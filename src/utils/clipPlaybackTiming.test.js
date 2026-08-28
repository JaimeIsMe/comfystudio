import test from 'node:test'
import assert from 'node:assert/strict'

import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'

test('transition handle sampling lets picture and mask use source media outside the trim', () => {
  const clip = {
    id: 'incoming',
    type: 'video',
    startTime: 4,
    duration: 4,
    trimStart: 10,
    trimEnd: 14,
    sourceDuration: 20,
    sourceTimeScale: 1,
    speed: 0.5,
  }

  assert.equal(
    getClipPlaybackTimingAtTimeline(clip, 3, 0.001, {
      useFrameSampling: false,
      allowHandles: false,
    }).time,
    10
  )
  assert.equal(
    getClipPlaybackTimingAtTimeline(clip, 3, 0.001, {
      useFrameSampling: false,
      allowHandles: true,
    }).time,
    9.5
  )
})

test('speed ramps stay frozen at trim-out inside a transition and extrapolate only past the clip edge', () => {
  const clip = {
    id: 'ramp',
    type: 'video',
    startTime: 0,
    duration: 10,
    trimStart: 10,
    trimEnd: 20,
    sourceDuration: 100,
    sourceTimeScale: 1,
    speed: 1,
    keyframes: {
      speed: [
        { time: 0, value: 1, easing: 'linear' },
        { time: 10, value: 4 },
      ],
    },
  }

  const nominal = getClipPlaybackTimingAtTimeline(clip, 10, 0.001, {
    useFrameSampling: false,
    allowHandles: false,
  })
  const transitionAtEdge = getClipPlaybackTimingAtTimeline(clip, 10, 0.001, {
    useFrameSampling: false,
    allowHandles: true,
  })
  const transitionPastEdge = getClipPlaybackTimingAtTimeline(clip, 11, 0.001, {
    useFrameSampling: false,
    allowHandles: true,
  })

  assert.ok(Math.abs(nominal.time - 19.999) < 0.001)
  assert.ok(Math.abs(transitionAtEdge.time - 19.999) < 0.001)
  assert.ok(Math.abs(transitionPastEdge.time - 24) < 0.001)
})
