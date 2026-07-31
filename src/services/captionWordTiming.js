// Repair whisper's smeared boundary-word timings.
//
// Whisper never leaves gaps inside a decoded region: when an utterance is
// preceded or followed by non-speech (music, laughter, silence), the first
// and last words absorb it — "Can" spanning three seconds of intro music —
// so captions appear long before anyone speaks and linger long after.
// Real words run ~0.1–0.5s; smeared boundary words run seconds. This pass
// re-lays implausibly long words at utterance edges tight against the first
// (or last) trustworthy word. Interior words are never touched, so accurate
// timings pass through byte-identical. Worst case for a genuinely drawn-out
// boundary word is a caption that lands a beat late — for captions, late by
// a hair beats early by seconds.

const DEFAULT_MAX_PLAUSIBLE_SECONDS = 0.9
const DEFAULT_RELAID_SECONDS = 0.45
const DEFAULT_MAX_UTTERANCE_GAP_SECONDS = 0.6

const round2 = (value) => Math.round(value * 100) / 100

/**
 * @param {Array<{start:number,end:number,text:string}>} words - Ordered word
 *   timings from the engine.
 * @returns {Array} New array; the input word objects are not mutated.
 */
export function repairSmearedWordTimings(words, {
  maxPlausibleSeconds = DEFAULT_MAX_PLAUSIBLE_SECONDS,
  relaidSeconds = DEFAULT_RELAID_SECONDS,
  maxUtteranceGapSeconds = DEFAULT_MAX_UTTERANCE_GAP_SECONDS,
} = {}) {
  const source = (Array.isArray(words) ? words : [])
    .filter((w) => w && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)))
    .map((w) => ({ ...w, start: Number(w.start), end: Number(w.end) }))
  if (source.length === 0) return source

  // Group contiguous words into utterances: a gap wider than the threshold
  // starts a new one.
  const utterances = []
  let current = [source[0]]
  for (let i = 1; i < source.length; i += 1) {
    const gap = source[i].start - source[i - 1].end
    if (gap > maxUtteranceGapSeconds) {
      utterances.push(current)
      current = [source[i]]
    } else {
      current.push(source[i])
    }
  }
  utterances.push(current)

  const isPlausible = (w) => (w.end - w.start) <= maxPlausibleSeconds

  let previousUtteranceEnd = -Infinity
  for (const utterance of utterances) {
    const firstPlausible = utterance.findIndex(isPlausible)

    if (firstPlausible === -1) {
      // Entirely implausible (e.g. a lone transcribed "laughter" spanning the
      // outro): keep the anchor start, give each word a short duration.
      let cursor = Math.max(utterance[0].start, previousUtteranceEnd)
      for (const w of utterance) {
        w.start = round2(cursor)
        w.end = round2(cursor + Math.min(w.end - w.start, relaidSeconds))
        if (w.end <= w.start) w.end = round2(w.start + relaidSeconds)
        cursor = w.end
      }
      previousUtteranceEnd = utterance[utterance.length - 1].end
      continue
    }

    // Leading edge: walk backward from the first trustworthy word, laying
    // each smeared word tight against its successor.
    for (let i = firstPlausible - 1; i >= 0; i -= 1) {
      const w = utterance[i]
      const successorStart = utterance[i + 1].start
      const duration = Math.min(w.end - w.start, relaidSeconds)
      w.end = round2(successorStart)
      w.start = round2(Math.max(successorStart - duration, previousUtteranceEnd))
      if (w.start >= w.end) w.start = round2(Math.max(w.end - 0.05, 0))
    }

    // Trailing edge: mirror image after the last trustworthy word.
    let lastPlausible = -1
    for (let i = utterance.length - 1; i >= 0; i -= 1) {
      if (isPlausible(utterance[i])) { lastPlausible = i; break }
    }
    for (let i = lastPlausible + 1; i < utterance.length; i += 1) {
      const w = utterance[i]
      const predecessorEnd = utterance[i - 1].end
      const duration = Math.min(w.end - w.start, relaidSeconds)
      w.start = round2(predecessorEnd)
      w.end = round2(predecessorEnd + duration)
      if (w.end <= w.start) w.end = round2(w.start + 0.05)
    }

    previousUtteranceEnd = utterance[utterance.length - 1].end
  }

  return utterances.flat()
}
