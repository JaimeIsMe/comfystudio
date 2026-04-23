export const TOPAZ_VIDEO_UPSCALE_WORKFLOW_ID = 'topaz-video-upscale'

export const TOPAZ_VIDEO_UPSCALE_MODEL_OPTIONS = Object.freeze([
  {
    id: 'Starlight Precise 2.5',
    label: 'Starlight Precise 2.5',
    creativitySupported: false,
  },
  {
    id: 'Starlight (Astra) Fast',
    label: 'Starlight (Astra) Fast',
    creativitySupported: false,
  },
  {
    id: 'Starlight (Astra) Creative',
    label: 'Starlight (Astra) Creative',
    creativitySupported: true,
  },
])

export const TOPAZ_VIDEO_UPSCALE_RESOLUTION_OPTIONS = Object.freeze([
  {
    id: 'FullHD (1080p)',
    label: '1080p',
    shortLabel: '1080p',
    longSide: 1920,
  },
  {
    id: '4K (2160p)',
    label: '4K',
    shortLabel: '4K',
    longSide: 3840,
  },
])

export const TOPAZ_VIDEO_UPSCALE_CREATIVITY_OPTIONS = Object.freeze([
  { id: 'low', label: 'Low' },
  { id: 'middle', label: 'Middle' },
  { id: 'high', label: 'High' },
])

export const TOPAZ_VIDEO_UPSCALE_DEFAULTS = Object.freeze({
  model: TOPAZ_VIDEO_UPSCALE_MODEL_OPTIONS[0].id,
  resolution: TOPAZ_VIDEO_UPSCALE_RESOLUTION_OPTIONS[0].id,
  creativity: TOPAZ_VIDEO_UPSCALE_CREATIVITY_OPTIONS[0].id,
})

export const TOPAZ_VIDEO_UPSCALE_PRICING_GUIDE = Object.freeze({
  'Starlight Precise 2.5': Object.freeze({
    'FullHD (1080p)': 12.99,
    '4K (2160p)': 28.08,
  }),
  'Starlight (Astra) Fast': Object.freeze({
    'FullHD (1080p)': 6.5,
    '4K (2160p)': 14.16,
  }),
  'Starlight (Astra) Creative': Object.freeze({
    'FullHD (1080p)': 43.62,
    '4K (2160p)': 77.99,
  }),
})

function firstFiniteNumber(...values) {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 0
}

export function getTopazVideoUpscaleModelOption(modelId = '') {
  return TOPAZ_VIDEO_UPSCALE_MODEL_OPTIONS.find((option) => option.id === modelId) || null
}

export function topazVideoUpscaleModelSupportsCreativity(modelId = '') {
  return getTopazVideoUpscaleModelOption(modelId)?.creativitySupported === true
}

export function getTopazVideoUpscaleResolutionOption(resolutionId = '') {
  return TOPAZ_VIDEO_UPSCALE_RESOLUTION_OPTIONS.find((option) => option.id === resolutionId) || null
}

export function getTopazVideoUpscaleResolutionShortLabel(resolutionId = '') {
  const option = getTopazVideoUpscaleResolutionOption(resolutionId)
  return option?.shortLabel || option?.label || String(resolutionId || '').trim()
}

export function getTopazVideoUpscaleCreditsPerSecond(modelId = '', resolutionId = '') {
  const rate = TOPAZ_VIDEO_UPSCALE_PRICING_GUIDE?.[String(modelId || '').trim()]?.[String(resolutionId || '').trim()]
  const numeric = Number(rate)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

export function getAssetResolutionDimensions(asset = null) {
  return {
    width: firstFiniteNumber(asset?.settings?.width, asset?.width),
    height: firstFiniteNumber(asset?.settings?.height, asset?.height),
  }
}

export function getAssetLongSide(asset = null) {
  const { width, height } = getAssetResolutionDimensions(asset)
  if (!width || !height) return 0
  return Math.max(width, height)
}

export function isTopazVideoUpscaleResolutionDisabled(asset = null, resolutionId = '') {
  const option = getTopazVideoUpscaleResolutionOption(resolutionId)
  const longSide = getAssetLongSide(asset)
  if (!option || !longSide) return false
  return longSide >= option.longSide
}

export function getTopazVideoUpscaleResolutionNotice(asset = null, resolutionId = '') {
  if (!isTopazVideoUpscaleResolutionDisabled(asset, resolutionId)) return ''
  return 'Video is already at this resolution or higher.'
}
