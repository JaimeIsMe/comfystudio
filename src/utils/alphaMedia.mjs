export const assetHasAlpha = (asset) => asset?.settings?.hasAlpha === true

export const canUseOpaqueVideoDerivative = (asset) => !assetHasAlpha(asset)

export const supportsTransparentExport = ({ format, proresProfile } = {}) => (
  format === 'webm'
  || (format === 'prores' && String(proresProfile) === '4')
)

export const shouldUseWebCodecsForAsset = canUseOpaqueVideoDerivative

export const normalizeTransparentExportSettings = (settings = {}) => {
  const next = { ...settings }
  if (next.transparent !== true) return next

  if (next.format === 'prores') {
    next.proresProfile = '4'
  }
  if (!supportsTransparentExport(next)) {
    next.transparent = false
    return next
  }

  // Current hardware routes are H.264/H.265 only and cannot retain alpha.
  next.useHardwareEncoder = false
  next.postProcessUpscale = 'none'
  return next
}
