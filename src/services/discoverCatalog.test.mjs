import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  DEFAULT_BUNDLED_DISCOVER_CATALOG,
  DEFAULT_DISCOVER_CATALOG_URL,
  DISCOVER_CATALOG_CACHE_KEY,
  extractYouTubeVideoId,
  getBundledDiscoverCatalogUrl,
  getYouTubeEmbedUrl,
  getYouTubeThumbnailUrl,
  getYouTubeWatchUrl,
  isTrustedDiscoverCatalogUrl,
  loadDiscoverCatalog,
  parseDiscoverCatalog,
  readDiscoverCatalogCache,
  writeDiscoverCatalogCache,
} from './discoverCatalog.mjs'

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  }
}

function response(json, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => json }
}

test('the public starter catalog matches the embedded, validated fallback', () => {
  const publicCatalog = JSON.parse(readFileSync(
    new URL('../../public/discover/catalog.json', import.meta.url),
    'utf8',
  ))

  assert.deepEqual(parseDiscoverCatalog(publicCatalog), parseDiscoverCatalog(DEFAULT_BUNDLED_DISCOVER_CATALOG))
  assert.equal(publicCatalog.items.length, 6)
})

test('catalog parsing keeps only constrained metadata and rejects unsafe entries', () => {
  const catalog = parseDiscoverCatalog({
    schemaVersion: 1,
    items: [{
      id: 'safe-video',
      youtubeId: 'RVuGlRZheps',
      title: '  Safe   title  ',
      kind: 'tutorial',
      url: 'https://attacker.example/embed',
      embedHtml: '<iframe src="https://attacker.example"></iframe>',
    }],
  })

  assert.equal(catalog.items[0].title, 'Safe title')
  assert.equal('url' in catalog.items[0], false)
  assert.equal('embedHtml' in catalog.items[0], false)

  assert.throws(() => parseDiscoverCatalog({
    schemaVersion: 1,
    items: [{
      id: 'unsafe-video',
      youtubeId: 'RVuGlRZheps',
      title: '<img src=x onerror=alert(1)>',
      kind: 'tutorial',
    }],
  }), /unsupported markup/)
  assert.throws(() => parseDiscoverCatalog({
    schemaVersion: 1,
    items: [{ id: 'bad-id', youtubeId: 'too-short', title: 'Bad', kind: 'showcase' }],
  }), /invalid YouTube ID/)
})

test('extracts only supported canonical YouTube URL shapes or raw IDs', () => {
  const id = 'RVuGlRZheps'
  assert.equal(extractYouTubeVideoId(id), id)
  assert.equal(extractYouTubeVideoId(`https://www.youtube.com/watch?v=${id}&feature=share`), id)
  assert.equal(extractYouTubeVideoId(`https://youtu.be/${id}?si=test`), id)
  assert.equal(extractYouTubeVideoId(`https://youtube.com/shorts/${id}`), id)
  assert.equal(extractYouTubeVideoId(`https://www.youtube.com/embed/${id}`), id)
  assert.equal(extractYouTubeVideoId(`https://evil.example/watch?v=${id}`), null)
  assert.equal(extractYouTubeVideoId(`https://www.youtube.com.evil.example/watch?v=${id}`), null)
  assert.equal(extractYouTubeVideoId(`javascript:${id}`), null)
  assert.equal(extractYouTubeVideoId(`https://www.youtube.com/channel/${id}`), null)
})

test('builds all playback URLs from a validated ID rather than caller-provided URLs', () => {
  const id = 'RVuGlRZheps'
  assert.equal(getYouTubeWatchUrl(id), `https://www.youtube.com/watch?v=${id}`)
  assert.equal(getYouTubeEmbedUrl(id), `https://www.youtube-nocookie.com/embed/${id}?rel=0`)
  assert.equal(getYouTubeThumbnailUrl(id), `https://i.ytimg.com/vi/${id}/hqdefault.jpg`)
  assert.throws(() => getYouTubeEmbedUrl('https://attacker.example'), /valid 11-character/)
})

test('allows only the fixed Velorn catalog endpoint and resolves a relative bundled asset', () => {
  assert.equal(isTrustedDiscoverCatalogUrl(DEFAULT_DISCOVER_CATALOG_URL), true)
  assert.equal(
    isTrustedDiscoverCatalogUrl('https://raw.githubusercontent.com/VelornLabs/velorn/main/public/discover/catalog.json'),
    true,
  )
  assert.equal(
    isTrustedDiscoverCatalogUrl('https://raw.githubusercontent.com/VelornLabs/other/main/public/discover/catalog.json'),
    false,
  )
  assert.equal(isTrustedDiscoverCatalogUrl('https://velorn.ai/discover/catalog.json'), true)
  assert.equal(isTrustedDiscoverCatalogUrl('https://www.velorn.ai/discover/catalog.json'), true)
  assert.equal(isTrustedDiscoverCatalogUrl('https://velorn.ai/discover/catalog.json?redirect=evil'), false)
  assert.equal(isTrustedDiscoverCatalogUrl('https://cdn.example/discover/catalog.json'), false)
  assert.equal(getBundledDiscoverCatalogUrl('./'), './discover/catalog.json')
  assert.equal(getBundledDiscoverCatalogUrl('/app/'), '/app/discover/catalog.json')
  assert.equal(getBundledDiscoverCatalogUrl('https://attacker.example/'), './discover/catalog.json')
})

test('loads a validated remote catalog first and caches it', async () => {
  const storage = makeStorage()
  const requested = []
  const result = await loadDiscoverCatalog({
    storage,
    now: 1000,
    fetchImpl: async (url, options) => {
      requested.push({ url, options })
      return response(DEFAULT_BUNDLED_DISCOVER_CATALOG)
    },
  })

  assert.equal(result.source, 'remote')
  assert.deepEqual(requested.map(({ url }) => url), [DEFAULT_DISCOVER_CATALOG_URL])
  assert.equal(requested[0].options.credentials, 'omit')
  assert.equal(requested[0].options.referrerPolicy, 'no-referrer')
  assert.equal(requested[0].options.redirect, 'error')
  assert.ok(storage.values.has(DISCOVER_CATALOG_CACHE_KEY))
  assert.equal(readDiscoverCatalogCache({ storage, now: 1000 })?.items.length, 6)
})

test('falls back from a failed remote request to a valid cache', async () => {
  const storage = makeStorage()
  assert.equal(writeDiscoverCatalogCache(DEFAULT_BUNDLED_DISCOVER_CATALOG, { storage, now: 1000 }), true)

  const result = await loadDiscoverCatalog({
    storage,
    now: 2000,
    fetchImpl: async () => response({}, { ok: false, status: 503 }),
  })

  assert.equal(result.source, 'cache')
  assert.equal(result.catalog.items[0].youtubeId, 'RVuGlRZheps')
  assert.match(result.warning.message, /status 503/)
})

test('falls back to the bundled catalog when remote and cache data are invalid', async () => {
  const storage = makeStorage({
    [DISCOVER_CATALOG_CACHE_KEY]: JSON.stringify({ cachedAt: 1000, catalog: { schemaVersion: 99, items: [] } }),
  })
  const requested = []
  const result = await loadDiscoverCatalog({
    storage,
    now: 2000,
    bundledUrl: './discover/catalog.json',
    fetchImpl: async (url) => {
      requested.push(url)
      if (url === DEFAULT_DISCOVER_CATALOG_URL) return response({}, { ok: false, status: 503 })
      return response(DEFAULT_BUNDLED_DISCOVER_CATALOG)
    },
  })

  assert.equal(result.source, 'bundled')
  assert.deepEqual(requested, [DEFAULT_DISCOVER_CATALOG_URL, './discover/catalog.json'])
  assert.equal(result.catalog.items.length, 6)
})

test('uses the embedded bundled catalog if asset fetching is unavailable', async () => {
  const result = await loadDiscoverCatalog({ fetchImpl: null, storage: makeStorage(), remoteUrl: '' })
  assert.equal(result.source, 'bundled')
  assert.equal(result.catalog.items.length, 6)
})

test('an untrusted remote URL is never requested', async () => {
  const requested = []
  const result = await loadDiscoverCatalog({
    remoteUrl: 'https://attacker.example/catalog.json',
    storage: makeStorage(),
    fetchImpl: async (url) => {
      requested.push(url)
      return response(DEFAULT_BUNDLED_DISCOVER_CATALOG)
    },
  })

  assert.equal(result.source, 'bundled')
  assert.deepEqual(requested, ['./discover/catalog.json'])
  assert.match(result.warning.message, /not trusted/)
})

test('bounds a stalled remote request before falling back to the bundled catalog', async () => {
  const requested = []
  const result = await loadDiscoverCatalog({
    storage: makeStorage(),
    remoteTimeoutMs: 5,
    bundledUrl: './discover/catalog.json',
    fetchImpl: async (url, options) => {
      requested.push(url)
      if (url === DEFAULT_DISCOVER_CATALOG_URL) {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
        })
      }
      return response(DEFAULT_BUNDLED_DISCOVER_CATALOG)
    },
  })

  assert.equal(result.source, 'bundled')
  assert.deepEqual(requested, [DEFAULT_DISCOVER_CATALOG_URL, './discover/catalog.json'])
  assert.equal(result.catalog.items.length, 6)
  assert.ok(result.warning)
})
