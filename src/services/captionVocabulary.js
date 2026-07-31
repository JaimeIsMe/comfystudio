// Vocabulary hint assembly for caption transcription.
//
// Whisper's initial prompt (--prompt) biases decoding toward words it has
// seen, which is the difference between "Velorn" and "the lawn" for brand
// names. This module is the pure assembly half (unit-tested, no store or
// window access); captionTranscription.js collects the project strings and
// injects the finished hint into local transcriptions.

// Whisper truncates the initial prompt to half its text context (~224
// tokens), so a compact hint keeps the distinctive words inside the budget.
const DEFAULT_MAX_ITEM_CHARS = 80
const DEFAULT_MAX_TOTAL_CHARS = 500

// Default strings the app itself plants; they carry no vocabulary signal.
const IGNORED_PARTS = new Set(['sample text'])

/**
 * Join candidate strings into one comma-separated hint: whitespace
 * normalized, duplicates dropped case-insensitively, each item capped, and
 * assembly stops before the total budget overflows — earlier parts win, so
 * callers should pass the most important strings first.
 */
export function buildVocabularyHint(parts, {
  maxItemChars = DEFAULT_MAX_ITEM_CHARS,
  maxTotalChars = DEFAULT_MAX_TOTAL_CHARS,
} = {}) {
  const seen = new Set()
  const kept = []
  let totalChars = 0

  for (const part of Array.isArray(parts) ? parts : []) {
    const normalized = String(part || '').replace(/\s+/g, ' ').trim().slice(0, maxItemChars).trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key) || IGNORED_PARTS.has(key)) continue
    const nextTotal = totalChars + (kept.length > 0 ? 2 : 0) + normalized.length
    if (nextTotal > maxTotalChars) break
    seen.add(key)
    kept.push(normalized)
    totalChars = nextTotal
  }

  // Whisper mimics the prompt's writing style, and an unpunctuated word
  // list nudges it toward dropping punctuation — which coarsens cue
  // grouping (sentence punctuation is a cue-break rule). Terminate the
  // hint like a sentence so the output keeps its punctuation habits.
  return kept.length > 0 ? `${kept.join(', ')}.` : ''
}
