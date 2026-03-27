export function clampAudioFadeDuration(value, clipDuration = 0) {
  const duration = Math.max(0, Number(clipDuration) || 0)
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(parsed, duration)
}

export function getAudioClipFadeValues(clip) {
  const duration = Math.max(0, Number(clip?.duration) || 0)
  const fadeIn = clampAudioFadeDuration(clip?.fadeIn, duration)
  const fadeOut = clampAudioFadeDuration(clip?.fadeOut, duration)
  return { duration, fadeIn, fadeOut }
}

export function getAudioClipFadeGain(clip, clipTime) {
  const { duration, fadeIn, fadeOut } = getAudioClipFadeValues(clip)
  if (duration <= 0) return 1

  const time = Math.max(0, Math.min(Number(clipTime) || 0, duration))
  let gain = 1

  if (fadeIn > 0) {
    gain = Math.min(gain, time / fadeIn)
  }

  if (fadeOut > 0) {
    gain = Math.min(gain, (duration - time) / fadeOut)
  }

  return Math.max(0, Math.min(1, gain))
}

function formatFadeNumber(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '0'
  return numeric.toFixed(6).replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, '$1')
}

export function buildAudioFadeVolumeExpression({ clipDuration, fadeIn, fadeOut, clipOffset = 0 }) {
  const duration = Math.max(0, Number(clipDuration) || 0)
  const normalizedFadeIn = clampAudioFadeDuration(fadeIn, duration)
  const normalizedFadeOut = clampAudioFadeDuration(fadeOut, duration)
  const offset = Math.max(0, Math.min(Number(clipOffset) || 0, duration))

  const fadeInExpr = normalizedFadeIn > 0
    ? `if(lt(t+${formatFadeNumber(offset)},${formatFadeNumber(normalizedFadeIn)}),(t+${formatFadeNumber(offset)})/${formatFadeNumber(normalizedFadeIn)},1)`
    : '1'

  const fadeOutStart = Math.max(0, duration - normalizedFadeOut)
  const fadeOutExpr = normalizedFadeOut > 0
    ? `if(gt(t+${formatFadeNumber(offset)},${formatFadeNumber(fadeOutStart)}),(${formatFadeNumber(duration)}-(t+${formatFadeNumber(offset)}))/${formatFadeNumber(normalizedFadeOut)},1)`
    : '1'

  return `max(0,min(1,min(${fadeInExpr},${fadeOutExpr})))`
}
