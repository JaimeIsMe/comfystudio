import { mapOriginalSourceTimeToOpticalFlowCache } from './frameSampling.js'
import { getRampedSourceOffset, getRampedSpeedAtTime, hasSpeedRamp } from './timeRemap.js'

export function getClipPlaybackTimingAtTimeline(clip, timelineTime, endOffset = 0.01, options = {}) {
  if (!clip) return { time: 0, rawTime: 0, clamped: false, minTime: 0, maxTime: 0 }
  const baseScale = clip.sourceTimeScale || (clip.timelineFps && clip.sourceFps
    ? clip.timelineFps / clip.sourceFps
    : 1)
  const speed = Number(clip.speed)
  const speedScale = Number.isFinite(speed) && speed > 0 ? speed : 1
  const timeScale = baseScale * speedScale
  const reverse = !!clip.reverse
  const trimStart = clip.trimStart || 0
  const rawTrimEnd = clip.trimEnd ?? clip.sourceDuration ?? (trimStart + (clip.duration || 0) * timeScale)
  const trimEnd = Number.isFinite(rawTrimEnd) ? rawTrimEnd : trimStart
  const sourceDuration = Number(clip.sourceDuration)
  const clipDuration = Math.max(0, Number(clip.duration) || 0)
  const clipLocalTime = timelineTime - (clip.startTime || 0)
  const nominalMinTime = Math.min(trimStart, trimEnd)
  const nominalMaxTime = Math.max(trimStart, trimEnd)
  const canUseHandles = !!options.allowHandles && Number.isFinite(sourceDuration) && sourceDuration > 0
  const handleBoundaryTime = clipLocalTime < 0
    ? 0
    : (clipLocalTime > clipDuration ? clipDuration : null)
  const usingHandles = canUseHandles && handleBoundaryTime !== null
  const minTime = usingHandles ? 0 : nominalMinTime
  const maxTime = usingHandles ? sourceDuration : nominalMaxTime
  const ramped = hasSpeedRamp(clip)
  const getRawSourceTime = (localTime) => (
    ramped
      ? trimStart + getRampedSourceOffset(clip, localTime) * baseScale
      : (reverse
        ? trimEnd - localTime * timeScale
        : trimStart + localTime * timeScale)
  )

  let sourceTime = getRawSourceTime(clipLocalTime)
  if (usingHandles) {
    // A transition may request media before/after a clip, but it must not
    // unfreeze a ramp that already exhausted its nominal trim while the
    // playhead is still inside the clip. Extrapolate only beyond the actual
    // clip boundary, starting from that boundary's trim-clamped source time.
    const boundarySourceTime = Math.max(
      nominalMinTime,
      Math.min(getRawSourceTime(handleBoundaryTime), nominalMaxTime)
    )
    const edgeSpeed = ramped
      ? getRampedSpeedAtTime(clip, handleBoundaryTime) * baseScale
      : timeScale
    const direction = reverse ? -1 : 1
    sourceTime = boundarySourceTime
      + (clipLocalTime - handleBoundaryTime) * edgeSpeed * direction
  }
  const safeMaxTime = Math.max(minTime, maxTime - endOffset)
  const clampedTime = Math.max(minTime, Math.min(sourceTime, safeMaxTime))
  const opticalMapping = options.useFrameSampling === false
    ? null
    : mapOriginalSourceTimeToOpticalFlowCache(clip, clampedTime, {
        requireUrl: options.requireUrl !== false,
        endOffset,
        handleSeconds: options.handleSeconds,
      })
  if (opticalMapping) {
    return {
      time: opticalMapping.time,
      rawTime: sourceTime - opticalMapping.sourceStart,
      clamped: opticalMapping.clamped || Math.abs(clampedTime - sourceTime) > 0.001,
      minTime: Math.max(0, minTime - opticalMapping.sourceStart),
      maxTime: Math.min(opticalMapping.maxTime, Math.max(0, maxTime - opticalMapping.sourceStart)),
      usingOpticalFlow: true,
    }
  }
  return {
    time: clampedTime,
    rawTime: sourceTime,
    clamped: Math.abs(clampedTime - sourceTime) > 0.001,
    minTime,
    maxTime,
    usingOpticalFlow: false,
  }
}

export function getClipPlaybackTimeAtTimeline(clip, timelineTime, endOffset = 0.01, options = {}) {
  return getClipPlaybackTimingAtTimeline(clip, timelineTime, endOffset, options).time
}
