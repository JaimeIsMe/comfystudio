import { buildMogStateFromPreset } from '../utils/mogPresets'
import { KINETIC_CAPTION_STYLES } from '../utils/kineticCaptionRenderer'

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export const CAPTION_PRESETS = [
  ...KINETIC_CAPTION_STYLES,
]

export const DEFAULT_CAPTION_PRESET_ID = KINETIC_CAPTION_STYLES[0]?.id || CAPTION_PRESETS[0]?.id

export function getCaptionPresetById(id) {
  return CAPTION_PRESETS.find((preset) => preset.id === id) || CAPTION_PRESETS[0]
}

export function buildCaptionControlsFromPreset(presetOrId, {
  text = '',
  duration = 2,
  assetName = null,
  aspectRatio = '16:9',
  overrides = {},
} = {}) {
  const preset = typeof presetOrId === 'string'
    ? getCaptionPresetById(presetOrId)
    : getCaptionPresetById(presetOrId?.id)

  if (preset?.renderer === 'kinetic') {
    return {
      headline: String(text || preset.sampleText || '').trim(),
      duration: clamp(Number(duration) || 2, 0.4, 8),
      assetName: assetName || `${preset.name} Captions`,
      ...overrides,
    }
  }

  const base = buildMogStateFromPreset(preset)
  return {
    ...base,
    headline: String(text || preset.sampleText || '').trim(),
    subheadline: '',
    kicker: '',
    duration: clamp(Number(duration) || 2, 0.4, 8),
    lineCount: 'auto',
    showKicker: false,
    textAlign: preset.textAlign || 'center',
    textGranularity: preset.textGranularity || 'word',
    backgroundMode: 'timelineStill',
    aspectRatio,
    assetName: assetName || `${preset.name} Captions`,
    ...overrides,
  }
}
