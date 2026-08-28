import { normalizeFontFamilyName } from '../utils/fontFamily.js'

export const CURATED_FONT_FAMILIES = Object.freeze([
  'Inter',
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Verdana',
  'Impact',
  'Comic Sans MS',
  'Trebuchet MS',
  'Tahoma',
])

const INITIAL_FONT_CATALOG = Object.freeze({
  families: CURATED_FONT_FAMILIES,
  status: 'idle',
  error: null,
  source: 'curated',
})

let cachedFontCatalog = INITIAL_FONT_CATALOG
let hasLoadedFontCatalog = false
let pendingFontCatalog = null
const catalogListeners = new Set()

export { normalizeFontFamilyName }

export function mergeFontFamilies(...collections) {
  const families = []
  const seen = new Set()

  for (const collection of collections) {
    const values = Array.isArray(collection) ? collection : [collection]
    for (const value of values) {
      const family = normalizeFontFamilyName(value)
      if (!family) continue
      const key = family.toLocaleLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      families.push(family)
    }
  }

  return families
}

export function resolveFontFamilySelection(families, value, fallback = 'Inter') {
  const current = normalizeFontFamilyName(value)
    || normalizeFontFamilyName(fallback)
    || 'Inter'
  const match = (Array.isArray(families) ? families : []).find((family) => (
    normalizeFontFamilyName(family)?.toLocaleLowerCase() === current.toLocaleLowerCase()
  ))
  return normalizeFontFamilyName(match) || current
}

function publishFontCatalog(nextCatalog) {
  cachedFontCatalog = nextCatalog
  for (const listener of catalogListeners) listener(nextCatalog)
  return nextCatalog
}

export function getSystemFontCatalogSnapshot() {
  return cachedFontCatalog
}

export function subscribeSystemFontCatalog(listener) {
  if (typeof listener !== 'function') return () => {}
  catalogListeners.add(listener)
  return () => catalogListeners.delete(listener)
}

export async function loadSystemFontFamilies({ forceRefresh = false, fontApi } = {}) {
  if (pendingFontCatalog) return pendingFontCatalog
  if (!forceRefresh && hasLoadedFontCatalog) return cachedFontCatalog

  const api = fontApi || globalThis.window?.electronAPI
  if (!api || typeof api.getSystemFonts !== 'function') {
    hasLoadedFontCatalog = true
    return publishFontCatalog({
      families: [...CURATED_FONT_FAMILIES],
      status: 'fallback',
      error: null,
      source: 'curated',
    })
  }

  publishFontCatalog({
    ...cachedFontCatalog,
    status: 'loading',
    error: null,
  })

  const request = (async () => {
    try {
      const result = await api.getSystemFonts(forceRefresh === true)
      const installed = Array.isArray(result?.fonts) ? result.fonts : []
      const families = mergeFontFamilies(CURATED_FONT_FAMILIES, installed)
      hasLoadedFontCatalog = true
      return publishFontCatalog({
        families,
        status: installed.length > 0 ? 'ready' : 'error',
        error: installed.length > 0
          ? null
          : (result?.error || 'Velorn could not read the fonts installed on this computer.'),
        source: result?.source || 'system',
      })
    } catch (error) {
      hasLoadedFontCatalog = true
      return publishFontCatalog({
        families: [...CURATED_FONT_FAMILIES],
        status: 'error',
        error: error?.message || 'Velorn could not read the fonts installed on this computer.',
        source: 'unavailable',
      })
    } finally {
      pendingFontCatalog = null
    }
  })()

  pendingFontCatalog = request
  return request
}

export function resetSystemFontCacheForTests() {
  cachedFontCatalog = INITIAL_FONT_CATALOG
  hasLoadedFontCatalog = false
  pendingFontCatalog = null
  catalogListeners.clear()
}
