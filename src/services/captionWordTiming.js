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

const DEFAULT_PLAUSIBLE_FLOOR_SECONDS = 0.9
const DEFAULT_PLAUSIBLE_CEILING_SECONDS = 3.0
const DEFAULT_PLAUSIBLE_MEDIAN_FACTOR = 2.5
// Trailing repairs demand much stronger evidence than leading ones: a held
// sung note at a phrase END is normal (observed real holds up to ~2.1s),
// while trailing smears run 2.8s+. A lingering caption is also the milder
// bug — a caption arriving before speech looks broken; one letting go late
// just reads as style.
const DEFAULT_TRAILING_FLOOR_SECONDS = 2.5
const DEFAULT_RELAID_SECONDS = 0.45
const DEFAULT_MAX_UTTERANCE_GAP_SECONDS = 0.6

const round2 = (value) => Math.round(value * 100) / 100

// Smear is a RELATIVE judgement: spoken words run ~0.1-0.5s, but sung held
// notes legitimately run 1-2s+ — a fixed cutoff squashes real singing. A
// word only counts as smeared when it towers over its own utterance's
// (lower) median duration, clamped so plain speech keeps a sane floor and
// nothing under the ceiling is ever repaired in an utterance of uniformly
// long words, while a lone multi-second vocalization still gets caught.
const plausibleCapForUtterance = (utterance, floor, ceiling, factor) => {
  const durations = utterance.map((w) => w.end - w.start).sort((a, b) => a - b)
  const median = durations[Math.floor((durations.length - 1) / 2)] || 0
  return Math.min(Math.max(median * factor, floor), ceiling)
}

/**
 * @param {Array<{start:number,end:number,text:string}>} words - Ordered word
 *   timings from the engine.
 * @returns {Array} New array; the input word objects are not mutated.
 */
export function repairSmearedWordTimings(words, {
  plausibleFloorSeconds = DEFAULT_PLAUSIBLE_FLOOR_SECONDS,
  plausibleCeilingSeconds = DEFAULT_PLAUSIBLE_CEILING_SECONDS,
  plausibleMedianFactor = DEFAULT_PLAUSIBLE_MEDIAN_FACTOR,
  trailingFloorSeconds = DEFAULT_TRAILING_FLOOR_SECONDS,
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

  let previousUtteranceEnd = -Infinity
  for (const utterance of utterances) {
    const cap = plausibleCapForUtterance(
      utterance,
      plausibleFloorSeconds,
      plausibleCeilingSeconds,
      plausibleMedianFactor
    )
    const isPlausible = (w) => (w.end - w.start) <= cap
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

    // Trailing edge: mirror image after the last trustworthy word, but with
    // the raised trailing bar so held sung notes at phrase ends survive.
    const trailingCap = Math.max(cap, trailingFloorSeconds)
    const isTrailingPlausible = (w) => (w.end - w.start) <= trailingCap
    let lastPlausible = -1
    for (let i = utterance.length - 1; i >= 0; i -= 1) {
      if (isTrailingPlausible(utterance[i])) { lastPlausible = i; break }
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
