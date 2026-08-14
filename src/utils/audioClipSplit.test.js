import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAudioClipSplitState,
  isAudioClipRole,
  normalizeVideoBackedAudioClips,
} from './audioClipSplit.js'

test('treats a video-backed clip on an audio track as audio', () => {
  const clip = { type: 'video', gainDb: -3, fadeIn: 0.25, fadeOut: 0.5 }
  const track = { id: 'audio-1', type: 'audio' }
  const asset = { id: 'asset-1', type: 'video', url: 'file:///podcast.mp4' }

  assert.equal(isAudioClipRole(clip, track), true)
  assert.deepEqual(buildAudioClipSplitState(clip, track, asset), {
    asset: { ...asset, type: 'audio' },
    leftClipUpdates: { type: 'audio', gainDb: -3, fadeIn: 0.25, fadeOut: 0 },
    rightClipOptions: {
      gainDb: -3,
      fadeIn: 0,
      fadeOut: 0.5,
      sourceTimeScale: 1,
      speed: 1,
      reverse: false,
    },
  })
})

test('does not reinterpret video clips on video tracks as audio', () => {
  const clip = { type: 'video' }
  const track = { id: 'video-1', type: 'video' }

  assert.equal(isAudioClipRole(clip, track), false)
  assert.equal(buildAudioClipSplitState(clip, track, { type: 'video' }), null)
})

test('keeps only the original outer fades after an audio razor cut', () => {
  const state = buildAudioClipSplitState(
    { type: 'audio', gainDb: 2, fadeIn: 0.4, fadeOut: 0.7 },
    { id: 'audio-1', type: 'audio' },
    { id: 'asset-1', type: 'audio' }
  )

  assert.deepEqual(state.leftClipUpdates, {
    type: 'audio', gainDb: 2, fadeIn: 0.4, fadeOut: 0,
  })
  assert.deepEqual(state.rightClipOptions, {
    gainDb: 2,
    fadeIn: 0,
    fadeOut: 0.7,
    sourceTimeScale: 1,
    speed: 1,
    reverse: false,
  })
})

test('preserves retime state and exact source ranges for a reverse split', () => {
  const state = buildAudioClipSplitState(
    {
      type: 'audio',
      sourceTimeScale: 0.5,
      sourceFps: 60,
      timelineFps: 30,
      speed: 2,
      reverse: true,
      trimStart: 0,
      trimEnd: 10,
    },
    { id: 'audio-1', type: 'audio' },
    { id: 'asset-1', type: 'audio' },
    { left: 4, right: 6 }
  )

  assert.deepEqual(state.leftClipUpdates, {
    type: 'audio',
    gainDb: undefined,
    fadeIn: 0,
    fadeOut: 0,
    trimStart: 6,
    trimEnd: 10,
  })

  assert.deepEqual(state.rightClipOptions, {
    gainDb: undefined,
    fadeIn: 0,
    fadeOut: 0,
    sourceTimeScale: 0.5,
    speed: 2,
    reverse: true,
    trimStart: 0,
    trimEnd: 6,
    sourceFps: 60,
    timelineFps: 30,
  })
})

test('repairs only legacy video clips placed on audio tracks', () => {
  const clips = [
    { id: 'video-audio', type: 'video', trackId: 'audio-1' },
    { id: 'video', type: 'video', trackId: 'video-1' },
    { id: 'image-audio', type: 'image', trackId: 'audio-1' },
    { id: 'audio', type: 'audio', trackId: 'audio-1' },
  ]
  const repaired = normalizeVideoBackedAudioClips(clips, [
    { id: 'video-1', type: 'video' },
    { id: 'audio-1', type: 'audio' },
  ])

  assert.deepEqual(repaired.map((clip) => clip.type), ['audio', 'video', 'image', 'audio'])
  assert.notEqual(repaired[0], clips[0])
  assert.equal(repaired[1], clips[1])
  assert.equal(repaired[2], clips[2])
  assert.equal(repaired[3], clips[3])
})
