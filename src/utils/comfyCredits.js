export const COMFY_CREDITS_PER_USD = 211

export function formatCreditCount(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: numeric % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

export function formatCreditsPerSecond(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return 'Unknown'
  return `${formatCreditCount(numeric)} credits / sec`
}

export function createExactCreditsEstimate(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  return {
    min: numeric,
    max: numeric,
  }
}

export function normalizeCreditsEstimate(estimate) {
  if (estimate == null) return null
  if (typeof estimate === 'number') return createExactCreditsEstimate(estimate)
  if (typeof estimate !== 'object') return null

  const min = Number(estimate.min)
  const max = Number(estimate.max)
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null

  return {
    min,
    max,
  }
}

export function formatCreditsRange(estimatedCredits, multiplier = 1) {
  const normalized = normalizeCreditsEstimate(estimatedCredits)
  if (!normalized) return 'Unknown'

  const scale = Math.max(0, Number(multiplier) || 0)
  const scaledMin = normalized.min * scale
  const scaledMax = normalized.max * scale

  if (Math.abs(scaledMax - scaledMin) < 1e-9) {
    return `${formatCreditCount(scaledMin)} credits`
  }
  return `${formatCreditCount(scaledMin)}-${formatCreditCount(scaledMax)} credits`
}

export function formatUsdValue(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 'Unknown'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(numeric)
}

export function formatUsdRangeFromCredits(estimatedCredits, multiplier = 1) {
  const normalized = normalizeCreditsEstimate(estimatedCredits)
  if (!normalized) return 'Unknown'

  const scale = Math.max(0, Number(multiplier) || 0)
  const usdMin = (normalized.min * scale) / COMFY_CREDITS_PER_USD
  const usdMax = (normalized.max * scale) / COMFY_CREDITS_PER_USD

  if (Math.abs(usdMax - usdMin) < 1e-9) {
    return `~${formatUsdValue(usdMin)}`
  }
  return `~${formatUsdValue(usdMin)}-${formatUsdValue(usdMax)}`
}

export function extractCreditCountFromText(text = '') {
  const normalized = String(text || '')
  if (!normalized) return null

  const priceMatch = normalized.match(/price:\s*([0-9][0-9,]*(?:\.\d+)?)\s*credits?/i)
  const fallbackMatch = normalized.match(/([0-9][0-9,]*(?:\.\d+)?)\s*credits?/i)
  const rawValue = priceMatch?.[1] || fallbackMatch?.[1] || ''
  if (!rawValue) return null

  const parsed = Number(rawValue.replace(/,/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
