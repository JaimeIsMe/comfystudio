import assert from 'node:assert/strict'
import test from 'node:test'

import { repairSmearedWordTimings } from './captionWordTiming.js'

// Real timings from the ShrimpMan investigation (whisper large-v3-turbo).
// Dialog actually starts ~5.2s; whisper smeared the first words across the
// music/laughter intro and stretched the tail across the outro laughter.

test('re-lays smeared leading words tight against the first trustworthy word', () => {
  const words = repairSmearedWordTimings([
    { start: 2.98, end: 4.07, text: 'can' },     // 1.09s — smeared
    { start: 4.07, end: 5.46, text: 'you' },     // 1.39s — smeared
    { start: 5.46, end: 5.83, text: 'imagine' }, // 0.37s — first plausible
    { start: 5.83, end: 6.07, text: 'if' },
  ])
  assert.equal(words[2].start, 5.46) // anchor untouched
  assert.equal(words[1].end, 5.46)   // "you" pulled tight against it
  assert.equal(words[1].start, 5.01)
  assert.equal(words[0].end, 5.01)   // "can" chains backward
  assert.equal(words[0].start, 4.56)
  assert.equal(words[3].start, 5.83) // interior untouched
})

test('re-lays smeared trailing words after the last trustworthy word', () => {
  const words = repairSmearedWordTimings([
    { start: 6.86, end: 7.0, text: 'as' },
    { start: 7.0, end: 9.83, text: 'shrimp' },      // 2.83s — smeared
    { start: 9.83, end: 15.02, text: 'cocktail?' }, // 5.19s — smeared
  ])
  assert.equal(words[0].end, 7.0)    // anchor untouched
  assert.equal(words[1].start, 7.0)
  assert.equal(words[1].end, 7.45)   // capped at the relaid duration
  assert.equal(words[2].start, 7.45)
  assert.equal(words[2].end, 7.9)
})

test('caps a lone implausible utterance instead of letting it linger', () => {
  const words = repairSmearedWordTimings([
    { start: 6.86, end: 7.0, text: 'as' },
    { start: 7.0, end: 7.45, text: 'shrimp' },
    { start: 7.45, end: 7.92, text: 'cocktail' },
    { start: 7.92, end: 15.03, text: 'laughter' }, // 7.1s tail, same utterance
  ])
  const laughter = words[3]
  assert.equal(laughter.start, 7.92)
  assert.equal(laughter.end, 8.37) // 0.45s, not seven seconds
})

test('an utterance made only of implausible words keeps its anchor and shrinks', () => {
  const words = repairSmearedWordTimings([
    { start: 1.0, end: 1.2, text: 'hello' },
    // gap > 0.6s: separate utterance, all smeared
    { start: 4.0, end: 9.0, text: 'laughter' },
  ])
  assert.equal(words[1].start, 4.0)
  assert.equal(words[1].end, 4.45)
})

test('plausible timings pass through untouched', () => {
  const input = [
    { start: 1.0, end: 1.3, text: 'plain' },
    { start: 1.3, end: 1.62, text: 'words' },
    { start: 1.62, end: 2.0, text: 'here' },
  ]
  const words = repairSmearedWordTimings(input)
  assert.deepEqual(
    words.map(({ start, end, text }) => ({ start, end, text })),
    input
  )
  // Input objects are not mutated.
  assert.equal(input[0].start, 1.0)
})

test('leading re-lay never crosses into the previous utterance', () => {
  const words = repairSmearedWordTimings([
    { start: 1.0, end: 1.3, text: 'first' },
    // gap starts a new utterance at 2.4; its smeared lead would reach back
    // past 1.3 without the guard
    { start: 2.4, end: 3.9, text: 'smeared' },  // 1.5s
    { start: 3.9, end: 4.1, text: 'anchor' },
  ])
  assert.ok(words[1].start >= words[0].end)
  assert.equal(words[1].end, 3.9)
})

test('tolerates empty and invalid input', () => {
  assert.deepEqual(repairSmearedWordTimings([]), [])
  assert.deepEqual(repairSmearedWordTimings(null), [])
  assert.deepEqual(repairSmearedWordTimings([{ text: 'no-times' }]), [])
})
