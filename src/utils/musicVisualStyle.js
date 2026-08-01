// Keep music-audio vocabulary out of image and video generation prompts.
//
// The music-video "Song style / visual look notes" field is deliberately
// dual-purpose: the director-LLM brief SHOULD know the song is boom bap at
// 90 BPM with a male vocal — that's creative context for planning. But the
// same words appended verbatim to a still-image or motion prompt plant
// visual concepts (rapper, DJ booth, turntables, stage lights) that
// contaminate b-roll and narrative shots, and negative prompts can't undo a
// concept once it's introduced (issue #91: a parliamentary-office cutaway
// rendered as a rapper/DJ scene).
//
// The filter is sentence-level: any segment that mentions music-audio
// vocabulary is dropped whole, and only the surviving VISUAL segments reach
// the generators. Over-catching is the gentle failure mode — a dropped
// segment just means the shot leans on its own (clean) keyframe/motion
// prompt, which is the primary content anyway.
//
// The term list is deliberately conservative: only words whose music sense
// dominates in a style-notes context. Ambiguous words that double as visual
// vocabulary (jazz club, metal, country, house, folk, grime, lo-fi,
// synthwave, hook, bridge, drop) are deliberately absent — better to let a
// rare music term slip through than to eat a real look description.
const MUSIC_AUDIO_TERM_PATTERN = new RegExp(
  [
    // tempo / key
    String.raw`\b\d{2,3}\s*bpm\b`,
    String.raw`\bbpm\b`,
    String.raw`\btempo\b`,
    String.raw`\b(?:major|minor)\s+key\b`,
    // vocals / lyrics
    String.raw`\bvocals?\b`,
    String.raw`\bvocalists?\b`,
    String.raw`\ba\s*cappella\b`,
    String.raw`\bacapella\b`,
    String.raw`\blyrics?\b`,
    String.raw`\bsinging\b`,
    String.raw`\bsung\b`,
    // song structure
    String.raw`\bchorus(?:es)?\b`,
    String.raw`\bverses?\b`,
    String.raw`\bpre-?chorus\b`,
    String.raw`\brefrains?\b`,
    String.raw`\bad-?libs?\b`,
    // production / instruments
    String.raw`\bvinyl\s+scratch(?:es|ing)?\b`,
    String.raw`\brecord\s+scratch(?:es|ing)?\b`,
    String.raw`\b808s?\b`,
    String.raw`\bhi-?hats?\b`,
    String.raw`\bsnares?\b`,
    String.raw`\bkick\s+drums?\b`,
    String.raw`\bbasslines?\b`,
    String.raw`\bdrum\s+machines?\b`,
    String.raw`\bsynthesizers?\b`,
    String.raw`\bturntablism\b`,
    String.raw`\bauto-?tune\b`,
    String.raw`\bbeat\s+drop\b`,
    // genres whose music sense dominates
    String.raw`\brap(?:per|pers)?\b`,
    String.raw`\bhip\s*-?\s*hop\b`,
    String.raw`\bboom\s*-?\s*bap\b`,
    String.raw`\br\s*&\s*b\b`,
    String.raw`\brnb\b`,
    String.raw`\bedm\b`,
    String.raw`\btechno\b`,
    String.raw`\bdubstep\b`,
    String.raw`\bhouse\s+music\b`,
    String.raw`\bdrum\s+and\s+bass\b`,
    String.raw`\bdnb\b`,
    String.raw`\breggaeton\b`,
    String.raw`\bafrobeats?\b`,
    String.raw`\b[kj]-?pop\b`,
    String.raw`\btrap\s+(?:beat|music)\b`,
    String.raw`\borchestral\b`,
    // generic music words (music sense dominant in a style-notes field)
    String.raw`\bsongs?\b`,
    String.raw`\bmusic\b(?!\s+video)`,
    String.raw`\bmelod(?:y|ies|ic)\b`,
    String.raw`\binstrumentals?\b`,
    String.raw`\bsoundtracks?\b`,
  ].join('|'),
  'i'
)

/**
 * Return only the VISUAL segments of a style-notes string, for use in
 * image/video generation prompts. Segments (sentences, lines, or
 * semicolon-separated runs) that mention music-audio vocabulary are dropped
 * whole. The director-LLM brief should keep receiving the raw field.
 *
 * @param {string} value - The raw "Song style / visual look notes" field.
 * @returns {string} Visual-only style text; '' when nothing survives.
 */
export function extractVisualStyleNotes(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  return text
    .split(/(?<=[.!?])\s+|\n+|;\s*/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && !MUSIC_AUDIO_TERM_PATTERN.test(segment))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
