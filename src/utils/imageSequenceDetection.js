/**
 * Image sequence detection: pure filename analysis, no filesystem access.
 *
 * A sequence is a run of files sharing a prefix + extension whose names end in
 * a frame number right before the extension (`shot_v012.1001.png`,
 * `render_0001.exr`, `plate42.tif`). Detection groups a flat file list into
 * proposed sequences plus leftovers; the import UI lets the user accept each
 * group as a sequence or keep the files as stills.
 */

// Formats ffmpeg can decode into a sequence intermediate. Broader than the
// browser-displayable set on purpose: TIFF/EXR/DPX stills can't render in
// Chromium, but as sequences they transcode into ordinary video assets.
export const SEQUENCE_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.exr', '.dpx']

// Subset the browser can decode directly — only these can fall back to a
// normal still import.
export const BROWSER_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

// Fewer frames than this and a numbered name is more likely photo_1/photo_2
// than a render — don't propose a sequence for it.
export const MIN_SEQUENCE_FRAMES = 3

const TRAILING_NUMBER_RE = /^(.*?)(\d+)(\.[a-z0-9]+)$/i

/**
 * Parse `prefix<digits>.ext` from a file name. Returns null for names without
 * a trailing frame number or with an extension outside the sequence set.
 */
export function parseSequenceFileName(name) {
  const match = TRAILING_NUMBER_RE.exec(String(name || ''))
  if (!match) return null
  const ext = match[3].toLowerCase()
  if (!SEQUENCE_IMAGE_EXTENSIONS.includes(ext)) return null
  return {
    prefix: match[1],
    frame: Number.parseInt(match[2], 10),
    digits: match[2],
    ext,
  }
}

function padFrame(frame, pad) {
  const str = String(frame)
  return pad > 0 ? str.padStart(pad, '0') : str
}

/**
 * Group files into proposed sequences.
 *
 * @param {Array<{name: string, path?: string}>} files
 * @returns {{ sequences: Array, leftovers: Array }} — sequences carry ordered
 *   frames, gap info, and a printf-style pattern for provenance; leftovers are
 *   the input entries that joined no sequence.
 */
export function detectImageSequences(files) {
  const groups = new Map()
  const leftovers = []

  for (const file of files || []) {
    const parsed = parseSequenceFileName(file?.name)
    if (!parsed) {
      leftovers.push(file)
      continue
    }
    const key = `${parsed.prefix.toLowerCase()}|${parsed.ext}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ file, parsed })
  }

  const sequences = []
  for (const members of groups.values()) {
    const byFrame = new Map()
    let duplicated = false
    for (const member of members) {
      if (byFrame.has(member.parsed.frame)) {
        duplicated = true
        break
      }
      byFrame.set(member.parsed.frame, member)
    }

    // Too few frames, or the same frame number twice (e.g. mixed padding of
    // the same shot) — treat the whole group as ordinary stills.
    if (duplicated || byFrame.size < MIN_SEQUENCE_FRAMES) {
      leftovers.push(...members.map((m) => m.file))
      continue
    }

    const ordered = [...byFrame.values()].sort((a, b) => a.parsed.frame - b.parsed.frame)
    const digitLengths = new Set(ordered.map((m) => m.parsed.digits.length))
    // Uniform digit width = zero-padded pattern; mixed widths = unpadded run.
    const pad = digitLengths.size === 1 ? ordered[0].parsed.digits.length : 0

    const start = ordered[0].parsed.frame
    const end = ordered[ordered.length - 1].parsed.frame
    const missing = []
    for (let f = start, i = 0; f <= end; f++) {
      if (ordered[i]?.parsed.frame === f) i++
      else missing.push(f)
    }

    const { prefix, ext } = ordered[0].parsed
    sequences.push({
      prefix,
      ext,
      pad,
      start,
      end,
      count: ordered.length,
      missing,
      pattern: `${prefix}%${pad > 0 ? `0${pad}` : ''}d${ext}`,
      displayName: `${prefix}[${padFrame(start, pad)}-${padFrame(end, pad)}]${ext}`,
      frames: ordered.map((m) => ({
        frame: m.parsed.frame,
        name: m.file.name,
        path: m.file.path || null,
        file: m.file,
      })),
    })
  }

  sequences.sort((a, b) => a.displayName.localeCompare(b.displayName))
  return { sequences, leftovers }
}

/**
 * Per-frame concat entries with hold-and-warn gap policy: a frame followed by
 * a hole holds until the next existing frame, so the sequence keeps its true
 * length and timing.
 *
 * @returns {Array<{path: string, duration: number}>}
 */
export function buildSequenceEntries(sequence, fps) {
  const frameDuration = 1 / Math.max(1, Number(fps) || 24)
  const frames = sequence?.frames || []
  return frames.map((frame, index) => {
    const next = frames[index + 1]
    const span = next ? next.frame - frame.frame : 1
    return {
      path: frame.path,
      duration: Math.max(1, span) * frameDuration,
    }
  })
}

/** A clean asset base name for the intermediate: `shot_v012.[..].png` → `shot_v012`. */
export function sequenceBaseName(sequence) {
  const raw = String(sequence?.prefix || 'sequence')
    .replace(/[\s._-]+$/g, '')
    .replace(/[^\w-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return raw || 'sequence'
}
