/**
 * Video Cache Service
 * 
 * Manages a pool of preloaded video elements for seamless timeline playback.
 * Handles:
 * - Preloading upcoming clips before they're needed
 * - Caching loaded videos to avoid reload delays
 * - Multi-layer compositing support
 * - Memory management (LRU eviction)
 */

// Maximum number of video elements to keep in cache
const MAX_CACHE_SIZE = 12

// How far ahead to preload (in seconds)
const PRELOAD_LOOKAHEAD = 2.0

// Minimum time before clip start to trigger preload
const PRELOAD_TRIGGER_TIME = 1.5

class VideoCache {
  constructor() {
    // Map of clipId -> { videoElement, lastUsed, ready, url }
    this.cache = new Map()
    
    // Currently active video elements (being displayed)
    this.activeElements = new Set()
    
    // Preload queue
    this.preloadQueue = []
    
    // Event listeners
    this.listeners = new Map()
  }

  /**
   * Cache key for a clip: use a separate entry for playback-cache URL so we don't reuse
   * an element that had its src switched (avoids black playback when cache becomes ready).
   */
  _cacheKey(clip) {
    const isPlaybackCache = clip?.url && (clip.url.includes('cache/playback_') || (clip.url.includes('playback_') && clip.url.includes('cache')))
    return clip.id + (isPlaybackCache ? '|pb' : '')
  }

  /**
   * Get or create a video element for a clip
   * @param {object} clip - The clip object
   * @param {boolean} preload - Whether this is a preload request
   * @returns {HTMLVideoElement} The video element
   */
  getVideoElement(clip, preload = false) {
    if (!clip || !clip.url) return null

    const cacheKey = this._cacheKey(clip)

    // Check if already cached
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)
      cached.lastUsed = Date.now()

      // Same URL: reuse. Different URL: don't swap src on same element (we use a different cache key for playback cache now)
      if (cached.url !== clip.url) {
        cached.videoElement.src = clip.url
        cached.url = clip.url
        cached.ready = false
        this._loadVideo(cached)
      }

      return cached.videoElement
    }

    // Create new video element
    const videoElement = document.createElement('video')
    videoElement.muted = true // Start muted, unmute when active
    videoElement.playsInline = true
    videoElement.preload = 'auto'
    videoElement.crossOrigin = 'anonymous'
    
    // Prevent default controls
    videoElement.controls = false
    videoElement.disablePictureInPicture = true
    
    const cacheEntry = {
      videoElement,
      url: clip.url,
      clipId: clip.id,
      baseClipId: clip.id, // For lookup when key is clipId|pb
      lastUsed: Date.now(),
      ready: false,
      loading: false,
    }

    // Add to cache
    this.cache.set(cacheKey, cacheEntry)
    
    // Set source and start loading
    videoElement.src = clip.url
    this._loadVideo(cacheEntry)

    // Evict old entries if cache is full
    this._evictIfNeeded()

    return videoElement
  }

  /**
   * Load a video and track its ready state
   */
  _loadVideo(cacheEntry) {
    if (cacheEntry.loading) return
    
    cacheEntry.loading = true
    const video = cacheEntry.videoElement

    const onCanPlay = () => {
      cacheEntry.ready = true
      cacheEntry.loading = false
      this._emitEvent('ready', { clipId: cacheEntry.clipId })
      video.removeEventListener('canplaythrough', onCanPlay)
      video.removeEventListener('error', onError)
    }

    const onError = (e) => {
      console.warn('Video load error:', cacheEntry.url, e)
      cacheEntry.loading = false
      video.removeEventListener('canplaythrough', onCanPlay)
      video.removeEventListener('error', onError)
    }

    video.addEventListener('canplaythrough', onCanPlay)
    video.addEventListener('error', onError)
    
    // Trigger load
    video.load()
  }

  _getEntry(clipId) {
    return this.cache.get(clipId) || this.cache.get(clipId + '|pb')
  }

  /**
   * Check if a clip's video is ready to play
   * @param {string} clipId - The clip ID
   * @returns {boolean} Whether the video is ready
   */
  isReady(clipId) {
    const cached = this._getEntry(clipId)
    return cached?.ready ?? false
  }

  /**
   * Get the ready state of multiple clips
   * @param {string[]} clipIds - Array of clip IDs
   * @returns {object} Map of clipId -> ready state
   */
  getReadyStates(clipIds) {
    const states = {}
    for (const clipId of clipIds) {
      states[clipId] = this.isReady(clipId)
    }
    return states
  }

  /**
   * Preload clips that will be needed soon
   * @param {object[]} clips - All clips on timeline
   * @param {number} currentTime - Current playhead position
   * @param {number} playbackRate - Current playback rate (for direction)
   */
  preloadUpcoming(clips, currentTime, playbackRate = 1) {
    if (!clips || clips.length === 0) return

    const isForward = playbackRate >= 0
    const lookaheadTime = currentTime + (isForward ? PRELOAD_LOOKAHEAD : -PRELOAD_LOOKAHEAD)
    
    // Find clips that start within the lookahead window
    const upcomingClips = clips.filter(clip => {
      if (isForward) {
        // Forward playback: preload clips that start soon
        return clip.startTime > currentTime && 
               clip.startTime <= lookaheadTime + clip.duration
      } else {
        // Reverse playback: preload clips we're approaching
        const clipEnd = clip.startTime + clip.duration
        return clipEnd < currentTime && 
               clipEnd >= lookaheadTime
      }
    })

    // Also include currently active clips (ensure they're loaded)
    const activeClips = clips.filter(clip => 
      currentTime >= clip.startTime && 
      currentTime < clip.startTime + clip.duration
    )

    // Combine and dedupe
    const clipsToPreload = [...new Map(
      [...activeClips, ...upcomingClips].map(c => [c.id, c])
    ).values()]

    // Preload each clip
    for (const clip of clipsToPreload) {
      this.getVideoElement(clip, true)
    }
  }

  /**
   * Sync a cached video element to the correct playback time
   * @param {string} clipId - The clip ID
   * @param {object} clip - The clip object
   * @param {number} timelineTime - Current timeline time
   * @param {boolean} isPlaying - Whether timeline is playing
   * @returns {HTMLVideoElement|null} The synced video element
   */
  syncVideo(clipId, clip, timelineTime, isPlaying) {
    const cached = this._getEntry(clipId)
    if (!cached || !cached.videoElement) return null

    const video = cached.videoElement
    cached.lastUsed = Date.now()

    // Calculate the time within the source video (fps-aware)
    const baseScale = clip.sourceTimeScale || (clip.timelineFps && clip.sourceFps
      ? clip.timelineFps / clip.sourceFps
      : 1)
    const speed = Number(clip.speed)
    const speedScale = Number.isFinite(speed) && speed > 0 ? speed : 1
    const timeScale = baseScale * speedScale
    const reverse = !!clip.reverse
    const trimStart = clip.trimStart || 0
    const rawTrimEnd = clip.trimEnd ?? clip.sourceDuration ?? trimStart
    const trimEnd = Number.isFinite(rawTrimEnd) ? rawTrimEnd : trimStart
    const sourceTime = reverse
      ? trimEnd - (timelineTime - clip.startTime) * timeScale
      : trimStart + (timelineTime - clip.startTime) * timeScale
    const timeDiff = Math.abs(video.currentTime - sourceTime)
    
    // Use different thresholds for playing vs paused
    if (isPlaying) {
      // When playing: Only seek on large drifts (0.15s) to avoid stuttering
      if (timeDiff > 0.15) {
        video.currentTime = sourceTime
      }
      // Start playing if needed
      if (video.paused && cached.ready) {
        video.play().catch(() => {})
      }
    } else {
      // When paused: Use tight threshold (0.02s) for precise scrubbing
      if (timeDiff > 0.02) {
        video.currentTime = sourceTime
      }
      // Ensure paused
      if (!video.paused) {
        video.pause()
      }
    }

    return video
  }

  /**
   * Mark a video element as active (being displayed)
   * @param {string} clipId - The clip ID
   * @param {boolean} unmute - Whether to unmute (for primary audio)
   */
  setActive(clipId, unmute = false) {
    this.activeElements.add(clipId)
    const cached = this._getEntry(clipId)
    if (cached?.videoElement) {
      cached.videoElement.muted = !unmute
    }
  }

  /**
   * Mark a video element as inactive
   * @param {string} clipId - The clip ID
   */
  setInactive(clipId) {
    this.activeElements.delete(clipId)
    const cached = this._getEntry(clipId)
    if (cached?.videoElement) {
      cached.videoElement.muted = true
      cached.videoElement.pause()
    }
  }

  /**
   * Pause all videos (when timeline stops)
   */
  pauseAll() {
    for (const [, cached] of this.cache) {
      if (cached.videoElement && !cached.videoElement.paused) {
        cached.videoElement.pause()
      }
    }
  }

  /**
   * Evict least recently used entries if cache is full
   */
  _evictIfNeeded() {
    if (this.cache.size <= MAX_CACHE_SIZE) return

    // Sort by lastUsed, oldest first; don't evict entries whose base clip is active
    const entries = [...this.cache.entries()]
      .filter(([, entry]) => !this.activeElements.has(entry.baseClipId))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)

    // Evict oldest entries until we're under the limit
    const toEvict = this.cache.size - MAX_CACHE_SIZE
    for (let i = 0; i < toEvict && i < entries.length; i++) {
      const [key, entry] = entries[i]
      
      // Clean up video element
      entry.videoElement.pause()
      entry.videoElement.src = ''
      entry.videoElement.load()
      
      this.cache.delete(key)
    }
  }

  /**
   * Clear the entire cache
   */
  clear() {
    for (const [, entry] of this.cache) {
      entry.videoElement.pause()
      entry.videoElement.src = ''
    }
    this.cache.clear()
    this.activeElements.clear()
  }

  /**
   * Get cache stats for debugging
   */
  getStats() {
    const ready = [...this.cache.values()].filter(e => e.ready).length
    return {
      total: this.cache.size,
      ready,
      active: this.activeElements.size,
      maxSize: MAX_CACHE_SIZE,
    }
  }

  /**
   * Add event listener
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event).add(callback)
  }

  /**
   * Remove event listener
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback)
    }
  }

  /**
   * Emit event
   */
  _emitEvent(event, data) {
    if (this.listeners.has(event)) {
      for (const callback of this.listeners.get(event)) {
        callback(data)
      }
    }
  }
}

// Singleton instance
const videoCache = new VideoCache()

export default videoCache
export { VideoCache, PRELOAD_LOOKAHEAD, PRELOAD_TRIGGER_TIME }
