import { useEffect, useRef, useCallback, useState, useMemo, useLayoutEffect, memo } from 'react'
import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'
import useProjectStore from '../stores/projectStore'
import videoCache from '../services/videoCache'
import renderCacheService from '../services/renderCache'
import { getAnimatedTransform } from '../utils/keyframes'
import { loadRenderCache, saveRenderCache } from '../services/fileSystem'
import { getSpriteFramePosition } from '../services/thumbnailSprites'

/**
 * Returns true if this layer fully obscures all layers below it (opaque, normal blend, covers frame).
 * When true, we can skip decoding/rendering all layers underneath for performance.
 */
function isLayerFullyObscuring(clip, playheadPosition) {
  if (!clip) return false
  // Images may contain transparency (PNG overlays like letterbox/vignette),
  // so they cannot be safely treated as fully occluding.
  if (clip.type !== 'video') return false
  const clipTime = playheadPosition - (clip.startTime || 0)
  const t = getAnimatedTransform(clip, clipTime)
  if (!t) return false
  const opacity = Number(t.opacity)
  const blendMode = t.blendMode || 'normal'
  const scaleX = Number(t.scaleX)
  const scaleY = Number(t.scaleY)
  const rotation = Number(t.rotation)
  const cropTop = Number(t.cropTop) || 0
  const cropBottom = Number(t.cropBottom) || 0
  const cropLeft = Number(t.cropLeft) || 0
  const cropRight = Number(t.cropRight) || 0
  if (opacity < 99.5 || blendMode !== 'normal') return false
  if (scaleX < 100 || scaleY < 100) return false
  if (rotation !== 0) return false
  if (cropTop > 0 || cropBottom > 0 || cropLeft > 0 || cropRight > 0) return false
  return true
}

/**
 * Get scaled sprite style that fills the container while showing the correct frame
 * Returns style for an inner div that will be absolutely positioned and scaled
 */
function getScaledSpriteStyle(spriteData, time) {
  if (!spriteData || !spriteData.frames || !spriteData.url) return null
  
  const framePos = getSpriteFramePosition(spriteData, time)
  if (!framePos) return null
  
  // Just return the original sprite style - we'll handle scaling differently
  return {
    spriteUrl: spriteData.url,
    frameX: framePos.x,
    frameY: framePos.y,
    frameWidth: framePos.width,
    frameHeight: framePos.height,
    spriteWidth: spriteData.width,
    spriteHeight: spriteData.height,
  }
}

/**
 * Track which clips are currently being loaded from disk to prevent duplicate loads
 */
const loadingCacheFromDisk = new Set()

/**
 * Cache of loaded blob URLs from disk (clipId -> blobUrl)
 * This persists across re-renders until the blob is explicitly revoked
 */
const diskCacheUrls = new Map()

/**
 * Helper to check if a blob URL is still valid
 * Blob URLs become invalid after page refresh
 */
function isBlobUrlValid(url) {
  if (!url || !url.startsWith('blob:')) return false
  // We can't truly validate a blob URL without fetching it,
  // but we can check if it's in our known-good map
  return diskCacheUrls.has(url) || false
}

/**
 * Hook to load render cache from disk when needed
 * This handles the case where a clip has cachePath but stale/invalid cacheUrl
 */
function useDiskCacheLoader(clip) {
  const currentProjectHandle = useProjectStore(state => state.currentProjectHandle)
  const setCacheUrl = useTimelineStore(state => state.setCacheUrl)
  const [loadedUrl, setLoadedUrl] = useState(null)
  
  useEffect(() => {
    // Only proceed if:
    // 1. We have a clip with a cachePath (saved to disk)
    // 2. The clip is marked as cached but cacheUrl is missing or might be stale
    // 3. We have a project handle to read from disk
    // 4. We're not already loading this clip
    if (!clip || !clip.cachePath || !currentProjectHandle) return
    if (loadingCacheFromDisk.has(clip.id)) return
    
    // Check if we already have a valid loaded URL for this clip
    const existingUrl = diskCacheUrls.get(clip.id)
    if (existingUrl) {
      setLoadedUrl(existingUrl)
      return
    }
    
    // Check if the current cacheUrl looks valid (not a stale blob URL)
    // After page refresh, blob URLs become invalid
    if (clip.cacheUrl && !clip.cacheUrl.startsWith('blob:')) {
      // Non-blob URL, probably fine
      return
    }
    
    // If cacheStatus is 'cached' but we don't have a verified URL, we need to reload
    // This happens after page refresh when blob URLs become invalid
    const needsReload = clip.cachePath && (
      !clip.cacheUrl || 
      (clip.cacheStatus === 'cached' && clip.cacheUrl?.startsWith('blob:') && !diskCacheUrls.has(clip.id))
    )
    
    if (!needsReload) return
    
    // Mark as loading to prevent duplicate loads
    loadingCacheFromDisk.add(clip.id)
    
    // Load from disk
    const loadFromDisk = async () => {
      try {
        console.log(`Loading render cache from disk for clip ${clip.id}: ${clip.cachePath}`)
        const result = await loadRenderCache(currentProjectHandle, clip.cachePath)
        
        if (result && result.url) {
          // Store in our local map for future reference
          diskCacheUrls.set(clip.id, result.url)
          
          // Update the clip's cacheUrl in the store
          setCacheUrl(clip.id, result.url, clip.cachePath)
          setLoadedUrl(result.url)
          
          console.log(`Successfully loaded render cache for clip ${clip.id}`)
        } else {
          console.warn(`Failed to load render cache for clip ${clip.id}: no URL returned`)
        }
      } catch (err) {
        console.error(`Error loading render cache for clip ${clip.id}:`, err)
      } finally {
        loadingCacheFromDisk.delete(clip.id)
      }
    }
    
    loadFromDisk()
  }, [clip?.id, clip?.cachePath, clip?.cacheUrl, clip?.cacheStatus, currentProjectHandle, setCacheUrl])
  
  return loadedUrl
}

/**
 * Hook to get the current valid URL for a clip
 * Falls back to clip.url if asset not found (for backwards compatibility)
 * Returns cached render URL if available and valid
 * Now also handles loading stale cache URLs from disk
 */
function useClipUrl(clip) {
  // Subscribe to this asset's URL so we re-render when playback cache is set (getAssetUrl alone doesn't trigger re-render)
  const assetUrl = useAssetsStore(state => {
    if (!clip?.assetId) return null
    const asset = state.assets.find(a => a.id === clip.assetId)
    if (!asset) return null
    const usePlaybackCache = !!asset.playbackCacheUrl && asset.playbackCacheStatus !== 'failed'
    return usePlaybackCache ? asset.playbackCacheUrl : (asset.url || null)
  })

  // This hook will trigger loading from disk if needed and return the loaded URL
  const diskLoadedUrl = useDiskCacheLoader(clip)

  return useMemo(() => {
    if (!clip) return { url: null, isCached: false }
    // For text clips, there's no URL
    if (clip.type === 'text') return { url: null, isCached: false }

    // Check if we have a valid cached render
    // Priority: diskLoadedUrl (freshly loaded) > clip.cacheUrl (from store)
    if (clip.cacheStatus === 'cached') {
      // Use disk-loaded URL if available (this is guaranteed fresh)
      if (diskLoadedUrl) {
        return { url: diskLoadedUrl, isCached: true }
      }
      // Use clip.cacheUrl if it's in our verified map
      if (clip.cacheUrl && diskCacheUrls.has(clip.id)) {
        return { url: clip.cacheUrl, isCached: true }
      }
      // Use clip.cacheUrl if it exists (might be from current session)
      if (clip.cacheUrl) {
        return { url: clip.cacheUrl, isCached: true }
      }
    }

    // Use URL from assets store (includes playback cache when ready — subscription above ensures we re-render when it's set)
    if (clip.assetId && assetUrl) {
      return { url: assetUrl, isCached: false }
    }
    // Fallback to clip's stored URL (may be stale after refresh)
    return { url: clip.url, isCached: false }
  }, [clip, clip?.assetId, clip?.cacheStatus, clip?.cacheUrl, clip?.id, diskLoadedUrl, assetUrl])
}

/**
 * Hook to get mask effect styles for a clip
 * Returns CSS mask properties if the clip has enabled mask effects
 * Returns empty object if clip is using cached render (mask already baked in)
 */
function useMaskEffectStyle(clip, playheadPosition, isCachedRender = false) {
  const getAssetById = useAssetsStore(state => state.getAssetById)
  
  return useMemo(() => {
    // Skip CSS masks if using cached render (mask is already composited)
    if (isCachedRender) return {}
    
    if (!clip || !clip.effects) return {}
    
    // Find enabled mask effects
    const maskEffects = clip.effects.filter(e => e.type === 'mask' && e.enabled)
    if (maskEffects.length === 0) return {}
    
    // Use the first mask effect (for now, we only support one mask per clip)
    const maskEffect = maskEffects[0]
    const maskAsset = getAssetById(maskEffect.maskAssetId)
    
    if (!maskAsset) return {}
    const sourceAsset = maskAsset.sourceAssetId ? getAssetById(maskAsset.sourceAssetId) : null
    const maskFrameCount = maskAsset.frameCount || maskAsset.maskFrames?.length || 1
    const sourceDuration = clip.sourceDuration
      || sourceAsset?.duration
      || sourceAsset?.settings?.duration
      || maskAsset?.settings?.duration
      || clip.duration
    
    // For video masks (PNG sequences), we need to get the correct frame
    let maskUrl = maskAsset.url
    
    if (maskAsset.maskFrames && maskAsset.maskFrames.length > 1) {
      // Calculate which frame to use based on SOURCE time (trim-aware)
      const clipTime = playheadPosition - clip.startTime
      const rawTimeScale = clip?.sourceTimeScale || (clip?.timelineFps && clip?.sourceFps
        ? clip.timelineFps / clip.sourceFps
        : 1)
      const speed = Number(clip?.speed)
      const speedScale = Number.isFinite(speed) && speed > 0 ? speed : 1
      const timeScale = rawTimeScale * speedScale
      const reverse = !!clip?.reverse
      const trimStart = clip.trimStart || 0
      const rawTrimEnd = clip.trimEnd ?? sourceDuration ?? trimStart
      const trimEnd = Number.isFinite(rawTrimEnd) ? rawTrimEnd : trimStart
      const sourceTime = reverse
        ? trimEnd - clipTime * timeScale
        : trimStart + clipTime * timeScale
      const sourceProgress = sourceDuration > 0
        ? Math.max(0, Math.min(1, sourceTime / sourceDuration))
        : 0
      const frameIndex = Math.min(
        Math.max(0, Math.floor(sourceProgress * maskFrameCount)),
        maskFrameCount - 1
      )
      
      // Get the URL for this specific frame
      if (maskAsset.maskFrames[frameIndex]?.url) {
        maskUrl = maskAsset.maskFrames[frameIndex].url
      }
    }
    
    if (!maskUrl) return {}
    
    // Build CSS mask styles
    const maskStyles = {
      WebkitMaskImage: `url(${maskUrl})`,
      maskImage: `url(${maskUrl})`,
      WebkitMaskSize: 'contain',
      maskSize: 'contain',
      WebkitMaskPosition: 'center',
      maskPosition: 'center',
      WebkitMaskRepeat: 'no-repeat',
      maskRepeat: 'no-repeat',
      // Use luminance mode - white = visible, black = transparent
      WebkitMaskMode: 'luminance',
      maskMode: 'luminance',
    }
    
    // Handle mask inversion
    if (maskEffect.invertMask) {
      // Invert by using a filter (note: limited browser support for mask-composite)
      // Alternative: we could invert the actual mask image server-side
      maskStyles.filter = 'invert(1)'
    }
    
    return maskStyles
  }, [clip, clip?.effects, playheadPosition, isCachedRender, getAssetById])
}

/**
 * VideoLayerRenderer - Renders video layers with preloading for seamless playback
 * 
 * This component handles:
 * - Preloading upcoming clips before they're needed
 * - Seamless transitions between adjacent clips (no black flicker)
 * - Multi-layer compositing with cached videos
 * - Proper sync between timeline position and video playback
 */

// How far ahead to preload (in seconds)
const PRELOAD_LOOKAHEAD = 2.5
const PLAYBACK_DIAG_KEY = 'comfystudio-playback-diag'

function isPlaybackDiagEnabled() {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(PLAYBACK_DIAG_KEY) === '1'
}

function shortPlaybackUrl(url) {
  if (!url) return null
  const asString = String(url)
  return asString.length > 72 ? `${asString.slice(0, 72)}...` : asString
}

function logPlaybackDiag(event, payload = {}) {
  if (!isPlaybackDiagEnabled()) return
  const nowSeconds = typeof performance !== 'undefined'
    ? Number((performance.now() / 1000).toFixed(3))
    : null
  console.log(`[PlaybackDiag] ${event}`, { t: nowSeconds, ...payload })
}

function resolvePlaybackUrl(clip, getAssetById) {
  if (!clip || clip.type !== 'video') return null
  if (clip.cacheStatus === 'cached' && clip.cacheUrl) {
    return clip.cacheUrl
  }
  const asset = clip.assetId ? getAssetById(clip.assetId) : null
  const usePlaybackCache = !!asset?.playbackCacheUrl && asset?.playbackCacheStatus !== 'failed'
  return (usePlaybackCache ? asset?.playbackCacheUrl : null) || asset?.url || clip.url || null
}

/**
 * Single video layer component - renders one video with transforms
 */
const VideoLayer = memo(function VideoLayer({ 
  clip, 
  track, 
  layerIndex, 
  totalLayers,
  playheadPosition, 
  isPlaying,
  buildVideoTransform,
  getClipTransform,
  isInTransition = false, // Whether this clip is part of a transition
}) {
  const containerRef = useRef(null)   // Container we attach the cached video element to
  const videoElementRef = useRef(null) // Cached video element we display (avoids black flash at cuts)
  const holdFrameRef = useRef(null) // Canvas to hold last frame during src changes
  const lastPlaybackDebugRef = useRef(0) // Throttle playback debug logs
  const [isReady, setIsReady] = useState(false)
  const [showHoldFrame, setShowHoldFrame] = useState(false)
  const [showSprite, setShowSprite] = useState(false)
  const [spriteContainerSize, setSpriteContainerSize] = useState({ width: 0, height: 0 })
  const lastSyncTime = useRef(0)
  const lastSeekTime = useRef(0)
  const seekDebounceRef = useRef(null)
  const isScrubbing = useRef(false)
  const lastPlayheadRef = useRef(playheadPosition)
  const lastClipUrlRef = useRef(null) // Track src changes for hold frame
  const diagEventTimesRef = useRef({})
  const attemptedPlaybackFallbackRef = useRef(false)
  
  // Get the current valid URL (may be cached render or original)
  const { url: clipUrl, isCached: isCachedRender } = useClipUrl(clip)
  
  // Get sprite data for this clip's asset
  const getAssetSprite = useAssetsStore(state => state.getAssetSprite)
  const getAssetById = useAssetsStore(state => state.getAssetById)
  const markPlaybackCacheBroken = useAssetsStore(state => state.markPlaybackCacheBroken)
  const spriteData = clip?.assetId ? getAssetSprite(clip.assetId) : null
  const asset = clip?.assetId ? getAssetById(clip.assetId) : null

  // Feature flag: Enable/disable sprite sheet scrubbing for real-time preview
  // Set to false to disable sprite scrubbing (will use video seeking instead)
  const ENABLE_SPRITE_SCRUBBING = false
  
  const useSpriteScrub = ENABLE_SPRITE_SCRUBBING && !!spriteData?.url && !isCachedRender
  
  // Get mask effect styles for video (skip if using cached render)
  const maskStyles = useMaskEffectStyle(clip, playheadPosition, isCachedRender)
  // Always compute mask styles for sprite overlay (sprites are from source)
  const spriteMaskStyles = useMaskEffectStyle(clip, playheadPosition, false)
  
  // Calculate clip-relative time for keyframe evaluation
  const clipTime = playheadPosition - (clip?.startTime || 0)
  const rawTimeScale = clip?.sourceTimeScale || (clip?.timelineFps && clip?.sourceFps
    ? clip.timelineFps / clip.sourceFps
    : 1)
  const speed = Number(clip?.speed)
  const speedScale = Number.isFinite(speed) && speed > 0 ? speed : 1
  const timeScale = isCachedRender ? 1 : rawTimeScale * speedScale
  const reverse = !!clip?.reverse
  const trimStart = clip?.trimStart || 0
  const rawTrimEnd = clip?.trimEnd ?? clip?.sourceDuration ?? (trimStart + (clip?.duration || 0) * timeScale)
  const trimEnd = Number.isFinite(rawTrimEnd) ? rawTrimEnd : trimStart
  const minTime = Math.min(trimStart, trimEnd)
  const maxTime = Math.max(trimStart, trimEnd)
  
  // Calculate source time for sprite frame lookup
  const sourceTime = reverse
    ? trimEnd - clipTime * timeScale
    : trimStart + clipTime * timeScale

  const getClampedTimeForPlayhead = useCallback((timelineTime) => {
    const startTime = Number(clip?.startTime) || 0
    const sourceTimelineTime = reverse
      ? trimEnd - (timelineTime - startTime) * timeScale
      : trimStart + (timelineTime - startTime) * timeScale
    return Math.max(minTime, Math.min(sourceTimelineTime, maxTime - 0.01))
  }, [clip?.startTime, reverse, trimEnd, timeScale, trimStart, minTime, maxTime])

  const logLayerDiag = useCallback((event, payload = {}, throttleMs = 0) => {
    if (!isPlaybackDiagEnabled()) return
    if (throttleMs > 0) {
      const now = Date.now()
      const last = diagEventTimesRef.current[event] || 0
      if (now - last < throttleMs) return
      diagEventTimesRef.current[event] = now
    }
    logPlaybackDiag(event, {
      clipId: clip?.id,
      trackId: track?.id,
      ...payload,
    })
  }, [clip?.id, track?.id])

  useEffect(() => {
    attemptedPlaybackFallbackRef.current = false
  }, [clip?.id, clipUrl])

  const attemptPlaybackCacheFallback = useCallback((reason, details = {}) => {
    if (attemptedPlaybackFallbackRef.current) return false
    if (!clip?.id || !clip?.assetId || !asset) return false

    const usingRenderCache = Boolean(clip.cacheStatus === 'cached' && clip.cacheUrl && clipUrl === clip.cacheUrl)
    if (usingRenderCache) return false

    const playbackCacheUrl = asset.playbackCacheUrl || null
    const sourceUrl = asset.url || null
    const usingPlaybackCache = Boolean(playbackCacheUrl && clipUrl && clipUrl === playbackCacheUrl)
    const canFallbackToSource = Boolean(sourceUrl && sourceUrl !== playbackCacheUrl)
    if (!usingPlaybackCache || !canFallbackToSource) return false

    attemptedPlaybackFallbackRef.current = true

    logLayerDiag('playback-cache:fallback', {
      reason,
      fromUrl: shortPlaybackUrl(playbackCacheUrl),
      toUrl: shortPlaybackUrl(sourceUrl),
      ...details,
    })

    if (typeof localStorage !== 'undefined' && localStorage.getItem('comfystudio-debug-playback') === '1') {
      console.warn('[PlaybackCache] Falling back to source media', {
        clipId: clip.id,
        assetId: asset.id,
        reason,
      })
    }

    markPlaybackCacheBroken(asset.id, reason)
    videoCache.invalidateClipSource(clip.id, playbackCacheUrl)
    setIsReady(false)
    return true
  }, [
    asset,
    clip?.assetId,
    clip?.cacheStatus,
    clip?.cacheUrl,
    clip?.id,
    clipUrl,
    logLayerDiag,
    markPlaybackCacheBroken,
  ])
  
  // Get animated transform (with keyframes applied)
  const animatedTransform = useMemo(() => {
    if (!clip) return null
    // Use keyframe-interpolated values if keyframes exist, otherwise use base transform
    return getAnimatedTransform(clip, clipTime)
  }, [clip, clipTime])
  
  // Get sprite frame info for current time (memoized to prevent recalculations)
  const spriteInfo = useMemo(() => {
    if (!spriteData || !spriteData.url) return null
    return getScaledSpriteStyle(spriteData, sourceTime)
  }, [spriteData, sourceTime])

  const updateSpriteContainerSize = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    setSpriteContainerSize(prev => (
      prev.width === width && prev.height === height ? prev : { width, height }
    ))
  }, [])

  useLayoutEffect(() => {
    let ro
    let rafId

    const tryAttach = () => {
      const el = containerRef.current
      if (!el) {
        rafId = requestAnimationFrame(tryAttach)
        return
      }
      updateSpriteContainerSize()
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(updateSpriteContainerSize)
        ro.observe(el)
      } else {
        window.addEventListener('resize', updateSpriteContainerSize)
      }
    }

    tryAttach()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      if (ro) ro.disconnect()
      window.removeEventListener('resize', updateSpriteContainerSize)
    }
  }, [updateSpriteContainerSize])

  const spriteOverlayStyle = useMemo(() => {
    if (!spriteInfo || !spriteContainerSize.width || !spriteContainerSize.height) return null
    const scale = Math.min(
      spriteContainerSize.width / spriteInfo.frameWidth,
      spriteContainerSize.height / spriteInfo.frameHeight
    )
    const scaledSpriteWidth = spriteInfo.spriteWidth * scale
    const scaledSpriteHeight = spriteInfo.spriteHeight * scale
    const offsetX = (spriteContainerSize.width - spriteInfo.frameWidth * scale) / 2 - (spriteInfo.frameX * scale)
    const offsetY = (spriteContainerSize.height - spriteInfo.frameHeight * scale) / 2 - (spriteInfo.frameY * scale)

    return {
      backgroundImage: `url(${spriteInfo.spriteUrl})`,
      backgroundRepeat: 'no-repeat',
      backgroundSize: `${scaledSpriteWidth}px ${scaledSpriteHeight}px`,
      backgroundPosition: `${offsetX}px ${offsetY}px`,
    }
  }, [spriteInfo, spriteContainerSize])

  const captureHoldFrame = useCallback((video) => {
    const canvas = holdFrameRef.current
    if (!canvas || !video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return true
  }, [])
  
  // Attach the cache's video element to our container so we show the preloaded element at cuts (no black flash)
  useEffect(() => {
    if (!clipUrl || !clip?.id || !containerRef.current) return

    const currentPlayhead = useTimelineStore.getState().playheadPosition
    const previousUrl = lastClipUrlRef.current
    const hasSourceChange = Boolean(previousUrl && previousUrl !== clipUrl)
    logLayerDiag('layer:attach:start', {
      playhead: Number(currentPlayhead.toFixed(3)),
      url: shortPlaybackUrl(clipUrl),
      previousUrl: shortPlaybackUrl(previousUrl),
      hasSourceChange,
      inTransition: isInTransition,
    })
    if (hasSourceChange && captureHoldFrame(videoElementRef.current)) {
      setShowHoldFrame(true)
      logLayerDiag('layer:hold-frame:capture', {
        fromUrl: shortPlaybackUrl(previousUrl),
        toUrl: shortPlaybackUrl(clipUrl),
      })
    }
    lastClipUrlRef.current = clipUrl

    const clipWithUrl = { id: clip.id, url: clipUrl }
    const cachedVideo = videoCache.getVideoElement(clipWithUrl)
    if (!cachedVideo) {
      logLayerDiag('layer:attach:cache-miss', {
        url: shortPlaybackUrl(clipUrl),
      })
      return
    }

    const container = containerRef.current
    const previousLayerVideo = videoElementRef.current
    if (previousLayerVideo && previousLayerVideo !== cachedVideo && previousLayerVideo.parentNode === container) {
      previousLayerVideo.pause()
      container.removeChild(previousLayerVideo)
      logLayerDiag('layer:replace-video', {
        oldCurrentTime: Number((previousLayerVideo.currentTime || 0).toFixed(3)),
        newCurrentTime: Number((cachedVideo.currentTime || 0).toFixed(3)),
      })
    }
    if (cachedVideo.parentNode !== container) {
      container.appendChild(cachedVideo)
      logLayerDiag('layer:attach:reparent', {
        readyState: cachedVideo.readyState,
        currentTime: Number((cachedVideo.currentTime || 0).toFixed(3)),
      })
    }

    // Style the video to fill the container (cache already set muted, playsInline, etc.)
    Object.assign(cachedVideo.style, {
      objectFit: 'contain',
      width: '100%',
      height: '100%',
      display: 'block',
      position: 'absolute',
      top: 0,
      left: 0,
    })

    const syncVideoToCurrentPlayhead = (reason) => {
      const livePlayhead = useTimelineStore.getState().playheadPosition
      const targetTime = getClampedTimeForPlayhead(livePlayhead)
      const beforeTime = cachedVideo.currentTime || 0
      if (Math.abs(beforeTime - targetTime) > 0.001) {
        cachedVideo.currentTime = targetTime
      }
      logLayerDiag('layer:seek', {
        reason,
        livePlayhead: Number(livePlayhead.toFixed(3)),
        from: Number(beforeTime.toFixed(3)),
        to: Number(targetTime.toFixed(3)),
        readyState: cachedVideo.readyState,
      }, reason === 'sync' ? 180 : 0)
    }

    syncVideoToCurrentPlayhead('attach')

    const markReady = (reason) => {
      if (cachedVideo.readyState >= 2) {
        setIsReady(true)
        setShowHoldFrame(false)
        logLayerDiag('layer:ready', {
          reason,
          readyState: cachedVideo.readyState,
          networkState: cachedVideo.networkState,
          currentTime: Number((cachedVideo.currentTime || 0).toFixed(3)),
        })
      }
    }

    const onLoadedData = () => {
      syncVideoToCurrentPlayhead('loadeddata')
      markReady('loadeddata')
    }
    const onCanPlay = () => {
      syncVideoToCurrentPlayhead('canplay')
      markReady('canplay')
    }
    const onWaiting = () => {
      logLayerDiag('video:waiting', { readyState: cachedVideo.readyState, networkState: cachedVideo.networkState }, 220)
      if (cachedVideo.readyState === 0 && cachedVideo.networkState === 3) {
        attemptPlaybackCacheFallback('waiting-network-no-source', {
          readyState: cachedVideo.readyState,
          networkState: cachedVideo.networkState,
        })
      }
    }
    const onStalled = () => logLayerDiag('video:stalled', { readyState: cachedVideo.readyState, networkState: cachedVideo.networkState }, 220)
    const onSeeking = () => logLayerDiag('video:seeking', { currentTime: Number((cachedVideo.currentTime || 0).toFixed(3)) }, 160)
    const onSeeked = () => logLayerDiag('video:seeked', { currentTime: Number((cachedVideo.currentTime || 0).toFixed(3)) }, 160)
    const onPlaying = () => logLayerDiag('video:playing', { currentTime: Number((cachedVideo.currentTime || 0).toFixed(3)) }, 220)
    const onPaused = () => logLayerDiag('video:pause', { currentTime: Number((cachedVideo.currentTime || 0).toFixed(3)) }, 220)
    const onError = () => {
      const errorCode = cachedVideo.error?.code || null
      logLayerDiag('video:error', { code: errorCode })
      attemptPlaybackCacheFallback(`video-error-${errorCode || 'unknown'}`, {
        code: errorCode,
        readyState: cachedVideo.readyState,
        networkState: cachedVideo.networkState,
      })
    }
    cachedVideo.addEventListener('waiting', onWaiting)
    cachedVideo.addEventListener('stalled', onStalled)
    cachedVideo.addEventListener('seeking', onSeeking)
    cachedVideo.addEventListener('seeked', onSeeked)
    cachedVideo.addEventListener('playing', onPlaying)
    cachedVideo.addEventListener('pause', onPaused)
    cachedVideo.addEventListener('error', onError)

    if (cachedVideo.readyState >= 2) {
      markReady('already-ready')
    } else {
      setIsReady(false)
      cachedVideo.addEventListener('loadeddata', onLoadedData, { once: true })
      cachedVideo.addEventListener('canplay', onCanPlay, { once: true })
    }

    videoElementRef.current = cachedVideo

    if (typeof localStorage !== 'undefined' && localStorage.getItem('comfystudio-debug-playback') === '1') {
      console.log('[PlaybackCache] VideoLayer attached:', { clipId: clip?.id, readyState: cachedVideo.readyState, srcHint: (clipUrl || '').slice(0, 50) + '...' })
    }

    return () => {
      cachedVideo.removeEventListener('loadeddata', onLoadedData)
      cachedVideo.removeEventListener('canplay', onCanPlay)
      cachedVideo.removeEventListener('waiting', onWaiting)
      cachedVideo.removeEventListener('stalled', onStalled)
      cachedVideo.removeEventListener('seeking', onSeeking)
      cachedVideo.removeEventListener('seeked', onSeeked)
      cachedVideo.removeEventListener('playing', onPlaying)
      cachedVideo.removeEventListener('pause', onPaused)
      cachedVideo.removeEventListener('error', onError)
      logLayerDiag('layer:detach', {
        readyState: cachedVideo.readyState,
        currentTime: Number((cachedVideo.currentTime || 0).toFixed(3)),
      })
      if (videoElementRef.current === cachedVideo) {
        videoElementRef.current = null
      }
    }
  }, [attemptPlaybackCacheFallback, clipUrl, clip?.id, captureHoldFrame, getClampedTimeForPlayhead, logLayerDiag])

  // Detect scrubbing (rapid playhead changes while paused)
  useEffect(() => {
    if (isPlaying) {
      isScrubbing.current = false
      if (showSprite) setShowSprite(false)
      return
    }
    
    const playheadDelta = Math.abs(playheadPosition - lastPlayheadRef.current)
    lastPlayheadRef.current = playheadPosition
    
    // If playhead moved significantly while paused, we're scrubbing
    if (playheadDelta > 0.01) {
      isScrubbing.current = true
      // Show sprite during scrubbing if available (only set if not already showing)
      if (useSpriteScrub && !showSprite) {
        setShowSprite(true)
      }
      
      // Reset scrubbing flag after user stops for 150ms
      if (seekDebounceRef.current) {
        clearTimeout(seekDebounceRef.current)
      }
      seekDebounceRef.current = setTimeout(() => {
        isScrubbing.current = false
        setShowSprite(false)
        // Force a final precise seek when scrubbing stops
        const video = videoElementRef.current
        if (video && clip) {
          const currentPlayhead = useTimelineStore.getState().playheadPosition
          const sourceTime = reverse
            ? trimEnd - (currentPlayhead - clip.startTime) * timeScale
            : trimStart + (currentPlayhead - clip.startTime) * timeScale
          const clampedTime = Math.max(minTime, Math.min(sourceTime, maxTime))
          video.currentTime = clampedTime
        }
      }, 150)
    }
    
    return () => {
      if (seekDebounceRef.current) {
        clearTimeout(seekDebounceRef.current)
      }
    }
  }, [playheadPosition, isPlaying]) // Removed spriteData and clip from deps to prevent loops

  // If cached render becomes available, hide sprite overlay
  useEffect(() => {
    if (isCachedRender && showSprite) {
      setShowSprite(false)
    }
  }, [isCachedRender, showSprite])

  // Sync video playback with timeline
  useEffect(() => {
    const video = videoElementRef.current
    if (!video || !clip) return
    const sourceTime = reverse
      ? trimEnd - clipTime * timeScale
      : trimStart + clipTime * timeScale
    
    // Clamp sourceTime to valid range
    const clampedTime = Math.max(minTime, Math.min(sourceTime, maxTime - 0.01)) // Stay slightly before end
    
    // Calculate time difference
    const timeDiff = Math.abs(video.currentTime - clampedTime)
    const debugPlayback = (
      (typeof localStorage !== 'undefined' && localStorage.getItem('comfystudio-debug-playback') === '1')
      || isPlaybackDiagEnabled()
    )

    // Use different sync strategies for playing vs paused vs scrubbing
    if (isPlaying) {
      // Debug: log when playing but video not ready (common cause of black during play)
      if (debugPlayback && video.readyState < 2) {
        const now = Date.now()
        if (now - lastPlaybackDebugRef.current > 1000) {
          lastPlaybackDebugRef.current = now
          console.warn('[PlaybackCache] Playing but video not ready — can cause black:', { clipId: clip.id, readyState: video.readyState, networkState: video.networkState })
          logLayerDiag('sync:not-ready', {
            readyState: video.readyState,
            networkState: video.networkState,
            currentTime: Number((video.currentTime || 0).toFixed(3)),
            targetTime: Number(clampedTime.toFixed(3)),
          }, 500)
        }
      }

      if (video.readyState === 0 && video.networkState === 3) {
        const fallbackTriggered = attemptPlaybackCacheFallback('sync-network-no-source', {
          readyState: video.readyState,
          networkState: video.networkState,
          currentTime: Number((video.currentTime || 0).toFixed(3)),
        })
        if (fallbackTriggered) {
          return
        }
      }

      // When playing: Let the video play naturally, only correct large drifts
      // During transitions, use a larger threshold to avoid fighting between two videos
      const speedMismatch = Math.abs(timeScale - 1) > 0.001
      const driftThreshold = isInTransition
        ? 0.25
        : (speedMismatch ? 0.5 : 0.15)
      const boundaryEpsilon = 0.03
      const nearForwardEnd = !reverse && clampedTime >= (maxTime - boundaryEpsilon)
      const nearReverseStart = reverse && clampedTime <= (minTime + boundaryEpsilon)
      
      if (reverse) {
        // Reverse playback: seek-only (no native reverse playback)
        if (timeDiff > 0.02) {
          logLayerDiag('sync:reverse-seek', {
            timeDiff: Number(timeDiff.toFixed(3)),
            from: Number((video.currentTime || 0).toFixed(3)),
            to: Number(clampedTime.toFixed(3)),
          }, 140)
          video.currentTime = clampedTime
          lastSyncTime.current = playheadPosition
        }
        if (nearReverseStart) {
          if (!video.paused) {
            video.pause()
          }
          logLayerDiag('sync:freeze-at-start', {
            currentTime: Number((video.currentTime || 0).toFixed(3)),
            minTime: Number(minTime.toFixed(3)),
          }, 180)
        }
        if (!video.paused) {
          video.pause()
        }
      } else {
        if (timeDiff > driftThreshold) {
          if (debugPlayback && Date.now() - lastPlaybackDebugRef.current > 1000) {
            lastPlaybackDebugRef.current = Date.now()
            console.log('[PlaybackCache] Seek during playback (drift correction):', { clipId: clip.id, timeDiff: timeDiff.toFixed(2), clampedTime: clampedTime.toFixed(2) })
          }
          logLayerDiag('sync:drift-seek', {
            timeDiff: Number(timeDiff.toFixed(3)),
            threshold: Number(driftThreshold.toFixed(3)),
            from: Number((video.currentTime || 0).toFixed(3)),
            to: Number(clampedTime.toFixed(3)),
            inTransition: isInTransition,
          }, 120)
          video.currentTime = clampedTime
          lastSyncTime.current = playheadPosition
        }
        
        // Ensure playback rate matches clip time scale
        const playbackSpeed = Math.max(0.01, Math.abs(timeScale))
        if (Number.isFinite(playbackSpeed) && Math.abs(video.playbackRate - playbackSpeed) > 0.001) {
          video.playbackRate = playbackSpeed
        }

        if (nearForwardEnd) {
          if (timeDiff > 0.01) {
            video.currentTime = clampedTime
          }
          if (!video.paused) {
            video.pause()
          }
          logLayerDiag('sync:freeze-at-end', {
            currentTime: Number((video.currentTime || 0).toFixed(3)),
            maxTime: Number(maxTime.toFixed(3)),
            clampedTime: Number(clampedTime.toFixed(3)),
          }, 180)
          return
        }

        // Start playing if paused and ready (don't wait for canplay - seek immediately)
        if (video.paused) {
          if (video.readyState >= 2) {
            // Video has enough data to play - seek first, then play
            if (timeDiff > 0.02) {
              video.currentTime = clampedTime
            }
            logLayerDiag('sync:play', {
              currentTime: Number((video.currentTime || 0).toFixed(3)),
              playbackRate: Number((video.playbackRate || 0).toFixed(3)),
              timeDiff: Number(timeDiff.toFixed(3)),
            }, 240)
            video.play().catch(() => {})
          }
        }
      }
    } else if (isScrubbing.current) {
      // When scrubbing with sprite: skip video seeking entirely (sprite handles display)
      // When scrubbing without sprite: use throttled seeking
      if (!useSpriteScrub) {
        const now = performance.now()
        if (now - lastSeekTime.current > 50) { // 50ms = 20 fps during scrub
          // Use fastSeek if available (seeks to nearest keyframe - much faster)
          if (video.fastSeek && typeof video.fastSeek === 'function') {
            video.fastSeek(clampedTime)
          } else {
            video.currentTime = clampedTime
          }
          lastSeekTime.current = now
        }
      }
      
      // Ensure video is paused
      if (!video.paused) {
        video.pause()
      }
    } else {
      // When paused (not scrubbing): Use tight threshold for precise positioning
      // Seek immediately if video is ready, don't wait
      if (video.readyState >= 1 && timeDiff > 0.02) {
        logLayerDiag('sync:paused-seek', {
          timeDiff: Number(timeDiff.toFixed(3)),
          from: Number((video.currentTime || 0).toFixed(3)),
          to: Number(clampedTime.toFixed(3)),
        }, 150)
        video.currentTime = clampedTime
        lastSyncTime.current = playheadPosition
      }
      
      // Ensure video is paused
      if (!video.paused) {
        video.pause()
      }
    }
  }, [clip, clipTime, playheadPosition, isPlaying, spriteData, isInTransition, timeScale, useSpriteScrub, logLayerDiag, attemptPlaybackCacheFallback])

  if (!clip) return null

  // Use animated transform instead of base transform
  const transformStyle = buildVideoTransform(animatedTransform)
  // Combine blur (from transform) with mask filter (e.g. invert) so both apply
  const combinedFilter = [transformStyle.filter, maskStyles.filter].filter(Boolean).join(' ') || undefined
  const spriteCombinedFilter = [transformStyle.filter, spriteMaskStyles.filter].filter(Boolean).join(' ') || undefined

  return (
    <>
      {/* Container for cached video element (displaying cache = no black flash at cuts) */}
      <div
        ref={containerRef}
        className="bg-transparent w-full h-full"
        style={{
          position: layerIndex === 0 ? 'relative' : 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: layerIndex + 1,
          opacity: (showSprite && spriteInfo) || showHoldFrame ? 0 : 1,
          ...transformStyle,
          ...maskStyles,
          filter: combinedFilter,
        }}
      />
      
      {/* Hold frame canvas - shows last frame during video src transition to prevent black flicker */}
      <canvas
        ref={holdFrameRef}
        className="pointer-events-none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          zIndex: layerIndex + 3,
          display: showHoldFrame ? 'block' : 'none',
          ...transformStyle,
          ...maskStyles,
          filter: combinedFilter,
        }}
      />
      
      {/* Sprite overlay (shown during fast scrubbing) */}
      {showSprite && spriteOverlayStyle && (
        <div
          className="pointer-events-none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: layerIndex + 2,
            overflow: 'hidden',
            backgroundColor: '#000',
            ...spriteOverlayStyle,
            ...transformStyle,
            ...spriteMaskStyles,
            filter: spriteCombinedFilter,
          }}
        />
      )}
    </>
  )
})

/**
 * Image layer component - renders static image with transforms
 */
const ImageLayer = memo(function ImageLayer({ 
  clip, 
  track, 
  layerIndex, 
  totalLayers,
  playheadPosition,
  buildVideoTransform,
  getClipTransform,
}) {
  // Get the current valid URL (may be cached render or original)
  const { url: clipUrl, isCached: isCachedRender } = useClipUrl(clip)
  
  // Get mask effect styles if any (skip if using cached render)
  const maskStyles = useMaskEffectStyle(clip, playheadPosition, isCachedRender)
  
  if (!clipUrl) return null

  // Calculate clip-relative time for keyframe evaluation
  const clipTime = playheadPosition - (clip?.startTime || 0)
  
  // Get animated transform (with keyframes applied)
  const animatedTransform = useMemo(() => {
    return getAnimatedTransform(clip, clipTime)
  }, [clip, clipTime])
  
  const transformStyle = buildVideoTransform(animatedTransform)
  const combinedFilter = [transformStyle.filter, maskStyles.filter].filter(Boolean).join(' ') || undefined

  return (
    <img
      src={clipUrl}
      alt={clip.name || 'Image'}
      className="bg-transparent w-full h-full"
      style={{
        objectFit: 'contain', // Maintain aspect ratio, letterbox if needed
        display: 'block',
        position: layerIndex === 0 ? 'relative' : 'absolute',
        top: 0,
        left: 0,
        zIndex: layerIndex + 1,
        // Apply animated clip transforms
        ...transformStyle,
        // Apply mask effect styles
        ...maskStyles,
        filter: combinedFilter,
      }}
      onContextMenu={(e) => e.preventDefault()}
      draggable={false}
    />
  )
})

/**
 * Text layer component - renders text overlay with transforms
 */
const TextLayer = memo(function TextLayer({
  clip,
  track,
  layerIndex,
  totalLayers,
  playheadPosition,
  buildVideoTransform,
  getClipTransform,
  previewScale = 1,
}) {
  if (!clip || clip.type !== 'text') return null
  
  // Calculate clip-relative time for keyframe evaluation
  const clipTime = playheadPosition - (clip?.startTime || 0)
  
  // Get animated transform (with keyframes applied)
  const animatedTransform = useMemo(() => {
    return getAnimatedTransform(clip, clipTime)
  }, [clip, clipTime])
  
  const transformStyle = buildVideoTransform(animatedTransform)
  const textProps = clip.textProperties || {}
  const safePreviewScale = Number.isFinite(previewScale) && previewScale > 0 ? previewScale : 1
  const scaledFontSize = (textProps.fontSize || 64) * safePreviewScale
  const scaledStrokeWidth = (textProps.strokeWidth || 0) * safePreviewScale
  const scaledShadowOffsetX = (textProps.shadowOffsetX || 2) * safePreviewScale
  const scaledShadowOffsetY = (textProps.shadowOffsetY || 2) * safePreviewScale
  const scaledShadowBlur = (textProps.shadowBlur || 4) * safePreviewScale
  
  // Build text styles from textProperties
  const textStyle = {
    fontFamily: textProps.fontFamily || 'Inter',
    fontSize: `${scaledFontSize}px`,
    fontWeight: textProps.fontWeight || 'bold',
    fontStyle: textProps.fontStyle || 'normal',
    color: textProps.textColor || '#FFFFFF',
    textAlign: textProps.textAlign || 'center',
    letterSpacing: textProps.letterSpacing ? `${textProps.letterSpacing * safePreviewScale}px` : 'normal',
    lineHeight: textProps.lineHeight || 1.2,
    // Text stroke
    WebkitTextStroke: textProps.strokeWidth > 0 
      ? `${scaledStrokeWidth}px ${textProps.strokeColor || '#000000'}`
      : 'none',
    paintOrder: 'stroke fill',
    // Text shadow
    textShadow: textProps.shadow 
      ? `${scaledShadowOffsetX}px ${scaledShadowOffsetY}px ${scaledShadowBlur}px ${textProps.shadowColor || 'rgba(0,0,0,0.5)'}`
      : 'none',
  }
  
  // Background style
  const backgroundStyle = textProps.backgroundOpacity > 0 
    ? {
        backgroundColor: textProps.backgroundColor || '#000000',
        opacity: textProps.backgroundOpacity / 100,
        padding: `${(textProps.backgroundPadding || 20) * safePreviewScale}px`,
        borderRadius: `${8 * safePreviewScale}px`,
      }
    : {}
  
  // Vertical alignment
  const getVerticalAlign = () => {
    switch (textProps.verticalAlign) {
      case 'top': return 'flex-start'
      case 'bottom': return 'flex-end'
      default: return 'center'
    }
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{
        zIndex: layerIndex + 10, // Text layers render on top of video
        alignItems: getVerticalAlign(),
        ...transformStyle,
      }}
    >
      <div 
        className="relative"
        style={backgroundStyle}
      >
        <span 
          style={textStyle}
          className="whitespace-pre-wrap"
        >
          {textProps.text || 'Sample Text'}
        </span>
      </div>
    </div>
  )
})

/**
 * Main VideoLayerRenderer component
 */
function VideoLayerRenderer({
  buildVideoTransform,
  getClipTransform,
  transitionInfo,
  getTransitionStyles,
  getTransitionOverlay,
  previewScale = 1,
}) {
  const containerRef = useRef(null)
  const preloadTimerRef = useRef(null)
  const pauseTimerRef = useRef(null)
  const lastPreloadPosition = useRef(0)
  const lastTopClipRef = useRef(null)
  const lastActiveSetRef = useRef('')
  
  // Track preloaded clip URL keys per clipId to avoid stale-preload bugs.
  const preloadedClips = useRef(new Map())
  
  const {
    clips,
    tracks,
    isPlaying,
    playheadPosition,
    playbackRate,
    getActiveClipsAtTime,
    getEnabledEffects,
    setCacheStatus,
    setCacheUrl,
  } = useTimelineStore()

  const getAssetById = useAssetsStore(state => state.getAssetById)
  const { currentProjectHandle } = useProjectStore()
  
  /**
   * Get clips that should be preloaded based on current position
   */
  const getClipsToPreload = useCallback((currentTime) => {
    const isForward = playbackRate >= 0
    const lookaheadEnd = currentTime + (isForward ? PRELOAD_LOOKAHEAD : -PRELOAD_LOOKAHEAD)
    
    // Find video clips that:
    // 1. Are currently active
    // 2. Will become active within lookahead window
    const videoTracks = tracks.filter(t => t.type === 'video')
    const videoTrackIds = new Set(videoTracks.map(t => t.id))
    
    const relevantClips = clips.filter(clip => {
      if (!videoTrackIds.has(clip.trackId) || clip.type !== 'video') return false
      
      const clipEnd = clip.startTime + clip.duration
      
      // Currently active
      if (currentTime >= clip.startTime && currentTime < clipEnd) {
        return true
      }
      
      // Will become active soon (forward)
      if (isForward && clip.startTime > currentTime && clip.startTime <= lookaheadEnd) {
        return true
      }
      
      // Will become active soon (reverse)
      if (!isForward && clipEnd < currentTime && clipEnd >= lookaheadEnd) {
        return true
      }
      
      return false
    })
    
    return relevantClips
  }, [clips, tracks, playbackRate])

  const autoCacheClip = useCallback(async (clip) => {
    if (!clip || clip.type !== 'video') return
    if (clip.cacheStatus === 'cached' || renderCacheService.isRendering(clip.id)) return

    const enabledEffects = getEnabledEffects(clip.id)
    const maskEffects = (enabledEffects || []).filter(e => e.type === 'mask' && e.enabled)
    if (maskEffects.length === 0) return

    const asset = getAssetById(clip.assetId)
    const videoUrl = asset?.url || clip.url
    if (!videoUrl) return

    setCacheStatus(clip.id, 'rendering', 0)

    try {
      const { blobUrl, blob } = await renderCacheService.renderClipWithEffects(
        clip,
        videoUrl,
        enabledEffects,
        getAssetById,
        {
          fps: 30,
          onProgress: (progress) => {
            if (progress.progress !== undefined) {
              setCacheStatus(clip.id, 'rendering', progress.progress)
            }
          }
        }
      )

      let cachePath = null
      if (currentProjectHandle && blob) {
        try {
          cachePath = await saveRenderCache(currentProjectHandle, clip.id, blob, {
            clipId: clip.id,
            duration: clip.duration,
            effects: enabledEffects.map(e => ({ id: e.id, type: e.type })),
          })
        } catch (saveErr) {
          console.warn('Failed to save cache to disk:', saveErr)
        }
      }

      setCacheUrl(clip.id, blobUrl, cachePath)
    } catch (err) {
      console.error('Auto render cache failed:', err)
      setCacheStatus(clip.id, 'none', 0)
    }
  }, [currentProjectHandle, getAssetById, getEnabledEffects, setCacheStatus, setCacheUrl])

  /**
   * Preload upcoming clips
   */
  const preloadUpcoming = useCallback(() => {
    const clipsToPreload = getClipsToPreload(playheadPosition)
    
    clipsToPreload.forEach(clip => {
      const resolvedUrl = resolvePlaybackUrl(clip, getAssetById)
      if (!resolvedUrl) {
        logPlaybackDiag('preload:skip-no-url', {
          clipId: clip.id,
          playhead: Number(playheadPosition.toFixed(3)),
        })
        return
      }
      const preloadKey = `${clip.id}|${resolvedUrl}`
      if (preloadedClips.current.get(clip.id) === preloadKey) return
      logPlaybackDiag('preload:request', {
        clipId: clip.id,
        playhead: Number(playheadPosition.toFixed(3)),
        url: shortPlaybackUrl(resolvedUrl),
      })
      videoCache.getVideoElement({ ...clip, url: resolvedUrl }, true)
      preloadedClips.current.set(clip.id, preloadKey)
    })
    
    lastPreloadPosition.current = playheadPosition
  }, [playheadPosition, getClipsToPreload, getAssetById])

  // Auto-render cache for clips with mask effects (smooth playback)
  useEffect(() => {
    const candidates = getClipsToPreload(playheadPosition)
    candidates.forEach(clip => {
      void autoCacheClip(clip)
    })
  }, [playheadPosition, getClipsToPreload, autoCacheClip])

  // Derive active layer clips synchronously to avoid one-frame stale ghosts/flicker.
  const activeLayerClips = useMemo(() => {
    const allActiveClips = getActiveClipsAtTime(playheadPosition)
    const videoClips = allActiveClips.filter(({ track }) => track.type === 'video')
    
    // Sort by track index (higher index = lower in stack, first rendered)
    // Video 1 on top of Video 2
    const sortedClips = [...videoClips].sort((a, b) => {
      const indexA = tracks.findIndex(t => t.id === a.track.id)
      const indexB = tracks.findIndex(t => t.id === b.track.id)
      return indexB - indexA
    })
    return sortedClips
  }, [playheadPosition, getActiveClipsAtTime, tracks, clips])

  // Playback diagnostics: track active clip-set and top-clip swaps at cuts.
  useEffect(() => {
    if (!isPlaybackDiagEnabled()) return
    const activeIds = activeLayerClips.map(({ clip }) => clip.id)
    const activeSetKey = activeIds.join(',')
    const topClipId = activeIds[0] || null
    if (activeSetKey !== lastActiveSetRef.current) {
      logPlaybackDiag('cut:active-set-change', {
        playhead: Number(playheadPosition.toFixed(3)),
        activeClipIds: activeIds,
      })
      lastActiveSetRef.current = activeSetKey
    }
    if (topClipId !== lastTopClipRef.current) {
      logPlaybackDiag('cut:top-clip-change', {
        playhead: Number(playheadPosition.toFixed(3)),
        fromClipId: lastTopClipRef.current,
        toClipId: topClipId,
        transitionType: transitionInfo?.transition?.type || null,
        transitionProgress: transitionInfo ? Number(transitionInfo.progress.toFixed(3)) : null,
      })
      lastTopClipRef.current = topClipId
    }
  }, [activeLayerClips, playheadPosition, transitionInfo])

  // Preload on position change (throttled)
  useEffect(() => {
    // Preload when position changes by more than 0.3 seconds
    if (Math.abs(playheadPosition - lastPreloadPosition.current) > 0.3) {
      preloadUpcoming()
    }
  }, [playheadPosition, preloadUpcoming])

  // Set up preload interval during playback
  useEffect(() => {
    if (isPlaying) {
      if (pauseTimerRef.current) {
        clearTimeout(pauseTimerRef.current)
        pauseTimerRef.current = null
      }
      // Preload frequently during playback
      preloadTimerRef.current = setInterval(() => {
        preloadUpcoming()
      }, 250)
      
      // Initial preload
      preloadUpcoming()
    } else {
      if (preloadTimerRef.current) {
        clearInterval(preloadTimerRef.current)
        preloadTimerRef.current = null
      }
      // Pause all cached videos when timeline stops
      // But first ensure current active clips are properly positioned to avoid black frames
      const allActiveClips = getActiveClipsAtTime(playheadPosition)
      const videoClips = allActiveClips.filter(({ track }) => track.type === 'video')
      
      // Pre-seek all active videos before pausing to prevent black frames
      videoClips.forEach(({ clip }) => {
        const resolvedUrl = resolvePlaybackUrl(clip, getAssetById)
        if (!resolvedUrl) return
        const clipWithUrl = { ...clip, url: resolvedUrl }
        const cachedVideo = videoCache.getVideoElement(clipWithUrl)
        if (cachedVideo && cachedVideo.readyState >= 1) {
          const baseScale = clip.sourceTimeScale || (clip.timelineFps && clip.sourceFps
            ? clip.timelineFps / clip.sourceFps
            : 1)
          const speed = Number(clip.speed)
          const speedScale = Number.isFinite(speed) && speed > 0 ? speed : 1
          const timeScale = baseScale * speedScale
          const reverse = !!clip.reverse
          const trimStart = clip.trimStart || 0
          const rawTrimEnd = clip.trimEnd ?? clip.sourceDuration ?? (trimStart + (clip.duration || 0) * timeScale)
          const trimEnd = Number.isFinite(rawTrimEnd) ? rawTrimEnd : trimStart
          const minTime = Math.min(trimStart, trimEnd)
          const maxTime = Math.max(trimStart, trimEnd)
          const sourceTime = reverse
            ? trimEnd - (playheadPosition - clip.startTime) * timeScale
            : trimStart + (playheadPosition - clip.startTime) * timeScale
          const clampedTime = Math.max(minTime, Math.min(sourceTime, maxTime - 0.01))
          cachedVideo.currentTime = clampedTime
        }
      })
      
      // Small delay before pausing to ensure seeks complete
      pauseTimerRef.current = setTimeout(() => {
        videoCache.pauseAll()
        pauseTimerRef.current = null
      }, 10)
    }

    return () => {
      if (preloadTimerRef.current) {
        clearInterval(preloadTimerRef.current)
      }
      if (pauseTimerRef.current) {
        clearTimeout(pauseTimerRef.current)
        pauseTimerRef.current = null
      }
    }
  }, [isPlaying, preloadUpcoming, getActiveClipsAtTime, playheadPosition, getAssetById])

  // Clean up preloaded set periodically to allow re-preloading
  useEffect(() => {
    const cleanup = setInterval(() => {
      // Keep only clips that are within a larger window
      const keepWindow = PRELOAD_LOOKAHEAD * 3
      preloadedClips.current = new Map(
        [...preloadedClips.current.entries()].filter(([clipId]) => {
          const clip = clips.find(c => c.id === clipId)
          if (!clip) return false
          const clipEnd = clip.startTime + clip.duration
          return (
            Math.abs(clip.startTime - playheadPosition) < keepWindow ||
            Math.abs(clipEnd - playheadPosition) < keepWindow
          )
        })
      )
    }, 5000)
    
    return () => clearInterval(cleanup)
  }, [clips, playheadPosition])

  // Separate text clips (rendered on top)
  const textClips = activeLayerClips.filter(({ clip }) => clip.type === 'text')
  
  // Combined video and image layers (both render in the same z-order space)
  const allMediaClips = activeLayerClips.filter(({ clip }) => clip.type === 'video' || clip.type === 'image')

  const getTransitionStyleForClip = (clip) => {
    if (!transitionInfo || !clip) return null
    if (typeof getTransitionStyles !== 'function') return null
    
    if (transitionInfo.transition?.kind === 'edge') {
      if (transitionInfo.clip?.id !== clip.id) return null
      const isOutgoing = transitionInfo.edge === 'out'
      return getTransitionStyles(transitionInfo, isOutgoing)
    }
    
    if (transitionInfo.clipA?.id === clip.id) {
      return getTransitionStyles(transitionInfo, true)
    }
    
    if (transitionInfo.clipB?.id === clip.id) {
      return getTransitionStyles(transitionInfo, false)
    }
    
    return null
  }

  // Precompute transition styles so culling and rendering share the same transition membership.
  const transitionStyleByClipId = useMemo(() => {
    const styleMap = new Map()
    for (const { clip } of allMediaClips) {
      const style = getTransitionStyleForClip(clip)
      if (style) {
        styleMap.set(clip.id, style)
      }
    }
    return styleMap
  }, [allMediaClips, transitionInfo, getTransitionStyles])
  
  // Occlusion culling: if a layer is fully opaque and covers the frame, nothing below is visible.
  // IMPORTANT: allMediaClips is ordered bottom -> top for rendering, so culling must scan top -> bottom.
  // IMPORTANT: never cull transition participants, or transitions become "fade to black + hard cut."
  const mediaClips = (() => {
    const visible = []
    for (let i = allMediaClips.length - 1; i >= 0; i -= 1) {
      const entry = allMediaClips[i]
      // Preserve render order (bottom -> top) while scanning from top.
      visible.unshift(entry)
      const inTransition = transitionStyleByClipId.has(entry.clip.id)
      if (!inTransition && isLayerFullyObscuring(entry.clip, playheadPosition)) break
    }
    return visible
  })()

  // Handle no active clips — just black, no message.
  // Keep this AFTER hooks so hook call order never changes between renders.
  if (activeLayerClips.length === 0 && !transitionInfo) {
    return <div className="absolute inset-0 bg-black" />
  }
  
  // Render multi-layer composition (including transitions)
  return (
    <div ref={containerRef} className="relative w-full h-full">
      {/* Video/Image layers */}
      {mediaClips.map(({ clip, track }, index) => (
        clip.type === 'image' ? (
          <ImageLayer
            key={`img-${track.id}-${clip.id}`}
            clip={clip}
            track={track}
            layerIndex={index}
            totalLayers={mediaClips.length}
            playheadPosition={playheadPosition}
            buildVideoTransform={(transform) => {
              const transitionStyle = transitionStyleByClipId.get(clip.id) || null
              return transitionStyle
                ? { ...buildVideoTransform(transform), ...transitionStyle }
                : buildVideoTransform(transform)
            }}
            getClipTransform={getClipTransform}
          />
        ) : (
          <VideoLayer
            key={`vid-${track.id}-${clip.id}`}
            clip={clip}
            track={track}
            layerIndex={index}
            totalLayers={mediaClips.length}
            playheadPosition={playheadPosition}
            isPlaying={isPlaying}
            isInTransition={transitionStyleByClipId.has(clip.id)}
            buildVideoTransform={(transform) => {
              const transitionStyle = transitionStyleByClipId.get(clip.id) || null
              return transitionStyle
                ? { ...buildVideoTransform(transform), ...transitionStyle }
                : buildVideoTransform(transform)
            }}
            getClipTransform={getClipTransform}
          />
        )
      ))}
      
      {/* Text layers (rendered on top) */}
      {textClips.map(({ clip, track }, index) => (
        <TextLayer
          key={`text-${track.id}-${clip.id}`}
          clip={clip}
          track={track}
          layerIndex={index}
          totalLayers={textClips.length}
          playheadPosition={playheadPosition}
          buildVideoTransform={buildVideoTransform}
          getClipTransform={getClipTransform}
          previewScale={previewScale}
        />
      ))}
      
      {/* Transition overlay (for fade effects) */}
      {transitionInfo ? getTransitionOverlay(transitionInfo) : null}
    </div>
  )
}

/**
 * Clear a clip's entry from the disk cache URL map
 * Call this when clearing a clip's render cache
 */
export function clearDiskCacheUrl(clipId) {
  const url = diskCacheUrls.get(clipId)
  if (url) {
    URL.revokeObjectURL(url)
    diskCacheUrls.delete(clipId)
  }
}

export default memo(VideoLayerRenderer)
