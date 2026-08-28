import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addCaptionCue,
  buildCaptionTranscript,
  createCaptionCueId,
  resolveCaptionMediaDuration,
  retimeCaptionCue,
  splitCaptionCueAtCaret,
  validateCaptionCues,
} from './captionCueEditing.js'

test('creates a collision-safe cue id', () => {
  assert.equal(createCaptionCueId([{ id: 'cue-new' }], () => 'cue-new'), 'cue-new-2')
})

test('uses the longest current media duration and ignores invalid values', () => {
  assert.equal(resolveCaptionMediaDuration(8, 12, '10'), 12)
  assert.equal(resolveCaptionMediaDuration(null, '', -2, 'invalid'), null)
})

test('splits text at the exact caret with contiguous proportional timing', () => {
  const original = [{
    id: 'cue-1',
    start: 2,
    end: 6,
    text: 'A considerably longer second phrase',
    words: [{ text: 'A' }, { text: 'considerably' }, { text: 'longer' }, { text: 'second' }, { text: 'phrase' }],
    override: { verticalPlacement: 'top' },
  }]
  const splitIndex = original[0].text.indexOf(' second')
  const result = splitCaptionCueAtCaret(original, 'cue-1', splitIndex, { idFactory: () => 'cue-2' })

  assert.equal(result.leftCue.id, 'cue-1')
  assert.equal(result.rightCue.id, 'cue-2')
  assert.equal(result.leftCue.end, result.rightCue.start)
  assert.equal(result.leftCue.text, 'A considerably longer')
  assert.equal(result.rightCue.text, 'second phrase')
  assert.deepEqual(result.rightCue.override, { verticalPlacement: 'top' })
  assert.notEqual(result.rightCue.override, original[0].override)
  assert.notEqual(result.leftCue.override, result.rightCue.override)
  assert.deepEqual(result.leftCue.words.map((word) => word.text), ['A', 'considerably', 'longer'])
  assert.deepEqual(result.rightCue.words.map((word) => word.text), ['second', 'phrase'])
  assert.notEqual(result.leftCue.words[0], original[0].words[0])
  assert.notEqual(result.rightCue.words[0], original[0].words[3])
  assert.deepEqual(original[0].text, 'A considerably longer second phrase')
})

test('splits no-space text at the exact caret and rejects true edges', () => {
  const source = [{ id: 'jp', start: 0, end: 2, text: '日本語字幕です' }]
  const result = splitCaptionCueAtCaret(source, 'jp', 3, { idFactory: () => 'jp-right' })
  assert.equal(result.leftCue.text, '日本語')
  assert.equal(result.rightCue.text, '字幕です')

  assert.throws(
    () => splitCaptionCueAtCaret([{ id: 'one', start: 0, end: 2, text: 'Hello world' }], 'one', 0),
    /inside the caption/
  )
  assert.throws(
    () => splitCaptionCueAtCaret([{ id: 'one', start: 0, end: 2, text: 'Hello world' }], 'one', 11),
    /inside the caption/
  )
  assert.throws(
    () => splitCaptionCueAtCaret([{ id: 'one', start: 0, end: 0.3, text: 'Too short' }], 'one', 4),
    /too short/
  )

  const fractional = splitCaptionCueAtCaret([
    { id: 'fractional', start: 0.0004, end: 0.4004, text: 'Two halves' },
  ], 'fractional', 3, { idFactory: () => 'fractional-right' })
  assert.ok(fractional.splitTime - fractional.leftCue.start >= 0.2 - 1e-9)
  assert.ok(fractional.rightCue.end - fractional.splitTime >= 0.2 - 1e-9)
})

test('adds a blank cue exactly at the preview playhead', () => {
  const result = addCaptionCue([
    { id: 'one', start: 0, end: 1, text: 'One' },
    { id: 'two', start: 3, end: 4, text: 'Two' },
  ], {
    atTime: 1.25,
    audioDuration: 5,
    idFactory: () => 'new',
  })

  assert.equal(result.index, 1)
  assert.deepEqual(result.cue, {
    id: 'new', start: 1.25, end: 2.75, text: '', words: [], override: {},
  })
  assert.equal(result.cues[2].start, 3)
})

test('clips a playhead cue to the next caption without moving its start', () => {
  const result = addCaptionCue([
    { id: 'one', start: 0, end: 1, text: 'One' },
    { id: 'two', start: 2.2, end: 3, text: 'Two' },
  ], {
    atTime: 1.5,
    audioDuration: 3,
    idFactory: () => 'new',
  })

  assert.equal(result.index, 1)
  assert.equal(result.cue.start, 1.5)
  assert.equal(result.cue.end, 2.2)
})

test('uses the requested tail time and refuses occupied or undersized positions', () => {
  const appended = addCaptionCue([{ id: 'one', start: 0, end: 1, text: 'One' }], {
    atTime: 1.4,
    audioDuration: 3,
    idFactory: () => 'new',
  })
  assert.equal(appended.cue.start, 1.4)
  assert.equal(appended.cue.end, 2.9)

  assert.throws(
    () => addCaptionCue([{ id: 'one', start: 0, end: 1, text: 'One' }], {
      atTime: 0.5,
      audioDuration: 3,
    }),
    /already covers this playhead/i
  )
  assert.throws(
    () => addCaptionCue([{ id: 'next', start: 1.3, end: 2, text: 'Next' }], {
      atTime: 1,
      audioDuration: 2,
    }),
    /not enough room after the playhead/i
  )
  assert.throws(
    () => addCaptionCue([], { atTime: 2, audioDuration: 2 }),
    /playhead earlier/i
  )
})

test('allows a new cue to begin exactly when the previous cue ends', () => {
  const result = addCaptionCue([{ id: 'one', start: 0, end: 1, text: 'One' }], {
    atTime: 1,
    audioDuration: 2,
    idFactory: () => 'new',
  })
  assert.equal(result.cue.start, 1)
  assert.equal(result.cue.end, 2)
})

test('retimes a cue by start while preserving duration, or changes duration explicitly', () => {
  const cues = [{ id: 'one', start: 1, end: 2.5, text: 'One' }]
  const moved = retimeCaptionCue(cues, 'one', { start: 3 })
  assert.equal(moved.cue.start, 3)
  assert.equal(moved.cue.end, 4.5)

  const resized = retimeCaptionCue(moved.cues, 'one', { duration: 0.75 })
  assert.equal(resized.cue.start, 3)
  assert.equal(resized.cue.end, 3.75)
  assert.deepEqual(cues, [{ id: 'one', start: 1, end: 2.5, text: 'One' }])

  assert.throws(() => retimeCaptionCue(cues, 'one', { start: -1 }), /zero or later/i)
  assert.throws(() => retimeCaptionCue(cues, 'one', { duration: 0.05 }), /at least 0.1 seconds/i)
  assert.throws(
    () => retimeCaptionCue(cues, 'one', { start: 4, maxEnd: 5 }),
    /end after the media/i
  )
  assert.throws(
    () => retimeCaptionCue(cues, 'one', { duration: 5, maxEnd: 5 }),
    /end after the media/i
  )
  assert.equal(
    retimeCaptionCue(cues, 'one', { start: 3.5, maxEnd: 5 }).cue.end,
    5
  )
})

test('builds the transcript and validates blanks, timings, and overlaps', () => {
  const cues = [
    { id: 'one', start: 0, end: 2, text: 'Hello' },
    { id: 'two', start: 1.5, end: 3, text: ' ' },
    { id: 'three', start: 4, end: 3.5, text: 'world' },
  ]
  assert.equal(buildCaptionTranscript(cues), 'Hello world')
  const result = validateCaptionCues(cues)
  assert.equal(result.valid, false)
  assert.deepEqual(result.errors.map((error) => error.code).sort(), ['blank', 'overlap', 'timing'])
})

test('rejects null timing and identifies every cue in nested overlaps', () => {
  const result = validateCaptionCues([
    { id: 'outer', start: 0, end: 10, text: 'Outer' },
    { id: 'inner-one', start: 1, end: 2, text: 'Inner one' },
    { id: 'inner-two', start: 3, end: 4, text: 'Inner two' },
    { id: 'null-start', start: null, end: 5, text: 'Invalid' },
  ])

  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.code === 'timing' && error.cueId === 'null-start'))
  const overlapIds = new Set(
    result.errors
      .filter((error) => error.code === 'overlap')
      .flatMap((error) => error.cueIds || [])
  )
  assert.deepEqual([...overlapIds].sort(), ['inner-one', 'inner-two', 'outer'])
})

test('accepts adjacent non-overlapping cues', () => {
  assert.equal(validateCaptionCues([
    { id: 'one', start: 0, end: 1, text: 'One' },
    { id: 'two', start: 1, end: 2, text: 'Two' },
  ]).valid, true)
})
