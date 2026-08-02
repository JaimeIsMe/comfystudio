// .cube 3D LUT parser (Adobe/IRIDAS format): the interchange format every
// grading tool exports. Only 3D LUTs are supported — 1D LUTs are a different
// beast (per-channel curves) and creator packs are overwhelmingly 3D.
//
// Data ordering in the file is red-fastest (r, then g, then b), which maps
// 1:1 onto a WebGL2 3D texture whose x axis is red — no reshuffling needed:
// index = r + g*N + b*N².

const MAX_LUT_SIZE = 129
const MIN_LUT_SIZE = 2

export function parseCubeLut(text, { name = '' } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Empty .cube file.')
  }

  let size = 0
  let title = ''
  let domainMin = [0, 0, 0]
  let domainMax = [1, 1, 1]
  let data = null
  let cursor = 0

  const lines = text.split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const upper = line.toUpperCase()
    if (upper.startsWith('TITLE')) {
      title = (line.match(/"([^"]*)"/) || [null, ''])[1]
      continue
    }
    if (upper.startsWith('LUT_1D_SIZE')) {
      throw new Error('1D LUTs are not supported — this file is a per-channel curve, not a 3D color cube.')
    }
    if (upper.startsWith('LUT_3D_SIZE')) {
      size = Number(line.split(/\s+/)[1])
      if (!Number.isInteger(size) || size < MIN_LUT_SIZE || size > MAX_LUT_SIZE) {
        throw new Error(`Unsupported LUT size ${size} (expected ${MIN_LUT_SIZE}-${MAX_LUT_SIZE}).`)
      }
      data = new Float32Array(size * size * size * 3)
      continue
    }
    if (upper.startsWith('DOMAIN_MIN')) {
      domainMin = line.split(/\s+/).slice(1, 4).map(Number)
      continue
    }
    if (upper.startsWith('DOMAIN_MAX')) {
      domainMax = line.split(/\s+/).slice(1, 4).map(Number)
      continue
    }
    if (upper.startsWith('LUT_3D_INPUT_RANGE') || upper.startsWith('LUT_IN_VIDEO_RANGE') || upper.startsWith('LUT_OUT_VIDEO_RANGE')) {
      // Rare vendor extensions; ignore rather than fail the whole import.
      continue
    }

    // Data line: three floats.
    const parts = line.split(/\s+/)
    if (parts.length < 3) continue
    const r = Number(parts[0])
    const g = Number(parts[1])
    const b = Number(parts[2])
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      throw new Error(`Malformed data line: "${line.slice(0, 40)}"`)
    }
    if (!data) {
      throw new Error('Data before LUT_3D_SIZE — not a valid 3D .cube file.')
    }
    if (cursor + 3 > data.length) {
      throw new Error('More data lines than LUT_3D_SIZE³ — corrupt file.')
    }
    data[cursor] = r
    data[cursor + 1] = g
    data[cursor + 2] = b
    cursor += 3
  }

  if (!data || size === 0) {
    throw new Error('Missing LUT_3D_SIZE — not a 3D .cube file.')
  }
  if (cursor !== data.length) {
    throw new Error(`Expected ${data.length / 3} data lines, found ${cursor / 3}.`)
  }

  const domainNonStandard = domainMin.some((v) => Math.abs(v) > 1e-6)
    || domainMax.some((v) => Math.abs(v - 1) > 1e-6)
  if (domainNonStandard) {
    // Creator LUTs are display-referred 0-1; log-domain LUTs are the rare
    // exception. Treat as 0-1 rather than failing — visibly wrong beats
    // silently rejected, and the user picked this LUT on purpose.
    console.warn('[cubeLut] Non-standard DOMAIN_MIN/MAX treated as 0-1:', { domainMin, domainMax, name })
  }

  return { size, title: title || name, data }
}

/**
 * Pack parsed float LUT data into RGBA8 for a filterable WebGL2 3D texture.
 * 8-bit quantization matches the 8-bit end-to-end pipeline; RGBA (not RGB)
 * sidesteps row-alignment traps across drivers.
 */
export function cubeLutToRgba8(parsed) {
  const { size, data } = parsed
  const texels = size * size * size
  const out = new Uint8Array(texels * 4)
  for (let i = 0; i < texels; i++) {
    out[i * 4] = Math.max(0, Math.min(255, Math.round(data[i * 3] * 255)))
    out[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(data[i * 3 + 1] * 255)))
    out[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(data[i * 3 + 2] * 255)))
    out[i * 4 + 3] = 255
  }
  return out
}
