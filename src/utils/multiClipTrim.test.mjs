import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createMultiClipTrimSession,
  getMultiClipTrimTargetIds,
  resolveMultiClipTrim,
} from './multiClipTrim.mjs'

const clip = (overrides = {}) => ({
  id: overrides.id || 'clip',
  type: 'video',
  trackId: overrides.trackId || `track-${overrides.id || 'clip'}`,
  startTime: 5,
  duration: 10,
  trimStart: 2,
  trimEnd: 12,
  sourceDuration: 20,
  speed: 1,
  sourceTimeScale: 1,
  ...overrides,
})

test('uses the full selection only when the grabbed clip is already selected', () => {
  assert.deepEqual(getMultiClipTrimTargetIds({
    selectedClipIds: ['a', 'b', 'c'],
    primaryClipId: 'b',
  }), ['a', 'b', 'c'])
  assert.deepEqual(getMultiClipTrimTargetIds({
    selectedClipIds: ['a', 'b'],
    primaryClipId: 'c',
  }), ['c'])
})

test('trims aligned tails together by the same timeline delta', () => {
  const clips = [clip({ id: 'a' }), clip({ id: 'b' }), clip({ id: 'c' })]
  const session = createMultiClipTrimSession({
    clips,
    targetClipIds: clips.map(({ id }) => id),
    primaryClipId: 'a',
    edge: 'right',
    fps: 24,
  })
  const result = resolveMultiClipTrim(session, -2)

  assert.equal(result.delta, -2)
  assert.deepEqual(result.updates.map(({ updates }) => updates.duration), [8, 8, 8])
  assert.deepEqual(result.updates.map(({ updates }) => updates.trimEnd), [10, 10, 10])
})

test('the strictest source tail limit constrains the whole selection', () => {
  const clips = [
    clip({ id: 'roomy', sourceDuration: 30 }),
    clip({ id: 'tight', sourceDuration: 12.5 }),
  ]
  const session = createMultiClipTrimSession({
    clips,
    targetClipIds: ['roomy', 'tight'],
    primaryClipId: 'roomy',
    edge: 'right',
    fps: 24,
  })
  const result = resolveMultiClipTrim(session, 4)

  assert.equal(result.delta, 0.5)
  assert.equal(result.constrained, true)
  assert.deepEqual(result.updates.map(({ updates }) => updates.duration), [10.5, 10.5])
})

test('a neighboring clip on any selected track constrains every tail', () => {
  const selectedA = clip({ id: 'a', trackId: 'v1', startTime: 0, trimStart: 0, trimEnd: 10 })
  const selectedB = clip({ id: 'b', trackId: 'v2', startTime: 0, trimStart: 0, trimEnd: 10 })
  const neighbor = clip({ id: 'next', trackId: 'v2', startTime: 11, duration: 3, trimStart: 0, trimEnd: 3 })
  const session = createMultiClipTrimSession({
    clips: [selectedA, selectedB, neighbor],
    targetClipIds: ['a', 'b'],
    primaryClipId: 'a',
    edge: 'right',
    fps: 24,
  })
  const result = resolveMultiClipTrim(session, 3)

  assert.equal(result.delta, 1)
  assert.deepEqual(result.updates.map(({ updates }) => updates.duration), [11, 11])
})

test('head extension preserves alignment and stops when one source reaches zero', () => {
  const clips = [
    clip({ id: 'a', trimStart: 4, trimEnd: 14 }),
    clip({ id: 'b', trimStart: 0.5, trimEnd: 10.5 }),
  ]
  const session = createMultiClipTrimSession({
    clips,
    targetClipIds: ['a', 'b'],
    primaryClipId: 'a',
    edge: 'left',
    fps: 24,
  })
  const result = resolveMultiClipTrim(session, -3)

  assert.equal(result.delta, -0.5)
  assert.deepEqual(result.updates.map(({ updates }) => updates.startTime), [4.5, 4.5])
  assert.deepEqual(result.updates.map(({ updates }) => updates.duration), [10.5, 10.5])
  assert.deepEqual(result.updates.map(({ updates }) => updates.trimStart), [3.5, 0])
})

test('tail shortening stops the whole group at the shortest selected clip', () => {
  const clips = [
    clip({ id: 'short', duration: 1, trimStart: 0, trimEnd: 1 }),
    clip({ id: 'long', duration: 4, trimStart: 0, trimEnd: 4 }),
  ]
  const session = createMultiClipTrimSession({
    clips,
    targetClipIds: ['short', 'long'],
    primaryClipId: 'long',
    edge: 'right',
    fps: 24,
  })
  const result = resolveMultiClipTrim(session, -3)

  assert.equal(result.delta, (1 / 24) - 1)
  assert.ok(Math.abs(result.updates[0].updates.duration - (1 / 24)) < 1e-9)
  assert.ok(Math.abs(result.updates[1].updates.duration - (3 + (1 / 24))) < 1e-9)
})

test('different source time scales receive the same timeline trim', () => {
  const clips = [
    clip({ id: 'normal', trimStart: 0, trimEnd: 10, sourceDuration: 30 }),
    clip({ id: 'double', trimStart: 0, trimEnd: 20, sourceDuration: 40, sourceTimeScale: 2 }),
  ]
  const session = createMultiClipTrimSession({
    clips,
    targetClipIds: ['normal', 'double'],
    primaryClipId: 'normal',
    edge: 'right',
    fps: 24,
  })
  const result = resolveMultiClipTrim(session, 1)

  assert.deepEqual(result.updates.map(({ updates }) => updates.duration), [11, 11])
  assert.deepEqual(result.updates.map(({ updates }) => updates.trimEnd), [11, 22])
})

test('session and resolve do not mutate source clips', () => {
  const clips = [clip({ id: 'a' }), clip({ id: 'b' })]
  const before = structuredClone(clips)
  const session = createMultiClipTrimSession({
    clips,
    targetClipIds: ['a', 'b'],
    primaryClipId: 'a',
    edge: 'left',
    fps: 24,
  })
  resolveMultiClipTrim(session, 2)
  assert.deepEqual(clips, before)
})
