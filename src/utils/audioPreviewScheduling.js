export const AUDIO_PREVIEW_LOOKAHEAD_SECONDS = 2.5
export const AUDIO_PREVIEW_RETENTION_SECONDS = 1
export const AUDIO_PREVIEW_MAX_ENTRIES = 16
export const AUDIO_PREVIEW_SEEK_TOLERANCE_SECONDS = 0.04
export const AUDIO_PREVIEW_START_ALIGNMENT_TOLERANCE_SECONDS = 0.12
export const AUDIO_PREVIEW_DRIFT_THRESHOLD_SECONDS = 0.45
export const AUDIO_PREVIEW_DRIFT_CHECK_INTERVAL_MS = 750
export const AUDIO_PREVIEW_SEEK_COOLDOWN_MS = 900

const finiteNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function resolveAudioPreviewUrl({
  preferredUrl = null,
  sourceUrl = null,
  currentUrl = null,
  playing = false,
  failedUrl = null,
  failedUrls = null,
} = {}) {
  const hasFailed = (url) => Boolean(
    url
    && (
      url === failedUrl
      || (failedUrls instanceof Set && failedUrls.has(url))
      || (Array.isArray(failedUrls) && failedUrls.includes(url))
    )
  )
  const preferred = preferredUrl || sourceUrl || null
  const usablePreferred = preferred && !hasFailed(preferred)
    ? preferred
    : (sourceUrl && !hasFailed(sourceUrl) ? sourceUrl : null)

  // A cache may become ready while a clip is already sounding. Swapping the
  // media source at that moment guarantees a cold-load dropout, so retain the
  // current playable URL until the entry is no longer sounding. Paused clips
  // may safely adopt and pre-seek a newly ready cache.
  if (playing && currentUrl && !hasFailed(currentUrl)) return currentUrl
  return usablePreferred || (currentUrl && !hasFailed(currentUrl) ? currentUrl : null)
}

export function getAudioClipTimeScale(clip) {
  const sourceScale = Number(clip?.sourceTimeScale)
  const timelineFps = Number(clip?.timelineFps)
  const sourceFps = Number(clip?.sourceFps)
  const baseScale = Number.isFinite(sourceScale) && sourceScale > 0
    ? sourceScale
    : (
      Number.isFinite(timelineFps) && timelineFps > 0
      && Number.isFinite(sourceFps) && sourceFps > 0
        ? timelineFps / sourceFps
        : 1
    )
  const speed = Number(clip?.speed)
  const speedScale = Number.isFinite(speed) && speed > 0 ? speed : 1
  return baseScale * speedScale
}

export function getAudioSourceTimeAtTimeline(clip, timelineTime) {
  const startTime = finiteNumber(clip?.startTime)
  const duration = Math.max(0, finiteNumber(clip?.duration))
  const timeScale = getAudioClipTimeScale(clip)
  const trimStart = finiteNumber(clip?.trimStart)
  const fallbackTrimEnd = trimStart + duration * timeScale
  const trimEnd = finiteNumber(
    clip?.trimEnd ?? clip?.sourceDuration,
    fallbackTrimEnd
  )
  const minTime = Math.min(trimStart, trimEnd)
  const maxTime = Math.max(trimStart, trimEnd)
  const clipTime = finiteNumber(timelineTime) - startTime
  const sourceTime = clip?.reverse
    ? trimEnd - clipTime * timeScale
    : trimStart + clipTime * timeScale
  const upperBound = Math.max(minTime, maxTime - 0.01)
  return Math.max(minTime, Math.min(sourceTime, upperBound))
}

const getClipWindow = (clip, playheadPosition) => {
  const start = finiteNumber(clip?.startTime)
  const duration = Math.max(0, finiteNumber(clip?.duration))
  const end = start + duration
  const playhead = finiteNumber(playheadPosition)
  const active = duration > 0 && playhead >= start && playhead < end
  const distance = active
    ? 0
    : playhead < start
      ? start - playhead
      : playhead - end
  return { start, end, active, distance }
}

/**
 * Select a bounded set of audio clips to keep backed by HTMLMediaElements.
 * Active clips are never dropped by the cap. Upcoming clips are preferred
 * over recently-ended clips so short cuts have time to load and seek before
 * their first audible frame.
 */
export function selectAudioPreviewCandidates({
  clips = [],
  tracks = [],
  playheadPosition = 0,
  playbackRate = 1,
  lookaheadSeconds = AUDIO_PREVIEW_LOOKAHEAD_SECONDS,
  retentionSeconds = AUDIO_PREVIEW_RETENTION_SECONDS,
  maxEntries = AUDIO_PREVIEW_MAX_ENTRIES,
  isTrackAudible = null,
} = {}) {
  const playhead = finiteNumber(playheadPosition)
  const isForward = finiteNumber(playbackRate, 1) >= 0
  const lookahead = Math.max(0, finiteNumber(lookaheadSeconds, AUDIO_PREVIEW_LOOKAHEAD_SECONDS))
  const retention = Math.max(0, finiteNumber(retentionSeconds, AUDIO_PREVIEW_RETENTION_SECONDS))
  const entryCap = Math.max(1, Math.floor(finiteNumber(maxEntries, AUDIO_PREVIEW_MAX_ENTRIES)))
  const trackMap = new Map((tracks || []).map((track) => [track?.id, track]))

  const candidates = []
  for (const clip of clips || []) {
    if (!clip || clip.enabled === false) continue
    const track = trackMap.get(clip.trackId)
    if (!track || track.type !== 'audio') continue
    if (typeof isTrackAudible === 'function' && !isTrackAudible(track)) continue

    const window = getClipWindow(clip, playhead)
    if (window.end <= window.start) continue

    const upcoming = isForward
      ? window.start > playhead && window.start - playhead <= lookahead
      : window.end <= playhead && playhead - window.end <= lookahead
    const retained = isForward
      ? window.end <= playhead && playhead - window.end <= retention
      : window.start > playhead && window.start - playhead <= retention

    if (!window.active && !upcoming && !retained) continue
    candidates.push({
      clip,
      track,
      active: window.active,
      upcoming,
      retained,
      distance: window.distance,
      prepareTimelineTime: window.active
        ? playhead
        : upcoming
          ? (isForward ? window.start : Math.max(window.start, window.end - 0.01))
          : null,
    })
  }

  candidates.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1
    if (a.distance !== b.distance) return a.distance - b.distance
    return finiteNumber(a.clip?.startTime) - finiteNumber(b.clip?.startTime)
  })

  const activeCount = candidates.reduce((count, candidate) => count + (candidate.active ? 1 : 0), 0)
  return candidates.slice(0, Math.max(entryCap, activeCount))
}

/**
 * Distinguish ordinary RAF advancement from an explicit seek, loop jump, or
 * playback start. This prevents normal playback from re-seeking every frame.
 */
export function isAudioTimelineDiscontinuity(previous, next, nowMs, toleranceSeconds = 0.2) {
  if (!previous) return true
  if (Boolean(previous.isPlaying) !== Boolean(next?.isPlaying)) return true

  const previousRate = finiteNumber(previous.playbackRate, 1)
  const nextRate = finiteNumber(next?.playbackRate, 1)
  if (Math.abs(previousRate - nextRate) > 0.001) return true

  if (!previous.isPlaying) {
    return Math.abs(finiteNumber(next?.playheadPosition) - finiteNumber(previous.playheadPosition)) > 0.001
  }

  const elapsedSeconds = Math.max(0, finiteNumber(nowMs) - finiteNumber(previous.sampledAtMs)) / 1000
  const expectedPosition = finiteNumber(previous.playheadPosition)
    + (previous.isPlaying ? elapsedSeconds * previousRate : 0)
  return Math.abs(finiteNumber(next?.playheadPosition) - expectedPosition) > Math.max(0, toleranceSeconds)
}

export function shouldCorrectAudioDrift({
  active,
  isPlaying,
  isSeeking,
  currentTime,
  expectedTime,
  nowMs,
  lastCheckAtMs = 0,
  lastSeekAtMs = 0,
  driftThresholdSeconds = AUDIO_PREVIEW_DRIFT_THRESHOLD_SECONDS,
  checkIntervalMs = AUDIO_PREVIEW_DRIFT_CHECK_INTERVAL_MS,
  seekCooldownMs = AUDIO_PREVIEW_SEEK_COOLDOWN_MS,
} = {}) {
  if (!active || !isPlaying || isSeeking) return false
  if (finiteNumber(nowMs) - finiteNumber(lastCheckAtMs) < checkIntervalMs) return false
  if (finiteNumber(nowMs) - finiteNumber(lastSeekAtMs) < seekCooldownMs) return false
  return Math.abs(finiteNumber(currentTime) - finiteNumber(expectedTime)) > driftThresholdSeconds
}

export function shouldAlignAudioBeforeStart({
  active,
  isPlaying,
  positionPrepared,
  attempts = 0,
  currentTime,
  expectedTime,
  toleranceSeconds = AUDIO_PREVIEW_START_ALIGNMENT_TOLERANCE_SECONDS,
} = {}) {
  if (!active || !isPlaying || !positionPrepared || attempts >= 1) return false
  return Math.abs(finiteNumber(currentTime) - finiteNumber(expectedTime)) > Math.max(0, toleranceSeconds)
}
