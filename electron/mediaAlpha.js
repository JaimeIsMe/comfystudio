const ALPHA_PIXEL_FORMAT_PREFIXES = [
  'yuva',
  'gbrap',
  'rgba',
  'bgra',
  'argb',
  'abgr',
  'ayuv',
  'ya',
]

function normalizeProbeText(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function probeStreamHasAlpha(stream) {
  if (!stream || typeof stream !== 'object') return false

  const pixelFormat = normalizeProbeText(stream.pix_fmt)
  if (pixelFormat && ALPHA_PIXEL_FORMAT_PREFIXES.some((prefix) => pixelFormat.startsWith(prefix))) {
    return true
  }

  // VP8/VP9 alpha WebM files commonly report yuv420p through ffprobe and
  // advertise the separate alpha plane only through this Matroska tag.
  const alphaMode = stream.tags?.alpha_mode ?? stream.tags?.ALPHA_MODE
  if (String(alphaMode || '').trim() === '1') return true

  // Some ProRes 4444 probes omit the yuva pixel format but retain the
  // profile name. Keep this as a codec-specific fallback to avoid treating
  // unrelated "4444" metadata as transparency.
  const codecName = normalizeProbeText(stream.codec_name)
  const profile = normalizeProbeText(stream.profile)
  return codecName === 'prores' && profile.includes('4444')
}

function getAlphaExportError(options = {}) {
  if (options.alpha !== true) return null

  const format = normalizeProbeText(options.format)
  const profile = String(options.proresProfile ?? '').trim()
  // The container selects VP9/ProRes in appendExportVideoEncoderArgs even
  // when an internal clip-bake caller leaves the default codec field set.
  const isVp9Webm = format === 'webm'
  const isProRes4444 = (format === 'mov' || format === 'prores') && profile === '4'

  if (isVp9Webm || isProRes4444) return null
  return 'Transparent video export requires WebM (VP9) or MOV (ProRes 4444).'
}

function getExportVideoPixelFormat({ codec, proresProfile, alpha = false } = {}) {
  if (codec === 'prores') {
    return String(proresProfile) === '4' ? 'yuva444p10le' : 'yuv422p10le'
  }
  if (codec === 'vp9') {
    return alpha ? 'yuva420p' : 'yuv420p'
  }
  return 'yuv420p'
}

function appendVp9AlphaArgs(args, alpha) {
  if (alpha === true) args.push('-auto-alt-ref', '0')
  return args
}

function appendAlphaCacheEncoderArgs(args) {
  args.push(
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuva420p',
    '-deadline', 'realtime',
    '-cpu-used', '8',
    '-row-mt', '1',
    '-crf', '30',
    '-b:v', '0',
    '-auto-alt-ref', '0'
  )
  return args
}

module.exports = {
  appendAlphaCacheEncoderArgs,
  appendVp9AlphaArgs,
  getAlphaExportError,
  getExportVideoPixelFormat,
  probeStreamHasAlpha,
}
