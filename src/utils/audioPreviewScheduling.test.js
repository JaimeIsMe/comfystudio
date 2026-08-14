import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getAudioClipTimeScale,
  getAudioSourceTimeAtTimeline,
  isAudioTimelineDiscontinuity,
  resolveAudioPreviewUrl,
  selectAudioPreviewCandidates,
  shouldAlignAudioBeforeStart,
  shouldCorrectAudioDrift,
} from './audioPreviewScheduling.js'

const tracks = [
  { id: 'audio-1', type: 'audio' },
  { id: 'audio-2', type: 'audio' },
  { id: 'video-1', type: 'video' },
]

test('keeps active, short upcoming, and recently-ended audio clips warm', () => {
  const clips = [
    { id: 'recent', trackId: 'audio-1', startTime: 8, duration: 1.5 },
    { id: 'active-a', trackId: 'audio-1', startTime: 9.5, duration: 2 },
    { id: 'active-b', trackId: 'audio-2', startTime: 10, duration: 1 },
    { id: 'short-next', trackId: 'audio-1', startTime: 11.5, duration: 0.08 },
    { id: 'later', trackId: 'audio-1', startTime: 14, duration: 1 },
    { id: 'picture', trackId: 'video-1', startTime: 10, duration: 5 },
  ]

  const result = selectAudioPreviewCandidates({
    clips,
    tracks,
    playheadPosition: 10.25,
    playbackRate: 1,
  })

  assert.deepEqual(result.map(({ clip }) => clip.id), [
    'active-a',
    'active-b',
    'short-next',
    'recent',
  ])
  assert.equal(result.find(({ clip }) => clip.id === 'short-next').prepareTimelineTime, 11.5)
})

test('the entry cap never drops simultaneous active audio layers', () => {
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `active-${index}`,
    trackId: index % 2 ? 'audio-1' : 'audio-2',
    startTime: 0,
    duration: 10,
  }))
  clips.push({ id: 'upcoming', trackId: 'audio-1', startTime: 6, duration: 1 })

  const result = selectAudioPreviewCandidates({
    clips,
    tracks,
    playheadPosition: 5,
    maxEntries: 2,
  })

  assert.equal(result.length, 5)
  assert.ok(result.every(({ active }) => active))
})

test('candidate selection excludes tracks rejected by current audibility state', () => {
  const result = selectAudioPreviewCandidates({
    clips: [
      { id: 'audible', trackId: 'audio-1', startTime: 0, duration: 2 },
      { id: 'muted', trackId: 'audio-2', startTime: 0, duration: 2 },
    ],
    tracks,
    playheadPosition: 1,
    isTrackAudible: (track) => track.id === 'audio-1',
  })

  assert.deepEqual(result.map(({ clip }) => clip.id), ['audible'])
})

test('calculates source time with trim, source scale, and clip speed', () => {
  const clip = {
    startTime: 10,
    duration: 4,
    trimStart: 3,
    trimEnd: 11,
    sourceTimeScale: 0.5,
    speed: 2,
  }

  assert.equal(getAudioClipTimeScale(clip), 1)
  assert.equal(getAudioSourceTimeAtTimeline(clip, 12), 5)
})

test('recognizes explicit jumps but not ordinary RAF advancement', () => {
  const previous = {
    playheadPosition: 20,
    playbackRate: 1,
    isPlaying: true,
    sampledAtMs: 1000,
  }

  assert.equal(isAudioTimelineDiscontinuity(previous, {
    playheadPosition: 20.016,
    playbackRate: 1,
    isPlaying: true,
  }, 1016), false)
  assert.equal(isAudioTimelineDiscontinuity(previous, {
    playheadPosition: 31,
    playbackRate: 1,
    isPlaying: true,
  }, 1016), true)
})

test('drift correction is gated while a seek is in flight and by cooldowns', () => {
  const base = {
    active: true,
    isPlaying: true,
    currentTime: 5,
    expectedTime: 6,
    nowMs: 2000,
    lastCheckAtMs: 1000,
    lastSeekAtMs: 0,
  }

  assert.equal(shouldCorrectAudioDrift(base), true)
  assert.equal(shouldCorrectAudioDrift({ ...base, isSeeking: true }), false)
  assert.equal(shouldCorrectAudioDrift({ ...base, lastCheckAtMs: 1600 }), false)
  assert.equal(shouldCorrectAudioDrift({ ...base, lastSeekAtMs: 1500 }), false)
  assert.equal(shouldCorrectAudioDrift({ ...base, currentTime: 5.8 }), false)
})

test('pins a playing source across cache changes and adopts it while inactive', () => {
  const sourceUrl = 'file:///source.mp4'
  const cacheUrl = 'file:///cache.mp4'

  assert.equal(resolveAudioPreviewUrl({
    preferredUrl: cacheUrl,
    sourceUrl,
    currentUrl: sourceUrl,
    playing: true,
  }), sourceUrl)
  assert.equal(resolveAudioPreviewUrl({
    preferredUrl: cacheUrl,
    sourceUrl,
    currentUrl: sourceUrl,
    playing: false,
  }), cacheUrl)
  assert.equal(resolveAudioPreviewUrl({
    preferredUrl: cacheUrl,
    sourceUrl,
    currentUrl: cacheUrl,
    playing: false,
    failedUrl: cacheUrl,
  }), sourceUrl)
  assert.equal(resolveAudioPreviewUrl({
    preferredUrl: cacheUrl,
    sourceUrl,
    currentUrl: sourceUrl,
    playing: true,
    failedUrls: new Set([sourceUrl]),
  }), cacheUrl)
  assert.equal(resolveAudioPreviewUrl({
    preferredUrl: cacheUrl,
    sourceUrl,
    currentUrl: sourceUrl,
    playing: true,
    failedUrls: new Set([sourceUrl, cacheUrl]),
  }), null)
})

test('allows one bounded catch-up seek before a cold clip starts', () => {
  const coldStart = {
    active: true,
    isPlaying: true,
    positionPrepared: true,
    attempts: 0,
    currentTime: 5,
    expectedTime: 5.3,
  }

  assert.equal(shouldAlignAudioBeforeStart(coldStart), true)
  assert.equal(shouldAlignAudioBeforeStart({ ...coldStart, attempts: 1 }), false)
  assert.equal(shouldAlignAudioBeforeStart({ ...coldStart, currentTime: 5.25 }), false)
  assert.equal(shouldAlignAudioBeforeStart({ ...coldStart, isPlaying: false }), false)
})
