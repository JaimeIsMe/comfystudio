/**
 * Proxy cache service (NLE-style low-res preview proxies).
 *
 * Distinct from playbackCache.js:
 *   - playbackCache.js keeps source resolution, just re-encodes to a
 *     playback-friendly H.264 (faststart + dense keyframes). Good when one
 *     layer is active. At 1080p × 4 layers on the timeline, even this
 *     chokes because you still decode 4 × 1080p streams.
 *   - proxyCache.js drops to 540p (default). 4 × 540p is ~16× fewer pixels
 *     through the decoder than 4 × 2160p (Kling-style 4K output). This is
 *     the standard NLE trick (Premiere/Resolve/FCP proxies).
 *
 * Fallback chain in VideoLayerRenderer's resolvePlaybackUrl is:
 *   1. clip.cacheUrl          (mask/clip pre-render — most specific)
 *   2. asset.proxyUrl         (this file — only when user setting is on)
 *   3. asset.playbackCacheUrl (same-res transcode)
 *   4. asset.url              (source)
 *
 * Export NEVER consults proxyUrl. exporter.js uses asset.path directly.
 */

import { isElectron } from './fileSystem'
import { getProjectFileUrl } from './fileSystem'

const CACHE_DIR = 'cache'
const PREFIX = 'proxy_'
const EXT = '.mp4'

// Default target height. 540 is the NLE sweet spot: 1/4 the pixel count of
// 1080, looks fine for preview, decodes fast. Override via options if a
// future setting wants 720p "high-quality" proxies.
const DEFAULT_PROXY_HEIGHT = 540

function safeFilename(assetId) {
  if (!assetId || typeof assetId !== 'string') return 'asset'
  return assetId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
}

/**
 * A video asset has a *ready* proxy file on disk that playback can use.
 * Shared between the UI counter and the bulk transcoder so they cannot
 * disagree on what "ready" means.
 */
export function hasUsableProxy(asset) {
  return Boolean(asset?.proxyStatus === 'ready' && asset?.proxyPath)
}

/**
 * A video asset is *proxyable* if it has any form of resolvable local
 * source path. We accept either:
 *   - asset.absolutePath — already absolute, use as-is
 *   - asset.path         — project-relative, we'll resolve it against the
 *                          project dir at transcode time
 *
 * Assets with only a remote/blob URL and no local path cannot be proxied
 * by ffmpeg and are classified as "unavailable" instead of "missing" in
 * the UI — so the user isn't told a button will work when it can't.
 */
export function isProxyableVideoAsset(asset) {
  if (!asset || asset.type !== 'video') return false
  return Boolean(asset.absolutePath || asset.path)
}

/**
 * Resolve an asset's local source path for ffmpeg. Prefers absolutePath,
 * falls back to joining project-relative `path` with the project dir.
 * Returns null if neither form is available, or — when `verifyExists` is
 * true — if the resolved path does not actually exist on disk.
 *
 * The existence check saves us from spawning ffmpeg on known-broken links
 * (moved/deleted source files) only for those to fail and be marked
 * `proxyStatus: 'failed'`. Marking them directly is both faster and lets
 * the UI classify them distinctly from assets that simply haven't been
 * processed yet.
 */
async function resolveAssetSourcePath(projectDir, asset, { verifyExists = true } = {}) {
  let resolved = null
  if (asset?.absolutePath) {
    resolved = asset.absolutePath
  } else if (asset?.path && projectDir && window.electronAPI?.pathJoin) {
    try {
      resolved = await window.electronAPI.pathJoin(projectDir, asset.path)
    } catch {
      return null
    }
  }
  if (!resolved) return null

  if (verifyExists && window.electronAPI?.pathExists) {
    try {
      const exists = await window.electronAPI.pathExists(resolved)
      if (!exists) return null
    } catch {
      // On IPC failure, fall through and let ffmpeg make the final call —
      // better to try and fail explicitly than to silently skip a file
      // that might actually be readable.
    }
  }
  return resolved
}

/**
 * Transcode one video file to a low-res proxy and save it into the project
 * cache directory. Returns { success, relativePath } on success.
 */
export async function transcodeVideoForProxy(projectDir, assetId, sourcePath, options = {}) {
  if (!isElectron()) {
    return { success: false, error: 'Proxy cache only available in Electron' }
  }
  if (!window.electronAPI?.transcodeForProxy) {
    // The renderer has the new code (via Vite HMR) but the Electron main
    // process / preload is stale. Happens on the first run after adding
    // a new IPC handler. Fully restart the Electron dev process:
    //   Ctrl-C `npm run electron:dev`  →  `npm run electron:dev`
    return {
      success: false,
      error: 'Proxy IPC handler not loaded — restart Electron (npm run electron:dev). Source videos still play fine; this only affects proxy generation.',
    }
  }

  const cacheDirPath = await window.electronAPI.pathJoin(projectDir, CACHE_DIR)
  await window.electronAPI.createDirectory(cacheDirPath)

  const baseName = `${PREFIX}${safeFilename(assetId)}${EXT}`
  const outputPath = await window.electronAPI.pathJoin(cacheDirPath, baseName)
  const relativePath = `${CACHE_DIR}/${baseName}`

  const targetHeight = Number(options.targetHeight) || DEFAULT_PROXY_HEIGHT
  const result = await window.electronAPI.transcodeForProxy({
    inputPath: sourcePath,
    outputPath,
    targetHeight,
  })

  if (!result?.success) {
    return { success: false, error: result?.error || 'Unknown proxy transcode error' }
  }
  return { success: true, relativePath }
}

/**
 * Queue a proxy transcode for an asset and update the store on completion.
 * Safe to call alongside enqueuePlaybackTranscode — they write to separate
 * fields (proxy* vs playbackCache*) so both tiers can coexist.
 *
 * Callers typically do NOT await this; it runs in the background.
 */
export async function enqueueProxyTranscode(projectDir, assetId, sourcePath, options = {}) {
  if (!projectDir || !assetId || !sourcePath) return
  if (!isElectron()) return

  const { useAssetsStore } = await import('../stores/assetsStore')
  const store = useAssetsStore.getState()
  // Guard: don't re-encode a proxy that's already ready unless forced.
  if (!options.force) {
    const existing = store.assets.find((a) => a.id === assetId)
    if (existing?.proxyStatus === 'ready' && existing?.proxyPath) return
    if (existing?.proxyStatus === 'encoding') return
  }

  store.setProxyCacheStatus?.(assetId, 'encoding')

  try {
    const result = await transcodeVideoForProxy(projectDir, assetId, sourcePath, options)
    if (!result.success) {
      useAssetsStore.getState().setProxyCacheStatus?.(assetId, 'failed')
      console.warn('[ProxyCache] Transcode failed:', result.error, { assetId })
      return
    }

    const url = await getProjectFileUrl(projectDir, result.relativePath)
    useAssetsStore.getState().setProxyCache?.(assetId, result.relativePath, url)
    useAssetsStore.getState().setProxyCacheStatus?.(assetId, 'ready')
  } catch (err) {
    useAssetsStore.getState().setProxyCacheStatus?.(assetId, 'failed')
    console.warn('[ProxyCache] Transcode error:', err?.message || err, { assetId })
  }
}

/**
 * localStorage-backed user preference for "prefer proxies during preview".
 * Kept in a pure helper so both the renderer (VideoLayerRenderer) and the
 * UI toggle (PreviewPanel) read from the same key.
 */
export const PROXY_PLAYBACK_ENABLED_KEY = 'comfystudio-use-playback-proxies'

export function isProxyPlaybackEnabled() {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(PROXY_PLAYBACK_ENABLED_KEY) === 'true'
}

export function setProxyPlaybackEnabled(enabled) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(PROXY_PLAYBACK_ENABLED_KEY, enabled ? 'true' : 'false')
}

/**
 * Bulk-generate proxies for every video asset that doesn't have one yet.
 * Used by the "Generate missing proxies" button for retroactive application
 * after a user first turns the feature on (or opens an older project).
 *
 * Runs jobs serially so we don't thrash ffmpeg with N parallel spawns; each
 * job updates store state so the UI can show per-asset progress.
 *
 * Returns a summary object once all jobs finish (or stop).
 */
export async function generateMissingProxiesForAllVideos(projectDir, options = {}) {
  if (!isElectron()) {
    return { success: false, skipped: 0, encoded: 0, failed: 0, error: 'Electron only' }
  }
  if (!projectDir) {
    return { success: false, skipped: 0, encoded: 0, failed: 0, error: 'No project open' }
  }

  const { useAssetsStore } = await import('../stores/assetsStore')
  const allAssets = useAssetsStore.getState().assets || []
  // Shared predicate with the UI counter — see isProxyableVideoAsset. A
  // video is a candidate for (re)encoding when it has a resolvable local
  // path; force ignores both the "already ready" and "already failed"
  // gates so Rebuild All is the single escape hatch for retrying assets
  // the user just re-linked. Non-force ("Generate missing") intentionally
  // skips failed items so they don't churn silently in the background.
  const candidates = allAssets.filter((a) => {
    if (!isProxyableVideoAsset(a)) return false
    if (options.force) return true
    if (a?.proxyStatus === 'encoding') return false
    if (a?.proxyStatus === 'failed') return false
    return !hasUsableProxy(a)
  })

  let encoded = 0
  let failed = 0
  const skipped = (allAssets.filter((a) => a?.type === 'video').length - candidates.length)

  for (const asset of candidates) {
    if (options.shouldAbort?.()) break
    options.onStart?.(asset)
    // Resolve at call time so assets imported with only a relative `path`
    // (older projects, some generation pipelines) are transcoded against
    // their current project location instead of being silently skipped.
    const sourcePath = await resolveAssetSourcePath(projectDir, asset)
    if (!sourcePath) {
      useAssetsStore.getState().setProxyCacheStatus?.(asset.id, 'failed')
      failed += 1
      options.onFinish?.(asset)
      continue
    }
    // Awaiting here serialises the ffmpeg spawns.
    await enqueueProxyTranscode(projectDir, asset.id, sourcePath, { force: options.force })
    const latest = useAssetsStore.getState().assets.find((a) => a.id === asset.id)
    if (hasUsableProxy(latest)) encoded += 1
    else failed += 1
    options.onFinish?.(latest)
  }

  return { success: true, encoded, failed, skipped }
}
