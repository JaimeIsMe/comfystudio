const clampNumber = (value, min, max, fallback = 0) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

const clampUnit = (value) => Math.max(0, Math.min(1, value))
const lerp = (from, to, weight) => from + ((to - from) * weight)

export const COLOR_ADJUSTMENT_KEYS = Object.freeze([
  'brightness',
  'contrast',
  'saturation',
  'gain',
  'gamma',
  'offset',
  'hue',
])

export const GLOBAL_ADJUSTMENT_KEYS = Object.freeze([...COLOR_ADJUSTMENT_KEYS, 'blur'])
export const TONAL_ADJUSTMENT_GROUP_KEYS = Object.freeze(['shadows', 'midtones', 'highlights'])
export const TONAL_ADJUSTMENT_PROPERTY_IDS = Object.freeze(
  TONAL_ADJUSTMENT_GROUP_KEYS.flatMap((group) => COLOR_ADJUSTMENT_KEYS.map((key) => `${group}.${key}`))
)

export const DEFAULT_TONAL_ADJUSTMENT_GROUP = Object.freeze({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  gain: 0,
  gamma: 0,
  offset: 0,
  hue: 0,
})

export const DEFAULT_ADJUSTMENT_SETTINGS = Object.freeze({
  brightness: 0, // -100..100 (%)
  contrast: 0,   // -100..100 (%)
  saturation: 0, // -100..100 (%)
  gain: 0,       // -100..100 (%)
  gamma: 0,      // -100..100 (%), stylistic gamma-like curve control
  offset: 0,     // -100..100 (%)
  hue: 0,        // -180..180 (deg)
  blur: 0,       // 0..50 (px)
  lut: null,     // { lutId, amount 0..100 } — 3D LUT from the app LUT library
  shadows: DEFAULT_TONAL_ADJUSTMENT_GROUP,
  midtones: DEFAULT_TONAL_ADJUSTMENT_GROUP,
  highlights: DEFAULT_TONAL_ADJUSTMENT_GROUP,
})

// LUT reference: only an id + strength live on the clip; the table itself
// stays in the app-level LUT library (services/lutLibrary.js).
export function normalizeLutSettings(lut) {
  const lutId = typeof lut?.lutId === 'string' ? lut.lutId.trim() : ''
  if (!lutId) return null
  return {
    lutId,
    amount: clampNumber(lut?.amount, 0, 100, 100),
  }
}

const createDefaultTonalGroup = () => ({ ...DEFAULT_TONAL_ADJUSTMENT_GROUP })

const getBrightnessFactor = (value) => Math.max(0, (100 + Number(value || 0)) / 100)
const getContrastFactor = (value) => Math.max(0, (100 + Number(value || 0)) / 100)
const getGammaContrastFactor = (value) => Math.max(0, (100 + (Number(value || 0) * 0.5)) / 100)
const getOffsetIntercept = (value) => Number(value || 0) / 200

const normalizeHue = (value, fallback = 0) => clampNumber(value, -180, 180, fallback)

export function normalizeAdjustmentGroup(settings = {}) {
  return {
    brightness: clampNumber(settings?.brightness, -100, 100, DEFAULT_TONAL_ADJUSTMENT_GROUP.brightness),
    contrast: clampNumber(settings?.contrast, -100, 100, DEFAULT_TONAL_ADJUSTMENT_GROUP.contrast),
    saturation: clampNumber(settings?.saturation, -100, 100, DEFAULT_TONAL_ADJUSTMENT_GROUP.saturation),
    gain: clampNumber(settings?.gain, -100, 100, DEFAULT_TONAL_ADJUSTMENT_GROUP.gain),
    gamma: clampNumber(settings?.gamma, -100, 100, DEFAULT_TONAL_ADJUSTMENT_GROUP.gamma),
    offset: clampNumber(settings?.offset, -100, 100, DEFAULT_TONAL_ADJUSTMENT_GROUP.offset),
    hue: normalizeHue(settings?.hue, DEFAULT_TONAL_ADJUSTMENT_GROUP.hue),
  }
}

export function normalizeAdjustmentSettings(settings = {}) {
  return {
    brightness: clampNumber(settings?.brightness, -100, 100, DEFAULT_ADJUSTMENT_SETTINGS.brightness),
    contrast: clampNumber(settings?.contrast, -100, 100, DEFAULT_ADJUSTMENT_SETTINGS.contrast),
    saturation: clampNumber(settings?.saturation, -100, 100, DEFAULT_ADJUSTMENT_SETTINGS.saturation),
    gain: clampNumber(settings?.gain, -100, 100, DEFAULT_ADJUSTMENT_SETTINGS.gain),
    gamma: clampNumber(settings?.gamma, -100, 100, DEFAULT_ADJUSTMENT_SETTINGS.gamma),
    offset: clampNumber(settings?.offset, -100, 100, DEFAULT_ADJUSTMENT_SETTINGS.offset),
    hue: normalizeHue(settings?.hue, DEFAULT_ADJUSTMENT_SETTINGS.hue),
    blur: clampNumber(settings?.blur, 0, 50, DEFAULT_ADJUSTMENT_SETTINGS.blur),
    lut: normalizeLutSettings(settings?.lut),
    shadows: normalizeAdjustmentGroup(settings?.shadows || {}),
    midtones: normalizeAdjustmentGroup(settings?.midtones || {}),
    highlights: normalizeAdjustmentGroup(settings?.highlights || {}),
  }
}

export function mergeAdjustmentSettings(base = {}, updates = {}) {
  const normalizedBase = normalizeAdjustmentSettings(base)
  const next = { ...normalizedBase, ...(updates || {}) }

  for (const groupKey of TONAL_ADJUSTMENT_GROUP_KEYS) {
    if (updates && Object.prototype.hasOwnProperty.call(updates, groupKey)) {
      next[groupKey] = {
        ...normalizedBase[groupKey],
        ...(updates?.[groupKey] || {}),
      }
    }
  }

  return normalizeAdjustmentSettings(next)
}

export function getAdjustmentValue(settings = {}, propertyPath) {
  if (!propertyPath || typeof propertyPath !== 'string') return undefined
  const segments = propertyPath.split('.')
  let current = settings
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') return undefined
    current = current[segment]
  }
  return current
}

export function setAdjustmentValue(settings = {}, propertyPath, value) {
  if (!propertyPath || typeof propertyPath !== 'string') {
    return normalizeAdjustmentSettings(settings)
  }

  const normalized = normalizeAdjustmentSettings(settings)
  const segments = propertyPath.split('.')

  if (segments.length === 1) {
    return normalizeAdjustmentSettings({
      ...normalized,
      [segments[0]]: value,
    })
  }

  const [groupKey, propertyKey] = segments
  if (!TONAL_ADJUSTMENT_GROUP_KEYS.includes(groupKey)) {
    return normalized
  }

  return normalizeAdjustmentSettings({
    ...normalized,
    [groupKey]: {
      ...normalized[groupKey],
      [propertyKey]: value,
    },
  })
}

function buildCssFilterPartsFromGroup(settings = {}, { includeBlur = false } = {}) {
  const normalized = includeBlur
    ? normalizeAdjustmentSettings(settings)
    : normalizeAdjustmentGroup(settings)
  const parts = []

  if (normalized.brightness !== 0) {
    parts.push(`brightness(${getBrightnessFactor(normalized.brightness).toFixed(3)})`)
  }
  if (normalized.contrast !== 0) {
    parts.push(`contrast(${getContrastFactor(normalized.contrast).toFixed(3)})`)
  }
  if (normalized.saturation !== 0) {
    const value = Math.max(0, (100 + normalized.saturation) / 100)
    parts.push(`saturate(${value.toFixed(3)})`)
  }
  if (normalized.gain !== 0) {
    parts.push(`brightness(${getBrightnessFactor(normalized.gain).toFixed(3)})`)
  }
  if (normalized.gamma !== 0) {
    parts.push(`contrast(${getGammaContrastFactor(normalized.gamma).toFixed(3)})`)
  }
  if (normalized.offset !== 0) {
    parts.push(`brightness(${Math.max(0, 1 + getOffsetIntercept(normalized.offset)).toFixed(3)})`)
  }
  if (normalized.hue !== 0) {
    parts.push(`hue-rotate(${normalized.hue.toFixed(1)}deg)`)
  }
  if (includeBlur && normalized.blur > 0) {
    parts.push(`blur(${normalized.blur.toFixed(2)}px)`)
  }

  return parts
}

export function buildCssFilterFromAdjustmentGroup(settings = {}, { includeBlur = false } = {}) {
  const parts = buildCssFilterPartsFromGroup(settings, { includeBlur })
  return parts.length > 0 ? parts.join(' ') : 'none'
}

export function buildCssFilterFromAdjustments(settings = {}, { includeBlur = true } = {}) {
  return buildCssFilterFromAdjustmentGroup(normalizeAdjustmentSettings(settings), { includeBlur })
}

export function hasAdjustmentGroupEffect(settings = {}) {
  return COLOR_ADJUSTMENT_KEYS.some((key) => Number(settings?.[key] || 0) !== 0)
}

export function hasTonalAdjustmentEffect(settings = {}) {
  const normalized = normalizeAdjustmentSettings(settings)
  return TONAL_ADJUSTMENT_GROUP_KEYS.some((groupKey) => hasAdjustmentGroupEffect(normalized[groupKey]))
}

export function hasLutEffect(settings = {}) {
  const lut = normalizeLutSettings(settings?.lut)
  return Boolean(lut && lut.amount > 0)
}

export function hasAdjustmentEffect(settings = {}) {
  const normalized = normalizeAdjustmentSettings(settings)
  return normalized.blur > 0
    || hasAdjustmentGroupEffect(normalized)
    || hasTonalAdjustmentEffect(normalized)
    || hasLutEffect(normalized)
}

// Routes a clip through the full-frame color pass (ADJUSTMENT_COLOR_PASS_FS)
// instead of the cheap per-sample inline grade: tonal groups need the
// luminance-weighted lerp, and LUTs need the 3D texture tap that only the
// full pass carries. The CPU pixel loop keeps using hasTonalAdjustmentEffect
// directly — it has no LUT stage (no-WebGL2 machines skip LUTs end-to-end,
// preview and export alike).
export function needsAdvancedColorPass(settings = {}) {
  return hasTonalAdjustmentEffect(settings) || hasLutEffect(settings)
}

// True when an adjustment clip's transform would visibly change the layers
// beneath it (scale/position/rotation/crop/flip or a non-normal blend of the
// stage copy over itself). A transform-only adjustment layer must still
// composite — the renderers skip inactive adjustment clips entirely, and
// gating only on color/effects made "scale everything with one adjustment
// layer" silently do nothing. Opacity alone is excluded: a partial-alpha
// copy of the stage over the identical stage is a visual no-op.
export function hasTransformingAdjustmentTransform(transform = {}) {
  const epsilon = 0.001
  const differs = (value, base) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && Math.abs(parsed - base) > epsilon
  }
  return (
    differs(transform.positionX, 0)
    || differs(transform.positionY, 0)
    || differs(transform.positionZ, 0)
    || differs(transform.scaleX, 100)
    || differs(transform.scaleY, 100)
    || differs(transform.rotation, 0)
    || differs(transform.rotationX, 0)
    || differs(transform.rotationY, 0)
    || differs(transform.cropTop, 0)
    || differs(transform.cropBottom, 0)
    || differs(transform.cropLeft, 0)
    || differs(transform.cropRight, 0)
    || transform.flipH === true
    || transform.flipV === true
    || (typeof transform.blendMode === 'string' && transform.blendMode !== 'normal')
  )
}

export function scaleAdjustmentSettings(settings = {}, factor = 1) {
  const normalized = normalizeAdjustmentSettings(settings)
  const clampedFactor = Math.max(0, Number.isFinite(Number(factor)) ? Number(factor) : 1)
  const scaled = {
    ...normalized,
    blur: normalized.blur * clampedFactor,
  }

  for (const key of COLOR_ADJUSTMENT_KEYS) {
    scaled[key] = normalized[key] * clampedFactor
  }
  for (const groupKey of TONAL_ADJUSTMENT_GROUP_KEYS) {
    scaled[groupKey] = {}
    for (const key of COLOR_ADJUSTMENT_KEYS) {
      scaled[groupKey][key] = normalized[groupKey][key] * clampedFactor
    }
  }

  return normalizeAdjustmentSettings(scaled)
}

export function getAdjustmentSvgFilterStages(settings = {}, { includeBlur = false } = {}) {
  const normalized = includeBlur
    ? normalizeAdjustmentSettings(settings)
    : normalizeAdjustmentGroup(settings)
  const stages = []

  if (normalized.brightness !== 0) {
    stages.push({ type: 'linear', slope: getBrightnessFactor(normalized.brightness), intercept: 0 })
  }
  if (normalized.contrast !== 0) {
    const slope = getContrastFactor(normalized.contrast)
    stages.push({ type: 'linear', slope, intercept: 0.5 - (0.5 * slope) })
  }
  if (normalized.saturation !== 0) {
    stages.push({ type: 'saturate', value: Math.max(0, (100 + normalized.saturation) / 100) })
  }
  if (normalized.gain !== 0) {
    stages.push({ type: 'linear', slope: getBrightnessFactor(normalized.gain), intercept: 0 })
  }
  if (normalized.gamma !== 0) {
    const slope = getGammaContrastFactor(normalized.gamma)
    stages.push({ type: 'linear', slope, intercept: 0.5 - (0.5 * slope) })
  }
  if (normalized.offset !== 0) {
    stages.push({ type: 'linear', slope: 1, intercept: getOffsetIntercept(normalized.offset) })
  }
  if (normalized.hue !== 0) {
    stages.push({ type: 'hueRotate', value: normalized.hue })
  }
  if (includeBlur && normalized.blur > 0) {
    stages.push({ type: 'gaussianBlur', stdDeviation: normalized.blur })
  }

  return stages
}

const smoothstep = (edge0, edge1, value) => {
  const t = clampUnit((value - edge0) / Math.max(0.0001, edge1 - edge0))
  return t * t * (3 - (2 * t))
}

export function getTonalWeight(zone, luminance) {
  const value = clampUnit(luminance)
  switch (zone) {
    case 'shadows':
      return 1 - smoothstep(0.18, 0.55, value)
    case 'highlights':
      return smoothstep(0.45, 0.82, value)
    case 'midtones':
      return smoothstep(0.18, 0.5, value) * (1 - smoothstep(0.5, 0.82, value))
    default:
      return 0
  }
}

export function getTonalMaskTableValues(zone, samples = 17) {
  const totalSamples = Math.max(3, Math.round(samples))
  return Array.from({ length: totalSamples }, (_, index) => {
    const luminance = index / (totalSamples - 1)
    return getTonalWeight(zone, luminance).toFixed(4)
  }).join(' ')
}

const applyLinearStage = ([r, g, b], slope, intercept = 0) => ([
  clampUnit((r * slope) + intercept),
  clampUnit((g * slope) + intercept),
  clampUnit((b * slope) + intercept),
])

const applySaturationStage = ([r, g, b], amount) => {
  const lum = (0.2126 * r) + (0.7152 * g) + (0.0722 * b)
  return [
    clampUnit(lum + ((r - lum) * amount)),
    clampUnit(lum + ((g - lum) * amount)),
    clampUnit(lum + ((b - lum) * amount)),
  ]
}

const applyHueRotateStage = ([r, g, b], degrees) => {
  const angle = (degrees * Math.PI) / 180
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)

  const matrix = [
    [
      0.213 + (cosA * 0.787) - (sinA * 0.213),
      0.715 - (cosA * 0.715) - (sinA * 0.715),
      0.072 - (cosA * 0.072) + (sinA * 0.928),
    ],
    [
      0.213 - (cosA * 0.213) + (sinA * 0.143),
      0.715 + (cosA * 0.285) + (sinA * 0.140),
      0.072 - (cosA * 0.072) - (sinA * 0.283),
    ],
    [
      0.213 - (cosA * 0.213) - (sinA * 0.787),
      0.715 - (cosA * 0.715) + (sinA * 0.715),
      0.072 + (cosA * 0.928) + (sinA * 0.072),
    ],
  ]

  return [
    clampUnit((r * matrix[0][0]) + (g * matrix[0][1]) + (b * matrix[0][2])),
    clampUnit((r * matrix[1][0]) + (g * matrix[1][1]) + (b * matrix[1][2])),
    clampUnit((r * matrix[2][0]) + (g * matrix[2][1]) + (b * matrix[2][2])),
  ]
}

export function applyAdjustmentGroupToRgb(rgb = [0, 0, 0], settings = {}) {
  const normalized = normalizeAdjustmentGroup(settings)
  let next = [...rgb]

  if (normalized.brightness !== 0) {
    next = applyLinearStage(next, getBrightnessFactor(normalized.brightness), 0)
  }
  if (normalized.contrast !== 0) {
    const slope = getContrastFactor(normalized.contrast)
    next = applyLinearStage(next, slope, 0.5 - (0.5 * slope))
  }
  if (normalized.saturation !== 0) {
    next = applySaturationStage(next, Math.max(0, (100 + normalized.saturation) / 100))
  }
  if (normalized.gain !== 0) {
    next = applyLinearStage(next, getBrightnessFactor(normalized.gain), 0)
  }
  if (normalized.gamma !== 0) {
    const slope = getGammaContrastFactor(normalized.gamma)
    next = applyLinearStage(next, slope, 0.5 - (0.5 * slope))
  }
  if (normalized.offset !== 0) {
    next = applyLinearStage(next, 1, getOffsetIntercept(normalized.offset))
  }
  if (normalized.hue !== 0) {
    next = applyHueRotateStage(next, normalized.hue)
  }

  return next
}

export function applyAdjustmentSettingsToImageData(imageData, settings = {}) {
  if (!imageData?.data) return imageData
  const normalized = normalizeAdjustmentSettings(settings)
  const tonalEnabled = hasTonalAdjustmentEffect(normalized)
  const data = imageData.data

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3]
    if (alpha <= 0) continue

    const original = [
      data[index] / 255,
      data[index + 1] / 255,
      data[index + 2] / 255,
    ]

    const globalAdjusted = applyAdjustmentGroupToRgb(original, normalized)
    let finalColor = [...globalAdjusted]

    if (tonalEnabled) {
      const luminance = (0.2126 * globalAdjusted[0]) + (0.7152 * globalAdjusted[1]) + (0.0722 * globalAdjusted[2])
      for (const groupKey of TONAL_ADJUSTMENT_GROUP_KEYS) {
        const groupSettings = normalized[groupKey]
        if (!hasAdjustmentGroupEffect(groupSettings)) continue
        const weight = getTonalWeight(groupKey, luminance)
        if (weight <= 0) continue
        const groupAdjusted = applyAdjustmentGroupToRgb(globalAdjusted, groupSettings)
        finalColor = [
          lerp(finalColor[0], groupAdjusted[0], weight),
          lerp(finalColor[1], groupAdjusted[1], weight),
          lerp(finalColor[2], groupAdjusted[2], weight),
        ]
      }
    }

    data[index] = Math.round(clampUnit(finalColor[0]) * 255)
    data[index + 1] = Math.round(clampUnit(finalColor[1]) * 255)
    data[index + 2] = Math.round(clampUnit(finalColor[2]) * 255)
  }

  return imageData
}
