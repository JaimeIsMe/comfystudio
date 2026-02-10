import { useState, useEffect, useCallback } from 'react'
import { Search, Video, Image as ImageIcon, Download, Loader2, ExternalLink, AlertCircle, Play, X } from 'lucide-react'
import useProjectStore from '../stores/projectStore'
import useAssetsStore from '../stores/assetsStore'
import { importAsset, isElectron } from '../services/fileSystem'
import { enqueuePlaybackTranscode } from '../services/playbackCache'
import { getPexelsApiKey } from '../services/pexelsSettings'

const PEXELS_PHOTOS_URL = 'https://api.pexels.com/v1/search'
const PEXELS_VIDEOS_URL = 'https://api.pexels.com/videos/search'
const PEXELS_CURATED_PHOTOS_URL = 'https://api.pexels.com/v1/curated'
const PEXELS_POPULAR_VIDEOS_URL = 'https://api.pexels.com/videos/popular'
const PER_PAGE = 20

/** Pick best video file for playback or download (prefer HD mp4). */
function getBestVideoUrl(item) {
  const files = item?.video_files || []
  const best = files.find(f => f.quality === 'hd' && f.file_type === 'video/mp4')
    || files.find(f => f.quality === 'hd')
    || files.find(f => f.file_type === 'video/mp4')
    || files[0]
  return best?.link || null
}

function StockPanel() {
  const [apiKey, setApiKey] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [mediaType, setMediaType] = useState('videos') // 'videos' | 'photos'
  const [results, setResults] = useState([])
  const [page, setPage] = useState(1)
  const [totalResults, setTotalResults] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [addingId, setAddingId] = useState(null) // id of item being added
  const [isDefaultContent, setIsDefaultContent] = useState(true) // trending/popular when no search
  const [previewVideo, setPreviewVideo] = useState(null) // video item for preview modal

  const { currentProjectHandle } = useProjectStore()
  const { addAsset } = useAssetsStore()

  // Load API key on mount
  useEffect(() => {
    getPexelsApiKey().then(key => setApiKey(key?.trim() || null))
  }, [])

  // Fetch trending/popular content when no search query (first visit or cleared search)
  const loadDefaultContent = useCallback(async (pageNum = 1) => {
    if (!apiKey) return
    setError(null)
    setLoading(true)
    try {
      const url = mediaType === 'videos'
        ? `${PEXELS_POPULAR_VIDEOS_URL}?per_page=${PER_PAGE}&page=${pageNum}`
        : `${PEXELS_CURATED_PHOTOS_URL}?per_page=${PER_PAGE}&page=${pageNum}`
      const res = await fetch(url, { headers: { Authorization: apiKey } })
      if (!res.ok) {
        if (res.status === 401) throw new Error('Invalid Pexels API key.')
        throw new Error(`Request failed: ${res.status}`)
      }
      const data = await res.json()
      if (mediaType === 'videos') {
        setResults(data.videos || [])
        setTotalResults(data.total_results || 0)
      } else {
        setResults(data.photos || [])
        setTotalResults(data.total_results || 0)
      }
      setPage(pageNum)
      setIsDefaultContent(true)
    } catch (err) {
      setError(err.message || 'Failed to load content')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [apiKey, mediaType])

  // When API key is ready and there's no search query, show trending/popular
  useEffect(() => {
    if (!apiKey || searchQuery.trim()) return
    loadDefaultContent(1)
  }, [apiKey, mediaType, searchQuery, loadDefaultContent])

  const search = useCallback(async (pageNum = 1) => {
    if (!apiKey) {
      setError('Add your Pexels API key in Settings (left panel → Settings).')
      return
    }
    const query = searchQuery.trim()
    if (!query) {
      setError('Enter a search term.')
      return
    }
    setError(null)
    setIsDefaultContent(false)
    setLoading(true)
    try {
      const url = mediaType === 'videos'
        ? `${PEXELS_VIDEOS_URL}?query=${encodeURIComponent(query)}&per_page=${PER_PAGE}&page=${pageNum}`
        : `${PEXELS_PHOTOS_URL}?query=${encodeURIComponent(query)}&per_page=${PER_PAGE}&page=${pageNum}`
      const res = await fetch(url, {
        headers: { Authorization: apiKey },
      })
      if (!res.ok) {
        const errText = await res.text()
        if (res.status === 401) throw new Error('Invalid Pexels API key.')
        throw new Error(errText || `Request failed: ${res.status}`)
      }
      const data = await res.json()
      if (mediaType === 'videos') {
        setResults(data.videos || [])
        setTotalResults(data.total_results || 0)
      } else {
        setResults(data.photos || [])
        setTotalResults(data.total_results || 0)
      }
      setPage(pageNum)
    } catch (err) {
      setError(err.message || 'Search failed')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [apiKey, searchQuery, mediaType])

  const handleAddToProject = async (item) => {
    if (!currentProjectHandle) {
      setError('Open or create a project first.')
      return
    }
    setAddingId(item.id)
    setError(null)
    try {
      if (mediaType === 'photos') {
        const url = item.src?.original || item.src?.large
        if (!url) throw new Error('No image URL')
        const res = await fetch(url)
        if (!res.ok) throw new Error('Failed to download image')
        const blob = await res.blob()
        const ext = blob.type === 'image/png' ? 'png' : 'jpg'
        const file = new File([blob], `pexels_${item.id}.${ext}`, { type: blob.type })
        const assetInfo = await importAsset(currentProjectHandle, file, 'images')
        const blobUrl = URL.createObjectURL(blob)
        addAsset({
          ...assetInfo,
          name: assetInfo.name || `Pexels_${item.id}`,
          type: 'image',
          url: blobUrl,
          folderId: null,
          isImported: true,
        })
      } else {
        // Pick best video file (prefer hd, then first mp4)
        const videoUrl = getBestVideoUrl(item)
        if (!videoUrl) throw new Error('No video download URL')
        const res = await fetch(videoUrl)
        if (!res.ok) throw new Error('Failed to download video')
        const blob = await res.blob()
        const file = new File([blob], `pexels_${item.id}.mp4`, { type: 'video/mp4' })
        const assetInfo = await importAsset(currentProjectHandle, file, 'video')
        const blobUrl = URL.createObjectURL(blob)
        const best = item.video_files?.find(f => f.quality === 'hd' && f.file_type === 'video/mp4')
          || item.video_files?.find(f => f.quality === 'hd')
          || item.video_files?.[0]
        const newAsset = addAsset({
          ...assetInfo,
          name: assetInfo.name || `Pexels_${item.id}`,
          type: 'video',
          url: blobUrl,
          folderId: null,
          isImported: true,
          settings: { duration: item.duration, fps: best?.fps },
        })
        if (isElectron() && currentProjectHandle && newAsset?.absolutePath) {
          enqueuePlaybackTranscode(currentProjectHandle, newAsset.id, newAsset.absolutePath).catch(() => {})
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to add to project')
    } finally {
      setAddingId(null)
    }
  }

  const totalPages = Math.ceil(totalResults / PER_PAGE)
  const loadPage = (pageNum) => isDefaultContent ? loadDefaultContent(pageNum) : search(pageNum)

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-sf-dark-950">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-sf-dark-700">
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-lg font-semibold text-sf-text-primary">Stock</h1>
          <a
            href="https://www.pexels.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-sf-text-muted hover:text-sf-accent flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" />
            Photos & videos from Pexels (free to use)
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sf-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search(1)}
              placeholder="Search stock footage..."
              className="w-full pl-8 pr-3 py-2 bg-sf-dark-800 border border-sf-dark-600 rounded-lg text-sm text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
            />
          </div>
          <div className="flex rounded-lg overflow-hidden border border-sf-dark-600">
            <button
              onClick={() => setMediaType('videos')}
              className={`px-3 py-2 text-xs flex items-center gap-1.5 transition-colors ${mediaType === 'videos' ? 'bg-sf-accent text-white' : 'bg-sf-dark-800 text-sf-text-muted hover:bg-sf-dark-700'}`}
            >
              <Video className="w-3.5 h-3.5" />
              Videos
            </button>
            <button
              onClick={() => setMediaType('photos')}
              className={`px-3 py-2 text-xs flex items-center gap-1.5 transition-colors ${mediaType === 'photos' ? 'bg-sf-accent text-white' : 'bg-sf-dark-800 text-sf-text-muted hover:bg-sf-dark-700'}`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              Photos
            </button>
          </div>
          <button
            onClick={() => search(1)}
            disabled={loading || !searchQuery.trim()}
            className="px-4 py-2 bg-sf-accent hover:bg-sf-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Search
          </button>
        </div>
      </div>

      {/* No API key */}
      {!apiKey && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <AlertCircle className="w-12 h-12 text-sf-accent mx-auto mb-3" />
            <p className="text-sm text-sf-text-primary mb-2">Pexels API key required</p>
            <p className="text-xs text-sf-text-muted mb-4">
              Get a free API key at{' '}
              <a href="https://www.pexels.com/api/" target="_blank" rel="noopener noreferrer" className="text-sf-accent hover:underline">
                pexels.com/api
              </a>
              , then add it in <strong>Settings</strong> (left panel → Settings).
            </p>
            <button
              onClick={() => getPexelsApiKey().then(key => setApiKey(key?.trim() || null))}
              className="px-3 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-xs text-sf-text-primary"
            >
              I've added my key — refresh
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {apiKey && error && (
        <div className="flex-shrink-0 px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-sm text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Results grid */}
      {apiKey && (
        <div className="flex-1 overflow-auto p-4">
          {loading && results.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-sf-accent animate-spin" />
            </div>
          ) : results.length === 0 && !error ? (
            <div className="text-center py-20 text-sf-text-muted text-sm">
              {searchQuery.trim() ? 'No results. Try a different search.' : 'Enter a search term and click Search.'}
            </div>
          ) : (
            <>
              {isDefaultContent && (
                <p className="text-xs text-sf-text-muted mb-3">
                  {mediaType === 'videos' ? 'Popular videos' : 'Trending photos'} on Pexels — or search above for something specific.
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {results.map((item) => {
                  const thumb = mediaType === 'videos' ? (item.image || item.video_pictures?.[0]?.picture) : (item.src?.medium || item.src?.large)
                  const isAdding = addingId === item.id
                  const isVideo = mediaType === 'videos'
                  return (
                    <div
                      key={item.id}
                      className="bg-sf-dark-800 border border-sf-dark-600 rounded-lg overflow-hidden group"
                    >
                      <div
                        className={`aspect-video bg-sf-dark-700 relative ${isVideo ? 'cursor-pointer' : ''}`}
                        onClick={isVideo ? () => setPreviewVideo(item) : undefined}
                        role={isVideo ? 'button' : undefined}
                        aria-label={isVideo ? 'Preview video' : undefined}
                      >
                        {thumb && (
                          <img
                            src={thumb}
                            alt={item.alt || item.user?.name || ''}
                            className="w-full h-full object-cover"
                          />
                        )}
                        {isVideo && item.duration && (
                          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 rounded text-[10px] text-white">
                            {item.duration}s
                          </span>
                        )}
                        {isVideo && (
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); setPreviewVideo(item) }}
                              className="p-2 bg-white/90 hover:bg-white rounded-full text-sf-dark-900 shadow-lg"
                              title="Preview"
                              aria-label="Preview video"
                            >
                              <Play className="w-5 h-5 fill-current" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAddToProject(item) }}
                              disabled={!currentProjectHandle || isAdding}
                              className="px-3 py-1.5 bg-sf-accent hover:bg-sf-accent-hover disabled:opacity-50 text-white text-xs font-medium rounded flex items-center gap-1.5"
                            >
                              {isAdding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                              Add to project
                            </button>
                          </div>
                        )}
                        {!isVideo && (
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button
                              onClick={() => handleAddToProject(item)}
                              disabled={!currentProjectHandle || isAdding}
                              className="px-3 py-1.5 bg-sf-accent hover:bg-sf-accent-hover disabled:opacity-50 text-white text-xs font-medium rounded flex items-center gap-1.5"
                            >
                              {isAdding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                              Add to project
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-[10px] text-sf-text-muted truncate" title={item.alt || item.user?.name}>
                          {item.alt || item.user?.name || `Pexels ${item.id}`}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <button
                    onClick={() => loadPage(page - 1)}
                    disabled={page <= 1 || loading}
                    className="px-3 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 disabled:opacity-50 rounded text-xs text-sf-text-primary"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-sf-text-muted">
                    Page {page} of {totalPages} ({totalResults} results)
                  </span>
                  <button
                    onClick={() => loadPage(page + 1)}
                    disabled={page >= totalPages || loading}
                    className="px-3 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 disabled:opacity-50 rounded text-xs text-sf-text-primary"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Video preview modal */}
      {previewVideo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewVideo(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Video preview"
        >
          <div
            className="relative bg-sf-dark-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewVideo(null)}
              className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
              aria-label="Close preview"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex-1 min-h-0 flex items-center justify-center p-4">
              <video
                src={getBestVideoUrl(previewVideo)}
                controls
                className="max-w-full max-h-[70vh] w-full rounded"
                preload="metadata"
                onEnded={(e) => e.target.pause()}
              />
            </div>
            <div className="flex items-center justify-between gap-4 p-4 border-t border-sf-dark-600">
              <p className="text-sm text-sf-text-muted truncate flex-1">
                {previewVideo.user?.name || `Video ${previewVideo.id}`}
                {previewVideo.duration != null && ` · ${previewVideo.duration}s`}
              </p>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setPreviewVideo(null)}
                  className="px-3 py-1.5 bg-sf-dark-600 hover:bg-sf-dark-500 rounded text-sm text-sf-text-primary"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    handleAddToProject(previewVideo)
                    setPreviewVideo(null)
                  }}
                  disabled={!currentProjectHandle || addingId === previewVideo.id}
                  className="px-4 py-1.5 bg-sf-accent hover:bg-sf-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded flex items-center gap-1.5"
                >
                  {addingId === previewVideo.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Add to project
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer attribution */}
      <div className="flex-shrink-0 px-4 py-2 border-t border-sf-dark-700 text-[10px] text-sf-text-muted">
        <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer" className="text-sf-accent hover:underline">
          Photos and videos provided by Pexels
        </a>
        {' · Free to use, no attribution required.'}
      </div>
    </div>
  )
}

export default StockPanel
