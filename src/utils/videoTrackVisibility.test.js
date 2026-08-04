import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyVideoSoloAsHidden,
  hasVideoSolo,
  isVideoTrackVisible,
} from './videoTrackVisibility.js'

test('video solo leaves ordinary visibility unchanged when no track is soloed', () => {
  const tracks = [
    { id: 'v1', type: 'video', visible: true },
    { id: 'v2', type: 'video', visible: false },
  ]

  assert.equal(hasVideoSolo(tracks), false)
  assert.equal(isVideoTrackVisible(tracks[0], false), true)
  assert.equal(isVideoTrackVisible(tracks[1], false), false)
  assert.strictEqual(applyVideoSoloAsHidden(tracks), tracks)
})

test('multiple video tracks can be soloed without changing saved eye state', () => {
  const tracks = [
    { id: 'v1', type: 'video', visible: true, solo: true },
    { id: 'v2', type: 'video', visible: true },
    { id: 'v3', type: 'video', visible: true, solo: true },
    { id: 'a1', type: 'audio', visible: true },
  ]

  const folded = applyVideoSoloAsHidden(tracks)
  assert.equal(hasVideoSolo(tracks), true)
  assert.equal(folded[0].visible, true)
  assert.equal(folded[1].visible, false)
  assert.equal(folded[2].visible, true)
  assert.equal(folded[3].visible, true)
  assert.equal(tracks[1].visible, true)
})

test('solo never overrides a hidden or muted video track', () => {
  assert.equal(isVideoTrackVisible({ type: 'video', visible: false, solo: true }, true), false)
  assert.equal(isVideoTrackVisible({ type: 'video', visible: true, muted: true, solo: true }, true), false)
  assert.equal(isVideoTrackVisible({ type: 'video', visible: true, solo: false }, true), false)
})
