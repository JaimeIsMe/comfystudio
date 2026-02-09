/**
 * Render Cache Service
 * 
 * Renders clips with effects (like masks) to a cached video file for smooth playback.
 * Uses Canvas API for compositing and MediaRecorder for encoding.
 * 
 * Flow:
 * 1. Extract video frames to canvas
 * 2. Apply mask as compositing operation
 * 3. Encode result using MediaRecorder
 * 4. Store as blob URL for playback
 */

class RenderCacheService {
  constructor() {
    // Map of clipId -> { blobUrl, timestamp, hash }
    this.cache = new Map()
    
    // Currently rendering clips
    this.rendering = new Map() // clipId -> { progress, cancel }
    
    // Event listeners for progress updates
    this.listeners = new Map()
  }

  /**
   * Generate a hash for cache invalidation
   * Changes to clip or effect properties should invalidate the cache
   */
  generateCacheHash(clip, effects, maskAssets) {
    const data = {
      clipId: clip.id,
      url: clip.url,
      assetId: clip.assetId,
      trimStart: clip.trimStart,
      duration: clip.duration,
      effects: effects.map(e => ({
        id: e.id,
        type: e.type,
        enabled: e.enabled,
        maskAssetId: e.maskAssetId,
        invertMask: e.invertMask,
      })),
      maskUrls: maskAssets.map(m => ({
        id: m.id,
        url: m.url,
        frameCount: m.frameCount,
      })),
    }
    // Simple hash - in production you'd use a proper hash function
    return JSON.stringify(data)
  }

  /**
   * Check if a clip has a valid cache
   */
  hasValidCache(clip, effects, maskAssets) {
    const cached = this.cache.get(clip.id)
    if (!cached) return false
    
    const currentHash = this.generateCacheHash(clip, effects, maskAssets)
    return cached.hash === currentHash
  }

  /**
   * Get cached video URL if available
   */
  getCachedUrl(clipId) {
    const cached = this.cache.get(clipId)
    return cached?.blobUrl || null
  }

  /**
   * Check if a clip is currently rendering
   */
  isRendering(clipId) {
    return this.rendering.has(clipId)
  }

  /**
   * Get render progress (0-100)
   */
  getRenderProgress(clipId) {
    return this.rendering.get(clipId)?.progress || 0
  }

  /**
   * Cancel an in-progress render
   */
  cancelRender(clipId) {
    const render = this.rendering.get(clipId)
    if (render) {
      render.cancelled = true
      this.rendering.delete(clipId)
      this.notifyListeners(clipId, { status: 'cancelled' })
    }
  }

  /**
   * Clear cache for a clip
   */
  clearCache(clipId) {
    const cached = this.cache.get(clipId)
    if (cached?.blobUrl) {
      URL.revokeObjectURL(cached.blobUrl)
    }
    this.cache.delete(clipId)
  }

  /**
   * Clear all caches
   */
  clearAllCaches() {
    for (const [clipId, cached] of this.cache) {
      if (cached.blobUrl) {
        URL.revokeObjectURL(cached.blobUrl)
      }
    }
    this.cache.clear()
  }

  /**
   * Add a progress listener
   */
  addListener(clipId, callback) {
    if (!this.listeners.has(clipId)) {
      this.listeners.set(clipId, new Set())
    }
    this.listeners.get(clipId).add(callback)
    
    return () => {
      this.listeners.get(clipId)?.delete(callback)
    }
  }

  /**
   * Notify listeners of progress/status changes
   */
  notifyListeners(clipId, data) {
    const listeners = this.listeners.get(clipId)
    if (listeners) {
      for (const callback of listeners) {
        callback(data)
      }
    }
  }

  /**
   * Load an image and return it as an HTMLImageElement
   */
  async loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = url
    })
  }

  /**
   * Preload all mask frames
   */
  async preloadMaskFrames(maskAsset) {
    const frames = []
    
    if (maskAsset.maskFrames && maskAsset.maskFrames.length > 0) {
      // Multi-frame mask (video mask)
      for (const frame of maskAsset.maskFrames) {
        try {
          const img = await this.loadImage(frame.url)
          frames.push(img)
        } catch (err) {
          console.warn('Failed to load mask frame:', frame.url, err)
          frames.push(null)
        }
      }
    } else if (maskAsset.url) {
      // Single frame mask
      try {
        const img = await this.loadImage(maskAsset.url)
        frames.push(img)
      } catch (err) {
        console.warn('Failed to load mask:', maskAsset.url, err)
      }
    }
    
    return frames
  }

  /**
   * Render a clip with its effects to a cached video
   * 
   * @param {object} clip - The clip to render
   * @param {string} videoUrl - URL of the source video
   * @param {array} effects - Array of enabled effects
   * @param {function} getAssetById - Function to get mask assets
   * @param {object} options - Render options
   * @returns {Promise<string>} - Blob URL of the rendered video
   */
  async renderClipWithEffects(clip, videoUrl, effects, getAssetById, options = {}) {
    const {
      fps = 30,
      quality = 0.9,
      onProgress = () => {},
    } = options

    // Check if already rendering
    if (this.rendering.has(clip.id)) {
      throw new Error('Clip is already being rendered')
    }

    // Get mask effects and their assets
    const maskEffects = effects.filter(e => e.type === 'mask' && e.enabled)
    if (maskEffects.length === 0) {
      throw new Error('No mask effects to render')
    }

    // Get the first mask effect (we only support one for now)
    const maskEffect = maskEffects[0]
    const maskAsset = getAssetById(maskEffect.maskAssetId)
    
    if (!maskAsset) {
      throw new Error('Mask asset not found')
    }

    // Set up render state
    const renderState = { progress: 0, cancelled: false }
    this.rendering.set(clip.id, renderState)

    try {
      // Notify start
      this.notifyListeners(clip.id, { status: 'loading', progress: 0 })
      onProgress({ status: 'loading', progress: 0 })

      // Load the source video
      const video = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.muted = true
      video.playsInline = true
      
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve
        video.onerror = reject
        video.src = videoUrl
      })

      // Preload all mask frames
      this.notifyListeners(clip.id, { status: 'loading_masks', progress: 5 })
      onProgress({ status: 'loading_masks', progress: 5 })
      
      const maskFrames = await this.preloadMaskFrames(maskAsset)
      
      if (maskFrames.length === 0) {
        throw new Error('Failed to load mask frames')
      }

      // Set up canvas with alpha support
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d', { alpha: true })
      
      // Pre-create mask canvas (reuse for performance)
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = canvas.width
      maskCanvas.height = canvas.height
      const maskCtx = maskCanvas.getContext('2d')

      // Calculate frame timing - use source video's frame rate if available
      const clipDuration = clip.duration
      const sourceFrameRate = fps // Timeline FPS
      const totalFrames = Math.ceil(clipDuration * sourceFrameRate)
      const frameInterval = 1 / sourceFrameRate
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

      // Notify rendering start
      this.notifyListeners(clip.id, { status: 'rendering', progress: 10 })
      onProgress({ status: 'rendering', progress: 10 })

      // PHASE 1: Render all frames to ImageData array first
      const renderedFrames = []
      
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        // Check if cancelled
        if (renderState.cancelled) {
          throw new Error('Render cancelled')
        }

        // Calculate time in source video
        const clipTime = frameIndex * frameInterval
        const sourceTime = reverse
          ? trimEnd - clipTime * timeScale
          : trimStart + clipTime * timeScale

        // Seek video to frame
        video.currentTime = sourceTime
        await new Promise(resolve => {
          video.onseeked = resolve
        })

        // Wait for video frame to be fully decoded
        while (video.readyState < 2) {
          await new Promise(resolve => setTimeout(resolve, 5))
        }

        // Clear canvas to fully transparent
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        // Draw video frame
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        // Apply mask (align to source time so trims stay in sync)
        const sourceDuration = clip.sourceDuration || clip.trimEnd || (clipDuration * timeScale)
        const sourceProgress = sourceDuration > 0
          ? Math.max(0, Math.min(1, sourceTime / sourceDuration))
          : 0
        const maskFrameIndex = Math.min(
          Math.max(0, Math.floor(sourceProgress * maskFrames.length)),
          maskFrames.length - 1
        )
        const maskImage = maskFrames[maskFrameIndex]

        if (maskImage) {
          // Draw the mask to reusable canvas
          maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
          maskCtx.drawImage(maskImage, 0, 0, canvas.width, canvas.height)
          
          // Get the mask pixel data
          const maskData = maskCtx.getImageData(0, 0, canvas.width, canvas.height)
          const maskPixels = maskData.data
          
          // Get the video frame pixel data
          const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const framePixels = frameData.data
          
          // Apply the mask: use mask luminance as alpha channel
          for (let i = 0; i < framePixels.length; i += 4) {
            const maskLuminance = (maskPixels[i] + maskPixels[i + 1] + maskPixels[i + 2]) / 3
            let alpha = maskEffect.invertMask ? (255 - maskLuminance) : maskLuminance
            framePixels[i + 3] = Math.round(alpha)
          }
          
          // Store the frame data
          renderedFrames.push(frameData)
        } else {
          // No mask, store original frame
          renderedFrames.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
        }

        // Update progress (10% for loading, 40% for frame extraction)
        const progress = 10 + Math.floor((frameIndex / totalFrames) * 40)
        renderState.progress = progress
        
        if (frameIndex % 5 === 0) {
          this.notifyListeners(clip.id, { status: 'rendering', progress, frame: frameIndex, totalFrames })
          onProgress({ status: 'rendering', progress, frame: frameIndex, totalFrames })
        }
      }

      // PHASE 2: Encode frames with precise timing using MediaRecorder
      this.notifyListeners(clip.id, { status: 'encoding', progress: 50 })
      onProgress({ status: 'encoding', progress: 50 })

      // Set up MediaRecorder with manual frame capture (0 fps = manual)
      const stream = canvas.captureStream(0)
      const videoTrack = stream.getVideoTracks()[0]
      
      let mimeType = 'video/webm;codecs=vp9'
      if (MediaRecorder.isTypeSupported('video/webm;codecs=vp09.00.10.08')) {
        mimeType = 'video/webm;codecs=vp09.00.10.08'
      }
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 10000000,
      })

      const chunks = []
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data)
        }
      }

      // Start recording
      mediaRecorder.start()
      
      // Give MediaRecorder time to initialize
      await new Promise(resolve => setTimeout(resolve, 100))

      // Play back frames using requestAnimationFrame for precise timing
      const frameDurationMs = 1000 / sourceFrameRate
      const totalDurationMs = renderedFrames.length * frameDurationMs
      
      await new Promise((resolve, reject) => {
        let frameIndex = 0
        const startTime = performance.now()
        
        const renderNextFrame = () => {
          if (renderState.cancelled) {
            reject(new Error('Render cancelled'))
            return
          }
          
          const elapsed = performance.now() - startTime
          const targetFrame = Math.floor(elapsed / frameDurationMs)
          
          // Render all frames up to the target (in case we skipped any)
          while (frameIndex <= targetFrame && frameIndex < renderedFrames.length) {
            ctx.putImageData(renderedFrames[frameIndex], 0, 0)
            
            // Request frame capture
            if (videoTrack.requestFrame) {
              videoTrack.requestFrame()
            }
            
            frameIndex++
          }
          
          // Update progress
          const progress = 50 + Math.floor((frameIndex / renderedFrames.length) * 45)
          if (frameIndex % 10 === 0) {
            this.notifyListeners(clip.id, { status: 'encoding', progress })
            onProgress({ status: 'encoding', progress })
          }
          
          // Continue until all frames are rendered
          if (frameIndex < renderedFrames.length) {
            requestAnimationFrame(renderNextFrame)
          } else {
            // Add a small buffer at the end to ensure last frame is captured
            setTimeout(resolve, 100)
          }
        }
        
        requestAnimationFrame(renderNextFrame)
      })

      // Stop recording
      mediaRecorder.stop()

      // Wait for final data
      await new Promise(resolve => {
        mediaRecorder.onstop = resolve
      })

      // Notify encoding
      this.notifyListeners(clip.id, { status: 'encoding', progress: 95 })
      onProgress({ status: 'encoding', progress: 95 })

      // Create blob from chunks
      const blob = new Blob(chunks, { type: 'video/webm' })
      const blobUrl = URL.createObjectURL(blob)

      // Store in cache
      const hash = this.generateCacheHash(clip, effects, [maskAsset])
      
      // Clear old cache if exists
      this.clearCache(clip.id)
      
      // Store new cache
      this.cache.set(clip.id, {
        blobUrl,
        blob, // Keep reference to blob for saving to disk
        timestamp: Date.now(),
        hash,
        width: canvas.width,
        height: canvas.height,
        duration: clipDuration,
      })

      // Clean up
      this.rendering.delete(clip.id)
      video.src = ''

      // Notify complete
      this.notifyListeners(clip.id, { status: 'complete', progress: 100, blobUrl, blob })
      onProgress({ status: 'complete', progress: 100, blobUrl, blob })

      // Return both blob and blobUrl for disk saving
      return { blobUrl, blob }

    } catch (err) {
      // Clean up on error
      this.rendering.delete(clip.id)
      this.notifyListeners(clip.id, { status: 'error', error: err.message })
      onProgress({ status: 'error', error: err.message })
      throw err
    }
  }
}

// Singleton instance
const renderCacheService = new RenderCacheService()

export default renderCacheService
export { RenderCacheService }
