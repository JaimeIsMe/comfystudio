import test from 'node:test'
import assert from 'node:assert/strict'

import {
  doesPresentedVideoFrameMatchTarget,
  getPreciseVideoSeekFps,
  getTargetVideoFrameIndex,
  isFrameStepSeekIntentAtTime,
  shouldIssuePreciseVideoSeek,
} from './previewVideoSeeking.js'

test('24 fps frame steps address every RIFE frame in a 0.5x 48 fps cache', () => {
  const targets = Array.from({ length: 8 }, (_, timelineFrame) => (timelineFrame / 24) * 0.5)
  assert.deepEqual(targets.map((time) => getTargetVideoFrameIndex(time, 48)), [0, 1, 2, 3, 4, 5, 6, 7])

  for (let index = 1; index < targets.length; index += 1) {
    assert.equal(shouldIssuePreciseVideoSeek({
      targetTime: targets[index],
      settledTargetTime: targets[index - 1],
      pendingTargetTime: null,
    }), true)
    assert.equal(doesPresentedVideoFrameMatchTarget({
      targetTime: targets[index],
      mediaTime: index / 48,
      fps: 48,
    }), true)
  }
})

test('0.16x motion at the 96 fps cap keeps repeats but never skips an available cache frame', () => {
  const targets = Array.from({ length: 11 }, (_, timelineFrame) => (timelineFrame / 24) * 0.16)
  const frameIndices = targets.map((time) => getTargetVideoFrameIndex(time, 96))
  assert.deepEqual(frameIndices, [0, 0, 1, 1, 2, 3, 3, 4, 5, 5, 6])

  for (let index = 1; index < targets.length; index += 1) {
    // Even two targets inside the same encoded frame are distinct exact seeks;
    // this is what the old 25 ms tolerance incorrectly suppressed.
    assert.equal(shouldIssuePreciseVideoSeek({
      targetTime: targets[index],
      settledTargetTime: targets[index - 1],
      pendingTargetTime: null,
    }), true)
    assert.ok(frameIndices[index] - frameIndices[index - 1] <= 1)
  }
})

test('presentation matching rejects a stale frame until the requested RIFE frame arrives', () => {
  const targetTime = (2 / 24) * 0.5
  assert.equal(doesPresentedVideoFrameMatchTarget({ mediaTime: 0, targetTime, fps: 48 }), false)
  assert.equal(doesPresentedVideoFrameMatchTarget({ mediaTime: 1 / 48, targetTime, fps: 48 }), false)
  assert.equal(doesPresentedVideoFrameMatchTarget({ mediaTime: 2 / 48, targetTime, fps: 48 }), true)
})

test('frame-step intent is tied to its exact snapped timeline target', () => {
  const intent = { type: 'frame-step', targetTime: 10 / 24, revision: 7 }
  assert.equal(isFrameStepSeekIntentAtTime(intent, 10 / 24), true)
  assert.equal(isFrameStepSeekIntentAtTime(intent, 11 / 24), false)
  assert.equal(isFrameStepSeekIntentAtTime(null, 10 / 24), false)
})

test('an unset precise-seek state does not masquerade as a settled first frame', () => {
  assert.equal(shouldIssuePreciseVideoSeek({
    targetTime: 0,
    pendingTargetTime: null,
    settledTargetTime: null,
  }), true)
})

test('exact stepping uses the frame rate of the source actually shown', () => {
  assert.equal(getPreciseVideoSeekFps({
    usingOpticalFlow: true,
    opticalFlowFps: 96,
    timelineFps: 24,
    clipSourceFps: 30,
  }), 96)
  assert.equal(getPreciseVideoSeekFps({
    isTimelineCache: true,
    timelineFps: 24,
    clipSourceFps: 60,
  }), 24)
  assert.equal(getPreciseVideoSeekFps({ clipSourceFps: 23.976, assetFps: 30, timelineFps: 24 }), 23.976)
  assert.equal(getPreciseVideoSeekFps({ assetFps: 30, timelineFps: 24 }), 30)
})
