const clampNumber = (value, min, max, fallback = 0) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export const DEFAULT_ADJUSTMENT_SETTINGS = Object.freeze({
  brightness: 0, // -100..100 (%)
  contrast: 0,   // -100..100 (%)
  saturation: 0, // -100..100 (%)
  gain: 0,       // -100..100 (%)
  gamma: 0,      // -100..100 (%), stylistic gamma-like curve control
  offset: 0,     // -100..100 (%)
  hue: 0,        // -180..180 (deg)
  blur: 0,       // 0..50 (px)
})

export function normalizeAdjustmentSettings(settings = {}) {
  return {
    brightness: clampNumber(settings?.brightness, -100, 100, DEFAULT_ADJUSTMENT_SETTINGS.brightness),
    contrast: clampNumber(settings?.contrast, -100, 100, DEFAULT_ADJUSTMENT_SETTINGS.contrast),
    saturation: clampNumber(settings?.saturation, -100, 100, DEFAULT_ADJUSTMENT_SETTINGS.saturation),
    gain: clampNumber(settings?.gain, -100, 100, DEFAULT_ADJUSTMENT_SETTINGS.gain),
    gamma: clampNumber(settings?.gamma, -100, 100, DEFAULT_ADJUSTMENT_SETTINGS.gamma),
    offset: clampNumber(settings?.offset, -100, 100, DEFAULT_ADJUSTMENT_SETTINGS.offset),
    hue: clampNumber(settings?.hue, -180, 180, DEFAULT_ADJUSTMENT_SETTINGS.hue),
    blur: clampNumber(settings?.blur, 0, 50, DEFAULT_ADJUSTMENT_SETTINGS.blur),
  }
}

export function buildCssFilterFromAdjustments(settings = {}, { includeBlur = true } = {}) {
  const normalized = normalizeAdjustmentSettings(settings)
  const parts = []

  if (normalized.brightness !== 0) {
    const value = Math.max(0, (100 + normalized.brightness) / 100)
    parts.push(`brightness(${value.toFixed(3)})`)
  }
  if (normalized.contrast !== 0) {
    const value = Math.max(0, (100 + normalized.contrast) / 100)
    parts.push(`contrast(${value.toFixed(3)})`)
  }
  if (normalized.saturation !== 0) {
    const value = Math.max(0, (100 + normalized.saturation) / 100)
    parts.push(`saturate(${value.toFixed(3)})`)
  }
  if (normalized.gain !== 0) {
    const value = Math.max(0, (100 + normalized.gain) / 100)
    parts.push(`brightness(${value.toFixed(3)})`)
  }
  if (normalized.gamma !== 0) {
    // CSS has no direct gamma filter; use contrast as a perceptual approximation.
    const value = Math.max(0, (100 + normalized.gamma * 0.5) / 100)
    parts.push(`contrast(${value.toFixed(3)})`)
  }
  if (normalized.offset !== 0) {
    const value = Math.max(0, 1 + (normalized.offset / 200))
    parts.push(`brightness(${value.toFixed(3)})`)
  }
  if (normalized.hue !== 0) {
    parts.push(`hue-rotate(${normalized.hue.toFixed(1)}deg)`)
  }
  if (includeBlur && normalized.blur > 0) {
    parts.push(`blur(${normalized.blur.toFixed(2)}px)`)
  }

  return parts.length > 0 ? parts.join(' ') : 'none'
}

export function hasAdjustmentEffect(settings = {}) {
  return buildCssFilterFromAdjustments(settings) !== 'none'
}
