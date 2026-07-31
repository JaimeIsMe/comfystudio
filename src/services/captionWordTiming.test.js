import assert from 'node:assert/strict'
import test from 'node:test'

import { repairSmearedWordTimings } from './captionWordTiming.js'

// Real timings from the July 31 investigation (whisper large-v3-turbo).
// ShrimpMan: spoken line with music/laughter intro and outro — whisper
// smeared boundary words across both. The puppet song: sung vocals where
// held notes legitimately run 1-2s and must never be "repaired".

const SHRIMPMAN_BASELINE = [
  { start: 0.01, end: 1.35, text: 'Can' },       // smeared across intro
  { start: 1.35, end: 2.70, text: 'you' },       // smeared
  { start: 2.70, end: 5.88, text: 'imagine' },   // smeared
  { start: 5.88, end: 5.95, text: 'if' },
  { start: 5.95, end: 6.14, text: 'there' },
  { start: 6.14, end: 6.24, text: 'were' },
  { start: 6.24, end: 6.48, text: 'such' },
  { start: 6.48, end: 6.86, text: 'things' },
  { start: 6.86, end: 7.00, text: 'as' },
  { start: 7.00, end: 9.83, text: 'shrimp' },    // smeared across outro
  { start: 9.83, end: 15.02, text: 'cocktail?' }, // smeared
]

test('repairs both smeared edges of the real ShrimpMan transcript', () => {
  const words = repairSmearedWordTimings(SHRIMPMAN_BASELINE)
  // Leading words re-laid tight against "if" at 5.88.
  assert.equal(words[2].end, 5.88)
  assert.equal(words[2].start, 5.43)
  assert.equal(words[1].start, 4.98)
  assert.equal(words[0].start, 4.53) // captions start ~4.5s, not 0.01
  // Interior untouched.
  assert.equal(words[3].start, 5.88)
  assert.equal(words[8].end, 7.0)
  // Trailing words re-laid after "as".
  assert.equal(words[9].start, 7.0)
  assert.equal(words[9].end, 7.45)
  assert.equal(words[10].start, 7.45)
  assert.equal(words[10].end, 7.9) // no five-second lingering "cocktail?"
})

test('repairs the VAD-anchored variant too (laughter start)', () => {
  const words = repairSmearedWordTimings([
    { start: 2.98, end: 4.07, text: 'can' },
    { start: 4.07, end: 5.46, text: 'you' },
    { start: 5.46, end: 5.83, text: 'imagine' },
    { start: 5.83, end: 6.07, text: 'if' },
  ])
  assert.equal(words[1].end, 5.46)
  assert.equal(words[1].start, 5.01)
  assert.equal(words[0].start, 4.56)
})

test('sung held notes pass through untouched — the puppet song tail', () => {
  // Real contiguous -ml 1 output: whisper leaves no gaps, so the held final
  // phrase shares one utterance with the rest of the verse.
  const input = [
    { start: 19.36, end: 20.24, text: 'Perfect!' },
    { start: 20.24, end: 20.42, text: 'We' },
    { start: 20.42, end: 21.44, text: 'communicate' },
    { start: 21.44, end: 22.48, text: 'exclusively' },
    { start: 22.48, end: 23.92, text: 'through' },   // 1.44s held note
    { start: 23.92, end: 24.96, text: 'knees.' },
    { start: 24.96, end: 26.82, text: 'Through' },   // 1.86s held
    { start: 26.82, end: 28.96, text: 'knees.' },    // 2.14s held outro
  ]
  const words = repairSmearedWordTimings(input)
  assert.deepEqual(
    words.map(({ start, end, text }) => ({ start, end, text })),
    input
  )
})

test('trailing repair needs much stronger evidence than a held note provides', () => {
  const base = [
    { start: 1.0, end: 1.2, text: 'short' },
    { start: 1.2, end: 1.5, text: 'words' },
    { start: 1.5, end: 1.8, text: 'here' },
  ]
  // 2.3s trailing word: under the 2.5s trailing bar — a plausible held note.
  const held = repairSmearedWordTimings([...base, { start: 1.8, end: 4.1, text: 'hold' }])
  assert.equal(held[3].end, 4.1)
  // 2.8s trailing word: over the bar — a smear, re-laid tight.
  const smeared = repairSmearedWordTimings([...base, { start: 1.8, end: 4.6, text: 'smear' }])
  assert.equal(smeared[3].start, 1.8)
  assert.equal(smeared[3].end, 2.25)
})

test('a lone multi-second vocalization still gets capped', () => {
  const words = repairSmearedWordTimings([
    { start: 6.86, end: 7.0, text: 'as' },
    { start: 7.0, end: 7.45, text: 'shrimp' },
    { start: 7.45, end: 7.92, text: 'cocktail' },
    // gap: transcribed laughter spanning the outro, alone in its utterance
    { start: 8.6, end: 15.03, text: 'laughter' },
  ])
  const laughter = words[3]
  assert.equal(laughter.start, 8.6)
  assert.equal(laughter.end, 9.05) // half a second, not six and a half
})

test('plain speech with plausible timings passes through untouched', () => {
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
  assert.equal(input[0].start, 1.0) // inputs not mutated
})

test('leading re-lay never crosses into the previous utterance', () => {
  const words = repairSmearedWordTimings([
    { start: 1.0, end: 1.3, text: 'first' },
    { start: 2.4, end: 3.9, text: 'smeared' },
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
