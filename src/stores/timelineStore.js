import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { TRANSITION_DEFAULT_SETTINGS } from '../constants/transitions'

// Maximum number of undo states to keep
const MAX_HISTORY_SIZE = 50

const getClipTimeScale = (clip) => {
  if (!clip) return 1
  const baseScale = clip.sourceTimeScale
    || (clip.timelineFps && clip.sourceFps ? clip.timelineFps / clip.sourceFps : 1)
  const speed = Number(clip.speed)
  const speedScale = Number.isFinite(speed) && speed > 0 ? speed : 1
  return baseScale * speedScale
}

const timelineToSourceTime = (clip, timelineSeconds) => {
  return timelineSeconds * getClipTimeScale(clip)
}

const sourceToTimelineTime = (clip, sourceSeconds) => {
  return sourceSeconds / getClipTimeScale(clip)
}

const getClipTrimEnd = (clip) => {
  if (!clip) return 0
  if (clip.trimEnd !== undefined && clip.trimEnd !== null) return clip.trimEnd
  if (clip.sourceDuration !== undefined && clip.sourceDuration !== null) return clip.sourceDuration
  return (clip.trimStart || 0) + timelineToSourceTime(clip, clip.duration || 0)
}

const normalizeClipTimebases = (clips, assets, timelineFps) => {
  if (!clips || clips.length === 0) return clips || []

  const assetsById = new Map((assets || []).map(asset => [asset.id, asset]))

  return clips.map((clip) => {
    if (!clip || clip.type !== 'video') return clip

    const asset = assetsById.get(clip.assetId)
    const sourceDuration = clip.sourceDuration
      || asset?.settings?.duration
      || asset?.duration
      || clip.duration
    const trimStart = clip.trimStart || 0
    const trimEnd = clip.trimEnd ?? sourceDuration
    const sourceSpan = Math.max(0, Math.min(sourceDuration, trimEnd) - trimStart)
    const sourceFps = Number(asset?.settings?.fps ?? asset?.fps)
    const normalizedTimelineFps = Number(timelineFps)

    const normalizedSpeed = Number.isFinite(Number(clip.speed)) && Number(clip.speed) > 0 ? Number(clip.speed) : 1
    const normalizedReverse = Boolean(clip.reverse)

    return {
      ...clip,
      sourceDuration,
      trimStart,
      trimEnd: Math.min(trimEnd, sourceDuration),
      duration: sourceSpan,
      sourceFps: Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : clip.sourceFps ?? null,
      timelineFps: Number.isFinite(normalizedTimelineFps) && normalizedTimelineFps > 0 ? normalizedTimelineFps : clip.timelineFps ?? null,
      sourceTimeScale: 1,
      speed: normalizedSpeed,
      reverse: normalizedReverse,
    }
  })
}

/**
 * Store for managing timeline state
 * Persisted to localStorage for data survival across refreshes
 */
export const useTimelineStore = create(
  persist(
    (set, get) => ({
  // Timeline settings
  duration: 60, // Total timeline duration in seconds
  zoom: 100, // Zoom level (100 = 1 second = ~20px)
  playheadPosition: 0, // Current playhead position in seconds
  isPlaying: false,
  
  // JKL Shuttle playback
  playbackRate: 1, // Playback speed multiplier (negative = reverse)
  shuttleMode: false, // Whether in JKL shuttle mode
  
  // Playback loop modes: 'normal', 'loop', 'loop-in-out', 'ping-pong'
  loopMode: 'normal',
  
  // Tracks
  tracks: [
    { id: 'video-1', name: 'Video 1', type: 'video', muted: false, locked: false, visible: true },
    { id: 'video-2', name: 'Video 2', type: 'video', muted: false, locked: false, visible: true },
    { id: 'audio-1', name: 'Audio 1', type: 'audio', channels: 'stereo', muted: false, locked: false, visible: true },
    { id: 'audio-2', name: 'Audio 2', type: 'audio', channels: 'stereo', muted: false, locked: false, visible: true },
    { id: 'audio-3', name: 'Audio 3', type: 'audio', channels: 'stereo', muted: false, locked: false, visible: true },
  ],
  
  // Clips on timeline
  clips: [],
  
  // Transitions between clips
  // Types: 'dissolve', 'fade-black', 'fade-white', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down',
  //        'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom-in', 'zoom-out', 'blur'
  transitions: [],
  
  // Selected clips (multi-select support)
  selectedClipIds: [], // Array of selected clip IDs

  // Active track for cut-at-playhead (X): only this track is cut when pressing X
  activeTrackId: null,

  // UI request: open Inspector (optionally mask picker) for a clip
  maskPickerRequest: null, // { clipId, openPicker }
  
  // Clip counter for unique IDs
  clipCounter: 1,
  
  // Transition counter for unique IDs
  transitionCounter: 1,
  
  // Snapping settings
  snappingEnabled: true,
  snappingThreshold: 10, // pixels - distance at which snapping activates
  
  // Active snap indicator (for visual feedback)
  activeSnapTime: null, // Time position being snapped to (null = no active snap)
  
  // Ripple edit mode - when enabled, moving/trimming clips shifts subsequent clips
  rippleEditMode: false,
  
  // In/Out points for three-point editing
  inPoint: null, // Timeline in-point (seconds)
  outPoint: null, // Timeline out-point (seconds)
  
  // Undo/Redo history
  history: [], // Array of past states
  historyIndex: -1, // Current position in history (-1 means at present state)
  
  /**
   * Save current state to history (call before making changes)
   */
  saveToHistory: () => {
    const state = get()
    const snapshot = {
      clips: JSON.parse(JSON.stringify(state.clips)),
      tracks: JSON.parse(JSON.stringify(state.tracks)),
      transitions: JSON.parse(JSON.stringify(state.transitions)),
      clipCounter: state.clipCounter,
      transitionCounter: state.transitionCounter,
    }
    
    set((state) => {
      // If we're not at the end of history, truncate the "future" states
      let newHistory = state.historyIndex >= 0 
        ? state.history.slice(0, state.historyIndex + 1)
        : [...state.history]
      
      // Add current state to history
      newHistory.push(snapshot)
      
      // Limit history size
      if (newHistory.length > MAX_HISTORY_SIZE) {
        newHistory = newHistory.slice(newHistory.length - MAX_HISTORY_SIZE)
      }
      
      return {
        history: newHistory,
        historyIndex: newHistory.length - 1
      }
    })
  },
  
  /**
   * Undo - restore previous state
   */
  undo: () => {
    const state = get()
    
    // If historyIndex is -1, we need to save current state first before undoing
    if (state.historyIndex === -1 && state.history.length > 0) {
      // Save current state so we can redo back to it
      const currentSnapshot = {
        clips: JSON.parse(JSON.stringify(state.clips)),
        tracks: JSON.parse(JSON.stringify(state.tracks)),
        transitions: JSON.parse(JSON.stringify(state.transitions)),
        clipCounter: state.clipCounter,
        transitionCounter: state.transitionCounter,
      }
      
      const lastHistoryState = state.history[state.history.length - 1]
      
      set({
        clips: lastHistoryState.clips,
        tracks: lastHistoryState.tracks,
        transitions: lastHistoryState.transitions,
        clipCounter: lastHistoryState.clipCounter,
        transitionCounter: lastHistoryState.transitionCounter,
        history: [...state.history, currentSnapshot],
        historyIndex: state.history.length - 1,
        selectedClipIds: [] // Clear selection on undo
      })
      return true
    }
    
    // Normal undo - go back in history
    if (state.historyIndex > 0) {
      const prevState = state.history[state.historyIndex - 1]
      set({
        clips: prevState.clips,
        tracks: prevState.tracks,
        transitions: prevState.transitions,
        clipCounter: prevState.clipCounter,
        transitionCounter: prevState.transitionCounter,
        historyIndex: state.historyIndex - 1,
        selectedClipIds: [] // Clear selection on undo
      })
      return true
    }
    
    return false // Nothing to undo
  },
  
  /**
   * Redo - restore next state
   */
  redo: () => {
    const state = get()
    
    if (state.historyIndex >= 0 && state.historyIndex < state.history.length - 1) {
      const nextState = state.history[state.historyIndex + 1]
      set({
        clips: nextState.clips,
        tracks: nextState.tracks,
        transitions: nextState.transitions,
        clipCounter: nextState.clipCounter,
        transitionCounter: nextState.transitionCounter,
        historyIndex: state.historyIndex + 1,
        selectedClipIds: [] // Clear selection on redo
      })
      return true
    }
    
    return false // Nothing to redo
  },
  
  /**
   * Check if undo is available
   */
  canUndo: () => {
    const state = get()
    return state.history.length > 0 && (state.historyIndex === -1 || state.historyIndex > 0)
  },
  
  /**
   * Check if redo is available
   */
  canRedo: () => {
    const state = get()
    return state.historyIndex >= 0 && state.historyIndex < state.history.length - 1
  },
  
  /**
   * Clear history (e.g., on project clear)
   */
  clearHistory: () => {
    set({ history: [], historyIndex: -1 })
  },

  /**
   * Handle clip overlaps on the same track (NLE overwrite behavior)
   * When a clip is placed, it cuts/trims any overlapping clips on the same track
   */
  resolveOverlaps: (trackId, newClipId, newStartTime, newDuration) => {
    const state = get()
    const newEndTime = newStartTime + newDuration
    
    // Find all clips on the same track that overlap with the new clip (excluding itself)
    const overlappingClips = state.clips.filter(clip => 
      clip.trackId === trackId &&
      clip.id !== newClipId &&
      clip.startTime < newEndTime &&
      clip.startTime + clip.duration > newStartTime
    )
    
    if (overlappingClips.length === 0) return { clips: state.clips, addedCount: 0 }
    
    let updatedClips = [...state.clips]
    let clipsToRemove = []
    let clipsToAdd = []
    
    overlappingClips.forEach(clip => {
      const clipEnd = clip.startTime + clip.duration
      
      // Case 1: New clip completely covers existing clip -> remove existing
      if (newStartTime <= clip.startTime && newEndTime >= clipEnd) {
        clipsToRemove.push(clip.id)
      }
      // Case 2: New clip cuts the beginning of existing clip -> trim existing clip's start
      else if (newStartTime <= clip.startTime && newEndTime < clipEnd) {
        const trimAmount = newEndTime - clip.startTime
        const trimAmountSource = timelineToSourceTime(clip, trimAmount)
        const idx = updatedClips.findIndex(c => c.id === clip.id)
        if (idx !== -1) {
          updatedClips[idx] = {
            ...updatedClips[idx],
            startTime: newEndTime,
            duration: clipEnd - newEndTime,
            trimStart: (clip.trimStart || 0) + trimAmountSource
          }
        }
      }
      // Case 3: New clip cuts the end of existing clip -> trim existing clip's end
      else if (newStartTime > clip.startTime && newEndTime >= clipEnd) {
        const idx = updatedClips.findIndex(c => c.id === clip.id)
        if (idx !== -1) {
          const newDuration = newStartTime - clip.startTime
          updatedClips[idx] = {
            ...updatedClips[idx],
            duration: newDuration,
            trimEnd: (clip.trimStart || 0) + timelineToSourceTime(clip, newDuration)
          }
        }
      }
      // Case 4: New clip is in the middle of existing clip -> split into two clips
      else if (newStartTime > clip.startTime && newEndTime < clipEnd) {
        // Trim the existing clip to end at newStartTime
        const idx = updatedClips.findIndex(c => c.id === clip.id)
        if (idx !== -1) {
          const firstPartDuration = newStartTime - clip.startTime
          updatedClips[idx] = {
            ...updatedClips[idx],
            duration: firstPartDuration,
            trimEnd: (clip.trimStart || 0) + timelineToSourceTime(clip, firstPartDuration)
          }
          
          // Create a second clip for the part after the new clip
          const secondPartStart = newEndTime
          const secondPartDuration = clipEnd - newEndTime
          const secondPartTrimStart = (clip.trimStart || 0) + timelineToSourceTime(clip, newEndTime - clip.startTime)
          
          clipsToAdd.push({
            ...clip,
            id: `clip-${state.clipCounter + clipsToAdd.length + 1}`,
            startTime: secondPartStart,
            duration: secondPartDuration,
            trimStart: secondPartTrimStart,
            trimEnd: getClipTrimEnd(clip)
          })
        }
      }
    })
    
    // Remove fully covered clips
    updatedClips = updatedClips.filter(c => !clipsToRemove.includes(c.id))
    
    // Add split clips
    updatedClips = [...updatedClips, ...clipsToAdd]
    
    return { clips: updatedClips, addedCount: clipsToAdd.length }
  },

  /**
   * Add a clip to the timeline
   */
  addClip: (trackId, asset, startTime = null, timelineFps = null) => {
    const state = get()
    const track = state.tracks.find(t => t.id === trackId)
    if (!track) return null
    
    // Save to history before modifying
    get().saveToHistory()
    
    // Find the end of existing clips on this track if no start time specified
    const trackClips = state.clips.filter(c => c.trackId === trackId)
    const calculatedStartTime = startTime ?? trackClips.reduce((max, clip) => 
      Math.max(max, clip.startTime + clip.duration), 0
    )
    
    // For images, use a default duration but allow extending (images have infinite source)
    // For videos/audio, use the actual source duration
    // Check both asset.duration and asset.settings.duration (different sources store it differently)
    const isImage = asset.type === 'image'
    const isVideo = asset.type === 'video'
    const assetDuration = asset.duration || asset.settings?.duration || null
    const sourceDuration = isImage ? Infinity : (assetDuration || 5)
    const sourceFps = isVideo ? Number(asset.settings?.fps ?? asset.fps) : null
    const normalizedTimelineFps = Number(timelineFps)
    const defaultDuration = isImage ? 5 : sourceDuration // Keep video/audio duration in real seconds
    
    // Log a warning if we couldn't get the actual duration
    if (!isImage && !assetDuration) {
      console.warn(`Could not get duration for asset "${asset.name}", defaulting to 5 seconds`)
    }
    
    const newClip = {
      id: `clip-${state.clipCounter}`,
      trackId,
      assetId: asset.id,
      name: asset.name,
      startTime: calculatedStartTime,
      duration: defaultDuration, // Visible duration on timeline
      sourceDuration: sourceDuration, // Original media duration (Infinity for images)
      trimStart: 0, // In-point (seconds from source start)
      trimEnd: isImage ? defaultDuration : sourceDuration, // Out-point (for images, this can grow)
      sourceFps: Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : null,
      timelineFps: Number.isFinite(normalizedTimelineFps) && normalizedTimelineFps > 0 ? normalizedTimelineFps : null,
      sourceTimeScale: 1,
      speed: 1,
      reverse: false,
      color: track.type === 'video' ? getVideoColor(state.clipCounter) : getAudioColor(track.id),
      type: asset.type,
      url: asset.url,
      thumbnail: asset.url, // For video clips
      // 2D Transform properties (NLE-style)
      transform: {
        positionX: 0,        // X position offset (pixels, 0 = centered)
        positionY: 0,        // Y position offset (pixels, 0 = centered)
        scaleX: 100,         // Horizontal scale (percentage, 100 = original)
        scaleY: 100,         // Vertical scale (percentage, 100 = original)
        scaleLinked: true,   // Link X and Y scale together
        rotation: 0,         // Rotation angle (degrees, -180 to 180)
        anchorX: 50,         // Anchor point X (percentage, 50 = center)
        anchorY: 50,         // Anchor point Y (percentage, 50 = center)
        opacity: 100,        // Opacity (percentage, 0-100)
        flipH: false,        // Horizontal flip
        flipV: false,        // Vertical flip
        // Crop (percentage from each edge)
        cropTop: 0,
        cropBottom: 0,
        cropLeft: 0,
        cropRight: 0,
      },
    }
    
    // Resolve overlaps with existing clips on the same track (NLE overwrite behavior)
    const { clips: updatedClips, addedCount } = get().resolveOverlaps(
      trackId, 
      newClip.id, 
      calculatedStartTime, 
      sourceDuration
    )
    
    set((state) => ({
      clips: [...updatedClips, newClip],
      clipCounter: state.clipCounter + 1 + addedCount,
      selectedClipIds: [newClip.id],
      // Extend timeline if needed
      duration: Math.max(state.duration, calculatedStartTime + newClip.duration + 10)
    }))
    
    return newClip
  },

  /**
   * Add a text clip to the timeline
   * @param {string} trackId - Target video track ID
   * @param {object} textOptions - Text configuration options
   * @param {number|null} startTime - Start time (null = end of existing clips)
   */
  addTextClip: (trackId, textOptions = {}, startTime = null) => {
    const state = get()
    const track = state.tracks.find(t => t.id === trackId)
    if (!track || track.type !== 'video') return null
    
    // Save to history before modifying
    get().saveToHistory()
    
    // Find the end of existing clips on this track if no start time specified
    const trackClips = state.clips.filter(c => c.trackId === trackId)
    const calculatedStartTime = startTime ?? trackClips.reduce((max, clip) => 
      Math.max(max, clip.startTime + clip.duration), 0
    )
    
    // Default text properties
    const defaultText = {
      text: textOptions.text || 'Sample Text',
      fontFamily: textOptions.fontFamily || 'Inter',
      fontSize: textOptions.fontSize || 64,
      fontWeight: textOptions.fontWeight || 'bold',
      fontStyle: textOptions.fontStyle || 'normal',
      textColor: textOptions.textColor || '#FFFFFF',
      backgroundColor: textOptions.backgroundColor || 'transparent',
      backgroundOpacity: textOptions.backgroundOpacity || 0,
      backgroundPadding: textOptions.backgroundPadding || 20,
      textAlign: textOptions.textAlign || 'center',
      verticalAlign: textOptions.verticalAlign || 'center',
      strokeColor: textOptions.strokeColor || '#000000',
      strokeWidth: textOptions.strokeWidth || 0,
      letterSpacing: textOptions.letterSpacing || 0,
      lineHeight: textOptions.lineHeight || 1.2,
      shadow: textOptions.shadow || false,
      shadowColor: textOptions.shadowColor || 'rgba(0,0,0,0.5)',
      shadowBlur: textOptions.shadowBlur || 4,
      shadowOffsetX: textOptions.shadowOffsetX || 2,
      shadowOffsetY: textOptions.shadowOffsetY || 2,
    }
    
    const duration = textOptions.duration || 5
    
    const newClip = {
      id: `clip-${state.clipCounter}`,
      trackId,
      assetId: null, // Text clips don't have asset references
      name: defaultText.text.substring(0, 20) + (defaultText.text.length > 20 ? '...' : ''),
      startTime: calculatedStartTime,
      duration: duration,
      sourceDuration: duration,
      trimStart: 0,
      trimEnd: duration,
      color: '#565C6B', // Muted blue for text clips
      type: 'text',
      url: null,
      thumbnail: null,
      // Text-specific properties
      textProperties: defaultText,
      // 2D Transform properties (same as video clips)
      transform: {
        positionX: 0,
        positionY: 0,
        scaleX: 100,
        scaleY: 100,
        scaleLinked: true,
        rotation: 0,
        anchorX: 50,
        anchorY: 50,
        opacity: 100,
        flipH: false,
        flipV: false,
        cropTop: 0,
        cropBottom: 0,
        cropLeft: 0,
        cropRight: 0,
      },
    }
    
    // Resolve overlaps with existing clips on the same track
    const { clips: updatedClips, addedCount } = get().resolveOverlaps(
      trackId, 
      newClip.id, 
      calculatedStartTime, 
      duration
    )
    
    set((state) => ({
      clips: [...updatedClips, newClip],
      clipCounter: state.clipCounter + 1 + addedCount,
      selectedClipIds: [newClip.id],
      duration: Math.max(state.duration, calculatedStartTime + newClip.duration + 10)
    }))
    
    return newClip
  },

  /**
   * Update text clip properties
   * @param {string} clipId - The text clip to update
   * @param {object} textUpdates - Partial text properties object
   * @param {boolean} saveHistory - Whether to save to history
   */
  updateTextProperties: (clipId, textUpdates, saveHistory = false) => {
    if (saveHistory) {
      get().saveToHistory()
    }
    
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId || clip.type !== 'text') return clip
        
        const currentText = clip.textProperties || {}
        const updatedText = { ...currentText, ...textUpdates }
        
        // Update clip name if text content changed
        const newName = textUpdates.text 
          ? textUpdates.text.substring(0, 20) + (textUpdates.text.length > 20 ? '...' : '')
          : clip.name
        
        return {
          ...clip,
          name: newName,
          textProperties: updatedText
        }
      })
    }))
  },

  /**
   * Remove a clip (or multiple clips if they're selected)
   */
  removeClip: (clipId) => {
    // Save to history before modifying
    get().saveToHistory()
    
    set((state) => ({
      clips: state.clips.filter(c => c.id !== clipId),
      selectedClipIds: state.selectedClipIds.filter(id => id !== clipId)
    }))
  },

  /**
   * Remove all selected clips
   */
  removeSelectedClips: () => {
    // Save to history before modifying
    get().saveToHistory()
    
    set((state) => ({
      clips: state.clips.filter(c => !state.selectedClipIds.includes(c.id)),
      selectedClipIds: []
    }))
  },

  /**
   * Remove audio clips that reference a specific asset
   */
  removeAudioClipsForAsset: (assetId) => {
    const state = get()
    const audioTrackIds = new Set(state.tracks.filter(t => t.type === 'audio').map(t => t.id))
    const isAudioClipForAsset = (c) => c.assetId === assetId && audioTrackIds.has(c.trackId)
    const nextClips = state.clips.filter(c => !isAudioClipForAsset(c))
    if (nextClips.length === state.clips.length) return

    // Save to history before modifying
    get().saveToHistory()

    const nextSelected = state.selectedClipIds.filter(id => nextClips.some(c => c.id === id))
    set((prev) => ({
      ...prev,
      clips: nextClips,
      selectedClipIds: nextSelected
    }))
  },

  /**
   * Move a clip to a new position/track
   * @param {string} clipId - The clip to move
   * @param {string} newTrackId - The target track ID
   * @param {number} newStartTime - The new start time
   * @param {boolean} resolveOverlaps - Whether to cut overlapping clips (default: false, set true on drag end)
   */
  moveClip: (clipId, newTrackId, newStartTime, resolveOverlaps = false) => {
    const state = get()
    const clip = state.clips.find(c => c.id === clipId)
    if (!clip) return
    
    // Save to history only on drag end (when resolving overlaps) to avoid flooding history during drag
    if (resolveOverlaps) {
      get().saveToHistory()
    }
    
    const delta = newStartTime - clip.startTime
    const finalStartTime = Math.max(0, newStartTime)
    
    set((state) => {
      // First, update the clip position
      let updatedClips = state.clips.map(c => 
        c.id === clipId 
          ? { ...c, trackId: newTrackId, startTime: finalStartTime }
          : c
      )
      
      // If ripple mode is on and we're moving forward, shift subsequent clips
      if (state.rippleEditMode && delta !== 0) {
        updatedClips = updatedClips.map(c => {
          // Only affect clips on the same track that come after the moved clip
          if (c.id !== clipId && c.trackId === clip.trackId && c.startTime > clip.startTime) {
            return { ...c, startTime: Math.max(0, c.startTime + delta) }
          }
          return c
        })
      }
      
      // Only resolve overlaps if explicitly requested (on drag end)
      if (resolveOverlaps) {
        const movedClip = updatedClips.find(c => c.id === clipId)
        if (movedClip) {
          const newEndTime = finalStartTime + movedClip.duration
          
          // Find all clips on the same track that overlap (excluding the moved clip)
          const overlappingClips = updatedClips.filter(c => 
            c.trackId === newTrackId &&
            c.id !== clipId &&
            c.startTime < newEndTime &&
            c.startTime + c.duration > finalStartTime
          )
          
          if (overlappingClips.length > 0) {
            let clipsToRemove = []
            let clipsToAdd = []
            
            overlappingClips.forEach(existingClip => {
              const clipEnd = existingClip.startTime + existingClip.duration
              
              // Case 1: Moved clip completely covers existing clip -> remove existing
              if (finalStartTime <= existingClip.startTime && newEndTime >= clipEnd) {
                clipsToRemove.push(existingClip.id)
              }
              // Case 2: Moved clip cuts the beginning of existing clip -> trim existing clip's start
              else if (finalStartTime <= existingClip.startTime && newEndTime < clipEnd) {
                const trimAmount = newEndTime - existingClip.startTime
                const trimAmountSource = timelineToSourceTime(existingClip, trimAmount)
                const idx = updatedClips.findIndex(c => c.id === existingClip.id)
                if (idx !== -1) {
                  updatedClips[idx] = {
                    ...updatedClips[idx],
                    startTime: newEndTime,
                    duration: clipEnd - newEndTime,
                    trimStart: (existingClip.trimStart || 0) + trimAmountSource
                  }
                }
              }
              // Case 3: Moved clip cuts the end of existing clip -> trim existing clip's end
              else if (finalStartTime > existingClip.startTime && newEndTime >= clipEnd) {
                const idx = updatedClips.findIndex(c => c.id === existingClip.id)
                if (idx !== -1) {
                  const newDuration = finalStartTime - existingClip.startTime
                  updatedClips[idx] = {
                    ...updatedClips[idx],
                    duration: newDuration,
                    trimEnd: (existingClip.trimStart || 0) + timelineToSourceTime(existingClip, newDuration)
                  }
                }
              }
              // Case 4: Moved clip is in the middle of existing clip -> split into two clips
              else if (finalStartTime > existingClip.startTime && newEndTime < clipEnd) {
                // Trim the existing clip to end at finalStartTime
                const idx = updatedClips.findIndex(c => c.id === existingClip.id)
                if (idx !== -1) {
                  const firstPartDuration = finalStartTime - existingClip.startTime
                  updatedClips[idx] = {
                    ...updatedClips[idx],
                    duration: firstPartDuration,
                    trimEnd: (existingClip.trimStart || 0) + timelineToSourceTime(existingClip, firstPartDuration)
                  }
                  
                  // Create a second clip for the part after the moved clip
                  const secondPartStart = newEndTime
                  const secondPartDuration = clipEnd - newEndTime
                  const secondPartTrimStart = (existingClip.trimStart || 0) + timelineToSourceTime(existingClip, newEndTime - existingClip.startTime)
                  
                  clipsToAdd.push({
                    ...existingClip,
                    id: `clip-${state.clipCounter + clipsToAdd.length + 1}`,
                    startTime: secondPartStart,
                    duration: secondPartDuration,
                    trimStart: secondPartTrimStart,
                    trimEnd: getClipTrimEnd(existingClip)
                  })
                }
              }
            })
            
            // Remove fully covered clips
            updatedClips = updatedClips.filter(c => !clipsToRemove.includes(c.id))
            
            // Add split clips
            updatedClips = [...updatedClips, ...clipsToAdd]
            
            // Update clip counter if we added clips
            if (clipsToAdd.length > 0) {
              return { 
                clips: updatedClips,
                clipCounter: state.clipCounter + clipsToAdd.length
              }
            }
          }
        }
      }
      
      return { clips: updatedClips }
    })
  },

  /**
   * Move all selected clips by a delta amount
   * @param {number} deltaTime - The time delta to move by
   * @param {string|null} newTrackId - Optional new track ID
   * @param {boolean} resolveOverlaps - Whether to cut overlapping clips (default: false, set true on drag end)
   */
  moveSelectedClips: (deltaTime, newTrackId = null, resolveOverlaps = false) => {
    // Save to history only on drag end (when resolving overlaps) to avoid flooding history during drag
    if (resolveOverlaps) {
      get().saveToHistory()
    }
    
    set((state) => {
      // First, move all selected clips
      let updatedClips = state.clips.map(clip => {
        if (state.selectedClipIds.includes(clip.id)) {
          return {
            ...clip,
            startTime: Math.max(0, clip.startTime + deltaTime),
            trackId: newTrackId !== null ? newTrackId : clip.trackId
          }
        }
        return clip
      })
      
      // Only resolve overlaps if explicitly requested (on drag end)
      if (!resolveOverlaps) {
        return { clips: updatedClips }
      }
      
      // Now resolve overlaps for each moved clip (NLE overwrite behavior)
      // This is done after all clips are moved to handle them as a group
      let clipsToRemove = []
      let clipsToAdd = []
      let addedCounter = 0
      
      state.selectedClipIds.forEach(movedClipId => {
        const movedClip = updatedClips.find(c => c.id === movedClipId)
        if (!movedClip) return
        
        const newStartTime = movedClip.startTime
        const newEndTime = newStartTime + movedClip.duration
        const trackId = movedClip.trackId
        
        // Find all clips on the same track that overlap (excluding moved/selected clips)
        const overlappingClips = updatedClips.filter(c => 
          c.trackId === trackId &&
          !state.selectedClipIds.includes(c.id) &&
          !clipsToRemove.includes(c.id) &&
          c.startTime < newEndTime &&
          c.startTime + c.duration > newStartTime
        )
        
        overlappingClips.forEach(existingClip => {
          const clipEnd = existingClip.startTime + existingClip.duration
          
          // Case 1: Moved clip completely covers existing clip -> remove existing
          if (newStartTime <= existingClip.startTime && newEndTime >= clipEnd) {
            clipsToRemove.push(existingClip.id)
          }
          // Case 2: Moved clip cuts the beginning of existing clip
          else if (newStartTime <= existingClip.startTime && newEndTime < clipEnd) {
            const trimAmount = newEndTime - existingClip.startTime
            const idx = updatedClips.findIndex(c => c.id === existingClip.id)
            if (idx !== -1) {
              const trimAmountSource = timelineToSourceTime(existingClip, trimAmount)
              updatedClips[idx] = {
                ...updatedClips[idx],
                startTime: newEndTime,
                duration: clipEnd - newEndTime,
                trimStart: (existingClip.trimStart || 0) + trimAmountSource
              }
            }
          }
          // Case 3: Moved clip cuts the end of existing clip
          else if (newStartTime > existingClip.startTime && newEndTime >= clipEnd) {
            const idx = updatedClips.findIndex(c => c.id === existingClip.id)
            if (idx !== -1) {
              const newDuration = newStartTime - existingClip.startTime
              updatedClips[idx] = {
                ...updatedClips[idx],
                duration: newDuration,
                trimEnd: (existingClip.trimStart || 0) + timelineToSourceTime(existingClip, newDuration)
              }
            }
          }
          // Case 4: Moved clip is in the middle of existing clip -> split
          else if (newStartTime > existingClip.startTime && newEndTime < clipEnd) {
            const idx = updatedClips.findIndex(c => c.id === existingClip.id)
            if (idx !== -1) {
              const firstPartDuration = newStartTime - existingClip.startTime
              updatedClips[idx] = {
                ...updatedClips[idx],
                duration: firstPartDuration,
                trimEnd: (existingClip.trimStart || 0) + timelineToSourceTime(existingClip, firstPartDuration)
              }
              
              const secondPartStart = newEndTime
              const secondPartDuration = clipEnd - newEndTime
              const secondPartTrimStart = (existingClip.trimStart || 0) + timelineToSourceTime(existingClip, newEndTime - existingClip.startTime)
              
              clipsToAdd.push({
                ...existingClip,
                id: `clip-${state.clipCounter + addedCounter + 1}`,
                startTime: secondPartStart,
                duration: secondPartDuration,
                trimStart: secondPartTrimStart,
                trimEnd: getClipTrimEnd(existingClip)
              })
              addedCounter++
            }
          }
        })
      })
      
      // Remove fully covered clips
      updatedClips = updatedClips.filter(c => !clipsToRemove.includes(c.id))
      
      // Add split clips
      updatedClips = [...updatedClips, ...clipsToAdd]
      
      return { 
        clips: updatedClips,
        clipCounter: clipsToAdd.length > 0 ? state.clipCounter + clipsToAdd.length : state.clipCounter
      }
    })
  },

  /**
   * Resize a clip
   */
  resizeClip: (clipId, newDuration) => {
    set((state) => ({
      clips: state.clips.map(clip =>
        clip.id === clipId
          ? (() => {
              const nextDuration = Math.max(0.5, newDuration)
              const timeScale = getClipTimeScale(clip)
              const nextTrimEnd = clip.sourceDuration === Infinity
                ? nextDuration
                : (clip.trimStart || 0) + timelineToSourceTime(clip, nextDuration)
              return { ...clip, duration: nextDuration, trimEnd: nextTrimEnd }
            })()
          : clip
      )
    }))
  },

  /**
   * Update clip playback speed (time stretch)
   * @param {string} clipId - The clip to update
   * @param {number} speed - Playback speed multiplier
   * @param {boolean} saveHistory - Whether to save to history
   */
  updateClipSpeed: (clipId, speed, saveHistory = false) => {
    const nextSpeed = Math.max(0.1, Math.min(8, Number(speed) || 1))
    if (saveHistory) {
      get().saveToHistory()
    }

    set((state) => {
      const target = state.clips.find(c => c.id === clipId)
      if (!target) return {}

      const audioTrackIds = new Set(state.tracks.filter(t => t.type === 'audio').map(t => t.id))
      const shouldSyncAudio = target.type === 'video'
      const isLinkedAudio = (clip) => shouldSyncAudio && clip.assetId === target.assetId && audioTrackIds.has(clip.trackId)

      const computeNext = (clip) => {
        if (clip.type === 'image') return { ...clip, speed: 1 }

        const currentSpeed = Number(clip.speed) > 0 ? Number(clip.speed) : 1
        const trimStart = clip.trimStart || 0
        const sourceDuration = Number.isFinite(clip.sourceDuration) ? clip.sourceDuration : null
        const trimEnd = clip.trimEnd ?? sourceDuration ?? (trimStart + (clip.duration || 0) * currentSpeed)
        const sourceSpan = Math.max(0.01, Math.min(sourceDuration ?? trimEnd, trimEnd) - trimStart)
        const nextDuration = Math.max(0.1, sourceSpan / nextSpeed)

        return {
          ...clip,
          speed: nextSpeed,
          duration: nextDuration,
          sourceTimeScale: 1,
        }
      }

      return {
        clips: state.clips.map(clip =>
          (clip.id === clipId || isLinkedAudio(clip)) ? computeNext(clip) : clip
        )
      }
    })
  },

  /**
   * Update clip reverse playback
   * @param {string} clipId - The clip to update
   * @param {boolean} reverse - Whether to reverse playback
   * @param {boolean} saveHistory - Whether to save to history
   */
  updateClipReverse: (clipId, reverse, saveHistory = true) => {
    if (saveHistory) {
      get().saveToHistory()
    }

    set((state) => {
      const target = state.clips.find(c => c.id === clipId)
      if (!target) return {}

      const audioTrackIds = new Set(state.tracks.filter(t => t.type === 'audio').map(t => t.id))
      const shouldSyncAudio = target.type === 'video'
      const isLinkedAudio = (clip) => shouldSyncAudio && clip.assetId === target.assetId && audioTrackIds.has(clip.trackId)

      return {
        clips: state.clips.map(clip =>
          (clip.id === clipId || isLinkedAudio(clip))
            ? { ...clip, reverse: !!reverse }
            : clip
        )
      }
    })
  },

  /**
   * Update clip trim properties directly (for interactive trimming)
   * @param {string} clipId - The clip to update
   * @param {object} updates - Object with properties to update (startTime, duration, trimStart, trimEnd)
   */
  updateClipTrim: (clipId, updates) => {
    set((state) => ({
      clips: state.clips.map(clip =>
        clip.id === clipId
          ? { ...clip, ...updates }
          : clip
      )
    }))
  },

  /**
   * Update clip transform properties (position, scale, rotation, flip, crop, opacity)
   * @param {string} clipId - The clip to update
   * @param {object} transformUpdates - Partial transform object with properties to update
   * @param {boolean} saveHistory - Whether to save to history (default: false for realtime sliders)
   */
  updateClipTransform: (clipId, transformUpdates, saveHistory = false) => {
    if (saveHistory) {
      get().saveToHistory()
    }
    
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        
        // Ensure transform object exists (for legacy clips)
        const currentTransform = clip.transform || {
          positionX: 0, positionY: 0,
          scaleX: 100, scaleY: 100, scaleLinked: true,
          rotation: 0, anchorX: 50, anchorY: 50, opacity: 100,
          flipH: false, flipV: false,
          cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0,
        }
        
        // Handle linked scale: if scaleLinked and one scale changed, update both
        let finalUpdates = { ...transformUpdates }
        if (currentTransform.scaleLinked) {
          if ('scaleX' in transformUpdates && !('scaleY' in transformUpdates)) {
            finalUpdates.scaleY = transformUpdates.scaleX
          } else if ('scaleY' in transformUpdates && !('scaleX' in transformUpdates)) {
            finalUpdates.scaleX = transformUpdates.scaleY
          }
        }
        
        return {
          ...clip,
          transform: {
            ...currentTransform,
            ...finalUpdates
          }
        }
      })
    }))
  },

  /**
   * Reset clip transform to defaults
   * @param {string} clipId - The clip to reset
   */
  resetClipTransform: (clipId) => {
    get().saveToHistory()
    
    set((state) => ({
      clips: state.clips.map(clip =>
        clip.id === clipId
          ? {
              ...clip,
              transform: {
                positionX: 0, positionY: 0,
                scaleX: 100, scaleY: 100, scaleLinked: true,
                rotation: 0, anchorX: 50, anchorY: 50, opacity: 100,
                flipH: false, flipV: false,
                cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0,
              }
            }
          : clip
      )
    }))
  },

  /**
   * Get the currently selected clip (first selected)
   */
  getSelectedClip: () => {
    const state = get()
    if (state.selectedClipIds.length === 0) return null
    return state.clips.find(c => c.id === state.selectedClipIds[0]) || null
  },

  // ==================== KEYFRAME MANAGEMENT ====================

  /**
   * Add or update a keyframe for a property
   * @param {string} clipId - The clip ID
   * @param {string} property - Property name (e.g., 'positionX', 'scaleX')
   * @param {number} time - Time in seconds (relative to clip start)
   * @param {number} value - Value at this keyframe
   * @param {string} easing - Easing function (default: 'easeInOut')
   */
  setKeyframe: (clipId, property, time, value, easing = 'easeInOut') => {
    get().saveToHistory()
    
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        
        const keyframes = clip.keyframes || {}
        const propKeyframes = [...(keyframes[property] || [])]
        
        // Find existing keyframe at this time (with tolerance)
        const existingIndex = propKeyframes.findIndex(kf => Math.abs(kf.time - time) < 0.05)
        
        if (existingIndex >= 0) {
          // Update existing keyframe
          propKeyframes[existingIndex] = { time, value, easing }
        } else {
          // Add new keyframe
          propKeyframes.push({ time, value, easing })
        }
        
        // Sort by time
        propKeyframes.sort((a, b) => a.time - b.time)
        
        return {
          ...clip,
          keyframes: {
            ...keyframes,
            [property]: propKeyframes
          }
        }
      })
    }))
  },

  /**
   * Remove a keyframe
   * @param {string} clipId - The clip ID
   * @param {string} property - Property name
   * @param {number} time - Time of keyframe to remove
   */
  removeKeyframe: (clipId, property, time) => {
    get().saveToHistory()
    
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        
        const keyframes = clip.keyframes || {}
        const propKeyframes = keyframes[property] || []
        
        // Filter out keyframe at this time
        const newPropKeyframes = propKeyframes.filter(kf => Math.abs(kf.time - time) > 0.05)
        
        // If no keyframes left for this property, remove the property entry
        const newKeyframes = { ...keyframes }
        if (newPropKeyframes.length === 0) {
          delete newKeyframes[property]
        } else {
          newKeyframes[property] = newPropKeyframes
        }
        
        return {
          ...clip,
          keyframes: newKeyframes
        }
      })
    }))
  },

  /**
   * Toggle keyframe at current playhead position
   * If keyframe exists, remove it; if not, add one with current value
   * @param {string} clipId - The clip ID
   * @param {string} property - Property name
   */
  toggleKeyframe: (clipId, property) => {
    const state = get()
    const clip = state.clips.find(c => c.id === clipId)
    if (!clip) return
    
    // Calculate time relative to clip start
    const clipTime = state.playheadPosition - clip.startTime
    if (clipTime < 0 || clipTime > clip.duration) return
    
    const keyframes = clip.keyframes?.[property] || []
    const existingKeyframe = keyframes.find(kf => Math.abs(kf.time - clipTime) < 0.05)
    
    // Determine if we need to handle linked scale
    const isScaleProperty = property === 'scaleX' || property === 'scaleY'
    const isLinked = clip.transform?.scaleLinked && isScaleProperty
    
    if (existingKeyframe) {
      // Remove existing keyframe
      get().removeKeyframe(clipId, property, clipTime)
      // If scale is linked, also remove the other scale keyframe
      if (isLinked) {
        const otherProperty = property === 'scaleX' ? 'scaleY' : 'scaleX'
        get().removeKeyframe(clipId, otherProperty, clipTime)
      }
    } else {
      // Add new keyframe with current transform value
      const currentValue = clip.transform?.[property] ?? 0
      get().setKeyframe(clipId, property, clipTime, currentValue, 'easeInOut')
      // If scale is linked, also add keyframe for the other scale property
      if (isLinked) {
        const otherProperty = property === 'scaleX' ? 'scaleY' : 'scaleX'
        const otherValue = clip.transform?.[otherProperty] ?? 0
        get().setKeyframe(clipId, otherProperty, clipTime, otherValue, 'easeInOut')
      }
    }
  },

  /**
   * Update keyframe easing
   * @param {string} clipId - The clip ID
   * @param {string} property - Property name
   * @param {number} time - Keyframe time
   * @param {string} easing - New easing value
   */
  updateKeyframeEasing: (clipId, property, time, easing) => {
    get().saveToHistory()
    
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        
        const keyframes = clip.keyframes || {}
        const propKeyframes = keyframes[property] || []
        
        const newPropKeyframes = propKeyframes.map(kf => 
          Math.abs(kf.time - time) < 0.05 ? { ...kf, easing } : kf
        )
        
        return {
          ...clip,
          keyframes: {
            ...keyframes,
            [property]: newPropKeyframes
          }
        }
      })
    }))
  },

  /**
   * Clear all keyframes for a property
   * @param {string} clipId - The clip ID
   * @param {string} property - Property name
   */
  clearPropertyKeyframes: (clipId, property) => {
    get().saveToHistory()
    
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        
        const newKeyframes = { ...clip.keyframes }
        delete newKeyframes[property]
        
        return {
          ...clip,
          keyframes: newKeyframes
        }
      })
    }))
  },

  /**
   * Clear all keyframes for a clip
   * @param {string} clipId - The clip ID
   */
  clearAllKeyframes: (clipId) => {
    get().saveToHistory()
    
    set((state) => ({
      clips: state.clips.map(clip => 
        clip.id === clipId ? { ...clip, keyframes: {} } : clip
      )
    }))
  },

  /**
   * Get keyframe at specific time for a property
   * @param {string} clipId - The clip ID
   * @param {string} property - Property name
   * @param {number} time - Time to check (relative to clip start)
   * @returns {Object|null} - Keyframe object or null
   */
  getKeyframeAtTime: (clipId, property, time) => {
    const state = get()
    const clip = state.clips.find(c => c.id === clipId)
    if (!clip) return null
    
    const keyframes = clip.keyframes?.[property] || []
    return keyframes.find(kf => Math.abs(kf.time - time) < 0.05) || null
  },

  /**
   * Check if property has keyframes
   * @param {string} clipId - The clip ID
   * @param {string} property - Property name
   * @returns {boolean}
   */
  hasKeyframes: (clipId, property) => {
    const state = get()
    const clip = state.clips.find(c => c.id === clipId)
    return clip?.keyframes?.[property]?.length > 0
  },

  /**
   * Navigate to next keyframe for a property
   * @param {string} clipId - The clip ID
   * @param {string} property - Property name (or 'all' for any property)
   */
  goToNextKeyframe: (clipId, property = 'all') => {
    const state = get()
    const clip = state.clips.find(c => c.id === clipId)
    if (!clip) return
    
    const clipTime = state.playheadPosition - clip.startTime
    let nextTime = Infinity
    
    if (property === 'all') {
      // Find next keyframe across all properties
      for (const propKeyframes of Object.values(clip.keyframes || {})) {
        for (const kf of propKeyframes) {
          if (kf.time > clipTime + 0.05 && kf.time < nextTime) {
            nextTime = kf.time
          }
        }
      }
    } else {
      // Find next keyframe for specific property
      const keyframes = clip.keyframes?.[property] || []
      for (const kf of keyframes) {
        if (kf.time > clipTime + 0.05 && kf.time < nextTime) {
          nextTime = kf.time
        }
      }
    }
    
    if (nextTime !== Infinity) {
      set({ playheadPosition: clip.startTime + nextTime })
    }
  },

  /**
   * Navigate to previous keyframe for a property
   * @param {string} clipId - The clip ID
   * @param {string} property - Property name (or 'all' for any property)
   */
  goToPrevKeyframe: (clipId, property = 'all') => {
    const state = get()
    const clip = state.clips.find(c => c.id === clipId)
    if (!clip) return
    
    const clipTime = state.playheadPosition - clip.startTime
    let prevTime = -Infinity
    
    if (property === 'all') {
      // Find previous keyframe across all properties
      for (const propKeyframes of Object.values(clip.keyframes || {})) {
        for (const kf of propKeyframes) {
          if (kf.time < clipTime - 0.05 && kf.time > prevTime) {
            prevTime = kf.time
          }
        }
      }
    } else {
      // Find previous keyframe for specific property
      const keyframes = clip.keyframes?.[property] || []
      for (const kf of keyframes) {
        if (kf.time < clipTime - 0.05 && kf.time > prevTime) {
          prevTime = kf.time
        }
      }
    }
    
    if (prevTime !== -Infinity) {
      set({ playheadPosition: clip.startTime + prevTime })
    }
  },

  // ==================== END KEYFRAME MANAGEMENT ====================

  // ==================== EFFECTS MANAGEMENT ====================

  /**
   * Add an effect to a clip
   * @param {string} clipId - The clip ID
   * @param {object} effect - Effect configuration { type, ...params }
   * @returns {object} The created effect
   */
  addEffect: (clipId, effect) => {
    get().saveToHistory()
    
    const effectId = `effect-${Date.now()}`
    const newEffect = {
      id: effectId,
      enabled: true,
      ...effect,
    }
    
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        
        const effects = clip.effects || []
        return {
          ...clip,
          effects: [...effects, newEffect],
          // Invalidate cache when effects change
          cacheStatus: clip.cacheStatus === 'cached' ? 'invalid' : clip.cacheStatus,
        }
      })
    }))
    
    return newEffect
  },

  /**
   * Remove an effect from a clip
   * @param {string} clipId - The clip ID
   * @param {string} effectId - The effect ID to remove
   */
  removeEffect: (clipId, effectId) => {
    get().saveToHistory()
    
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        
        const effects = clip.effects || []
        const newEffects = effects.filter(e => e.id !== effectId)
        return {
          ...clip,
          effects: newEffects,
          // Invalidate cache when effects change, or clear if no effects left
          cacheStatus: newEffects.length === 0 ? 'none' : 
                      (clip.cacheStatus === 'cached' ? 'invalid' : clip.cacheStatus),
          cacheUrl: newEffects.length === 0 ? null : clip.cacheUrl,
        }
      })
    }))
  },

  /**
   * Update an effect's properties
   * @param {string} clipId - The clip ID
   * @param {string} effectId - The effect ID
   * @param {object} updates - Properties to update
   * @param {boolean} saveHistory - Whether to save to history (default: false for realtime)
   */
  updateEffect: (clipId, effectId, updates, saveHistory = false) => {
    if (saveHistory) {
      get().saveToHistory()
    }
    
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        
        const effects = clip.effects || []
        return {
          ...clip,
          effects: effects.map(e => 
            e.id === effectId ? { ...e, ...updates } : e
          ),
          // Invalidate cache when effect properties change
          cacheStatus: clip.cacheStatus === 'cached' ? 'invalid' : clip.cacheStatus,
        }
      })
    }))
  },

  /**
   * Toggle an effect's enabled state
   * @param {string} clipId - The clip ID
   * @param {string} effectId - The effect ID
   */
  toggleEffect: (clipId, effectId) => {
    get().saveToHistory()
    
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        
        const effects = clip.effects || []
        return {
          ...clip,
          effects: effects.map(e => 
            e.id === effectId ? { ...e, enabled: !e.enabled } : e
          ),
          // Invalidate cache when effect is toggled
          cacheStatus: clip.cacheStatus === 'cached' ? 'invalid' : clip.cacheStatus,
        }
      })
    }))
  },

  /**
   * Reorder effects (move effect up or down in the stack)
   * @param {string} clipId - The clip ID
   * @param {string} effectId - The effect ID to move
   * @param {number} direction - -1 for up, 1 for down
   */
  reorderEffect: (clipId, effectId, direction) => {
    get().saveToHistory()
    
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        
        const effects = [...(clip.effects || [])]
        const index = effects.findIndex(e => e.id === effectId)
        
        if (index === -1) return clip
        
        const newIndex = index + direction
        if (newIndex < 0 || newIndex >= effects.length) return clip
        
        // Swap
        [effects[index], effects[newIndex]] = [effects[newIndex], effects[index]]
        
        return { ...clip, effects }
      })
    }))
  },

  /**
   * Get all effects for a clip
   * @param {string} clipId - The clip ID
   * @returns {Array} Array of effects
   */
  getClipEffects: (clipId) => {
    const state = get()
    const clip = state.clips.find(c => c.id === clipId)
    return clip?.effects || []
  },

  /**
   * Get enabled effects for a clip (for rendering)
   * @param {string} clipId - The clip ID
   * @returns {Array} Array of enabled effects
   */
  getEnabledEffects: (clipId) => {
    const state = get()
    const clip = state.clips.find(c => c.id === clipId)
    return (clip?.effects || []).filter(e => e.enabled)
  },

  /**
   * Add a mask effect to a clip
   * @param {string} clipId - The clip ID
   * @param {string} maskAssetId - The mask asset ID
   * @returns {object} The created mask effect
   */
  addMaskEffect: (clipId, maskAssetId) => {
    return get().addEffect(clipId, {
      type: 'mask',
      maskAssetId,
      invertMask: false,
      feather: 0,
    })
  },

  // ==================== END EFFECTS MANAGEMENT ====================

  // ==================== RENDER CACHE MANAGEMENT ====================

  /**
   * Set the render cache status for a clip
   * @param {string} clipId - The clip ID
   * @param {string} status - Cache status: 'none', 'rendering', 'cached', 'invalid'
   * @param {number} progress - Render progress (0-100) when rendering
   */
  setCacheStatus: (clipId, status, progress = 0) => {
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        return {
          ...clip,
          cacheStatus: status,
          cacheProgress: progress,
        }
      })
    }))
  },

  /**
   * Set the cached video URL for a clip
   * @param {string} clipId - The clip ID  
   * @param {string} cacheUrl - Blob URL of the cached video
   * @param {string} cachePath - Optional path to the cached file on disk
   */
  setCacheUrl: (clipId, cacheUrl, cachePath = null) => {
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        return {
          ...clip,
          cacheUrl,
          cachePath, // Path to the file on disk (for persistence)
          cacheStatus: cacheUrl ? 'cached' : 'none',
          cacheProgress: cacheUrl ? 100 : 0,
        }
      })
    }))
  },

  /**
   * Invalidate cache for a clip (e.g., when effects change)
   * @param {string} clipId - The clip ID
   */
  invalidateCache: (clipId) => {
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        // Only invalidate if there was a cache
        if (clip.cacheStatus === 'cached' || clip.cacheUrl) {
          return {
            ...clip,
            cacheStatus: 'invalid',
            // Keep cacheUrl for now - will be revoked when new cache is created
          }
        }
        return clip
      })
    }))
  },

  /**
   * Clear cache for a clip
   * @param {string} clipId - The clip ID
   */
  clearClipCache: (clipId) => {
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        return {
          ...clip,
          cacheStatus: 'none',
          cacheProgress: 0,
          cacheUrl: null,
        }
      })
    }))
  },

  /**
   * Get cache status for a clip
   * @param {string} clipId - The clip ID
   * @returns {object} { status, progress, url }
   */
  getClipCacheStatus: (clipId) => {
    const state = get()
    const clip = state.clips.find(c => c.id === clipId)
    return {
      status: clip?.cacheStatus || 'none',
      progress: clip?.cacheProgress || 0,
      url: clip?.cacheUrl || null,
    }
  },

  /**
   * Check if a clip needs caching (has effects but no valid cache)
   * @param {string} clipId - The clip ID
   * @returns {boolean}
   */
  clipNeedsCache: (clipId) => {
    const state = get()
    const clip = state.clips.find(c => c.id === clipId)
    if (!clip) return false
    
    const hasEffects = (clip.effects || []).some(e => e.enabled)
    const hasValidCache = clip.cacheStatus === 'cached' && clip.cacheUrl
    
    return hasEffects && !hasValidCache
  },

  // ==================== END RENDER CACHE MANAGEMENT ====================

  /**
   * Trim a clip from the left (adjust in-point)
   */
  trimClipStart: (clipId, deltaTime) => {
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        
        const timeScale = getClipTimeScale(clip)
        const minSourceDuration = 0.5 * timeScale
        const currentTrimEnd = getClipTrimEnd(clip)
        const newTrimStart = Math.max(
          0,
          Math.min(currentTrimEnd - minSourceDuration, (clip.trimStart || 0) + deltaTime * timeScale)
        )
        const trimDeltaSource = newTrimStart - (clip.trimStart || 0)
        const trimDeltaTimeline = trimDeltaSource / timeScale
        
        return {
          ...clip,
          trimStart: newTrimStart,
          startTime: clip.startTime + trimDeltaTimeline,
          duration: clip.duration - trimDeltaTimeline
        }
      })
    }))
  },

  /**
   * Trim a clip from the right (adjust out-point)
   * Images can be extended indefinitely (sourceDuration = Infinity)
   */
  trimClipEnd: (clipId, deltaTime) => {
    set((state) => ({
      clips: state.clips.map(clip => {
        if (clip.id !== clipId) return clip
        
        // For images (Infinity source), allow extending without limit
        // For video/audio, cap at source duration
        const timeScale = getClipTimeScale(clip)
        const maxDuration = clip.sourceDuration === Infinity ? Infinity : clip.sourceDuration
        const minSourceDuration = 0.5 * timeScale
        const currentTrimEnd = getClipTrimEnd(clip)
        const newTrimEnd = Math.max(
          (clip.trimStart || 0) + minSourceDuration,
          Math.min(maxDuration, currentTrimEnd + deltaTime * timeScale)
        )
        const newDuration = (newTrimEnd - (clip.trimStart || 0)) / timeScale
        
        return {
          ...clip,
          trimEnd: newTrimEnd,
          duration: newDuration
        }
      })
    }))
  },

  /**
   * Calculate available handles for a clip
   * Head handle = trimStart (footage available before current in-point)
   * Tail handle = sourceDuration - trimEnd (footage available after current out-point)
   */
  getClipHandles: (clipId) => {
    const state = get()
    const clip = state.clips.find(c => c.id === clipId)
    if (!clip) return { head: 0, tail: 0 }
    
    const headHandle = sourceToTimelineTime(clip, clip.trimStart || 0)
    const sourceDuration = clip.sourceDuration || getClipTrimEnd(clip)
    const trimEnd = getClipTrimEnd(clip)
    const tailHandle = sourceToTimelineTime(clip, sourceDuration - trimEnd)
    
    return {
      head: Math.max(0, headHandle),
      tail: Math.max(0, tailHandle)
    }
  },

  /**
   * Calculate max transition duration between two clips
   * Limited by available handles on both clips
   */
  getMaxTransitionDuration: (clipAId, clipBId) => {
    const state = get()
    const clipA = state.clips.find(c => c.id === clipAId)
    const clipB = state.clips.find(c => c.id === clipBId)
    
    if (!clipA || !clipB) return 0
    
    // ClipA needs tail handle (to extend past its current end)
    const clipAHandles = get().getClipHandles(clipAId)
    // ClipB needs head handle (to start earlier than its current start)
    const clipBHandles = get().getClipHandles(clipBId)
    
    // Max duration is limited by both handles
    // Each clip contributes half the transition duration
    const maxFromA = clipAHandles.tail * 2
    const maxFromB = clipBHandles.head * 2
    
    // Also limited by clip durations (can't transition longer than the clip)
    const maxFromClipA = clipA.duration
    const maxFromClipB = clipB.duration
    
    return Math.min(maxFromA, maxFromB, maxFromClipA, maxFromClipB)
  },

  /**
   * Calculate max transition duration for a single clip edge (in/out)
   * Limited by the clip's duration
   */
  getMaxEdgeTransitionDuration: (clipId) => {
    const state = get()
    const clip = state.clips.find(c => c.id === clipId)
    if (!clip) return 0
    return Math.max(0, clip.duration)
  },

  /**
   * Build transition settings with defaults
   */
  buildTransitionSettings: (type, settings = {}) => {
    return {
      ...(TRANSITION_DEFAULT_SETTINGS[type] || {}),
      ...(settings || {})
    }
  },

  /**
   * Add a transition between two clips (Resolve-style)
   * This creates actual overlap by extending clipA and starting clipB earlier
   */
  addTransition: (clipAId, clipBId, transitionType = 'dissolve', duration = 0.5) => {
    const state = get()
    const clipA = state.clips.find(c => c.id === clipAId)
    const clipB = state.clips.find(c => c.id === clipBId)
    
    if (!clipA || !clipB) return null
    
    // Check if transition already exists
    const existingTransition = state.transitions.find(
      t => (t.clipAId === clipAId && t.clipBId === clipBId) ||
           (t.clipAId === clipBId && t.clipBId === clipAId)
    )
    if (existingTransition) return existingTransition
    
    // Validate that clips are on the same track and adjacent
    if (clipA.trackId !== clipB.trackId) {
      console.warn('Cannot add transition between clips on different tracks')
      return null
    }
    
    // Get max allowed transition duration based on available handles
    const maxDuration = get().getMaxTransitionDuration(clipAId, clipBId)
    if (maxDuration < 0.1) {
      console.warn('Insufficient handles for transition. Need more footage before/after trim points.')
      return null
    }
    
    // Clamp duration to available handles
    const actualDuration = Math.min(duration, maxDuration)
    const halfDuration = actualDuration / 2
    
    // Store the original edit point (where clips meet)
    const editPoint = clipA.startTime + clipA.duration
    
    // Save to history before modifying
    get().saveToHistory()
    
    const newTransition = {
      id: `transition-${state.transitionCounter}`,
      kind: 'between',
      clipAId,
      clipBId,
      type: transitionType,
      duration: actualDuration,
      settings: get().buildTransitionSettings(transitionType),
      // Store original positions for removal
      editPoint: editPoint,
      originalClipAEnd: clipA.startTime + clipA.duration,
      originalClipATrimEnd: clipA.trimEnd,
      originalClipBStart: clipB.startTime,
      originalClipBTrimStart: clipB.trimStart,
    }
    
    // Modify clips to create overlap:
    // ClipA extends by halfDuration (into clipB's original time)
    // ClipB starts halfDuration earlier (into clipA's original time)
    set((state) => ({
      clips: state.clips.map(c => {
        if (c.id === clipAId) {
          // Extend clipA's duration and trimEnd
          const trimEnd = getClipTrimEnd(c)
          const trimEndDelta = timelineToSourceTime(c, halfDuration)
          return {
            ...c,
            duration: c.duration + halfDuration,
            trimEnd: trimEnd + trimEndDelta
          }
        }
        if (c.id === clipBId) {
          // Start clipB earlier and adjust trimStart
          const trimStartDelta = timelineToSourceTime(c, halfDuration)
          return {
            ...c,
            startTime: c.startTime - halfDuration,
            duration: c.duration + halfDuration,
            trimStart: Math.max(0, (c.trimStart || 0) - trimStartDelta)
          }
        }
        return c
      }),
      transitions: [...state.transitions, newTransition],
      transitionCounter: state.transitionCounter + 1
    }))
    
    return newTransition
  },

  /**
   * Add a transition to a single clip edge (in/out)
   * This does not modify clip duration, it just applies an effect at the edge.
   */
  addEdgeTransition: (clipId, edge = 'in', transitionType = 'fade-black', duration = 0.5) => {
    const state = get()
    const clip = state.clips.find(c => c.id === clipId)
    if (!clip) return null
    
    // Only one edge transition per clip+edge
    const existing = state.transitions.find(
      t => t.kind === 'edge' && t.clipId === clipId && t.edge === edge
    )
    if (existing) return existing
    
    const maxDuration = get().getMaxEdgeTransitionDuration(clipId)
    if (maxDuration < 0.1) return null
    
    const actualDuration = Math.min(duration, maxDuration)
    
    // Save to history before modifying
    get().saveToHistory()
    
    const newTransition = {
      id: `transition-${state.transitionCounter}`,
      kind: 'edge',
      clipId,
      edge,
      type: transitionType,
      duration: actualDuration,
      settings: get().buildTransitionSettings(transitionType),
    }
    
    set((state) => ({
      transitions: [...state.transitions, newTransition],
      transitionCounter: state.transitionCounter + 1
    }))
    
    return newTransition
  },

  /**
   * Remove a transition and restore clips to their original positions
   */
  removeTransition: (transitionId) => {
    const state = get()
    const transition = state.transitions.find(t => t.id === transitionId)
    
    if (!transition) return
    
    // Save to history before modifying
    get().saveToHistory()

    // Edge transitions don't modify clips
    if (transition.kind === 'edge') {
      set((state) => ({
        transitions: state.transitions.filter(t => t.id !== transitionId)
      }))
      return
    }
    
    // Restore clips to their original positions (between transitions)
    set((state) => ({
      clips: state.clips.map(c => {
        if (c.id === transition.clipAId && transition.originalClipATrimEnd !== undefined) {
          const newDuration = transition.originalClipAEnd - c.startTime
          return {
            ...c,
            duration: newDuration,
            trimEnd: transition.originalClipATrimEnd
          }
        }
        if (c.id === transition.clipBId && transition.originalClipBStart !== undefined) {
          const durationDiff = c.startTime - transition.originalClipBStart
          return {
            ...c,
            startTime: transition.originalClipBStart,
            duration: c.duration - durationDiff,
            trimStart: transition.originalClipBTrimStart
          }
        }
        return c
      }),
      transitions: state.transitions.filter(t => t.id !== transitionId)
    }))
  },

  /**
   * Update transition duration (adjusts clip overlap accordingly)
   */
  updateTransition: (transitionId, updates) => {
    const state = get()
    const transition = state.transitions.find(t => t.id === transitionId)
    
    if (!transition || updates.duration === undefined) {
      set((state) => ({
        transitions: state.transitions.map(t =>
          t.id === transitionId
            ? {
                ...t,
                ...updates,
                settings: updates.settings
                  ? get().buildTransitionSettings(updates.type || t.type, {
                      ...(t.settings || {}),
                      ...updates.settings
                    })
                  : t.settings
              }
            : t
        )
      }))
      return
    }

    // Edge transitions just update duration (clamped)
    if (transition.kind === 'edge') {
      const maxDuration = get().getMaxEdgeTransitionDuration(transition.clipId)
      const actualNewDuration = Math.min(updates.duration, maxDuration)
      
      get().saveToHistory()
      set((state) => ({
        transitions: state.transitions.map(t =>
          t.id === transitionId
            ? {
                ...t,
                ...updates,
                duration: actualNewDuration,
                settings: updates.settings
                  ? get().buildTransitionSettings(updates.type || t.type, {
                      ...(t.settings || {}),
                      ...updates.settings
                    })
                  : t.settings
              }
            : t
        )
      }))
      return
    }
    
    // If duration is changing, we need to adjust the clip overlap
    const newDuration = updates.duration
    const oldDuration = transition.duration
    const durationDiff = newDuration - oldDuration
    const halfDiff = durationDiff / 2
    
    // Validate new duration against available handles
    const maxDuration = get().getMaxTransitionDuration(transition.clipAId, transition.clipBId)
    const actualNewDuration = Math.min(newDuration, maxDuration + oldDuration)
    const actualHalfDiff = (actualNewDuration - oldDuration) / 2
    
    // Save to history
    get().saveToHistory()
    
    set((state) => ({
      clips: state.clips.map(c => {
        if (c.id === transition.clipAId) {
          const trimEnd = getClipTrimEnd(c)
          const trimEndDelta = timelineToSourceTime(c, actualHalfDiff)
          return {
            ...c,
            duration: c.duration + actualHalfDiff,
            trimEnd: trimEnd + trimEndDelta
          }
        }
        if (c.id === transition.clipBId) {
          const trimStartDelta = timelineToSourceTime(c, actualHalfDiff)
          return {
            ...c,
            startTime: c.startTime - actualHalfDiff,
            duration: c.duration + actualHalfDiff,
            trimStart: Math.max(0, (c.trimStart || 0) - trimStartDelta)
          }
        }
        return c
      }),
      transitions: state.transitions.map(t =>
        t.id === transitionId
          ? {
              ...t,
              ...updates,
              duration: actualNewDuration,
              settings: updates.settings
                ? get().buildTransitionSettings(updates.type || t.type, {
                    ...(t.settings || {}),
                    ...updates.settings
                  })
                : t.settings
            }
          : t
      )
    }))
  },

  /**
   * Get the active video clip at a specific time (topmost video track)
   */
  getActiveClipAtTime: (time) => {
    const state = get()
    // Get video tracks in reverse order (top track = highest priority)
    const videoTracks = state.tracks.filter(t => t.type === 'video' && t.visible && !t.muted)
    
    for (const track of videoTracks) {
      const clip = state.clips.find(c => 
        c.trackId === track.id &&
        time >= c.startTime &&
        time < c.startTime + c.duration
      )
      if (clip) return clip
    }
    return null
  },

  /**
   * Get all active clips at a specific time (for compositing)
   */
  getActiveClipsAtTime: (time) => {
    const state = get()
    const activeClips = []
    
    for (const track of state.tracks) {
      if (!track.visible || track.muted) continue
      
      const trackClips = state.clips.filter(c =>
        c.trackId === track.id &&
        time >= c.startTime &&
        time < c.startTime + c.duration
      )
      if (trackClips.length > 0) {
        // Keep deterministic order (earlier clips first)
        trackClips
          .sort((a, b) => a.startTime - b.startTime)
          .forEach(clip => activeClips.push({ clip, track }))
      }
    }
    return activeClips
  },

  /**
   * Get transition info at a specific time (if in transition zone)
   * With the new overlap model:
   * - ClipA and ClipB now overlap for transition.duration
   * - The overlap zone IS the transition zone
   * - transitionStart = clipB.startTime (which is now earlier than original edit point)
   * - transitionEnd = clipA.startTime + clipA.duration (which is now later than original edit point)
   */
  getTransitionAtTime: (time) => {
    const state = get()
    
    for (const transition of state.transitions) {
      if (transition.kind === 'edge') {
        const clip = state.clips.find(c => c.id === transition.clipId)
        if (!clip) continue
        
        const duration = Math.min(transition.duration, clip.duration)
        if (duration <= 0) continue
        
        if (transition.edge === 'in') {
          const start = clip.startTime
          const end = start + duration
          if (time >= start && time < end) {
            const progress = (time - start) / duration
            return { transition, clip, edge: 'in', progress }
          }
        } else {
          const end = clip.startTime + clip.duration
          const start = end - duration
          if (time >= start && time < end) {
            const progress = (time - start) / duration
            return { transition, clip, edge: 'out', progress }
          }
        }
        
        continue
      }
      
      const clipA = state.clips.find(c => c.id === transition.clipAId)
      const clipB = state.clips.find(c => c.id === transition.clipBId)
      
      if (!clipA || !clipB) continue
      
      // With overlap model:
      // - ClipB.startTime is where the transition starts
      // - ClipA.startTime + ClipA.duration is where the transition ends
      // Both clips are visible during this overlap period
      const transitionStart = clipB.startTime
      const clipAEnd = clipA.startTime + clipA.duration
      
      // The overlap zone is where both clips exist simultaneously
      if (time >= transitionStart && time < clipAEnd) {
        // Progress goes from 0 (start of clipB) to 1 (end of clipA overlap)
        const progress = (time - transitionStart) / transition.duration
        return { transition, clipA, clipB, progress: Math.min(1, Math.max(0, progress)) }
      }
    }
    return null
  },

  /**
   * Get the end time of the last clip
   */
  getTimelineEndTime: () => {
    const state = get()
    if (state.clips.length === 0) return 0
    return Math.max(...state.clips.map(c => c.startTime + c.duration))
  },

  /**
   * Select a clip (supports multi-select modes)
   * @param {string} clipId - The clip to select
   * @param {object} options - Selection options
   * @param {boolean} options.addToSelection - Add to existing selection (Shift+click)
   * @param {boolean} options.toggleSelection - Toggle this clip in selection (Ctrl/Cmd+click)
   */
  selectClip: (clipId, options = {}) => {
    const { addToSelection = false, toggleSelection = false } = options
    
    set((state) => {
      if (toggleSelection) {
        // Ctrl/Cmd+click: toggle this clip in selection
        const isSelected = state.selectedClipIds.includes(clipId)
        if (isSelected) {
          return { selectedClipIds: state.selectedClipIds.filter(id => id !== clipId) }
        } else {
          return { selectedClipIds: [...state.selectedClipIds, clipId] }
        }
      } else if (addToSelection) {
        // Shift+click: add to selection (or range select)
        if (state.selectedClipIds.includes(clipId)) {
          return state // Already selected
        }
        return { selectedClipIds: [...state.selectedClipIds, clipId] }
      } else {
        // Normal click: replace selection
        return { selectedClipIds: [clipId] }
      }
    })
  },

  /**
   * Clear all selections
   */
  clearSelection: () => {
    set({ selectedClipIds: [] })
  },

  /**
   * Request opening the Inspector for a clip (optionally mask picker)
   */
  requestMaskPicker: (clipId, options = {}) => {
    const { openPicker = true } = options
    set({ maskPickerRequest: { clipId, openPicker } })
  },

  /**
   * Clear mask picker request
   */
  clearMaskPickerRequest: () => {
    set({ maskPickerRequest: null })
  },

  /**
   * Select multiple clips at once
   */
  selectClips: (clipIds) => {
    set({ selectedClipIds: clipIds })
  },

  /**
   * Check if a clip is selected
   */
  isClipSelected: (clipId) => {
    return get().selectedClipIds.includes(clipId)
  },

  /**
   * Set playhead position
   */
  setPlayheadPosition: (position) => {
    set({ playheadPosition: Math.max(0, position) })
  },

  /**
   * Set active track for cut-at-playhead (X key). Only the active track is split when pressing X.
   */
  setActiveTrack: (trackId) => {
    set({ activeTrackId: trackId })
  },

  /**
   * Toggle play/pause
   */
  togglePlay: () => {
    set((state) => ({ 
      isPlaying: !state.isPlaying,
      playbackRate: state.isPlaying ? state.playbackRate : 1, // Reset to 1x when starting
      shuttleMode: false
    }))
  },

  /**
   * Set playback rate (for JKL shuttle)
   */
  setPlaybackRate: (rate) => {
    set({ playbackRate: rate })
  },

  /**
   * JKL Shuttle: J key - play reverse (multiple presses increase speed)
   */
  shuttleReverse: () => {
    set((state) => {
      const speeds = [-1, -2, -4, -8]
      
      if (!state.isPlaying || state.playbackRate > 0) {
        // Not playing or playing forward - start reverse at 1x
        return { isPlaying: true, playbackRate: -1, shuttleMode: true }
      }
      
      // Already playing reverse - increase speed
      const currentIndex = speeds.indexOf(state.playbackRate)
      const nextIndex = Math.min(currentIndex + 1, speeds.length - 1)
      return { playbackRate: speeds[nextIndex], shuttleMode: true }
    })
  },

  /**
   * JKL Shuttle: K key - pause
   */
  shuttlePause: () => {
    set({ isPlaying: false, playbackRate: 1, shuttleMode: false })
  },

  /**
   * JKL Shuttle: L key - play forward (multiple presses increase speed)
   */
  shuttleForward: () => {
    set((state) => {
      const speeds = [1, 2, 4, 8]
      
      if (!state.isPlaying || state.playbackRate < 0) {
        // Not playing or playing reverse - start forward at 1x
        return { isPlaying: true, playbackRate: 1, shuttleMode: true }
      }
      
      // Already playing forward - increase speed
      const currentIndex = speeds.indexOf(state.playbackRate)
      const nextIndex = Math.min(currentIndex + 1, speeds.length - 1)
      return { playbackRate: speeds[nextIndex], shuttleMode: true }
    })
  },

  /**
   * JKL Shuttle: K+J or K+L - slow shuttle (hold K and tap J or L)
   */
  shuttleSlow: (direction) => {
    set((state) => {
      const rate = direction === 'reverse' ? -0.5 : 0.5
      return { isPlaying: true, playbackRate: rate, shuttleMode: true }
    })
  },

  /**
   * Set playback loop mode
   * @param {'normal' | 'loop' | 'loop-in-out' | 'ping-pong'} mode
   */
  setLoopMode: (mode) => {
    set({ loopMode: mode })
  },

  /**
   * Set zoom level (20% - 2000%)
   */
  setZoom: (zoom) => {
    set({ zoom: Math.max(20, Math.min(2000, zoom)) })
  },

  /**
   * Toggle track mute
   */
  toggleTrackMute: (trackId) => {
    set((state) => ({
      tracks: state.tracks.map(track =>
        track.id === trackId ? { ...track, muted: !track.muted } : track
      )
    }))
  },

  /**
   * Toggle track lock
   */
  toggleTrackLock: (trackId) => {
    set((state) => ({
      tracks: state.tracks.map(track =>
        track.id === trackId ? { ...track, locked: !track.locked } : track
      )
    }))
  },

  /**
   * Toggle track visibility
   */
  toggleTrackVisibility: (trackId) => {
    set((state) => ({
      tracks: state.tracks.map(track =>
        track.id === trackId ? { ...track, visible: !track.visible } : track
      )
    }))
  },

  /**
   * Add a new track
   * @param {string} type - 'video' | 'audio'
   * @param {object} options - For audio: { channels: 'mono' | 'stereo' }
   */
  addTrack: (type, options = {}) => {
    const state = get()
    const existingTracks = state.tracks.filter(t => t.type === type)
    
    // Generate unique ID by finding the highest existing number
    let maxNum = 0
    existingTracks.forEach(t => {
      const match = t.id.match(new RegExp(`^${type}-(\\d+)$`))
      if (match) {
        maxNum = Math.max(maxNum, parseInt(match[1]))
      }
    })
    
    const newTrack = {
      id: `${type}-${maxNum + 1}`,
      name: `${type === 'video' ? 'Video' : 'Audio'} ${maxNum + 1}`,
      type,
      muted: false,
      locked: false,
      visible: true
    }
    if (type === 'audio') {
      newTrack.channels = options.channels === 'mono' ? 'mono' : 'stereo'
    }
    
    set((state) => {
      // For video tracks, add to the beginning (top)
      // For audio tracks, add to the end (bottom)
      if (type === 'video') {
        const videoTracks = state.tracks.filter(t => t.type === 'video')
        const audioTracks = state.tracks.filter(t => t.type === 'audio')
        return {
          tracks: [newTrack, ...videoTracks, ...audioTracks]
        }
      } else {
        return {
          tracks: [...state.tracks, newTrack]
        }
      }
    })
    
    return newTrack
  },

  /**
   * Remove a track (and all its clips)
   * Prevents removing the last video or audio track
   */
  removeTrack: (trackId) => {
    const state = get()
    const track = state.tracks.find(t => t.id === trackId)
    if (!track) return false
    
    // Count tracks of this type
    const tracksOfType = state.tracks.filter(t => t.type === track.type)
    
    // Prevent removing the last track of a type
    if (tracksOfType.length <= 1) {
      return false
    }
    
    // Save to history before modifying
    get().saveToHistory()
    
    set((state) => ({
      tracks: state.tracks.filter(t => t.id !== trackId),
      // Also remove all clips on this track
      clips: state.clips.filter(c => c.trackId !== trackId),
      // Clear selection if any selected clips were on this track
      selectedClipIds: state.selectedClipIds.filter(id => {
        const clip = state.clips.find(c => c.id === id)
        return clip && clip.trackId !== trackId
      })
    }))
    
    return true
  },

  /**
   * Rename a track
   */
  renameTrack: (trackId, newName) => {
    if (!newName || newName.trim() === '') return false
    
    // Save to history before modifying
    get().saveToHistory()
    
    set((state) => ({
      tracks: state.tracks.map(track =>
        track.id === trackId ? { ...track, name: newName.trim() } : track
      )
    }))
    
    return true
  },

  /**
   * Reorder a track within its type group (video or audio)
   * @param {string} trackId - The track to move
   * @param {number} newIndex - The new index within its type group
   */
  reorderTrack: (trackId, newIndex) => {
    const state = get()
    const track = state.tracks.find(t => t.id === trackId)
    if (!track) return
    
    const trackType = track.type
    const tracksOfType = state.tracks.filter(t => t.type === trackType)
    const otherTracks = state.tracks.filter(t => t.type !== trackType)
    
    // Find current index within type group
    const currentIndex = tracksOfType.findIndex(t => t.id === trackId)
    if (currentIndex === newIndex) return
    
    // Clamp newIndex
    const clampedIndex = Math.max(0, Math.min(tracksOfType.length - 1, newIndex))
    
    // Remove track from current position and insert at new position
    const reorderedTracks = [...tracksOfType]
    reorderedTracks.splice(currentIndex, 1)
    reorderedTracks.splice(clampedIndex, 0, track)
    
    // Save to history
    get().saveToHistory()
    
    // Reconstruct tracks array with video first, then audio
    const videoTracks = trackType === 'video' ? reorderedTracks : otherTracks.filter(t => t.type === 'video')
    const audioTracks = trackType === 'audio' ? reorderedTracks : otherTracks.filter(t => t.type === 'audio')
    
    set({ tracks: [...videoTracks, ...audioTracks] })
  },

  /**
   * Get clip at specific time on specific track
   */
  getClipAtTime: (trackId, time) => {
    const state = get()
    return state.clips.find(clip => 
      clip.trackId === trackId &&
      time >= clip.startTime &&
      time < clip.startTime + clip.duration
    )
  },

  /**
   * Clear all project data (for "New Project")
   */
  clearProject: () => {
    set({
      duration: 60,
      zoom: 100,
      playheadPosition: 0,
      isPlaying: false,
      playbackRate: 1,
      shuttleMode: false,
      loopMode: 'normal',
      tracks: [
        { id: 'video-1', name: 'Video 1', type: 'video', muted: false, locked: false, visible: true },
        { id: 'video-2', name: 'Video 2', type: 'video', muted: false, locked: false, visible: true },
        { id: 'audio-1', name: 'Audio 1', type: 'audio', channels: 'stereo', muted: false, locked: false, visible: true },
        { id: 'audio-2', name: 'Audio 2', type: 'audio', channels: 'stereo', muted: false, locked: false, visible: true },
        { id: 'audio-3', name: 'Audio 3', type: 'audio', channels: 'stereo', muted: false, locked: false, visible: true },
      ],
      clips: [],
      transitions: [],
      selectedClipIds: [],
      activeTrackId: null,
      clipCounter: 1,
      transitionCounter: 1,
      snappingEnabled: true,
      snappingThreshold: 10,
      activeSnapTime: null,
      rippleEditMode: false,
      inPoint: null,
      outPoint: null,
      // Clear undo/redo history
      history: [],
      historyIndex: -1,
    })
  },

  /**
   * Load timeline data from a project
   * @param {object} timelineData - Timeline data from project file
   */
  loadFromProject: (timelineData, assets = [], timelineFps = null) => {
    if (!timelineData) return
    const normalizedClips = normalizeClipTimebases(timelineData.clips || [], assets, timelineFps)

    set({
      duration: timelineData.duration || 60,
      zoom: timelineData.zoom || 100,
      tracks: timelineData.tracks || [
        { id: 'video-1', name: 'Video 1', type: 'video', muted: false, locked: false, visible: true },
        { id: 'video-2', name: 'Video 2', type: 'video', muted: false, locked: false, visible: true },
        { id: 'audio-1', name: 'Audio 1', type: 'audio', channels: 'stereo', muted: false, locked: false, visible: true },
        { id: 'audio-2', name: 'Audio 2', type: 'audio', channels: 'stereo', muted: false, locked: false, visible: true },
        { id: 'audio-3', name: 'Audio 3', type: 'audio', channels: 'stereo', muted: false, locked: false, visible: true },
      ],
      clips: normalizedClips,
      transitions: timelineData.transitions || [],
      clipCounter: timelineData.clipCounter || 1,
      transitionCounter: timelineData.transitionCounter || 1,
      snappingEnabled: timelineData.snappingEnabled ?? true,
      snappingThreshold: timelineData.snappingThreshold || 10,
      rippleEditMode: timelineData.rippleEditMode || false,
      // Reset playback state
      playheadPosition: 0,
      isPlaying: false,
      playbackRate: 1,
      shuttleMode: false,
      loopMode: 'normal',
      selectedClipIds: [],
      activeSnapTime: null,
      inPoint: null,
      outPoint: null,
      // Clear history on load
      history: [],
      historyIndex: -1,
    })
  },

  /**
   * Get timeline data for saving to project
   */
  getProjectData: () => {
    const state = get()
    return {
      duration: state.duration,
      zoom: state.zoom,
      tracks: state.tracks,
      clips: state.clips,
      transitions: state.transitions,
      clipCounter: state.clipCounter,
      transitionCounter: state.transitionCounter,
      snappingEnabled: state.snappingEnabled,
      snappingThreshold: state.snappingThreshold,
      rippleEditMode: state.rippleEditMode,
    }
  },

  /**
   * Toggle snapping on/off
   */
  toggleSnapping: () => {
    set((state) => ({ snappingEnabled: !state.snappingEnabled }))
  },

  /**
   * Set snapping enabled/disabled
   */
  setSnappingEnabled: (enabled) => {
    set({ snappingEnabled: enabled })
  },

  /**
   * Set snapping threshold (in pixels)
   */
  setSnappingThreshold: (threshold) => {
    set({ snappingThreshold: Math.max(5, Math.min(30, threshold)) })
  },

  /**
   * Set active snap time for visual feedback
   */
  setActiveSnapTime: (time) => {
    set({ activeSnapTime: time })
  },

  /**
   * Clear active snap indicator
   */
  clearActiveSnap: () => {
    set({ activeSnapTime: null })
  },

  /**
   * Toggle ripple edit mode
   */
  toggleRippleEdit: () => {
    set((state) => ({ rippleEditMode: !state.rippleEditMode }))
  },

  /**
   * Set ripple edit mode
   */
  setRippleEditMode: (enabled) => {
    set({ rippleEditMode: enabled })
  },

  /**
   * Get clips that would be affected by ripple edit
   * (clips on the same track after the given time)
   */
  getClipsToRipple: (trackId, afterTime) => {
    const state = get()
    return state.clips
      .filter(c => c.trackId === trackId && c.startTime >= afterTime)
      .sort((a, b) => a.startTime - b.startTime)
  },

  /**
   * Set In point at current playhead position
   */
  setInPoint: (time = null) => {
    set((state) => ({ 
      inPoint: time !== null ? time : state.playheadPosition 
    }))
  },

  /**
   * Set Out point at current playhead position
   */
  setOutPoint: (time = null) => {
    set((state) => ({ 
      outPoint: time !== null ? time : state.playheadPosition 
    }))
  },

  /**
   * Clear In point
   */
  clearInPoint: () => {
    set({ inPoint: null })
  },

  /**
   * Clear Out point
   */
  clearOutPoint: () => {
    set({ outPoint: null })
  },

  /**
   * Clear both In and Out points
   */
  clearInOutPoints: () => {
    set({ inPoint: null, outPoint: null })
  },

  /**
   * Go to In point
   */
  goToInPoint: () => {
    const state = get()
    if (state.inPoint !== null) {
      set({ playheadPosition: state.inPoint })
    }
  },

  /**
   * Go to Out point
   */
  goToOutPoint: () => {
    const state = get()
    if (state.outPoint !== null) {
      set({ playheadPosition: state.outPoint })
    }
  }
    }),
    {
      name: 'storyflow-timeline', // localStorage key
      partialize: (state) => ({
        // Only persist these fields (exclude transient UI state)
        duration: state.duration,
        zoom: state.zoom,
        tracks: state.tracks,
        clips: state.clips,
        transitions: state.transitions,
        clipCounter: state.clipCounter,
        transitionCounter: state.transitionCounter,
        snappingEnabled: state.snappingEnabled,
        snappingThreshold: state.snappingThreshold,
        rippleEditMode: state.rippleEditMode,
        // Note: Transient UI state NOT persisted:
        // - activeSnapTime, selectedClipIds, playheadPosition
        // - isPlaying, playbackRate, shuttleMode
        // - inPoint, outPoint (session-specific)
      }),
    }
  )
)

// Helper function to get video clip colors (desaturated palette)
function getVideoColor(index) {
  const colors = [
    '#5a7a9e', // desaturated blue
    '#7a6a9e', // desaturated purple
    '#b06a8a', // desaturated pink
    '#4a8a7a', // desaturated green
    '#6a7080', // desaturated blue
    '#b06a6a', // desaturated red
  ]
  return colors[index % colors.length]
}

// Helper function to get audio clip colors (desaturated palette)
function getAudioColor(trackId) {
  const colors = {
    'music': '#4a8a6a', // desaturated green
    'voiceover': '#565C6B', // muted blue
    'sfx': '#8a6a9a', // desaturated purple
  }
  return colors[trackId] || '#6B7280'
}

export default useTimelineStore
