import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectAudioMixClips,
  countExpectedAudioMixClips,
  getAudioMixDelayMilliseconds,
  isAudioMixClip,
} from '../electron/audioMixEligibility.mjs'

const tracks = [
  { id: 'audio-1', type: 'audio' },
  { id: 'video-1', type: 'video' },
]

test('recovers a video-backed legacy split fragment placed on an audio track', () => {
  const legacyFragment = {
    id: 'legacy-short-fragment',
    type: 'video',
    trackId: 'audio-1',
    startTime: 1,
    duration: 1 / 60,
  }

  assert.equal(isAudioMixClip(legacyFragment, tracks[0]), true)
  assert.equal(isAudioMixClip(legacyFragment, tracks[1]), false)
})

test('collects normal audio and short recovered fragments without including visual video clips', () => {
  const clips = [
    { id: 'normal-audio', type: 'audio', trackId: 'audio-1', startTime: 0, duration: 1 },
    { id: 'legacy-short-fragment', type: 'video', trackId: 'audio-1', startTime: 1, duration: 1 / 60 },
    { id: 'visual-video', type: 'video', trackId: 'video-1', startTime: 0, duration: 2 },
    { id: 'disabled-audio', type: 'audio', trackId: 'audio-1', startTime: 0, duration: 2, enabled: false },
  ]

  const collected = collectAudioMixClips(clips, tracks)

  assert.deepEqual(collected.map((clip) => clip.id), [
    'normal-audio',
    'legacy-short-fragment',
  ])
  assert.equal(countExpectedAudioMixClips(collected, 0, 2), 2)
})

test('expected clip count includes a short recovered fragment that overlaps the export range', () => {
  const shortFragment = {
    id: 'legacy-short-fragment',
    type: 'video',
    trackId: 'audio-1',
    startTime: 10,
    duration: 0.005,
  }

  const collected = collectAudioMixClips([shortFragment], tracks)

  assert.equal(countExpectedAudioMixClips(collected, 9.5, 10.5), 1)
  assert.equal(countExpectedAudioMixClips(collected, 10.005, 11), 0)
})

test('preserves fractional-millisecond delay at frame-aligned cut seams', () => {
  assert.equal(getAudioMixDelayMilliseconds(1 / 24, 0), 1000 / 24)
  assert.equal(getAudioMixDelayMilliseconds(1001 / 30000, 0), 1001 / 30)
})
