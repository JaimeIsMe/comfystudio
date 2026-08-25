const PEXELS_PHOTOS_SEARCH_URL = 'https://api.pexels.com/v1/search'
const PEXELS_VIDEOS_SEARCH_URL = 'https://api.pexels.com/videos/search'
const PEXELS_CURATED_PHOTOS_URL = 'https://api.pexels.com/v1/curated'
const PEXELS_POPULAR_VIDEOS_URL = 'https://api.pexels.com/videos/popular'

export const PEXELS_STOCK_PANEL_STORAGE_KEY = 'comfystudio-stock-panel-state-v1'
export const PEXELS_DEFAULT_PER_PAGE = 20
export const PEXELS_MAX_PER_PAGE = 80
export const PEXELS_MAX_MCP_IMPORT_ITEMS = 20
export const VELORN_OPEN_STOCK_EVENT = 'velorn-open-stock-tab'

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.round(numeric)))
}

export function normalizePexelsQuery(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 200)
}

export function normalizePexelsMediaType(value, fallback = 'videos') {
  const normalized = String(value || '').trim().toLowerCase()
  if (['photo', 'photos', 'image', 'images', 'still', 'stills'].includes(normalized)) return 'photos'
  if (['video', 'videos', 'footage', 'clip', 'clips'].includes(normalized)) return 'videos'
  return fallback === 'photos' ? 'photos' : 'videos'
}

export function normalizePexelsOrientation(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return ['landscape', 'portrait', 'square'].includes(normalized) ? normalized : ''
}

export function getBestPexelsVideoFile(item) {
  const files = Array.isArray(item?.video_files) ? item.video_files : []
  return files.find((file) => file?.quality === 'hd' && file?.file_type === 'video/mp4')
    || files.find((file) => file?.quality === 'hd')
    || files.find((file) => file?.file_type === 'video/mp4')
    || files[0]
    || null
}

export function getPexelsMediaDownloadSpec(item, mediaType) {
  const normalizedType = normalizePexelsMediaType(mediaType)
  const id = String(item?.id ?? '').trim()
  if (!id) throw new Error('Pexels result is missing an ID.')

  if (normalizedType === 'photos') {
    const url = item?.src?.original || item?.src?.large2x || item?.src?.large || ''
    if (!url) throw new Error(`Pexels photo ${id} has no downloadable image URL.`)
    return {
      id,
      url,
      fileName: `pexels_${id}.jpg`,
      category: 'images',
      assetType: 'image',
      mimeType: 'image/jpeg',
      fps: null,
      duration: null,
    }
  }

  const file = getBestPexelsVideoFile(item)
  if (!file?.link) throw new Error(`Pexels video ${id} has no downloadable video URL.`)
  return {
    id,
    url: file.link,
    fileName: `pexels_${id}.mp4`,
    category: 'video',
    assetType: 'video',
    mimeType: file.file_type || 'video/mp4',
    fps: Number(file.fps) || null,
    duration: Number(item?.duration) || null,
  }
}

export function summarizePexelsMediaItem(item, mediaType) {
  const normalizedType = normalizePexelsMediaType(mediaType)
  const spec = getPexelsMediaDownloadSpec(item, normalizedType)
  const isPhoto = normalizedType === 'photos'
  const photographer = String(item?.photographer || item?.user?.name || '').trim()
  const photographerUrl = String(item?.photographer_url || item?.user?.url || '').trim()
  const pageUrl = String(item?.url || '').trim()
  const thumbnailUrl = isPhoto
    ? String(item?.src?.medium || item?.src?.large || item?.src?.original || '')
    : String(item?.image || item?.video_pictures?.[0]?.picture || '')

  return {
    id: spec.id,
    provider: 'pexels',
    mediaType: isPhoto ? 'photo' : 'video',
    name: String(item?.alt || '').trim() || `Pexels ${isPhoto ? 'photo' : 'video'} ${spec.id}`,
    width: Number(item?.width) || null,
    height: Number(item?.height) || null,
    duration: spec.duration,
    fps: spec.fps,
    photographer,
    photographerUrl,
    pageUrl,
    thumbnailUrl,
  }
}

function buildPexelsUrl(baseUrl, params = {}) {
  const url = new URL(baseUrl)
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || typeof value === 'undefined' || value === '') return
    url.searchParams.set(key, String(value))
  })
  return url.toString()
}

async function parsePexelsResponse(response) {
  if (response.ok) return response.json()
  if (response.status === 401) throw new Error('Invalid Pexels API key.')
  let detail = ''
  try {
    detail = String(await response.text()).trim()
  } catch {
    // Best effort only; the status still gives a useful error.
  }
  throw new Error(detail || `Pexels request failed with status ${response.status}.`)
}

export async function searchPexelsMedia({
  apiKey,
  query,
  mediaType = 'videos',
  page = 1,
  perPage = PEXELS_DEFAULT_PER_PAGE,
  orientation = '',
  fetchImpl = globalThis.fetch,
} = {}) {
  const key = String(apiKey || '').trim()
  if (!key) throw new Error('Add your Pexels API key in Velorn Settings before searching stock media.')
  const normalizedQuery = normalizePexelsQuery(query)
  if (!normalizedQuery) throw new Error('Provide a Pexels search query.')
  if (typeof fetchImpl !== 'function') throw new Error('Network requests are not available in this Velorn session.')

  const normalizedType = normalizePexelsMediaType(mediaType)
  const normalizedPage = clampInteger(page, 1, 1, 10_000)
  const normalizedPerPage = clampInteger(perPage, PEXELS_DEFAULT_PER_PAGE, 1, PEXELS_MAX_PER_PAGE)
  const normalizedOrientation = normalizePexelsOrientation(orientation)
  const baseUrl = normalizedType === 'photos' ? PEXELS_PHOTOS_SEARCH_URL : PEXELS_VIDEOS_SEARCH_URL
  const url = buildPexelsUrl(baseUrl, {
    query: normalizedQuery,
    per_page: normalizedPerPage,
    page: normalizedPage,
    orientation: normalizedOrientation,
  })
  const response = await fetchImpl(url, { headers: { Authorization: key } })
  const data = await parsePexelsResponse(response)
  const items = normalizedType === 'photos'
    ? (Array.isArray(data?.photos) ? data.photos : [])
    : (Array.isArray(data?.videos) ? data.videos : [])

  return {
    provider: 'pexels',
    query: normalizedQuery,
    mediaType: normalizedType,
    orientation: normalizedOrientation || null,
    page: clampInteger(data?.page, normalizedPage, 1, 10_000),
    perPage: normalizedPerPage,
    totalResults: Math.max(0, Number(data?.total_results) || 0),
    items,
    results: items.map((item) => summarizePexelsMediaItem(item, normalizedType)),
  }
}

export async function loadDefaultPexelsMedia({
  apiKey,
  mediaType = 'videos',
  page = 1,
  perPage = PEXELS_DEFAULT_PER_PAGE,
  fetchImpl = globalThis.fetch,
} = {}) {
  const key = String(apiKey || '').trim()
  if (!key) throw new Error('Add your Pexels API key in Velorn Settings before browsing stock media.')
  if (typeof fetchImpl !== 'function') throw new Error('Network requests are not available in this Velorn session.')

  const normalizedType = normalizePexelsMediaType(mediaType)
  const normalizedPage = clampInteger(page, 1, 1, 10_000)
  const normalizedPerPage = clampInteger(perPage, PEXELS_DEFAULT_PER_PAGE, 1, PEXELS_MAX_PER_PAGE)
  const baseUrl = normalizedType === 'photos' ? PEXELS_CURATED_PHOTOS_URL : PEXELS_POPULAR_VIDEOS_URL
  const url = buildPexelsUrl(baseUrl, { per_page: normalizedPerPage, page: normalizedPage })
  const response = await fetchImpl(url, { headers: { Authorization: key } })
  const data = await parsePexelsResponse(response)
  const items = normalizedType === 'photos'
    ? (Array.isArray(data?.photos) ? data.photos : [])
    : (Array.isArray(data?.videos) ? data.videos : [])

  return {
    provider: 'pexels',
    query: '',
    mediaType: normalizedType,
    orientation: null,
    page: clampInteger(data?.page, normalizedPage, 1, 10_000),
    perPage: normalizedPerPage,
    totalResults: Math.max(0, Number(data?.total_results) || 0),
    items,
    results: items.map((item) => summarizePexelsMediaItem(item, normalizedType)),
  }
}

export async function downloadPexelsMediaItem({
  item,
  mediaType,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Network requests are not available in this Velorn session.')
  const spec = getPexelsMediaDownloadSpec(item, mediaType)
  const response = await fetchImpl(spec.url)
  if (!response.ok) throw new Error(`Failed to download Pexels ${spec.assetType} ${spec.id} (${response.status}).`)
  const blob = await response.blob()
  const resolvedMimeType = blob.type || spec.mimeType
  const extension = resolvedMimeType === 'image/png' ? 'png' : (spec.assetType === 'image' ? 'jpg' : 'mp4')
  const fileName = `pexels_${spec.id}.${extension}`
  const file = new File([blob], fileName, { type: resolvedMimeType })
  return { blob, file, spec: { ...spec, fileName, mimeType: resolvedMimeType } }
}

export function buildPexelsStockSource(item, mediaType, query = '') {
  const summary = summarizePexelsMediaItem(item, mediaType)
  return {
    provider: 'pexels',
    id: summary.id,
    mediaType: summary.mediaType,
    query: normalizePexelsQuery(query),
    pageUrl: summary.pageUrl,
    photographer: summary.photographer,
    photographerUrl: summary.photographerUrl,
    alt: String(item?.alt || '').trim(),
  }
}

export function buildPexelsAssetRecord({
  item,
  mediaType,
  query = '',
  imported = {},
  blobUrl = null,
  folderId = null,
  sourceTool = 'stock_panel',
} = {}) {
  const normalizedType = normalizePexelsMediaType(mediaType)
  const spec = getPexelsMediaDownloadSpec(item, normalizedType)
  const stockSource = buildPexelsStockSource(item, normalizedType, query)
  return {
    ...imported,
    name: imported?.name || `Pexels_${spec.id}`,
    type: spec.assetType,
    url: blobUrl || imported?.url || null,
    folderId: folderId || null,
    isImported: true,
    sourceTool,
    stockSource,
    settings: {
      ...(imported?.settings || {}),
      ...(spec.duration ? { duration: spec.duration } : {}),
      ...(spec.fps ? { fps: spec.fps } : {}),
      stockSource,
    },
  }
}

export function getExistingPexelsIds(assets = []) {
  const ids = new Set()
  for (const asset of assets || []) {
    const source = asset?.stockSource || asset?.settings?.stockSource
    if (String(source?.provider || '').toLowerCase() === 'pexels' && source?.id !== null && typeof source?.id !== 'undefined') {
      ids.add(String(source.id))
      continue
    }
    const match = /(?:^|[\\/_-])pexels[_ -]?(\d+)(?:\.|$|[_ -])/i.exec(String(asset?.name || asset?.relativePath || asset?.absolutePath || ''))
    if (match) ids.add(match[1])
  }
  return ids
}

export function selectPexelsImportItems({
  items = [],
  resultIds = [],
  count = 10,
  existingIds = new Set(),
  skipExisting = true,
} = {}) {
  const cappedCount = clampInteger(count, 10, 1, PEXELS_MAX_MCP_IMPORT_ITEMS)
  const byId = new Map((items || []).map((item) => [String(item?.id ?? ''), item]))
  const requestedIds = Array.isArray(resultIds)
    ? [...new Set(resultIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
    : []
  const missingIds = requestedIds.filter((id) => !byId.has(id))
  const ordered = requestedIds.length > 0
    ? requestedIds.map((id) => byId.get(id)).filter(Boolean)
    : [...(items || [])]
  const duplicateItems = ordered.filter((item) => existingIds.has(String(item?.id ?? '')))
  const candidates = ordered
    .filter((item) => !skipExisting || !existingIds.has(String(item?.id ?? '')))
    .slice(0, cappedCount)

  return {
    candidates,
    duplicateItems,
    missingIds,
    requestedIds,
    count: cappedCount,
  }
}

export function buildDefaultPexelsFolderPath(query) {
  const normalizedQuery = normalizePexelsQuery(query)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  const leaf = normalizedQuery
    ? normalizedQuery.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    : 'Imported Stock'
  return ['Stock', 'Pexels', leaf]
}

export function readPexelsStockPanelState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(PEXELS_STOCK_PANEL_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writePexelsStockPanelState(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(PEXELS_STOCK_PANEL_STORAGE_KEY, JSON.stringify(state || {}))
    return true
  } catch {
    return false
  }
}
