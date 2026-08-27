export const DISCOVER_CATALOG_SCHEMA_VERSION = 1
export const DEFAULT_DISCOVER_CATALOG_URL = 'https://raw.githubusercontent.com/VelornLabs/velorn/main/public/discover/catalog.json'
export const DISCOVER_CATALOG_CACHE_KEY = 'velorn-discover-catalog-v1'
export const DISCOVER_CATALOG_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const DISCOVER_CATALOG_REMOTE_TIMEOUT_MS = 5_000

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const ITEM_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const TRUSTED_REMOTE_CATALOG_URLS = new Set([
  DEFAULT_DISCOVER_CATALOG_URL,
  'https://velorn.ai/discover/catalog.json',
  'https://www.velorn.ai/discover/catalog.json',
])
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const ITEM_KINDS = new Set(['showcase', 'tutorial'])
const MAX_CATALOG_ITEMS = 200

// This mirrors public/discover/catalog.json so a valid starter catalog remains
// available even if both the network and a file:// asset request are unavailable.
export const DEFAULT_BUNDLED_DISCOVER_CATALOG = Object.freeze({
  schemaVersion: DISCOVER_CATALOG_SCHEMA_VERSION,
  updatedAt: '2026-08-27T18:11:01.000Z',
  items: Object.freeze([
    Object.freeze({
      id: 'velorn-overview',
      youtubeId: 'RVuGlRZheps',
      title: 'Velorn Overview: AI Video Editing Powered by ComfyUI',
      kind: 'tutorial',
      creator: 'Velorn',
      description: 'A guided overview of Velorn editing and AI generation.',
      category: 'Getting started',
      tags: Object.freeze(['overview', 'generation']),
      featured: true,
    }),
    Object.freeze({
      id: 'velorn-mcp-ai-generations',
      youtubeId: 'AT9usQS3m48',
      title: 'Velorn MCP AI Generations',
      kind: 'tutorial',
      creator: 'Velorn',
      description: 'See an MCP-connected agent drive AI generation from Velorn.',
      category: 'MCP and agents',
      tags: Object.freeze(['mcp', 'generation']),
      featured: false,
    }),
    Object.freeze({
      id: 'velorn-music-video-tutorial',
      youtubeId: '8BsFbUsq1kE',
      title: 'Velorn Music Video Tutorial',
      kind: 'tutorial',
      creator: 'Velorn',
      description: 'Learn the guided workflow for creating a music video in Velorn.',
      category: 'Music videos',
      tags: Object.freeze(['music video', 'guided workflow']),
      featured: false,
    }),
    Object.freeze({
      id: 'motion-graphics-with-an-agent',
      youtubeId: 'Owel8zkMWkY',
      title: 'Motion graphics with an agent',
      kind: 'tutorial',
      creator: 'Velorn',
      description: 'A practical example of using an agent to build motion graphics.',
      category: 'MCP and agents',
      tags: Object.freeze(['motion graphics', 'showcase']),
      featured: false,
    }),
    Object.freeze({
      id: 'claude-edits-solar-system-video',
      youtubeId: '_r4jf7ZDT2o',
      title: 'Claude Edits a Solar System Info Video',
      kind: 'showcase',
      creator: 'Velorn',
      description: 'An agent-assisted informational edit created in Velorn.',
      category: 'Agent-assisted editing',
      tags: Object.freeze(['mcp', 'editing']),
      featured: true,
    }),
    Object.freeze({
      id: 'music-video-made-with-velorn',
      youtubeId: 'iX-YdjVMDhg',
      title: 'Music video made with Velorn',
      kind: 'showcase',
      creator: 'Velorn',
      description: 'A finished music video created with Velorn.',
      category: 'Music videos',
      tags: Object.freeze(['music video']),
      featured: false,
    }),
    Object.freeze({
      id: 'ltx-23-ai-music-video',
      youtubeId: 'ogJ08d2GlqI',
      title: 'LTX 2.3 AI Music Video',
      kind: 'showcase',
      creator: "j'aime",
      description: 'An AI-generated music video created with Velorn and LTX 2.3.',
      category: 'Music videos',
      tags: Object.freeze(['music video', 'ai generation', 'LTX 2.3']),
      featured: false,
    }),
    Object.freeze({
      id: 'you-dont-need-saving',
      youtubeId: 'WcHBs-7_G14',
      title: "You Don't Need Saving",
      kind: 'showcase',
      creator: "j'aime",
      description: 'An original AI-created music video made with Velorn.',
      category: 'Music videos',
      tags: Object.freeze(['music video', 'ai generation']),
      featured: false,
    }),
  ]),
})

function normalizePlainText(value, fieldName, { required = false, maxLength }) {
  if (typeof value === 'undefined' || value === null) {
    if (required) throw new Error(`Discover catalog ${fieldName} is required.`)
    return undefined
  }
  if (typeof value !== 'string') throw new Error(`Discover catalog ${fieldName} must be text.`)

  const normalized = value.trim().replace(/\s+/g, ' ')
  if (required && !normalized) throw new Error(`Discover catalog ${fieldName} is required.`)
  if (!normalized) return undefined
  if (normalized.length > maxLength) {
    throw new Error(`Discover catalog ${fieldName} exceeds ${maxLength} characters.`)
  }
  if (/[<>\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`Discover catalog ${fieldName} contains unsupported markup or control characters.`)
  }
  return normalized
}

function normalizeCatalogItem(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Discover catalog item ${index + 1} must be an object.`)
  }

  const id = normalizePlainText(value.id, `item ${index + 1} id`, { required: true, maxLength: 64 })
  if (!ITEM_ID_PATTERN.test(id)) {
    throw new Error(`Discover catalog item ${index + 1} has an invalid id.`)
  }

  const youtubeId = normalizePlainText(value.youtubeId, `item ${index + 1} youtubeId`, {
    required: true,
    maxLength: 11,
  })
  if (!YOUTUBE_ID_PATTERN.test(youtubeId)) {
    throw new Error(`Discover catalog item ${index + 1} has an invalid YouTube ID.`)
  }

  const title = normalizePlainText(value.title, `item ${index + 1} title`, { required: true, maxLength: 140 })
  const kind = normalizePlainText(value.kind, `item ${index + 1} kind`, { required: true, maxLength: 16 })
  if (!ITEM_KINDS.has(kind)) {
    throw new Error(`Discover catalog item ${index + 1} must be a tutorial or showcase.`)
  }

  const creator = normalizePlainText(value.creator, `item ${index + 1} creator`, { maxLength: 80 })
  const description = normalizePlainText(value.description, `item ${index + 1} description`, { maxLength: 360 })
  const category = normalizePlainText(value.category, `item ${index + 1} category`, { maxLength: 48 })

  if (typeof value.featured !== 'undefined' && typeof value.featured !== 'boolean') {
    throw new Error(`Discover catalog item ${index + 1} featured must be true or false.`)
  }

  if (typeof value.tags !== 'undefined' && !Array.isArray(value.tags)) {
    throw new Error(`Discover catalog item ${index + 1} tags must be a list.`)
  }
  if ((value.tags?.length || 0) > 8) {
    throw new Error(`Discover catalog item ${index + 1} has too many tags.`)
  }
  const tags = [...new Set((value.tags || []).map((tag, tagIndex) => (
    normalizePlainText(tag, `item ${index + 1} tag ${tagIndex + 1}`, { required: true, maxLength: 32 })
  )))]

  return {
    id,
    youtubeId,
    title,
    kind,
    ...(creator ? { creator } : {}),
    ...(description ? { description } : {}),
    ...(category ? { category } : {}),
    ...(tags.length ? { tags } : {}),
    featured: value.featured === true,
  }
}

export function parseDiscoverCatalog(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Discover catalog must be an object.')
  }
  if (value.schemaVersion !== DISCOVER_CATALOG_SCHEMA_VERSION) {
    throw new Error(`Unsupported Discover catalog schema version: ${String(value.schemaVersion)}.`)
  }
  if (!Array.isArray(value.items)) throw new Error('Discover catalog items must be a list.')
  if (value.items.length > MAX_CATALOG_ITEMS) {
    throw new Error(`Discover catalog cannot contain more than ${MAX_CATALOG_ITEMS} items.`)
  }

  let updatedAt
  if (typeof value.updatedAt !== 'undefined') {
    updatedAt = normalizePlainText(value.updatedAt, 'updatedAt', { required: true, maxLength: 40 })
    if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('Discover catalog updatedAt must be a valid date.')
  }

  const items = value.items.map(normalizeCatalogItem)
  const itemIds = new Set()
  const youtubeIds = new Set()
  items.forEach((item) => {
    if (itemIds.has(item.id)) throw new Error(`Discover catalog contains duplicate item id: ${item.id}.`)
    if (youtubeIds.has(item.youtubeId)) {
      throw new Error(`Discover catalog contains duplicate YouTube ID: ${item.youtubeId}.`)
    }
    itemIds.add(item.id)
    youtubeIds.add(item.youtubeId)
  })

  return {
    schemaVersion: DISCOVER_CATALOG_SCHEMA_VERSION,
    ...(updatedAt ? { updatedAt } : {}),
    items,
  }
}

export function isValidYouTubeVideoId(value) {
  return typeof value === 'string' && YOUTUBE_ID_PATTERN.test(value)
}

export function extractYouTubeVideoId(input) {
  const value = typeof input === 'string' ? input.trim() : ''
  if (isValidYouTubeVideoId(value)) return value
  if (!value || /[<>\u0000-\u001f\u007f]/.test(value)) return null

  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null

  const host = url.hostname.toLowerCase()
  let candidate = ''
  if (host === 'youtu.be') {
    const match = url.pathname.match(/^\/([^/]+)\/?$/)
    candidate = match?.[1] || ''
  } else if (YOUTUBE_HOSTS.has(host) && url.pathname === '/watch') {
    candidate = url.searchParams.get('v') || ''
  } else if (YOUTUBE_HOSTS.has(host)) {
    const match = url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)\/?$/)
    candidate = match?.[1] || ''
  }

  return isValidYouTubeVideoId(candidate) ? candidate : null
}

function requireYouTubeVideoId(value) {
  if (!isValidYouTubeVideoId(value)) throw new Error('A valid 11-character YouTube video ID is required.')
  return value
}

export function getYouTubeWatchUrl(youtubeId) {
  return `https://www.youtube.com/watch?v=${requireYouTubeVideoId(youtubeId)}`
}

export function getYouTubeEmbedUrl(youtubeId) {
  return `https://www.youtube-nocookie.com/embed/${requireYouTubeVideoId(youtubeId)}?rel=0`
}

export function getYouTubeThumbnailUrl(youtubeId) {
  return `https://i.ytimg.com/vi/${requireYouTubeVideoId(youtubeId)}/hqdefault.jpg`
}

export function isTrustedDiscoverCatalogUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && TRUSTED_REMOTE_CATALOG_URLS.has(url.href)
  } catch {
    return false
  }
}

export function getDiscoverRemoteCatalogUrl() {
  return DEFAULT_DISCOVER_CATALOG_URL
}

function getViteBaseUrl() {
  const viteBase = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
    ? String(import.meta.env.BASE_URL)
    : './'
  return viteBase
}

export function getBundledDiscoverCatalogUrl(baseUrl = getViteBaseUrl()) {
  const normalizedBase = typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : './'
  if (/^(?:https?:|data:|javascript:)/i.test(normalizedBase)) return './discover/catalog.json'
  return `${normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`}discover/catalog.json`
}

function resolveStorage(storage) {
  if (storage) return storage
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

export function readDiscoverCatalogCache({
  storage,
  now = Date.now(),
  maxAgeMs = DISCOVER_CATALOG_CACHE_MAX_AGE_MS,
} = {}) {
  const resolvedStorage = resolveStorage(storage)
  if (!resolvedStorage || typeof resolvedStorage.getItem !== 'function') return null

  try {
    const raw = resolvedStorage.getItem(DISCOVER_CATALOG_CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw)
    const cachedAt = Number(cached?.cachedAt)
    if (!Number.isFinite(cachedAt) || cachedAt > now || now - cachedAt > maxAgeMs) return null
    return parseDiscoverCatalog(cached.catalog)
  } catch {
    return null
  }
}

export function writeDiscoverCatalogCache(catalog, { storage, now = Date.now() } = {}) {
  const resolvedStorage = resolveStorage(storage)
  if (!resolvedStorage || typeof resolvedStorage.setItem !== 'function') return false

  try {
    const validatedCatalog = parseDiscoverCatalog(catalog)
    resolvedStorage.setItem(DISCOVER_CATALOG_CACHE_KEY, JSON.stringify({
      cachedAt: now,
      catalog: validatedCatalog,
    }))
    return true
  } catch {
    return false
  }
}

export function clearDiscoverCatalogCache({ storage } = {}) {
  const resolvedStorage = resolveStorage(storage)
  if (!resolvedStorage || typeof resolvedStorage.removeItem !== 'function') return false
  try {
    resolvedStorage.removeItem(DISCOVER_CATALOG_CACHE_KEY)
    return true
  } catch {
    return false
  }
}

async function fetchCatalog(url, fetchImpl, signal, { remote = false } = {}) {
  const response = await fetchImpl(url, {
    cache: 'no-store',
    credentials: 'omit',
    ...(remote ? { referrerPolicy: 'no-referrer', redirect: 'error' } : {}),
    ...(signal ? { signal } : {}),
    headers: { Accept: 'application/json' },
  })
  if (!response?.ok) {
    throw new Error(`Discover catalog request failed with status ${String(response?.status || 'unknown')}.`)
  }
  return parseDiscoverCatalog(await response.json())
}

async function fetchRemoteCatalogWithTimeout(url, fetchImpl, parentSignal, timeoutMs) {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(parentSignal?.reason)
  if (parentSignal?.aborted) abortFromParent()
  else parentSignal?.addEventListener?.('abort', abortFromParent, { once: true })

  const normalizedTimeoutMs = Number.isFinite(Number(timeoutMs))
    ? Math.max(1, Number(timeoutMs))
    : DISCOVER_CATALOG_REMOTE_TIMEOUT_MS
  const timer = setTimeout(
    () => controller.abort(new Error('Discover catalog request timed out.')),
    normalizedTimeoutMs,
  )

  try {
    return await fetchCatalog(url, fetchImpl, controller.signal, { remote: true })
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener?.('abort', abortFromParent)
  }
}

export async function loadDiscoverCatalog({
  fetchImpl = globalThis.fetch,
  storage,
  signal,
  remoteUrl = DEFAULT_DISCOVER_CATALOG_URL,
  bundledUrl = getBundledDiscoverCatalogUrl(),
  now = Date.now(),
  remoteTimeoutMs = DISCOVER_CATALOG_REMOTE_TIMEOUT_MS,
} = {}) {
  const warnings = []

  if (typeof fetchImpl === 'function' && isTrustedDiscoverCatalogUrl(remoteUrl)) {
    try {
      const catalog = await fetchRemoteCatalogWithTimeout(
        remoteUrl,
        fetchImpl,
        signal,
        remoteTimeoutMs,
      )
      writeDiscoverCatalogCache(catalog, { storage, now })
      return { catalog, source: 'remote' }
    } catch (error) {
      warnings.push(error)
    }
  } else if (remoteUrl) {
    warnings.push(new Error('The Discover catalog remote URL is not trusted.'))
  }

  const cachedCatalog = readDiscoverCatalogCache({ storage, now })
  if (cachedCatalog) {
    return { catalog: cachedCatalog, source: 'cache', ...(warnings[0] ? { warning: warnings[0] } : {}) }
  }

  if (typeof fetchImpl === 'function') {
    try {
      const catalog = await fetchCatalog(bundledUrl, fetchImpl, signal)
      return { catalog, source: 'bundled', ...(warnings[0] ? { warning: warnings[0] } : {}) }
    } catch (error) {
      warnings.push(error)
    }
  }

  // Keep Discover useful offline even in restrictive file:// environments.
  return {
    catalog: parseDiscoverCatalog(DEFAULT_BUNDLED_DISCOVER_CATALOG),
    source: 'bundled',
    ...(warnings[0] ? { warning: warnings[0] } : {}),
  }
}
