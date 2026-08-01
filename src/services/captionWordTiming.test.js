import assert from 'node:assert/strict'
import test from 'node:test'

import { isNonSpeechMarker, repairSmearedWordTimings, snapWordsToAudibleSpans } from './captionWordTiming.js'

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

test('recognizes whisper non-speech marker tokens', () => {
  assert.equal(isNonSpeechMarker('[BLANK_AUDIO]'), true)
  assert.equal(isNonSpeechMarker('[MUSIC]'), true)
  assert.equal(isNonSpeechMarker('(applause)'), true)
  assert.equal(isNonSpeechMarker('♪'), true)
  assert.equal(isNonSpeechMarker(''), true)
  assert.equal(isNonSpeechMarker('brie'), false)
  assert.equal(isNonSpeechMarker('cocktail?'), false)
  assert.equal(isNonSpeechMarker('[partial'), false)
})

test('tolerates empty and invalid input', () => {
  assert.deepEqual(repairSmearedWordTimings([]), [])
  assert.deepEqual(repairSmearedWordTimings(null), [])
  assert.deepEqual(repairSmearedWordTimings([{ text: 'no-times' }]), [])
})

// The trimmed-clip smear (July 31): a 3.75s song clip at 8.0–11.75 on an
// otherwise silent timeline. Whisper anchored the phrase at zero and spread
// nine words uniformly across the leading silence — durations so consistent
// the median-based repair correctly refuses to touch them. The audible span
// is structural truth the duration heuristic doesn't have.
const TRIMMED_CLIP_SMEAR = [
  { start: 0.0, end: 0.94, text: '"He' },
  { start: 0.94, end: 2.2, text: 'says' },
  { start: 2.2, end: 3.46, text: 'your' },
  { start: 3.46, end: 4.72, text: 'eyes' },
  { start: 4.72, end: 5.67, text: 'are' },
  { start: 5.67, end: 7.25, text: 'pools' },
  { start: 7.25, end: 8.08, text: 'of' },
  { start: 8.08, end: 10.08, text: 'moonlit' },
  { start: 10.08, end: 11.72, text: 'brie"' },
]

test('snaps a silence-smeared utterance into its audible span', () => {
  const words = snapWordsToAudibleSpans(TRIMMED_CLIP_SMEAR, [{ start: 8.0, end: 11.75 }])
  assert.equal(words[0].start, 8.0)          // first word waits for the clip
  assert.equal(words[words.length - 1].end, 11.72) // last word keeps its true end
  for (const w of words) {
    assert.ok(w.start >= 8.0 && w.end <= 11.75)
  }
  // Order and relative pacing survive the rescale.
  for (let i = 1; i < words.length; i += 1) {
    assert.ok(words[i].start >= words[i - 1].start)
  }
})

test('words already inside a span are byte-identical after snapping', () => {
  const input = [
    { start: 19.36, end: 20.24, text: 'Perfect!' },
    { start: 20.24, end: 20.42, text: 'We' },
    { start: 24.96, end: 26.82, text: 'Through' },
    { start: 26.82, end: 28.96, text: 'knees.' },
  ]
  const words = snapWordsToAudibleSpans(input, [{ start: 0, end: 28.96 }])
  assert.deepEqual(
    words.map(({ start, end, text }) => ({ start, end, text })),
    input
  )
})

test('an utterance entirely in generated silence is dropped as hallucination', () => {
  // Prompt echo, [BLANK_AUDIO] phrases, phantom "I don't know" — anything
  // whisper claims to hear where no audio clip exists is not real.
  const words = snapWordsToAudibleSpans(
    [
      { start: 1.0, end: 2.0, text: 'ghost' },
      { start: 12.0, end: 12.4, text: 'real' },
    ],
    [{ start: 10, end: 15 }]
  )
  assert.deepEqual(words.map(({ start, end, text }) => ({ start, end, text })), [
    { start: 12.0, end: 12.4, text: 'real' },
  ])
})

test('missing or invalid spans leave words untouched', () => {
  const input = [{ start: 0.5, end: 1.0, text: 'word' }]
  assert.deepEqual(snapWordsToAudibleSpans(input, []), input)
  assert.deepEqual(snapWordsToAudibleSpans(input, null), input)
  assert.deepEqual(snapWordsToAudibleSpans(input, [{ start: 5, end: 5 }]), input)
})

test('snap then repair — the full pipeline on the trimmed-clip case', () => {
  const words = repairSmearedWordTimings(
    snapWordsToAudibleSpans(TRIMMED_CLIP_SMEAR, [{ start: 8.0, end: 11.75 }])
  )
  assert.equal(words[0].start, 8.0)
  assert.equal(words[words.length - 1].end, 11.72)
  // The snapped durations are natural, so the statistical repair must not
  // second-guess the structural truth.
  for (const w of words) {
    assert.ok(w.start >= 8.0 && w.end <= 11.75)
  }
})

test('overlapping spans merge before snapping', () => {
  const words = snapWordsToAudibleSpans(
    [{ start: 0.0, end: 4.0, text: 'early' }],
    [{ start: 2.0, end: 3.0 }, { start: 2.5, end: 4.5 }]
  )
  assert.equal(words[0].start, 2.0)
  assert.equal(words[0].end, 4.0)
})

// The planets-project bug (Aug 1): ten narration clips across a 67s program,
// music muted. Whisper anchored the head at 0 and smeared the first two words
// across 7.9s of generated silence, but every interior word tracked its real
// clip in wall time — and -ml 1 output never leaves gaps, so all 123 words
// formed ONE utterance. The old whole-utterance rescale shifted every word up
// to 7s late (decaying to zero at the end). Timings below are the real repro
// values; the spans are the first two narration clips.
const PLANETS_SPANS = [
  { start: 7.875, end: 11.833 },
  { start: 12.708, end: 17.708 },
]
const PLANETS_HEAD_SMEAR = [
  { start: 0.0, end: 2.65, text: '1' },        // smeared across leading silence
  { start: 2.65, end: 8.92, text: 'star.' },   // smeared
  { start: 8.92, end: 9.18, text: '8' },
  { start: 9.18, end: 10.16, text: 'worlds.' },
  { start: 10.16, end: 10.54, text: 'This' },
  { start: 10.54, end: 11.46, text: 'solar' },
  { start: 11.46, end: 12.74, text: 'system.' },
  { start: 12.74, end: 13.3, text: 'Mercury,' },
  { start: 13.3, end: 13.45, text: 'the' },
  { start: 16.9, end: 17.2, text: 'days.' },
]

test('a mostly in-span utterance keeps its interior words byte-identical', () => {
  const words = snapWordsToAudibleSpans(PLANETS_HEAD_SMEAR, PLANETS_SPANS)
  // The smeared head is squeezed between the first span's start and the
  // first structurally plausible word.
  assert.equal(words[0].start, 7.88)
  assert.equal(words[0].end, 8.19)
  assert.equal(words[1].start, 8.19)
  assert.equal(words[1].end, 8.92)
  // Every interior word is untouched — the old global rescale moved
  // "Mercury," from 12.74 to 14.78, seven seconds after the clip started.
  assert.deepEqual(
    words.slice(2).map(({ start, end, text }) => ({ start, end, text })),
    PLANETS_HEAD_SMEAR.slice(2)
  )
})

test('a mostly in-span utterance squeezes a trailing smear to the span end', () => {
  const words = snapWordsToAudibleSpans(
    [
      { start: 13.0, end: 13.4, text: 'silent' },
      { start: 13.4, end: 13.9, text: 'orbit' },
      { start: 13.9, end: 14.5, text: 'holds' },
      { start: 14.5, end: 17.0, text: 'true' },
      { start: 17.0, end: 25.0, text: 'forever.' }, // smeared past the program
    ],
    PLANETS_SPANS
  )
  assert.deepEqual(words[4], { start: 17.0, end: 17.71, text: 'forever.' })
  assert.equal(words[3].end, 17.0) // its anchor did not move
})

test('snap then repair — the planets head smear survives the full pipeline', () => {
  const words = repairSmearedWordTimings(
    snapWordsToAudibleSpans(PLANETS_HEAD_SMEAR, PLANETS_SPANS)
  )
  assert.equal(words[0].start, 7.88) // captions start with the audio
  const mercury = words.find((w) => w.text === 'Mercury,')
  assert.equal(mercury.start, 12.74) // exactly where whisper heard it
})
