import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'

/**
 * Get the topmost video or image clip at the given time (for capture).
 * Returns { clip, track } or null.
 */
export function getTopmostVideoOrImageClipAtTime(time) {
  try {
    if (time == null || typeof time !== 'number' || Number.isNaN(time)) return null
    const timelineState = useTimelineStore.getState()
    if (!timelineState || typeof timelineState.getActiveClipsAtTime !== 'function') return null
    const tracks = timelineState.tracks
    if (!Array.isArray(tracks)) return null
    const activeClips = timelineState.getActiveClipsAtTime(time)
    if (!Array.isArray(activeClips)) return null
    // Video 1 = top; lower track index = higher in stack
    const videoLayerClips = activeClips
      .filter(({ track }) => track && track.type === 'video')
      .sort((a, b) => {
        const indexA = tracks.findIndex((t) => t && t.id === a.track.id)
        const indexB = tracks.findIndex((t) => t && t.id === b.track.id)
        return indexA - indexB
      })
    const top = videoLayerClips.find(({ clip }) => clip?.type === 'video' || clip?.type === 'image')
    if (!top || !top.clip) return null
    const { clip } = top
    if (clip.type === 'video' || clip.type === 'image') return top
    return null
  } catch (_) {
    return null
  }
}

/**
 * Extract source time (in seconds) for a clip at the given timeline time.
 */
function getSourceTimeForClip(clip, timelineTime) {
  const clipTime = timelineTime - clip.startTime
  const baseScale = clip.sourceTimeScale || (clip.timelineFps && clip.sourceFps
    ? clip.timelineFps / clip.sourceFps
    : 1)
  const speed = Number(clip.speed)
  const speedScale = Number.isFinite(speed) && speed > 0 ? speed : 1
  const timeScale = baseScale * speedScale
  const trimStart = clip.trimStart || 0
  const reverse = !!clip.reverse
  const trimEnd = clip.trimEnd ?? clip.sourceDuration ?? trimStart
  const rawSourceTime = reverse
    ? trimEnd - clipTime * timeScale
    : trimStart + clipTime * timeScale
  const maxSourceTime = clip.sourceDuration ?? clip.duration ?? trimEnd
  return Math.max(0, Math.min(rawSourceTime, maxSourceTime - 0.001))
}

/**
 * Capture the frame from the topmost video or image clip at the given timeline time.
 * Returns Promise<{ blobUrl, file }> or Promise<null> if no clip or error.
 */
export function captureTimelineFrameAt(time) {
  try {
    const assetsState = useAssetsStore.getState()
    if (!assetsState || typeof assetsState.getAssetById !== 'function') return Promise.resolve(null)
    const top = getTopmostVideoOrImageClipAtTime(time)
    if (!top) return Promise.resolve(null)
    const { clip } = top
    const asset = assetsState.getAssetById(clip.assetId)
    if (!asset?.url) return Promise.resolve(null)

  if (clip.type === 'image') {
    return fetch(asset.url)
      .then((r) => r.blob())
      .then((blob) => {
        const file = new File([blob], `timeline_frame_${Date.now()}.png`, { type: 'image/png' })
        const blobUrl = URL.createObjectURL(blob)
        return { blobUrl, file }
      })
      .catch(() => null)
  }

  if (clip.type === 'video') {
    const sourceTime = getSourceTimeForClip(clip, time)
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.muted = true
      video.preload = 'auto'
      video.src = asset.url

      video.onloadedmetadata = () => {
        video.currentTime = Math.min(sourceTime, Math.max(0, (video.duration || 0) - 0.01))
      }

      video.onseeked = () => {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        canvas.getContext('2d').drawImage(video, 0, 0)
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const file = new File([blob], `timeline_frame_${Date.now()}.png`, { type: 'image/png' })
              const blobUrl = URL.createObjectURL(blob)
              resolve({ blobUrl, file })
            } else {
              resolve(null)
            }
          },
          'image/png'
        )
      }

      video.onerror = () => resolve(null)
    })
  }

  return Promise.resolve(null)
  } catch (_) {
    return Promise.resolve(null)
  }
}
