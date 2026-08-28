import { isBetweenClipTransition } from './transitionKinds.js'
import { getRampedSourceOffset, getRampedSpeedBounds, hasSpeedRamp } from './timeRemap.js'

export const FRAME_SAMPLING_MODE = Object.freeze({
  FRAME: 'frame',
  BLEND: 'blend',
  OPTICAL_FLOW: 'optical-flow',
})

export const OPTICAL_FLOW_CACHE_VERSION = 'rife_ncnn_vulkan_v46_uhd_v1'
export const OPTICAL_FLOW_CACHE_ENGINE = 'rife-ncnn-vulkan'
export const OPTICAL_FLOW_CACHE_MODEL = 'rife-v4.6'
export const OPTICAL_FLOW_MAX_MULTIPLIER = 4
export const OPTICAL_FLOW_MAX_FPS = 120
export const OPTICAL_FLOW_HANDLE_SECONDS = 1

const CACHE_EPSILON = 1 / 1000
const transitionHandleCache = new WeakMap()

const positiveNumber = (value, fallback = null) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function normalizeFrameSamplingMode(value) {
  if (value === FRAME_SAMPLING_MODE.BLEND) return FRAME_SAMPLING_MODE.BLEND
  if (value === FRAME_SAMPLING_MODE.OPTICAL_FLOW) return FRAME_SAMPLING_MODE.OPTICAL_FLOW
  return FRAME_SAMPLING_MODE.FRAME
}

export function isSafeOpticalFlowCachePath(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//')) return false
  const parts = normalized.split('/')
  return parts.length === 2
    && parts[0] === 'cache'
    && parts[1].length > 0
    && parts[1] !== '.'
    && parts[1] !== '..'
    && /^[a-zA-Z0-9._-]+\.mp4$/i.test(parts[1])
}

export function getOpticalFlowSourceSignature(fileInfoResult) {
  const info = fileInfoResult?.info || fileInfoResult
  const size = Number(info?.size)
  const modified = info?.modified || info?.mtimeMs || null
  return Number.isFinite(size) && modified ? `${size}|${modified}` : null
}

export function getClipMinimumSpeed(clip) {
  const baseSpeed = positiveNumber(clip?.speed, 1)
  if (!hasSpeedRamp(clip)) return baseSpeed
  return Math.max(0.05, Math.min(baseSpeed, getRampedSpeedBounds(clip).min))
}

export function getClipMaximumSpeed(clip) {
  const baseSpeed = positiveNumber(clip?.speed, 1)
  if (!hasSpeedRamp(clip)) return baseSpeed
  return Math.max(baseSpeed, getRampedSpeedBounds(clip).max)
}

const getClipSourceOffsetAtTime = (clip, clipTime) => (
  hasSpeedRamp(clip)
    ? getRampedSourceOffset(clip, clipTime)
    : clipTime * positiveNumber(clip?.speed, 1)
)

const normalizeTransitionSplit = (split = null, alignment = 'center') => {
  if (split && Number.isFinite(Number(split.clipA)) && Number.isFinite(Number(split.clipB))) {
    const clipA = Math.max(0, Number(split.clipA))
    const clipB = Math.max(0, Number(split.clipB))
    const total = clipA + clipB
    if (total > 0) return { clipA: clipA / total, clipB: clipB / total }
  }
  if (alignment === 'start') return { clipA: 1, clipB: 0 }
  if (alignment === 'end') return { clipA: 0, clipB: 1 }
  return { clipA: 0.5, clipB: 0.5 }
}

/**
 * Source-seconds of head/tail media a between-transition can request outside
 * the clip's nominal trim. The default one-second handle remains for normal
 * editing; long transitions and fast edge speeds expand it deterministically.
 */
export function getRequiredOpticalFlowHandleSeconds(clip, transitions = [], clips = []) {
  if (!clip?.id) return OPTICAL_FLOW_HANDLE_SECONDS
  if (clip && typeof clip === 'object') {
    const cached = transitionHandleCache.get(clip)
    if (cached?.transitions === transitions && cached?.clips === clips) return cached.value
  }
  const clipStart = Number(clip.startTime) || 0
  const clipEnd = clipStart + Math.max(0, Number(clip.duration) || 0)
  let maxHeadTimelineExtension = 0
  let maxTailTimelineExtension = 0

  for (const transition of transitions || []) {
    if (!isBetweenClipTransition(transition)) continue
    if (transition.clipAId !== clip.id && transition.clipBId !== clip.id) continue
    const clipA = (clips || []).find((item) => item?.id === transition.clipAId)
    const clipB = (clips || []).find((item) => item?.id === transition.clipBId)
    if (!clipA || !clipB || clipA.trackId !== clipB.trackId) continue
    const duration = Math.max(0, Number(transition.duration) || 0)
    const split = normalizeTransitionSplit(
      transition?.settings?.split,
      transition?.settings?.alignment || 'center'
    )
    const editPoint = Number.isFinite(Number(transition.editPoint))
      ? Number(transition.editPoint)
      : ((Number(clipA.startTime) || 0) + (Number(clipA.duration) || 0))
    const transitionStart = editPoint - duration * split.clipA
    const transitionEnd = editPoint + duration * split.clipB
    maxHeadTimelineExtension = Math.max(maxHeadTimelineExtension, Math.max(0, clipStart - transitionStart))
    maxTailTimelineExtension = Math.max(maxTailTimelineExtension, Math.max(0, transitionEnd - clipEnd))
  }

  const baseScale = positiveNumber(
    clip?.sourceTimeScale,
    positiveNumber(clip?.timelineFps, null) && positiveNumber(clip?.sourceFps, null)
      ? Number(clip.timelineFps) / Number(clip.sourceFps)
      : 1
  )
  const clipDuration = Math.max(0, Number(clip.duration) || 0)
  const nominalEndOffset = getClipSourceOffsetAtTime(clip, clipDuration)
  const headSourceSeconds = Math.max(
    0,
    -getClipSourceOffsetAtTime(clip, -maxHeadTimelineExtension) * baseScale
  )
  const tailSourceSeconds = Math.max(
    0,
    (getClipSourceOffsetAtTime(clip, clipDuration + maxTailTimelineExtension) - nominalEndOffset) * baseScale
  )
  const value = Math.max(OPTICAL_FLOW_HANDLE_SECONDS, headSourceSeconds, tailSourceSeconds)
  if (clip && typeof clip === 'object') {
    transitionHandleCache.set(clip, { transitions, clips, value })
  }
  return value
}

export function getRequiredOpticalFlowTargetFps(clip, options = {}) {
  const timelineFps = positiveNumber(options.timelineFps ?? clip?.timelineFps, 24)
  const sourceFps = positiveNumber(options.sourceFps ?? clip?.sourceFps, timelineFps)
  const sourceTimeScale = positiveNumber(
    clip?.sourceTimeScale,
    timelineFps / sourceFps
  )
  const minimumSpeed = getClipMinimumSpeed(clip)
  const multiplierCap = sourceFps * OPTICAL_FLOW_MAX_MULTIPLIER
  // Build only enough source frames for the slowest point in the current
  // timewarp at the timeline cadence. Delivery/export FPS can resample this
  // timeline master and must not force an unnecessarily dense cache rebuild.
  const requiredFps = timelineFps / (sourceTimeScale * minimumSpeed)
  return Math.max(
    1,
    Number(Math.min(OPTICAL_FLOW_MAX_FPS, multiplierCap, requiredFps).toFixed(6))
  )
}

export function getRequiredOpticalFlowSourceRange(clip, options = {}) {
  const trimStart = Math.max(0, Number(clip?.trimStart) || 0)
  const duration = Math.max(0, Number(clip?.duration) || 0)
  const sourceDuration = positiveNumber(clip?.sourceDuration, null)
  const baseScale = positiveNumber(
    clip?.sourceTimeScale,
    positiveNumber(clip?.timelineFps, null) && positiveNumber(clip?.sourceFps, null)
      ? Number(clip.timelineFps) / Number(clip.sourceFps)
      : 1
  )
  const rawTrimEnd = Number(clip?.trimEnd)
  // Use the same nominal-end contract as preview/export. A speed ramp can
  // consume less than the available trim or exhaust it early; in either case
  // playback reaches only the integrated end clamped to the trim boundary.
  // Transition handles then extrapolate from that clamped boundary.
  const mappedEnd = trimStart + baseScale * getClipSourceOffsetAtTime(clip, duration)
  const usedEnd = Number.isFinite(rawTrimEnd)
    ? Math.max(trimStart, Math.min(mappedEnd, rawTrimEnd))
    : Math.max(trimStart, mappedEnd)
  const handleSeconds = Math.max(0, Number(options.handleSeconds ?? OPTICAL_FLOW_HANDLE_SECONDS) || 0)
  const sourceStart = Math.max(0, trimStart - handleSeconds)
  const unclampedEnd = usedEnd + handleSeconds
  const sourceEnd = sourceDuration === null
    ? unclampedEnd
    : Math.min(sourceDuration, unclampedEnd)

  return {
    sourceStart,
    sourceEnd: Math.max(sourceStart, sourceEnd),
    duration: Math.max(0, sourceEnd - sourceStart),
  }
}

export function getOpticalFlowCacheEntry(clip) {
  const cache = clip?.opticalFlowCache
  return cache && typeof cache === 'object' ? cache : null
}

export function getFrameSamplingSignature(clip) {
  const mode = normalizeFrameSamplingMode(clip?.frameSampling)
  if (mode !== FRAME_SAMPLING_MODE.OPTICAL_FLOW) return { mode }

  const cache = getOpticalFlowCacheEntry(clip)
  return {
    mode,
    cache: cache
      ? {
          version: cache.version || null,
          path: cache.path || null,
          sourceStart: Number.isFinite(Number(cache.sourceStart)) ? Number(cache.sourceStart) : null,
          sourceEnd: Number.isFinite(Number(cache.sourceEnd)) ? Number(cache.sourceEnd) : null,
          targetFps: Number.isFinite(Number(cache.targetFps)) ? Number(cache.targetFps) : null,
          requestedTargetFps: Number.isFinite(Number(cache.requestedTargetFps)) ? Number(cache.requestedTargetFps) : null,
          sourceSignature: cache.sourceSignature || null,
          engine: cache.engine || null,
          engineVersion: cache.engineVersion || null,
          modelName: cache.modelName || null,
          sourceFrameCount: Number.isFinite(Number(cache.sourceFrameCount)) ? Number(cache.sourceFrameCount) : null,
          frameCount: Number.isFinite(Number(cache.frameCount)) ? Number(cache.frameCount) : null,
        }
      : null,
  }
}

export function getOpticalFlowCacheUsability(clip, options = {}) {
  if (normalizeFrameSamplingMode(clip?.frameSampling) !== FRAME_SAMPLING_MODE.OPTICAL_FLOW) {
    return { usable: false, reason: 'not-selected', cache: getOpticalFlowCacheEntry(clip) }
  }
  if (clip?.type !== 'video') {
    return { usable: false, reason: 'not-video', cache: getOpticalFlowCacheEntry(clip) }
  }
  if (clip?.reverse) {
    return { usable: false, reason: 'reverse-unsupported', cache: getOpticalFlowCacheEntry(clip) }
  }

  const cache = getOpticalFlowCacheEntry(clip)
  if (!cache) return { usable: false, reason: 'missing', cache: null }
  if (cache.version !== OPTICAL_FLOW_CACHE_VERSION) return { usable: false, reason: 'version', cache }
  if (cache.engine !== OPTICAL_FLOW_CACHE_ENGINE) return { usable: false, reason: 'engine', cache }
  if (cache.modelName !== OPTICAL_FLOW_CACHE_MODEL) return { usable: false, reason: 'model', cache }
  if (cache.status !== 'ready') return { usable: false, reason: cache.status || 'missing', cache }
  if (!cache.path) return { usable: false, reason: 'path', cache }
  if (options.requireUrl !== false && !cache.url) return { usable: false, reason: 'url', cache }

  const requiredRange = getRequiredOpticalFlowSourceRange(clip, options)
  const cachedStart = Number(cache.sourceStart)
  const cachedEnd = Number(cache.sourceEnd)
  if (!Number.isFinite(cachedStart) || !Number.isFinite(cachedEnd) || cachedEnd <= cachedStart) {
    return { usable: false, reason: 'bounds', cache, requiredRange }
  }
  if (cachedStart > requiredRange.sourceStart + CACHE_EPSILON) {
    return { usable: false, reason: 'head-coverage', cache, requiredRange }
  }
  if (cachedEnd + CACHE_EPSILON < requiredRange.sourceEnd) {
    return { usable: false, reason: 'tail-coverage', cache, requiredRange }
  }

  const requiredFps = getRequiredOpticalFlowTargetFps(clip, options)
  // requestedTargetFps is provenance. Cache sufficiency must be based on the
  // rate that was actually encoded, especially for very short source ranges
  // where converting a requested rate to a whole frame count can quantize it.
  const cachedFps = positiveNumber(cache.targetFps, null)
  if (cachedFps === null || cachedFps + CACHE_EPSILON < requiredFps) {
    return { usable: false, reason: 'fps', cache, requiredRange, requiredFps }
  }

  return { usable: true, reason: null, cache, requiredRange, requiredFps }
}

export function isOpticalFlowCacheUsable(clip, options = {}) {
  return getOpticalFlowCacheUsability(clip, options).usable
}

export function mapOriginalSourceTimeToOpticalFlowCache(clip, sourceTime, options = {}) {
  const usability = getOpticalFlowCacheUsability(clip, options)
  if (!usability.usable) return null
  const cacheStart = Number(usability.cache.sourceStart)
  const cacheEnd = Number(usability.cache.sourceEnd)
  const endOffset = Math.max(0, Number(options.endOffset) || 0)
  const clampedOriginal = Math.max(cacheStart, Math.min(Number(sourceTime) || 0, cacheEnd - endOffset))
  return {
    time: Math.max(0, clampedOriginal - cacheStart),
    originalTime: clampedOriginal,
    rawTime: (Number(sourceTime) || 0) - cacheStart,
    clamped: Math.abs(clampedOriginal - (Number(sourceTime) || 0)) > CACHE_EPSILON,
    minTime: 0,
    maxTime: Math.max(0, cacheEnd - cacheStart),
    sourceStart: cacheStart,
    sourceEnd: cacheEnd,
    targetFps: Number(usability.cache.targetFps),
  }
}
