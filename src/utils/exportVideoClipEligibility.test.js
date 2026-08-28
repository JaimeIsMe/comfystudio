import test from 'node:test'
import assert from 'node:assert/strict'

import { getRenderableVideoClipIds } from './exportVideoClipEligibility.js'

const tracks = [
  { id: 'visible', type: 'video', visible: true, muted: false },
  { id: 'hidden', type: 'video', visible: false, muted: false },
]

test('excludes disabled, hidden, and out-of-range clips from export preparation', () => {
  const ids = getRenderableVideoClipIds({
    tracks,
    rangeStart: 10,
    rangeEnd: 20,
    clips: [
      { id: 'visible-in-range', trackId: 'visible', startTime: 12, duration: 2 },
      { id: 'disabled', trackId: 'visible', startTime: 12, duration: 2, enabled: false },
      { id: 'hidden', trackId: 'hidden', startTime: 12, duration: 2 },
      { id: 'before', trackId: 'visible', startTime: 0, duration: 5 },
    ],
  })
  assert.deepEqual([...ids], ['visible-in-range'])
})

test('includes between-transition spill contributors that overlap the export range', () => {
  const clips = [
    { id: 'a', trackId: 'visible', startTime: 0, duration: 4 },
    { id: 'b', trackId: 'visible', startTime: 4, duration: 4 },
  ]
  const ids = getRenderableVideoClipIds({
    tracks,
    clips,
    transitions: [{
      id: 't',
      kind: 'between',
      clipAId: 'a',
      clipBId: 'b',
      duration: 2,
      editPoint: 4,
      settings: { alignment: 'center' },
    }],
    rangeStart: 4.5,
    rangeEnd: 4.75,
  })
  assert.deepEqual([...ids].sort(), ['a', 'b'])
})

test('includes spill contributors for legacy between transitions without a kind', () => {
  const clips = [
    { id: 'a', trackId: 'visible', startTime: 0, duration: 4 },
    { id: 'b', trackId: 'visible', startTime: 4, duration: 4 },
  ]
  const ids = getRenderableVideoClipIds({
    tracks,
    clips,
    transitions: [{ clipAId: 'a', clipBId: 'b', duration: 2, editPoint: 4 }],
    rangeStart: 4.5,
    rangeEnd: 4.75,
  })
  assert.deepEqual([...ids].sort(), ['a', 'b'])
})

test('solo exports prepare only the requested clip and ignore transitions', () => {
  const clips = [
    { id: 'a', trackId: 'visible', startTime: 0, duration: 4 },
    { id: 'b', trackId: 'visible', startTime: 2, duration: 4 },
  ]
  const ids = getRenderableVideoClipIds({
    tracks,
    clips,
    transitions: [{ kind: 'between', clipAId: 'a', clipBId: 'b', duration: 2, editPoint: 3 }],
    rangeStart: 0,
    rangeEnd: 6,
    soloClipIds: ['b'],
  })
  assert.deepEqual([...ids], ['b'])
})

test('track solo excludes otherwise visible clips on non-solo tracks', () => {
  const ids = getRenderableVideoClipIds({
    tracks: [
      { id: 'solo', type: 'video', visible: true, muted: false, solo: true },
      { id: 'other', type: 'video', visible: true, muted: false },
    ],
    clips: [
      { id: 'kept', trackId: 'solo', startTime: 0, duration: 4 },
      { id: 'excluded', trackId: 'other', startTime: 0, duration: 4 },
    ],
    rangeStart: 0,
    rangeEnd: 4,
  })
  assert.deepEqual([...ids], ['kept'])
})
