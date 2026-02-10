import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Store for managing generated and imported assets
 * Persisted to localStorage for data survival across refreshes
 * 
 * Asset structure:
 * {
 *   id: string,
 *   name: string,
 *   type: 'video' | 'audio' | 'image' | 'mask',
 *   url: string (blob URL for playback),
 *   path: string (relative path in project for imported assets),
 *   createdAt: ISO string,
 *   imported: ISO string (for imported assets),
 *   isImported: boolean,
 *   settings: { duration, width, height, etc. },
 *   prompt: string (for AI-generated),
 *   mimeType: string,
 *   size: number,
 *   folderId: string | null (folder organization),
 *   
 *   // Mask-specific fields:
 *   sourceAssetId: string (for masks - the asset the mask was generated from),
 *   frameCount: number (for video masks - number of PNG frames),
 *   maskFrames: Array<{filename, url}> (for video masks - individual frame data),
 * }
 */
export const useAssetsStore = create(
  persist(
    (set, get) => ({
  // All assets (AI-generated + imported)
  assets: [],
  
  // Folders for organizing assets
  folders: [],
  
  // Currently selected asset for preview
  currentPreview: null,
  
  // Counter for auto-naming
  assetCounter: 1,
  folderCounter: 1,
  
  // Video playback state (shared between PreviewPanel and TransportControls)
  videoRef: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.75,
  
  // Register video element ref
  registerVideoRef: (ref) => {
    set({ videoRef: ref })
  },
  
  // Playback controls
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (dur) => set({ duration: dur }),
  setVolume: (vol) => {
    const ref = get().videoRef
    if (ref) {
      ref.volume = vol
    }
    set({ volume: vol })
  },
  
  togglePlay: () => {
    const { videoRef, isPlaying, currentPreview } = get()
    if (videoRef) {
      if (isPlaying) {
        videoRef.pause()
      } else {
        videoRef.play()
      }
    } else if (currentPreview?.type === 'mask') {
      // For masks (no videoRef), just toggle the isPlaying state
      // The MaskPreview component will handle the actual playback
      set({ isPlaying: !isPlaying })
    }
  },
  
  seekTo: (time) => {
    const { videoRef, duration } = get()
    const clampedTime = Math.max(0, Math.min(duration, time))
    if (videoRef) {
      videoRef.currentTime = clampedTime
    }
    // Always update currentTime state (needed for masks and other non-video assets)
    set({ currentTime: clampedTime })
  },
  
  skip: (seconds) => {
    const { videoRef, currentTime, duration } = get()
    if (videoRef) {
      const newTime = Math.max(0, Math.min(duration, currentTime + seconds))
      videoRef.currentTime = newTime
      set({ currentTime: newTime })
    }
  },
  
  /**
   * Generate a name from prompt text
   */
  generateName: (prompt) => {
    const counter = get().assetCounter
    // Take first few words, clean up, limit length
    const words = prompt
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .slice(0, 4)
      .join('_')
      .substring(0, 30)
    
    set({ assetCounter: counter + 1 })
    return `${words}_${String(counter).padStart(3, '0')}`
  },
  
  /**
   * Add a new generated asset
   */
  addAsset: (asset) => {
    const newAsset = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      ...asset
    }
    
    set((state) => ({
      assets: [newAsset, ...state.assets],
      currentPreview: newAsset // Auto-preview new assets
    }))
    
    return newAsset
  },
  
  /**
   * Set the current preview
   * Also resets playback state for the new asset
   */
  setPreview: (asset) => {
    set({ 
      currentPreview: asset, 
      previewMode: 'asset',
      isPlaying: false,  // Don't auto-play, let user control
      currentTime: 0,    // Reset to start
    })
  },
  
  /**
   * Preview mode: 'asset' (single asset preview) or 'timeline' (playing timeline)
   */
  previewMode: 'asset',
  
  /**
   * Set the preview mode explicitly
   */
  setPreviewMode: (mode) => {
    set({ previewMode: mode })
  },
  
  /**
   * Clear the current preview
   */
  clearPreview: () => {
    set({ currentPreview: null })
  },
  
  /**
   * Remove an asset
   */
  removeAsset: (id) => {
    set((state) => ({
      assets: state.assets.filter(a => a.id !== id),
      currentPreview: state.currentPreview?.id === id ? null : state.currentPreview
    }))
  },
  
  /**
   * Rename an asset
   */
  renameAsset: (id, newName) => {
    set((state) => ({
      assets: state.assets.map(a => 
        a.id === id ? { ...a, name: newName } : a
      ),
      currentPreview: state.currentPreview?.id === id 
        ? { ...state.currentPreview, name: newName }
        : state.currentPreview
    }))
  },

  /**
   * Enable/disable audio for a video asset
   */
  setAssetAudioEnabled: (id, enabled) => {
    set((state) => ({
      assets: state.assets.map(a =>
        a.id === id ? { ...a, audioEnabled: enabled } : a
      ),
      currentPreview: state.currentPreview?.id === id
        ? { ...state.currentPreview, audioEnabled: enabled }
        : state.currentPreview
    }))
  },

  /**
   * Move an asset to a folder
   * @param {string} assetId - The asset ID
   * @param {string|null} folderId - The folder ID (null = root)
   */
  moveAssetToFolder: (assetId, folderId) => {
    set((state) => ({
      assets: state.assets.map(a =>
        a.id === assetId ? { ...a, folderId } : a
      ),
      currentPreview: state.currentPreview?.id === assetId
        ? { ...state.currentPreview, folderId }
        : state.currentPreview
    }))
  },

  /**
   * Move multiple assets to a folder
   * @param {string[]} assetIds - Asset IDs to move
   * @param {string|null} folderId - The folder ID (null = root)
   */
  moveAssetsToFolder: (assetIds, folderId) => {
    if (!assetIds?.length) return
    const idSet = new Set(assetIds)
    set((state) => ({
      assets: state.assets.map(a =>
        idSet.has(a.id) ? { ...a, folderId } : a
      ),
      currentPreview: state.currentPreview && idSet.has(state.currentPreview.id)
        ? { ...state.currentPreview, folderId }
        : state.currentPreview
    }))
  },

  /**
   * Add a new folder
   * @param {object} folder - Folder data { name, parentId }
   */
  addFolder: (folder) => {
    const state = get()
    const newFolder = {
      id: `folder-${state.folderCounter}`,
      name: folder.name,
      parentId: folder.parentId || null,
      createdAt: new Date().toISOString()
    }
    set((state) => ({
      folders: [...state.folders, newFolder],
      folderCounter: state.folderCounter + 1
    }))
    return newFolder
  },

  /**
   * Remove a folder (moves contained assets to parent folder)
   * @param {string} folderId - The folder ID to remove
   */
  removeFolder: (folderId) => {
    const state = get()
    const folder = state.folders.find(f => f.id === folderId)
    if (!folder) return

    // Move all assets in this folder to the parent folder
    const updatedAssets = state.assets.map(a =>
      a.folderId === folderId ? { ...a, folderId: folder.parentId } : a
    )

    // Move all subfolders to the parent folder
    const updatedFolders = state.folders
      .filter(f => f.id !== folderId)
      .map(f => f.parentId === folderId ? { ...f, parentId: folder.parentId } : f)

    set({
      assets: updatedAssets,
      folders: updatedFolders
    })
  },

  /**
   * Rename a folder
   * @param {string} folderId - The folder ID
   * @param {string} newName - The new name
   */
  renameFolder: (folderId, newName) => {
    set((state) => ({
      folders: state.folders.map(f =>
        f.id === folderId ? { ...f, name: newName } : f
      )
    }))
  },

  /**
   * Clear all assets (for "New Project")
   */
  clearProject: () => {
    // Revoke any blob URLs before clearing
    const state = get()
    state.assets.forEach(asset => {
      if (asset.url && asset.url.startsWith('blob:')) {
        URL.revokeObjectURL(asset.url)
      }
    })
    
    set({
      assets: [],
      folders: [],
      currentPreview: null,
      assetCounter: 1,
      folderCounter: 1,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
    })
  },

  /**
   * Load assets from project data
   * @param {Array} projectAssets - Assets from project file
   * @param {FileSystemDirectoryHandle|string} projectHandle - The project directory handle for regenerating URLs
   * @param {Array} [projectFolders] - Folders from project file (optional; if omitted, folders are cleared)
   * @param {number} [projectFolderCounter] - Folder counter from project file (optional)
   */
  loadFromProject: async (projectAssets, projectHandle, projectFolders, projectFolderCounter) => {
    // Clear existing assets first
    get().clearProject()
    
    // Load assets - URLs need to be regenerated for imported assets
    const assetsWithUrls = []
    
    for (const asset of (projectAssets || [])) {
      const needsUrlRefresh = asset?.url?.startsWith?.('blob:')
      const hasPath = !!asset?.path
      const hasAbsolutePath = !!asset?.absolutePath

      if ((asset.isImported || needsUrlRefresh || hasPath || hasAbsolutePath) && projectHandle) {
        // For imported assets (or stale blob URLs), regenerate URL from file
        try {
          const { getProjectFileUrl, getAbsoluteFileUrl, isElectron } = await import('../services/fileSystem')
          let url = null
          if (isElectron() && hasAbsolutePath) {
            url = await getAbsoluteFileUrl(asset.absolutePath)
          } else if (hasPath) {
            url = await getProjectFileUrl(projectHandle, asset.path)
          }
          // Regenerate playback cache URL if we have a cached transcode
          let playbackCacheUrl = null
          if (asset.playbackCachePath) {
            try {
              playbackCacheUrl = await getProjectFileUrl(projectHandle, asset.playbackCachePath)
            } catch (e) {
              console.warn(`Could not load playback cache for ${asset.name}:`, e)
            }
          }
          assetsWithUrls.push({ ...asset, url, playbackCacheUrl: playbackCacheUrl ?? undefined })
        } catch (err) {
          console.warn(`Could not load asset ${asset.name}:`, err)
          // Keep asset but mark URL as null
          assetsWithUrls.push({ ...asset, url: null })
        }
      } else {
        // For AI/external assets, keep the URL as-is (may need ComfyUI to be running)
        assetsWithUrls.push(asset)
      }
    }
    
    const nextState = {
      assets: assetsWithUrls,
      assetCounter: (projectAssets?.length || 0) + 1,
    }
    // Restore folder structure from project file so folders persist across sessions
    if (Array.isArray(projectFolders)) {
      nextState.folders = projectFolders
    }
    if (typeof projectFolderCounter === 'number' && projectFolderCounter >= 0) {
      nextState.folderCounter = projectFolderCounter
    }
    set(nextState)
  },

  /**
   * Get assets data for saving to project
   * Returns assets without blob URLs (paths only for imported)
   */
  getProjectData: () => {
    const state = get()
    return state.assets.map(asset => ({
      ...asset,
      // Don't save blob URLs - they're session-specific
      url: asset.isImported ? null : asset.url, // Keep URL for AI assets (they're external)
      playbackCacheUrl: undefined, // Session-only; path is persisted
    }))
  },

  /**
   * Update asset URL (for when loading from project and regenerating blob URLs)
   */
  updateAssetUrl: (assetId, url) => {
    set((state) => ({
      assets: state.assets.map(a => 
        a.id === assetId ? { ...a, url } : a
      ),
      currentPreview: state.currentPreview?.id === assetId 
        ? { ...state.currentPreview, url }
        : state.currentPreview
    }))
  },

  /**
   * Update asset's sprite data
   * @param {string} assetId - The asset ID
   * @param {object} spriteData - Sprite metadata { spriteUrl, spritePath, ... }
   */
  updateAssetSprite: (assetId, spriteData) => {
    set((state) => ({
      assets: state.assets.map(a => 
        a.id === assetId ? { ...a, sprite: spriteData } : a
      ),
      currentPreview: state.currentPreview?.id === assetId 
        ? { ...state.currentPreview, sprite: spriteData }
        : state.currentPreview
    }))
  },

  /**
   * Get sprite data for an asset
   * @param {string} assetId - The asset ID
   * @returns {object|null} - Sprite data or null
   */
  getAssetSprite: (assetId) => {
    const asset = get().assets.find(a => a.id === assetId)
    return asset?.sprite || null
  },

  /**
   * Generate thumbnail sprite for a video asset
   * @param {string} assetId - The asset ID
   * @param {string} projectPath - Project directory path (for saving)
   */
  generateAssetSprite: async (assetId, projectPath) => {
    const asset = get().assets.find(a => a.id === assetId)
    if (!asset || asset.type !== 'video' || !asset.url) {
      console.warn('Cannot generate sprite: invalid asset or not a video')
      return null
    }

    // Mark as generating
    set((state) => ({
      assets: state.assets.map(a => 
        a.id === assetId ? { ...a, spriteGenerating: true } : a
      )
    }))

    try {
      const { generateThumbnailSprite, saveSpriteToProject } = await import('../services/thumbnailSprites')
      
      // Generate sprite
      const result = await generateThumbnailSprite(asset.url, asset.duration || 5)
      if (!result) {
        throw new Error('Failed to generate sprite')
      }

      let spriteData = result.spriteData

      // Save to project if we have a project path
      if (projectPath) {
        const saved = await saveSpriteToProject(projectPath, assetId, result.blob, result.spriteData)
        spriteData = {
          ...spriteData,
          spritePath: saved.spritePath,
          url: result.spriteUrl, // Keep blob URL for immediate use
        }
      }

      // Update asset with sprite data
      get().updateAssetSprite(assetId, spriteData)
      
      // Clear generating flag
      set((state) => ({
        assets: state.assets.map(a => 
          a.id === assetId ? { ...a, spriteGenerating: false } : a
        )
      }))

      console.log(`Generated sprite for ${asset.name}: ${spriteData.frameCount} frames`)
      return spriteData
    } catch (err) {
      console.error('Failed to generate sprite:', err)
      
      // Clear generating flag
      set((state) => ({
        assets: state.assets.map(a => 
          a.id === assetId ? { ...a, spriteGenerating: false } : a
        )
      }))
      
      return null
    }
  },

  /**
   * Load sprites for all video assets from project
   * @param {string} projectPath - Project directory path
   */
  loadSpritesFromProject: async (projectPath) => {
    if (!projectPath) return

    const { loadSpriteFromProject } = await import('../services/thumbnailSprites')
    const state = get()
    
    const videoAssets = state.assets.filter(a => a.type === 'video')
    
    for (const asset of videoAssets) {
      try {
        const sprite = await loadSpriteFromProject(projectPath, asset.id)
        if (sprite) {
          get().updateAssetSprite(asset.id, sprite.spriteData)
          console.log(`Loaded sprite for ${asset.name}`)
        }
      } catch (err) {
        // Sprite might not exist yet, that's OK
      }
    }
  },

  /**
   * Get asset by ID
   * @param {string} assetId - The asset ID to find
   * @returns {Object|null} - The asset or null if not found
   */
  getAssetById: (assetId) => {
    return get().assets.find(a => a.id === assetId) || null
  },

  /**
   * Get the current valid URL for an asset (prefers playback cache when ready for smooth timeline playback)
   * @param {string} assetId - The asset ID
   * @returns {string|null} - The current URL or null
   */
  getAssetUrl: (assetId) => {
    const asset = get().assets.find(a => a.id === assetId)
    if (!asset) return null
    // Use playback cache URL when available (Flame-style: optimized for playback)
    const useCache = !!asset.playbackCacheUrl
    const url = useCache ? asset.playbackCacheUrl : (asset.url || null)
    if (typeof localStorage !== 'undefined' && localStorage.getItem('storyflow-debug-playback') === '1' && asset.type === 'video') {
      console.log('[PlaybackCache] getAssetUrl:', { assetId, useCache, urlHint: url ? (url.startsWith('file:') ? 'file:// (cache or original)' : url.slice(0, 50) + '...') : 'null' })
    }
    return url
  },

  /**
   * Set playback cache path and URL for an asset (after transcode completes)
   */
  setPlaybackCache: (assetId, playbackCachePath, playbackCacheUrl) => {
    set((state) => ({
      assets: state.assets.map(a =>
        a.id === assetId ? { ...a, playbackCachePath, playbackCacheUrl } : a
      ),
      currentPreview: state.currentPreview?.id === assetId
        ? { ...state.currentPreview, playbackCachePath, playbackCacheUrl }
        : state.currentPreview,
    }))
  },

  /**
   * Set playback cache status for UI (encoding | ready | failed)
   */
  setPlaybackCacheStatus: (assetId, status) => {
    set((state) => ({
      assets: state.assets.map(a =>
        a.id === assetId ? { ...a, playbackCacheStatus: status } : a
      ),
      currentPreview: state.currentPreview?.id === assetId
        ? { ...state.currentPreview, playbackCacheStatus: status }
        : state.currentPreview,
    }))
  },

  /**
   * Regenerate URLs for all imported assets that have null URLs
   * Called when project handle becomes available
   * @param {FileSystemDirectoryHandle} projectHandle - The project directory handle
   */
  regenerateImportedUrls: async (projectHandle) => {
    if (!projectHandle) return
    
    const state = get()
    const assetsNeedingUrls = state.assets.filter(a => a.isImported && a.path && !a.url)
    
    if (assetsNeedingUrls.length === 0) return
    
    console.log(`Regenerating URLs for ${assetsNeedingUrls.length} imported assets...`)
    
    for (const asset of assetsNeedingUrls) {
      try {
        const { getProjectFileUrl } = await import('../services/fileSystem')
        const url = await getProjectFileUrl(projectHandle, asset.path)
        get().updateAssetUrl(asset.id, url)
        console.log(`Regenerated URL for ${asset.name}`)
      } catch (err) {
        console.warn(`Could not regenerate URL for ${asset.name}:`, err)
      }
    }
  },

  /**
   * Get all mask assets for a specific source asset
   * @param {string} sourceAssetId - The source asset ID
   * @returns {Array} - Array of mask assets
   */
  getMasksForAsset: (sourceAssetId) => {
    return get().assets.filter(a => a.type === 'mask' && a.sourceAssetId === sourceAssetId)
  },

  /**
   * Get all mask assets in the project
   * @returns {Array} - Array of all mask assets
   */
  getAllMasks: () => {
    return get().assets.filter(a => a.type === 'mask')
  },

  /**
   * Add a mask asset with proper structure
   * @param {Object} maskData - Mask asset data
   * @returns {Object} - The created mask asset
   */
  addMaskAsset: (maskData) => {
    console.log('addMaskAsset called with:', maskData)
    
    const state = get()
    const counter = state.assetCounter
    
    const newMask = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      type: 'mask',
      name: maskData.name || `Mask_${String(counter).padStart(3, '0')}`,
      sourceAssetId: maskData.sourceAssetId,
      prompt: maskData.prompt,
      url: maskData.url,                    // For single image masks
      maskFrames: maskData.maskFrames || [], // For video masks (PNG sequence)
      frameCount: maskData.frameCount || 1,
      settings: maskData.settings || {},
      path: maskData.path,
      mimeType: maskData.mimeType || 'image/png',
      folderId: maskData.folderId || null,
      isImported: false, // Masks are always AI-generated
    }
    
    console.log('Creating mask asset:', newMask)
    
    set((state) => ({
      assets: [newMask, ...state.assets],
      assetCounter: state.assetCounter + 1,
      currentPreview: newMask
    }))
    
    console.log('Mask asset added to store')
    
    return newMask
  }
    }),
    {
      name: 'storyflow-assets', // localStorage key
      partialize: (state) => ({
        // Only persist these fields (exclude transient playback state)
        assets: state.assets,
        folders: state.folders,
        assetCounter: state.assetCounter,
        folderCounter: state.folderCounter,
        volume: state.volume,
        // Don't persist previewMode - always start fresh
      }),
    }
  )
)

export default useAssetsStore
