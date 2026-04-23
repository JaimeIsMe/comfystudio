/**
 * Commit-render service — Flame-style "hard commit" for adjustment layers.
 *
 * User flow:
 *   1. User selects an adjustment clip.
 *   2. User clicks "Commit render" in the inspector.
 *   3. This service renders the composite of [that adjustment + everything
 *      beneath it] over the adjustment's time range into a single H.264 MP4.
 *   4. The MP4 is registered as a regular video asset, and a normal video
 *      clip is placed on a dedicated "Commits" track above the adjustment's
 *      track. Playback becomes trivially smooth because the compositor just
 *      plays that single top layer — no live multi-layer compositing.
 *
 * Iterating: user deletes the commit clip to re-expose the live composite.
 * No signature/staleness machinery — intentional, matches Flame semantics.
 *
 * Electron only: the render pipeline shells out to ffmpeg. Web fallback
 * returns an error.
 */

import { isElectron } from './fileSystem'
import { exportTimeline } from './exporter'
import useTimelineStore from '../stores/timelineStore'
import useProjectStore from '../stores/projectStore'
import useAssetsStore from '../stores/assetsStore'

const CACHE_DIR = 'cache'
const PREFIX = 'commit_'
const EXT = '.mp4'
const COMMITS_TRACK_NAME = 'Commits'

function safeClipId(clipId) {
  if (!clipId || typeof clipId !== 'string') return 'clip'
  return clipId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
}

function getOrCreateCommitsTrack(timeline) {
  const existing = (timeline.tracks || []).find(
    (track) => track?.type === 'video' && track?.name === COMMITS_TRACK_NAME
  )
  if (existing) return existing
  // addTrack returns the new track and puts video tracks at the top.
  return timeline.addTrack('video', { name: COMMITS_TRACK_NAME })
}

/**
 * Render a committed flatten of the selected adjustment clip.
 *
 * @param {string} adjustmentClipId
 * @param {object} [options]
 * @param {(progress:{status?:string, progress?:number}) => void} [options.onProgress]
 * @returns {Promise<{ success:true, assetId:string, clipId:string, outputPath:string, relativePath:string } | { success:false, error:string }>}
 */
export async function commitAdjustmentRender(adjustmentClipId, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {}

  if (!isElectron() || !window.electronAPI?.pathJoin) {
    return { success: false, error: 'Commit render is only available in Electron. Run: npm run electron:dev' }
  }
  if (!adjustmentClipId) {
    return { success: false, error: 'No adjustment clip specified.' }
  }

  const projectState = useProjectStore.getState()
  const projectHandle = projectState.currentProjectHandle
  if (!projectHandle || typeof projectHandle !== 'string') {
    return { success: false, error: 'No project folder open.' }
  }

  const timelineState = useTimelineStore.getState()
  const adjustmentClip = (timelineState.clips || []).find((clip) => clip?.id === adjustmentClipId)
  if (!adjustmentClip) {
    return { success: false, error: 'Adjustment clip not found.' }
  }
  if (adjustmentClip.type !== 'adjustment') {
    return { success: false, error: 'Commit render is only supported on adjustment clips.' }
  }

  const rangeStart = Number(adjustmentClip.startTime) || 0
  const duration = Number(adjustmentClip.duration) || 0
  if (!(duration > 0)) {
    return { success: false, error: 'Adjustment clip has zero duration.' }
  }
  const rangeEnd = rangeStart + duration

  const timelineSettings = projectState.getCurrentTimelineSettings?.() || { width: 1920, height: 1080, fps: 24 }
  const width = Number(timelineSettings.width) || 1920
  const height = Number(timelineSettings.height) || 1080
  const fps = Number(timelineSettings.fps) || 24

  // Resolve cache paths.
  const unix = Date.now()
  const baseName = `${PREFIX}${safeClipId(adjustmentClipId)}_${unix}${EXT}`
  const cacheDirPath = await window.electronAPI.pathJoin(projectHandle, CACHE_DIR)
  await window.electronAPI.createDirectory(cacheDirPath)
  const outputPath = await window.electronAPI.pathJoin(cacheDirPath, baseName)
  const relativePath = `${CACHE_DIR}/${baseName}`

  onProgress({ status: 'Preparing commit render…', progress: 0 })

  try {
    await exportTimeline(
      {
        outputPath,
        width,
        height,
        fps,
        rangeStart,
        rangeEnd,
        format: 'mp4',
        includeAudio: true,
        videoCodec: 'h264',
        keyframeInterval: 6,
        preset: 'fast',
        crf: 20,
        useCachedRenders: true,
        fastSeek: true,
      },
      onProgress
    )
  } catch (err) {
    const message = err?.message || String(err || 'Unknown export error')
    return { success: false, error: message }
  }

  // Build a URL the renderer can play.
  let url = null
  try {
    url = await window.electronAPI.getFileUrlDirect(outputPath)
  } catch (err) {
    return { success: false, error: `Render finished but could not load output: ${err?.message || err}` }
  }

  // Register as a regular imported video asset so every downstream consumer
  // (compositor, exporter, asset library) treats it identically to any clip.
  const assetsStore = useAssetsStore.getState()
  const baseLabel = adjustmentClip.name || 'Adjustment Layer'
  const assetName = `Commit: ${baseLabel}`
  const newAsset = assetsStore.addAsset({
    name: assetName,
    type: 'video',
    path: relativePath,
    absolutePath: outputPath,
    url,
    duration,
    width,
    height,
    fps,
    mimeType: 'video/mp4',
    isImported: true,
    hasAudio: true,
    audioEnabled: true,
    imported: new Date().toISOString(),
  })

  if (!newAsset?.id) {
    return { success: false, error: 'Render finished but asset could not be registered.' }
  }

  // Place the flattened clip on a dedicated "Commits" track above everything.
  const timeline = useTimelineStore.getState()
  const commitsTrack = getOrCreateCommitsTrack(timeline)
  if (!commitsTrack?.id) {
    return { success: false, error: 'Could not resolve Commits track.' }
  }

  const timelineFps = timeline.timelineFps || fps
  const newClip = timeline.addClip(
    commitsTrack.id,
    newAsset,
    rangeStart,
    timelineFps,
    { duration, selectAfterAdd: true }
  )

  if (!newClip?.id) {
    return { success: false, error: 'Render finished but clip could not be placed on the Commits track.' }
  }

  onProgress({ status: 'Commit render complete', progress: 100 })

  return {
    success: true,
    assetId: newAsset.id,
    clipId: newClip.id,
    outputPath,
    relativePath,
  }
}
