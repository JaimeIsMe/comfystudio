import test from 'node:test'
import assert from 'node:assert/strict'

import { translateTransitionsForClipMoves } from './transitionClipMoves.mjs'

const clips = [
  { id: 'clip-a', trackId: 'video-1', startTime: 10, duration: 5 },
  { id: 'clip-b', trackId: 'video-1', startTime: 15, duration: 5 },
]

const betweenTransition = {
  id: 'transition-1',
  kind: 'between',
  clipAId: 'clip-a',
  clipBId: 'clip-b',
  editPoint: 15,
  originalClipAEnd: 15,
  originalClipBStart: 15,
  duration: 1,
}

test('moves a between transition when both attached clips translate together', () => {
  const result = translateTransitionsForClipMoves({
    transitions: [betweenTransition],
    beforeClips: clips,
    afterClips: clips.map((clip) => ({ ...clip, startTime: clip.startTime - 7 })),
  })

  assert.deepEqual(result[0], {
    ...betweenTransition,
    editPoint: 8,
    originalClipAEnd: 8,
    originalClipBStart: 8,
  })
})

test('uses actual clamped clip movement rather than the requested delta', () => {
  const result = translateTransitionsForClipMoves({
    transitions: [betweenTransition],
    beforeClips: clips,
    afterClips: clips.map((clip) => ({ ...clip, startTime: clip.startTime - 10 })),
  })

  assert.equal(result[0].editPoint, 5)
  assert.equal(result[0].originalClipAEnd, 5)
  assert.equal(result[0].originalClipBStart, 5)
})

test('does not move a transition when only one attached clip moves', () => {
  const transitions = [betweenTransition]
  const result = translateTransitionsForClipMoves({
    transitions,
    beforeClips: clips,
    afterClips: [
      { ...clips[0], startTime: 4 },
      clips[1],
    ],
  })

  assert.equal(result, transitions)
  assert.equal(result[0], betweenTransition)
})

test('does not move a transition when its clips land on different tracks', () => {
  const result = translateTransitionsForClipMoves({
    transitions: [betweenTransition],
    beforeClips: clips,
    afterClips: [
      { ...clips[0], startTime: 4, trackId: 'video-1' },
      { ...clips[1], startTime: 9, trackId: 'video-2' },
    ],
  })

  assert.equal(result[0], betweenTransition)
})

test('leaves edge transitions and missing compatibility fields unchanged', () => {
  const edgeTransition = {
    id: 'edge-1',
    kind: 'edge',
    clipId: 'clip-a',
    edge: 'in',
    duration: 1,
  }
  const modernBetween = {
    id: 'transition-modern',
    kind: 'between',
    clipAId: 'clip-a',
    clipBId: 'clip-b',
    editPoint: 15,
    duration: 1,
  }
  const result = translateTransitionsForClipMoves({
    transitions: [edgeTransition, modernBetween],
    beforeClips: clips,
    afterClips: clips.map((clip) => ({ ...clip, startTime: clip.startTime + 2 })),
  })

  assert.equal(result[0], edgeTransition)
  assert.deepEqual(result[1], { ...modernBetween, editPoint: 17 })
  assert.equal(Object.hasOwn(result[1], 'originalClipAEnd'), false)
  assert.equal(Object.hasOwn(result[1], 'originalClipBStart'), false)
})
