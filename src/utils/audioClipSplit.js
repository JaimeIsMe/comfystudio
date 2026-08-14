const isVideoBackedAudioClip = (clip, track) => (
  clip?.type === 'video' && track?.type === 'audio'
)

export function isAudioClipRole(clip, track) {
  return clip?.type === 'audio' || isVideoBackedAudioClip(clip, track)
}

const clampFadeToPiece = (value, duration) => {
  const fade = Math.max(0, Number(value) || 0)
  const pieceDuration = Number(duration)
  return Number.isFinite(pieceDuration) && pieceDuration >= 0
    ? Math.min(fade, pieceDuration)
    : fade
}

export function buildAudioClipSplitState(clip, track, asset, pieceDurations = {}) {
  if (!isAudioClipRole(clip, track)) return null

  const sourceScale = Number(clip?.sourceTimeScale)
  const sourceFps = Number(clip?.sourceFps)
  const timelineFps = Number(clip?.timelineFps)
  const fallbackSourceScale = (
    Number.isFinite(sourceFps) && sourceFps > 0
    && Number.isFinite(timelineFps) && timelineFps > 0
  ) ? timelineFps / sourceFps : 1
  const speed = Number(clip?.speed)
  const normalizedSourceScale = Number.isFinite(sourceScale) && sourceScale > 0
    ? sourceScale
    : fallbackSourceScale
  const normalizedSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1
  const trimStart = Number(clip?.trimStart)
  const trimEnd = Number(clip?.trimEnd ?? clip?.sourceDuration)
  const leftDuration = Number(pieceDurations.left)
  const hasReverseSplitRange = Boolean(
    clip?.reverse === true
    && Number.isFinite(trimStart)
    && Number.isFinite(trimEnd)
    && Number.isFinite(leftDuration)
    && leftDuration >= 0
  )
  const lowerTrim = hasReverseSplitRange ? Math.min(trimStart, trimEnd) : null
  const upperTrim = hasReverseSplitRange ? Math.max(trimStart, trimEnd) : null
  const reverseBoundary = hasReverseSplitRange
    ? Math.max(lowerTrim, Math.min(upperTrim, upperTrim - leftDuration * normalizedSourceScale * normalizedSpeed))
    : null

  return {
    asset: asset?.type === 'audio' ? asset : { ...asset, type: 'audio' },
    leftClipUpdates: {
      type: 'audio',
      gainDb: clip?.gainDb,
      fadeIn: clampFadeToPiece(clip?.fadeIn, pieceDurations.left),
      fadeOut: 0,
      ...(hasReverseSplitRange ? { trimStart: reverseBoundary, trimEnd: upperTrim } : {}),
    },
    rightClipOptions: {
      gainDb: clip?.gainDb,
      fadeIn: 0,
      fadeOut: clampFadeToPiece(clip?.fadeOut, pieceDurations.right),
      sourceTimeScale: normalizedSourceScale,
      speed: normalizedSpeed,
      reverse: clip?.reverse === true,
      ...(hasReverseSplitRange ? { trimStart: lowerTrim, trimEnd: reverseBoundary } : {}),
      ...(Number.isFinite(sourceFps) && sourceFps > 0 ? { sourceFps } : {}),
      ...(Number.isFinite(timelineFps) && timelineFps > 0 ? { timelineFps } : {}),
    },
  }
}

export function normalizeVideoBackedAudioClips(clips = [], tracks = []) {
  const audioTrackIds = new Set(
    tracks.filter((track) => track?.type === 'audio').map((track) => track.id)
  )

  return clips.map((clip) => (
    clip?.type === 'video' && audioTrackIds.has(clip.trackId)
      ? { ...clip, type: 'audio' }
      : clip
  ))
}
