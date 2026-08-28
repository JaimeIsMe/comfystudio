import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FRAME_SAMPLING_MODE,
  OPTICAL_FLOW_CACHE_ENGINE,
  OPTICAL_FLOW_CACHE_MODEL,
  OPTICAL_FLOW_CACHE_VERSION,
  getClipMinimumSpeed,
  getClipMaximumSpeed,
  getFrameSamplingSignature,
  getOpticalFlowSourceSignature,
  getOpticalFlowCacheUsability,
  getRequiredOpticalFlowSourceRange,
  getRequiredOpticalFlowHandleSeconds,
  getRequiredOpticalFlowTargetFps,
  isSafeOpticalFlowCachePath,
  mapOriginalSourceTimeToOpticalFlowCache,
  normalizeFrameSamplingMode,
} from './frameSampling.js'
import { getRampedSourceOffset } from './timeRemap.js'

const makeClip = (overrides = {}) => ({
  id: 'clip-1',
  type: 'video',
  frameSampling: FRAME_SAMPLING_MODE.OPTICAL_FLOW,
  startTime: 0,
  duration: 4,
  trimStart: 10,
  trimEnd: 12,
  sourceDuration: 30,
  sourceFps: 24,
  timelineFps: 24,
  sourceTimeScale: 1,
  speed: 0.5,
  reverse: false,
  ...overrides,
})

const readyCache = (overrides = {}) => ({
  version: OPTICAL_FLOW_CACHE_VERSION,
  status: 'ready',
  path: 'cache/optical_flow_clip-1.mp4',
  url: 'file:///project/cache/optical_flow_clip-1.mp4',
  sourceStart: 9,
  sourceEnd: 13,
  targetFps: 96,
  requestedTargetFps: 96,
  engine: OPTICAL_FLOW_CACHE_ENGINE,
  modelName: OPTICAL_FLOW_CACHE_MODEL,
  ...overrides,
})

test('normalizes legacy and unknown frame sampling values to frame mode', () => {
  assert.equal(normalizeFrameSamplingMode(), FRAME_SAMPLING_MODE.FRAME)
  assert.equal(normalizeFrameSamplingMode('nearest'), FRAME_SAMPLING_MODE.FRAME)
  assert.equal(normalizeFrameSamplingMode('blend'), FRAME_SAMPLING_MODE.BLEND)
  assert.equal(normalizeFrameSamplingMode('optical-flow'), FRAME_SAMPLING_MODE.OPTICAL_FLOW)
})

test('cache signatures track rendered media identity without session state', () => {
  const clip = makeClip({
    opticalFlowCache: readyCache({
      progress: 73,
      error: 'transient',
      jobId: 'session-job',
      generatedAt: '2026-08-27T00:00:00.000Z',
      sourceSignature: '123|456',
      engine: OPTICAL_FLOW_CACHE_ENGINE,
      engineVersion: '20221029',
      modelName: OPTICAL_FLOW_CACHE_MODEL,
      frameCount: 288,
    }),
  })
  const signature = getFrameSamplingSignature(clip)

  assert.equal(signature.mode, FRAME_SAMPLING_MODE.OPTICAL_FLOW)
  assert.deepEqual(signature.cache, {
    version: OPTICAL_FLOW_CACHE_VERSION,
    path: 'cache/optical_flow_clip-1.mp4',
    sourceStart: 9,
    sourceEnd: 13,
    targetFps: 96,
    requestedTargetFps: 96,
    sourceSignature: '123|456',
    engine: OPTICAL_FLOW_CACHE_ENGINE,
    engineVersion: '20221029',
    modelName: OPTICAL_FLOW_CACHE_MODEL,
    sourceFrameCount: null,
    frameCount: 288,
  })
  assert.equal(Object.hasOwn(signature.cache, 'progress'), false)
  assert.deepEqual(getFrameSamplingSignature({ frameSampling: 'blend' }), { mode: 'blend' })
})

test('accepts only project-owned optical-flow MP4 cache paths', () => {
  assert.equal(isSafeOpticalFlowCachePath('cache/optical_flow_clip.mp4'), true)
  assert.equal(isSafeOpticalFlowCachePath('cache\\optical_flow_clip.mp4'), true)
  assert.equal(isSafeOpticalFlowCachePath('../cache/optical_flow_clip.mp4'), false)
  assert.equal(isSafeOpticalFlowCachePath('cache/../outside.mp4'), false)
  assert.equal(isSafeOpticalFlowCachePath('/tmp/optical_flow_clip.mp4'), false)
  assert.equal(isSafeOpticalFlowCachePath('C:/cache/optical_flow_clip.mp4'), false)
  assert.equal(isSafeOpticalFlowCachePath('cache/nested/optical_flow_clip.mp4'), false)
  assert.equal(isSafeOpticalFlowCachePath('cache/optical_flow_clip.webm'), false)
})

test('builds the same stable source signature used by cache hydration and export', () => {
  assert.equal(getOpticalFlowSourceSignature({ info: { size: 42, modified: '2026-08-27T12:00:00.000Z' } }), '42|2026-08-27T12:00:00.000Z')
  assert.equal(getOpticalFlowSourceSignature({ size: 42, mtimeMs: 1234 }), '42|1234')
  assert.equal(getOpticalFlowSourceSignature({ info: { size: 42 } }), null)
})

test('derives the minimum speed from a speed ramp', () => {
  const clip = makeClip({
    speed: 1,
    keyframes: { speed: [{ time: 0, value: 1 }, { time: 2, value: 0.25 }, { time: 4, value: 0.75 }] },
  })
  assert.equal(getClipMinimumSpeed(clip), 0.25)
  assert.equal(getClipMaximumSpeed(clip), 1)
  assert.equal(getRequiredOpticalFlowTargetFps(clip), 96)
})

test('expands source handles for long transitions at the clip speed', () => {
  const clipA = makeClip({ id: 'a', trackId: 'v1', startTime: 0, duration: 4, speed: 2 })
  const clipB = makeClip({ id: 'b', trackId: 'v1', startTime: 4, duration: 4, speed: 2 })
  const transitions = [{
    id: 't1',
    kind: 'between',
    clipAId: 'a',
    clipBId: 'b',
    duration: 3,
    editPoint: 4,
    settings: { alignment: 'center' },
  }]
  assert.equal(getRequiredOpticalFlowHandleSeconds(clipA, transitions, [clipA, clipB]), 3)
  assert.equal(getRequiredOpticalFlowHandleSeconds(clipB, transitions, [clipA, clipB]), 3)
  assert.deepEqual(getRequiredOpticalFlowSourceRange(clipA, { handleSeconds: 3 }), {
    sourceStart: 7,
    sourceEnd: 15,
    duration: 8,
  })
})

test('legacy clip-to-clip transitions without a kind still expand optical-flow handles', () => {
  const clipA = makeClip({ id: 'a', trackId: 'v1', startTime: 0, duration: 4, speed: 2 })
  const clipB = makeClip({ id: 'b', trackId: 'v1', startTime: 4, duration: 4, speed: 2 })
  const legacyTransition = {
    id: 'legacy',
    clipAId: 'a',
    clipBId: 'b',
    duration: 3,
    editPoint: 4,
    settings: { alignment: 'center' },
  }
  assert.equal(getRequiredOpticalFlowHandleSeconds(clipA, [legacyTransition], [clipA, clipB]), 3)
})

test('builds only the source rate needed by the current slow motion', () => {
  assert.equal(getRequiredOpticalFlowTargetFps(makeClip()), 48)
  assert.equal(getRequiredOpticalFlowTargetFps(makeClip({ speed: 1 })), 24)
  assert.equal(getRequiredOpticalFlowTargetFps(makeClip({ speed: 0.25 })), 96)
  assert.equal(getRequiredOpticalFlowTargetFps(makeClip({ sourceFps: 60, timelineFps: 24, sourceTimeScale: 0.4 })), 120)
})

test('caps optical-flow target rate at four times source and 120 fps', () => {
  assert.equal(getRequiredOpticalFlowTargetFps(makeClip({ speed: 0.1 })), 96)
  assert.equal(getRequiredOpticalFlowTargetFps(makeClip({ sourceFps: 23.976, speed: 0.1 })), 95.904)
  assert.equal(getRequiredOpticalFlowTargetFps(makeClip({ sourceFps: 60, timelineFps: 60, speed: 0.1 })), 120)
})

test('builds a bounded source range with handles', () => {
  assert.deepEqual(getRequiredOpticalFlowSourceRange(makeClip()), {
    sourceStart: 9,
    sourceEnd: 13,
    duration: 4,
  })
  assert.deepEqual(getRequiredOpticalFlowSourceRange(makeClip({ trimStart: 0.25, trimEnd: 1, duration: 1.5 })), {
    sourceStart: 0,
    sourceEnd: 2,
    duration: 2,
  })
})

test('uses integrated speed-ramp consumption instead of inflating the whole clip to peak speed', () => {
  const clip = makeClip({
    speed: 0.5,
    trimEnd: 12,
    keyframes: { speed: [{ time: 0, value: 0.5 }, { time: 2, value: 2 }] },
  })
  const range = getRequiredOpticalFlowSourceRange(clip)
  assert.equal(range.sourceStart, 9)
  assert.ok(Math.abs(range.sourceEnd - 13) < 0.001)
  assert.ok(Math.abs(range.duration - 4) < 0.001)
})

test('cubic-bezier ramp overshoot is covered through a long transition', () => {
  const clipA = makeClip({
    id: 'a',
    trackId: 'v1',
    startTime: 0,
    duration: 1,
    trimStart: 10,
    trimEnd: 20,
    sourceDuration: 100,
    speed: 1,
    keyframes: {
      speed: [
        { time: 0, value: 1, easing: 'cubic-bezier(0.25, 8, 0.75, 8)' },
        { time: 2, value: 2 },
      ],
    },
  })
  const clipB = makeClip({ id: 'b', trackId: 'v1', startTime: 1, duration: 1 })
  const transitions = [{
    kind: 'between',
    clipAId: 'a',
    clipBId: 'b',
    duration: 4,
    editPoint: 1,
    settings: { alignment: 'center' },
  }]
  const handleSeconds = getRequiredOpticalFlowHandleSeconds(clipA, transitions, [clipA, clipB])
  const range = getRequiredOpticalFlowSourceRange(clipA, { handleSeconds })
  const nominalEndSourceTime = Math.min(
    clipA.trimEnd,
    clipA.trimStart + getRampedSourceOffset(clipA, clipA.duration)
  )
  const transitionTailSourceTime = nominalEndSourceTime
    + (getRampedSourceOffset(clipA, 3) - getRampedSourceOffset(clipA, clipA.duration))

  assert.ok(getClipMaximumSpeed(clipA) > 7)
  assert.ok(range.sourceEnd + 0.001 >= transitionTailSourceTime)
  assert.ok(range.sourceEnd < 40, 'the exact integral should avoid a whole-clip 16x overestimate')
})

test('accepts a ready cache only when version, coverage, and fps are sufficient', () => {
  const clip = makeClip({ opticalFlowCache: readyCache() })
  assert.equal(getOpticalFlowCacheUsability(clip).usable, true)
  assert.equal(getOpticalFlowCacheUsability({ ...clip, opticalFlowCache: readyCache({ targetFps: 47, requestedTargetFps: 47 }) }).reason, 'fps')
  assert.equal(getOpticalFlowCacheUsability({ ...clip, opticalFlowCache: readyCache({ sourceStart: 9.5 }) }).reason, 'head-coverage')
  assert.equal(getOpticalFlowCacheUsability({ ...clip, opticalFlowCache: readyCache({ sourceEnd: 12.5 }) }).reason, 'tail-coverage')
  assert.equal(getOpticalFlowCacheUsability({ ...clip, opticalFlowCache: readyCache({ version: 'old' }) }).reason, 'version')
  assert.equal(getOpticalFlowCacheUsability({ ...clip, opticalFlowCache: readyCache({ engine: 'ffmpeg-minterpolate' }) }).reason, 'engine')
  assert.equal(getOpticalFlowCacheUsability({ ...clip, opticalFlowCache: readyCache({ modelName: 'rife-v4.25' }) }).reason, 'model')
})

test('uses the effective encoded rate for cache sufficiency', () => {
  const clip = makeClip({
    sourceFps: 23.976,
    timelineFps: 24,
    sourceTimeScale: 1,
    speed: 0.4,
    opticalFlowCache: readyCache({
      targetFps: 59.94,
      requestedTargetFps: 60,
    }),
  })
  assert.equal(getRequiredOpticalFlowTargetFps(clip), 60)
  assert.equal(getOpticalFlowCacheUsability(clip).reason, 'fps')

  const sufficientClip = {
    ...clip,
    opticalFlowCache: readyCache({
      targetFps: 60.1,
      requestedTargetFps: 60,
    }),
  }
  assert.equal(getOpticalFlowCacheUsability(sufficientClip).usable, true)
})

test('a longer transition invalidates cache coverage for URL selection and time mapping together', () => {
  const clip = makeClip({ opticalFlowCache: readyCache() })
  assert.equal(getOpticalFlowCacheUsability(clip, { handleSeconds: 1 }).usable, true)
  assert.equal(getOpticalFlowCacheUsability(clip, { handleSeconds: 3 }).reason, 'head-coverage')
  assert.equal(mapOriginalSourceTimeToOpticalFlowCache(clip, 10.5, { handleSeconds: 3 }), null)

  const rebuilt = {
    ...clip,
    opticalFlowCache: readyCache({ sourceStart: 7, sourceEnd: 15 }),
  }
  assert.equal(getOpticalFlowCacheUsability(rebuilt, { handleSeconds: 3 }).usable, true)
  assert.equal(mapOriginalSourceTimeToOpticalFlowCache(rebuilt, 10.5, { handleSeconds: 3 })?.time, 3.5)
})

test('requires a hydrated URL for preview but not for export path resolution', () => {
  const clip = makeClip({ opticalFlowCache: readyCache({ url: undefined }) })
  assert.equal(getOpticalFlowCacheUsability(clip).reason, 'url')
  assert.equal(getOpticalFlowCacheUsability(clip, { requireUrl: false }).usable, true)
})

test('maps original source seconds into cache-relative seconds', () => {
  const clip = makeClip({ opticalFlowCache: readyCache() })
  assert.deepEqual(mapOriginalSourceTimeToOpticalFlowCache(clip, 10.5), {
    time: 1.5,
    originalTime: 10.5,
    rawTime: 1.5,
    clamped: false,
    minTime: 0,
    maxTime: 4,
    sourceStart: 9,
    sourceEnd: 13,
    targetFps: 96,
  })
})

test('reverse and unselected clips never use an optical-flow cache', () => {
  const cache = readyCache()
  assert.equal(getOpticalFlowCacheUsability(makeClip({ reverse: true, opticalFlowCache: cache })).reason, 'reverse-unsupported')
  assert.equal(getOpticalFlowCacheUsability(makeClip({ frameSampling: 'frame', opticalFlowCache: cache })).reason, 'not-selected')
})
