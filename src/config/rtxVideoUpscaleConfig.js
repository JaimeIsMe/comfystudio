export const RTX_VIDEO_UPSCALE_QUALITY_OPTIONS = Object.freeze([
  { id: 'LOW', label: 'Low' },
  { id: 'MEDIUM', label: 'Medium' },
  { id: 'HIGH', label: 'High' },
  { id: 'ULTRA', label: 'Ultra' },
])

export const RTX_VIDEO_UPSCALE_DEFAULTS = Object.freeze({
  quality: 'HIGH',
  longSide: 3840,
})

export function normalizeRtxUpscaleQuality(value = '') {
  const normalized = String(value || '').trim().toUpperCase()
  return RTX_VIDEO_UPSCALE_QUALITY_OPTIONS.some((option) => option.id === normalized)
    ? normalized
    : RTX_VIDEO_UPSCALE_DEFAULTS.quality
}

export function resolveRtxNvencEncoder(videoCodec = 'h264') {
  return String(videoCodec || '').trim().toLowerCase() === 'h265'
    ? 'hevc_nvenc'
    : 'h264_nvenc'
}

export function resolveRtx4kDimensions(width = 1920, height = 1080) {
  const sourceWidth = Math.max(2, Number(width) || 1920)
  const sourceHeight = Math.max(2, Number(height) || 1080)
  const scale = Math.max(1, RTX_VIDEO_UPSCALE_DEFAULTS.longSide / Math.max(sourceWidth, sourceHeight))
  const makeMultipleOfEight = (value) => Math.max(8, Math.round(value / 8) * 8)
  return {
    width: makeMultipleOfEight(sourceWidth * scale),
    height: makeMultipleOfEight(sourceHeight * scale),
  }
}
