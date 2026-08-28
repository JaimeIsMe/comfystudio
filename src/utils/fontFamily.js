const DEFAULT_FONT_FAMILY = 'Inter'

export function normalizeFontFamilyName(value, fallback = null) {
  if (typeof value !== 'string') return fallback
  let normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const hasMatchingQuotes = (
    (normalized.startsWith('"') && normalized.endsWith('"'))
    || (normalized.startsWith("'") && normalized.endsWith("'"))
  )
  if (hasMatchingQuotes && normalized.length >= 2) {
    normalized = normalized.slice(1, -1).trim()
  }

  if (!normalized || normalized.length > 160) return fallback
  return normalized
}

/** Serialize one font family as a quoted CSS string token. */
export function quoteCssFontFamily(value, fallback = DEFAULT_FONT_FAMILY) {
  const family = normalizeFontFamilyName(value, fallback) || DEFAULT_FONT_FAMILY
  const escaped = family
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
  return `"${escaped}"`
}

export { DEFAULT_FONT_FAMILY }
