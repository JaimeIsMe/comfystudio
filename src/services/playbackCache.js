/**
 * Playback cache service (Flame-style)
 * Transcodes imported video to a playback-optimized format (H.264, keyframe every 6, no B-frames)
 * so timeline preview is smooth regardless of source format.
 */

import { isElectron } from './fileSystem'
import { getProjectFileUrl } from './fileSystem'

const CACHE_DIR = 'cache'
const PREFIX = 'playback_'
const EXT = '.mp4'

/**
 * Sanitize asset id for use in filename
 */
function safeFilename(assetId) {
  if (!assetId || typeof assetId !== 'string') return 'asset'
  return assetId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
}

/**
 * Transcode a video file to playback-optimized format and save to project cache.
 * Same dimensions, H.264, keyframe every 6 frames, no B-frames.
 * @param {string} projectDir - Project directory path (Electron)
 * @param {string} assetId - Asset id (used for output filename)
 * @param {string} sourcePath - Absolute path to source video
 * @returns {Promise<{ success: boolean, relativePath?: string, error?: string }>}
 */
export async function transcodeVideoForPlayback(projectDir, assetId, sourcePath) {
  if (!isElectron() || !window.electronAPI?.transcodeForPlayback) {
    return { success: false, error: 'Playback cache only available in Electron' }
  }

  const cacheDirPath = await window.electronAPI.pathJoin(projectDir, CACHE_DIR)
  await window.electronAPI.createDirectory(cacheDirPath)

  const baseName = `${PREFIX}${safeFilename(assetId)}${EXT}`
  const outputPath = await window.electronAPI.pathJoin(cacheDirPath, baseName)
  const relativePath = `${CACHE_DIR}/${baseName}`

  const result = await window.electronAPI.transcodeForPlayback({
    inputPath: sourcePath,
    outputPath,
  })

  if (!result.success) {
    return { success: false, error: result.error }
  }
  return { success: true, relativePath }
}

/**
 * Enqueue a transcode job and update the asset when done.
 * Call this after adding a video asset (import, AI generate, Pexels).
 * Runs in background; playback uses original until cache is ready.
 * @param {string} projectDir - Project directory path
 * @param {string} assetId - Asset id
 * @param {string} sourcePath - Absolute path to source video file
 */
export async function enqueuePlaybackTranscode(projectDir, assetId, sourcePath) {
  if (!projectDir || !assetId || !sourcePath) return
  if (!isElectron()) {
    console.log('[PlaybackCache] Skipped (Electron only). Run the app with: npm run electron:dev')
    return
  }

  console.log('[PlaybackCache] Transcoding for smooth playback…', { assetId })

  const { useAssetsStore } = await import('../stores/assetsStore')
  useAssetsStore.getState().setPlaybackCacheStatus?.(assetId, 'encoding')

  try {
    const result = await transcodeVideoForPlayback(projectDir, assetId, sourcePath)
    if (!result.success) {
      useAssetsStore.getState().setPlaybackCacheStatus?.(assetId, 'failed')
      console.warn('[PlaybackCache] Transcode failed:', result.error, { assetId })
      return
    }

    const url = await getProjectFileUrl(projectDir, result.relativePath)
    useAssetsStore.getState().setPlaybackCache?.(assetId, result.relativePath, url)
    useAssetsStore.getState().setPlaybackCacheStatus?.(assetId, 'ready')
    console.log('[PlaybackCache] Ready — using cached file for playback:', { assetId, path: result.relativePath })
    if (typeof localStorage !== 'undefined' && localStorage.getItem('storyflow-debug-playback') === '1') {
      console.log('[PlaybackCache] (debug) URL:', url?.slice?.(0, 70) + '...')
    }
  } catch (err) {
    useAssetsStore.getState().setPlaybackCacheStatus?.(assetId, 'failed')
    console.warn('[PlaybackCache] Transcode error:', err.message || err, { assetId })
  }
}
