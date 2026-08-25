import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildDefaultPexelsFolderPath,
  buildPexelsAssetRecord,
  downloadPexelsMediaItem,
  getPexelsMediaDownloadSpec,
  getExistingPexelsIds,
  normalizePexelsMediaType,
  searchPexelsMedia,
  selectPexelsImportItems,
} from './pexelsStock.js'

const PHOTO = {
  id: 101,
  width: 6000,
  height: 4000,
  url: 'https://www.pexels.com/photo/ocean-101/',
  photographer: 'Ocean Artist',
  photographer_url: 'https://www.pexels.com/@ocean-artist',
  alt: 'Aerial ocean shoreline',
  src: {
    original: 'https://images.pexels.com/photos/101/original.jpg',
    medium: 'https://images.pexels.com/photos/101/medium.jpg',
  },
}

const VIDEO = {
  id: 202,
  width: 1920,
  height: 1080,
  duration: 12,
  url: 'https://www.pexels.com/video/ocean-202/',
  user: { name: 'Drone Artist', url: 'https://www.pexels.com/@drone-artist' },
  image: 'https://images.pexels.com/videos/202/poster.jpg',
  video_files: [
    { quality: 'sd', file_type: 'video/mp4', link: 'https://videos.pexels.com/202-sd.mp4', fps: 24 },
    { quality: 'hd', file_type: 'video/mp4', link: 'https://videos.pexels.com/202-hd.mp4', fps: 30 },
  ],
}

test('normalizes common stock-media type aliases', () => {
  assert.equal(normalizePexelsMediaType('images'), 'photos')
  assert.equal(normalizePexelsMediaType('footage'), 'videos')
  assert.equal(normalizePexelsMediaType('', 'photos'), 'photos')
})

test('searches Pexels photos with bounded request fields and normalized results', async () => {
  let requestedUrl = ''
  let requestedOptions = null
  const result = await searchPexelsMedia({
    apiKey: 'secret-key',
    query: '  ocean   drone shots ',
    mediaType: 'images',
    page: 2,
    perPage: 500,
    orientation: 'landscape',
    fetchImpl: async (url, options) => {
      requestedUrl = url
      requestedOptions = options
      return {
        ok: true,
        status: 200,
        json: async () => ({ page: 2, total_results: 900, photos: [PHOTO] }),
      }
    },
  })

  const url = new URL(requestedUrl)
  assert.equal(url.pathname, '/v1/search')
  assert.equal(url.searchParams.get('query'), 'ocean drone shots')
  assert.equal(url.searchParams.get('per_page'), '80')
  assert.equal(url.searchParams.get('page'), '2')
  assert.equal(url.searchParams.get('orientation'), 'landscape')
  assert.equal(requestedOptions.headers.Authorization, 'secret-key')
  assert.equal(result.mediaType, 'photos')
  assert.equal(result.results[0].id, '101')
  assert.equal(result.results[0].photographer, 'Ocean Artist')
  assert.equal(result.results[0].thumbnailUrl, PHOTO.src.medium)
})

test('prefers an HD MP4 for Pexels video downloads without exposing it in search results', async () => {
  const result = await searchPexelsMedia({
    apiKey: 'secret-key',
    query: 'waves',
    mediaType: 'videos',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ page: 1, total_results: 1, videos: [VIDEO] }),
    }),
  })

  assert.equal(getPexelsMediaDownloadSpec(VIDEO, 'videos').url, 'https://videos.pexels.com/202-hd.mp4')
  assert.equal('downloadUrl' in result.results[0], false)
  assert.equal(result.results[0].fps, 30)
  assert.equal(result.results[0].duration, 12)
})

test('downloads the selected Pexels video as an importable project file', async () => {
  const downloaded = await downloadPexelsMediaItem({
    item: VIDEO,
    mediaType: 'videos',
    fetchImpl: async (url) => {
      assert.equal(url, 'https://videos.pexels.com/202-hd.mp4')
      return {
        ok: true,
        status: 200,
        blob: async () => new Blob(['video-bytes'], { type: 'video/mp4' }),
      }
    },
  })

  assert.equal(downloaded.file.name, 'pexels_202.mp4')
  assert.equal(downloaded.file.type, 'video/mp4')
  assert.equal(downloaded.spec.category, 'video')
  assert.equal(downloaded.spec.duration, 12)
  assert.equal(downloaded.spec.fps, 30)
})

test('reports invalid Pexels credentials without exposing the key', async () => {
  await assert.rejects(
    searchPexelsMedia({
      apiKey: 'do-not-echo',
      query: 'ocean',
      fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }),
    }),
    /Invalid Pexels API key/,
  )
})

test('selects requested IDs in order and skips existing Pexels assets', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }]
  const selection = selectPexelsImportItems({
    items,
    resultIds: ['3', '2', '1'],
    count: 3,
    existingIds: new Set(['2']),
    skipExisting: true,
  })
  assert.deepEqual(selection.candidates.map((item) => item.id), [3, 1])
  assert.deepEqual(selection.duplicateItems.map((item) => item.id), [2])
  assert.deepEqual(selection.missingIds, [])
})

test('recognizes both explicit provenance and legacy Pexels filenames', () => {
  const ids = getExistingPexelsIds([
    { stockSource: { provider: 'pexels', id: '101' } },
    { name: 'pexels_202.mp4' },
    { name: 'unrelated.jpg' },
  ])
  assert.deepEqual([...ids].sort(), ['101', '202'])
})

test('builds a portable query folder and persists Pexels provenance on assets', () => {
  assert.deepEqual(buildDefaultPexelsFolderPath('ocean drone shots'), ['Stock', 'Pexels', 'Ocean Drone Shots'])
  const asset = buildPexelsAssetRecord({
    item: PHOTO,
    mediaType: 'photos',
    query: 'ocean drone shots',
    imported: { name: 'pexels_101.jpg', absolutePath: '/project/images/pexels_101.jpg' },
    blobUrl: 'blob:photo',
    folderId: 'folder-1',
    sourceTool: 'import_stock_media',
  })
  assert.equal(asset.type, 'image')
  assert.equal(asset.folderId, 'folder-1')
  assert.equal(asset.sourceTool, 'import_stock_media')
  assert.equal(asset.stockSource.id, '101')
  assert.equal(asset.stockSource.pageUrl, PHOTO.url)
  assert.deepEqual(asset.settings.stockSource, asset.stockSource)
})
