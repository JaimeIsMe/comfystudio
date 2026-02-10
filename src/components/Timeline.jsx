import { useState, useRef, useEffect, useMemo } from 'react'
import { 
  Volume2, VolumeX, Lock, Unlock, Eye, EyeOff, 
  Plus, Video, Type, Image as ImageIcon,
  Sparkles, GripVertical, Magnet, ArrowRightLeft, Square, X, Check, Pencil,
  Undo2, Redo2, Diamond, Zap, AlertTriangle, Loader2, ChevronRight
} from 'lucide-react'
import useTimelineStore from '../stores/timelineStore'
import useProjectStore from '../stores/projectStore'
import renderCacheService from '../services/renderCache'
import { deleteRenderCache } from '../services/fileSystem'
import { clearDiskCacheUrl } from './VideoLayerRenderer'
import useAssetsStore from '../stores/assetsStore'
import { useSnapping, SNAP_TYPES } from '../hooks/useSnapping'
import { getAllKeyframeTimes } from '../utils/keyframes'
import { TRANSITION_TYPES, TRANSITION_DURATIONS, FRAME_RATE } from '../constants/transitions'
import MasterAudioMeter from './AudioMeter'

function Timeline({ onOpenAudioGenerate }) {
  const timelineRef = useRef(null)
  const trackHeadersRef = useRef(null)
  const trackContentRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragClip, setDragClip] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  
  // Track headers width (resizable) — default wide enough to read labels; persisted
  const TRACK_HEADERS_MIN = 100
  const TRACK_HEADERS_MAX = 400
  const TRACK_HEADERS_STORAGE_KEY = 'storyflow-timeline-track-headers-width'
  const AUDIO_TRACK_HEIGHT_MONO = 40
  const AUDIO_TRACK_HEIGHT_STEREO = 80
  const getAudioTrackHeight = (track) => (track.channels === 'mono' ? AUDIO_TRACK_HEIGHT_MONO : AUDIO_TRACK_HEIGHT_STEREO)
  const getAudioTrackOffset = (audioTracksList, index) => {
    let y = 0
    for (let i = 0; i < index; i++) y += getAudioTrackHeight(audioTracksList[i])
    return y
  }
  const [trackHeadersWidth, setTrackHeadersWidth] = useState(() => {
    try {
      const w = localStorage.getItem(TRACK_HEADERS_STORAGE_KEY)
      if (w != null) {
        const n = parseInt(w, 10)
        if (Number.isFinite(n) && n >= TRACK_HEADERS_MIN && n <= TRACK_HEADERS_MAX) return n
      }
    } catch (_) {}
    return 208 // default wider so "Video 1", "AUDIO", icons and P are readable
  })
  const [isResizingHeaders, setIsResizingHeaders] = useState(false)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)
  const lastTrackHeadersWidthRef = useRef(null) // for persisting on resize end
  
  // Trimming state
  const [trimState, setTrimState] = useState(null) // { clipId, edge: 'left' | 'right', startX, startValue }

  const getTimeScale = (clip) => {
    if (!clip) return 1
    if (clip.sourceTimeScale) return clip.sourceTimeScale
    if (clip.timelineFps && clip.sourceFps) {
      return clip.timelineFps / clip.sourceFps
    }
    return 1
  }
  
  // Scrubbing state (for dragging playhead)
  const [isScrubbing, setIsScrubbing] = useState(false)
  
  // Clip dragging state (moving clips within timeline)
  const [clipDragState, setClipDragState] = useState(null) // { clipId, startX, originalStartTime, originalTrackId }
  
  // Marquee selection state
  const [marqueeState, setMarqueeState] = useState(null) // { startX, startY, currentX, currentY, scrollLeft, scrollTop }
  
  // Transition type menu state
  const [transitionMenu, setTransitionMenu] = useState(null) // { x, y, clipA, clipB }
  
  // Transition drag/drop state
  const [transitionDropTarget, setTransitionDropTarget] = useState(null) // `${clipAId}-${clipBId}`
  
  // Transition dragging state
  const [transitionDragState, setTransitionDragState] = useState(null) // { transitionId, startX, startDuration }
  
  // Roll edit state (dragging between two adjacent clips)
  const [rollEditState, setRollEditState] = useState(null) // { clipAId, clipBId, startX, originalEditPoint }
  
  // Spacebar panning state
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState(null) // { x, y, scrollLeft, scrollTop }
  const [isSpaceHeld, setIsSpaceHeld] = useState(false)
  
  // Transition types and durations are defined in constants/transitions
  
  // Clip context menu state
  const [clipContextMenu, setClipContextMenu] = useState(null) // { x, y, clipId }
  const [maskSubmenuOpen, setMaskSubmenuOpen] = useState(false)
  
  // Track rename state
  const [renamingTrackId, setRenamingTrackId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  
  // Track reorder drag state
  const [trackDragState, setTrackDragState] = useState(null) // { trackId, trackType, startY, originalIndex }
  const [trackDropTarget, setTrackDropTarget] = useState(null) // index within type group
  
  // Timeline store
  const {
    duration,
    zoom,
    playheadPosition,
    tracks,
    clips,
    transitions,
    selectedClipIds,
    activeTrackId,
    setActiveTrack,
    snappingEnabled,
    activeSnapTime,
    rippleEditMode,
    inPoint,
    outPoint,
    addClip,
    removeClip,
    removeSelectedClips,
    moveClip,
    moveSelectedClips,
    resizeClip,
    updateClipTrim,
    selectClip,
    clearSelection,
    setPlayheadPosition,
    setZoom,
    toggleTrackMute,
    toggleTrackLock,
    toggleTrackVisibility,
    addTrack,
    addTransition,
    removeTransition,
    updateTransition,
    getMaxTransitionDuration,
    addMaskEffect,
    toggleSnapping,
    toggleRippleEdit,
    setActiveSnapTime,
    clearActiveSnap,
    removeTrack,
    renameTrack,
    reorderTrack,
    undo,
    redo,
    canUndo,
    canRedo,
    saveToHistory,
    clearClipCache,
    requestMaskPicker
  } = useTimelineStore()

  const { currentProjectHandle, getCurrentTimelineSettings } = useProjectStore()
  const timelineFps = getCurrentTimelineSettings()?.fps
  
  const edgeTransitionsByClipId = useMemo(() => {
    const map = new Map()
    transitions
      .filter(t => t.kind === 'edge' && t.clipId)
      .forEach(t => {
        if (!map.has(t.clipId)) {
          map.set(t.clipId, [])
        }
        map.get(t.clipId).push(t)
      })
    return map
  }, [transitions])
  
  // Snapping hook
  const { snapClipPosition, snapTrim, pixelsPerSecond: snapPixelsPerSecond } = useSnapping()

  // Assets store for drag & drop and preview mode
  const { assets, currentPreview, setPreview, setPreviewMode, getAssetUrl, isPlaying: assetIsPlaying, setIsPlaying: setAssetIsPlaying } = useAssetsStore()

  const availableMasks = useMemo(() => {
    return assets.filter(a => a.type === 'mask')
  }, [assets])
  
  // Helper to get clip URL - uses asset store URL if available (handles refreshed blob URLs)
  const getClipUrl = (clip) => {
    if (!clip) return null
    if (clip.type === 'text') return null
    // Try to get current URL from assets store (may have been regenerated after refresh)
    if (clip.assetId) {
      const assetUrl = getAssetUrl(clip.assetId)
      if (assetUrl) return assetUrl
    }
    // Fallback to clip's stored URL
    return clip.url
  }

  // Pixels per second based on zoom
  const pixelsPerSecond = zoom / 5

  // Filtered tracks by type (moved up for use in effects)
  const videoTracks = tracks.filter(t => t.type === 'video')
  const audioTracks = tracks.filter(t => t.type === 'audio')

  // Calculate time from mouse position
  const getTimeFromMouseEvent = (e) => {
    if (!timelineRef.current) return 0
    const rect = timelineRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft
    const time = x / pixelsPerSecond
    return Math.max(0, Math.min(duration, time))
  }

  // Handle playhead scrubbing - start on mousedown
  const handleTimelineMouseDown = (e) => {
    // Don't start scrubbing if clicking on a clip or trim handle
    if (e.target.closest('[data-clip]') || e.target.closest('[data-trim-handle]')) {
      return
    }
    
    e.preventDefault()
    
    // Check for spacebar held - start panning
    if (isSpaceHeld) {
      setIsPanning(true)
      setPanStart({
        x: e.clientX,
        y: e.clientY,
        scrollLeft: timelineRef.current?.scrollLeft || 0,
        scrollTop: trackContentRef.current?.scrollTop || 0
      })
      return
    }
    
    // Switch to timeline preview mode when clicking on timeline
    // Also pause asset playback if it's playing
    if (clips.length > 0) {
      setPreviewMode('timeline')
      if (assetIsPlaying) {
        setAssetIsPlaying(false)
      }
    }
    
    // Check for Alt+Click to start marquee selection
    if (e.altKey) {
      // Start marquee selection
      const rect = timelineRef.current.getBoundingClientRect()
      setMarqueeState({
        startX: e.clientX - rect.left + timelineRef.current.scrollLeft,
        startY: e.clientY - rect.top + timelineRef.current.scrollTop,
        currentX: e.clientX - rect.left + timelineRef.current.scrollLeft,
        currentY: e.clientY - rect.top + timelineRef.current.scrollTop,
        scrollLeft: timelineRef.current.scrollLeft,
        scrollTop: timelineRef.current.scrollTop
      })
      
      // Clear selection unless Shift is held (to add to selection)
      if (!e.shiftKey) {
        clearSelection()
      }
      return
    }
    
    // Regular click - start scrubbing
    setIsScrubbing(true)
    
    // Don't clear selection when clicking on empty space - keep showing last selected clip in inspector
    // User can press Escape to explicitly clear selection if needed
    
    // Immediately move playhead to click position
    const time = getTimeFromMouseEvent(e)
    setPlayheadPosition(time)
  }

  // Handle scrubbing mouse move and mouse up
  useEffect(() => {
    if (!isScrubbing) return
    
    const handleMouseMove = (e) => {
      const time = getTimeFromMouseEvent(e)
      setPlayheadPosition(time)
    }
    
    const handleMouseUp = () => {
      setIsScrubbing(false)
    }
    
    // Add listeners to window so dragging works even outside the timeline
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isScrubbing, pixelsPerSecond, duration, setPlayheadPosition])

  // Handle track headers resize
  useEffect(() => {
    if (!isResizingHeaders) return
    
    const handleMouseMove = (e) => {
      const deltaX = e.clientX - resizeStartX.current
      const newWidth = Math.max(TRACK_HEADERS_MIN, Math.min(TRACK_HEADERS_MAX, resizeStartWidth.current + deltaX))
      lastTrackHeadersWidthRef.current = newWidth
      setTrackHeadersWidth(newWidth)
    }
    
    const handleMouseUp = () => {
      const widthToSave = lastTrackHeadersWidthRef.current
      if (widthToSave != null) {
        try {
          localStorage.setItem(TRACK_HEADERS_STORAGE_KEY, String(widthToSave))
        } catch (_) {}
      }
      setIsResizingHeaders(false)
    }
    
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingHeaders])

  // Handle marquee selection mouse move and mouse up
  useEffect(() => {
    if (!marqueeState) return
    
    const handleMouseMove = (e) => {
      if (!timelineRef.current) return
      const rect = timelineRef.current.getBoundingClientRect()
      setMarqueeState(prev => ({
        ...prev,
        currentX: e.clientX - rect.left + timelineRef.current.scrollLeft,
        currentY: e.clientY - rect.top + timelineRef.current.scrollTop
      }))
    }
    
    const handleMouseUp = (e) => {
      if (!marqueeState || !timelineRef.current) {
        setMarqueeState(null)
        return
      }
      
      // Calculate marquee bounds in timeline coordinates
      const left = Math.min(marqueeState.startX, marqueeState.currentX)
      const right = Math.max(marqueeState.startX, marqueeState.currentX)
      const top = Math.min(marqueeState.startY, marqueeState.currentY)
      const bottom = Math.max(marqueeState.startY, marqueeState.currentY)
      
      // Convert to time range
      const startTime = left / pixelsPerSecond
      const endTime = right / pixelsPerSecond
      
      // Account for ruler height and track positions
      const rulerHeight = 20
      const videoTrackHeight = 48
      const audioSectionHeight = 20
      
      // Find clips that intersect with the marquee
      const clipsToSelect = []
      
      clips.forEach(clip => {
        const clipEnd = clip.startTime + clip.duration
        if (!(clip.startTime >= endTime || clipEnd <= startTime)) {
          const track = tracks.find(t => t.id === clip.trackId)
          if (!track) return
          
          let clipY = rulerHeight
          const trackType = track.type
          
          if (trackType === 'video') {
            const videoTrackIndex = videoTracks.findIndex(t => t.id === clip.trackId)
            clipY += videoTrackIndex * videoTrackHeight
            const clipHeight = videoTrackHeight
            const clipBottom = clipY + clipHeight
            if (!(clipY >= bottom || clipBottom <= top)) clipsToSelect.push(clip.id)
          } else {
            const audioTrackIndex = audioTracks.findIndex(t => t.id === clip.trackId)
            clipY += videoTracks.length * videoTrackHeight + audioSectionHeight + getAudioTrackOffset(audioTracks, audioTrackIndex)
            const clipHeight = getAudioTrackHeight(track)
            const clipBottom = clipY + clipHeight
            if (!(clipY >= bottom || clipBottom <= top)) clipsToSelect.push(clip.id)
          }
        }
      })
      
      // Select the intersecting clips
      if (clipsToSelect.length > 0) {
        // If Shift was held at start, add to selection
        if (e.shiftKey) {
          const newSelection = [...new Set([...selectedClipIds, ...clipsToSelect])]
          useTimelineStore.getState().selectClips(newSelection)
        } else {
          useTimelineStore.getState().selectClips(clipsToSelect)
        }
      }
      
      setMarqueeState(null)
    }
    
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [marqueeState, clips, tracks, videoTracks, audioTracks, pixelsPerSecond, selectedClipIds])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger when typing in inputs (use activeElement so prompt/search fields work)
      const active = document.activeElement
      if (active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable)) return
      
      // Spacebar - enable panning mode (but don't prevent default if not in timeline)
      if (e.code === 'Space' && !e.repeat) {
        // Only enable panning if we're hovering over the timeline
        setIsSpaceHeld(true)
      }
      
      // Ctrl/Cmd + Z - Undo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        undo()
      }
      
      // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y - Redo
      if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'z' || e.key === 'y')) {
        e.preventDefault()
        redo()
      }
      
      // S key - toggle snapping
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        toggleSnapping()
      }
      
      // R key - toggle ripple edit mode
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        toggleRippleEdit()
      }
      
      // Delete/Backspace - delete selected clips
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipIds.length > 0) {
        e.preventDefault()
        removeSelectedClips()
      }
      
      // Escape - clear selection
      if (e.key === 'Escape') {
        clearSelection()
      }
      
      // Ctrl/Cmd + A - select all clips
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        const allClipIds = clips.map(c => c.id)
        useTimelineStore.getState().selectClips(allClipIds)
      }
      
      // X - split at playhead on active track only (seamless: second clip continues from cut in source)
      if (e.key === 'x' && !e.ctrlKey && !e.metaKey && !e.altKey && activeTrackId) {
        const clip = clips.find(
          c => c.trackId === activeTrackId &&
            playheadPosition > c.startTime &&
            playheadPosition < c.startTime + c.duration
        )
        if (clip) {
          e.preventDefault()
          saveToHistory()
          const splitTime = playheadPosition - clip.startTime
          const remainder = clip.duration - splitTime
          // Source time at the cut (so second clip continues from here — no repeat/slip)
          const sourceTimeAtCut = (clip.trimStart || 0) + splitTime * getTimeScale(clip)
          resizeClip(clip.id, splitTime)
          const asset = assets.find(a => a.id === clip.assetId)
          if (asset) {
            const newClip = addClip(clip.trackId, asset, playheadPosition, timelineFps)
            if (newClip) {
              updateClipTrim(newClip.id, { trimStart: sourceTimeAtCut })
              resizeClip(newClip.id, remainder)
            }
          }
        }
      }
    }
    
    const handleKeyUp = (e) => {
      // Release spacebar panning mode
      if (e.code === 'Space') {
        setIsSpaceHeld(false)
        setIsPanning(false)
        setPanStart(null)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [toggleSnapping, toggleRippleEdit, selectedClipIds, removeSelectedClips, clearSelection, clips, undo, redo, activeTrackId, playheadPosition, saveToHistory, resizeClip, addClip, updateClipTrim, assets, timelineFps])

  // Handle spacebar panning
  useEffect(() => {
    if (!isPanning || !panStart) return
    
    const handleMouseMove = (e) => {
      if (!timelineRef.current || !trackContentRef.current) return
      
      const deltaX = e.clientX - panStart.x
      const deltaY = e.clientY - panStart.y
      
      // Scroll the timeline horizontally
      timelineRef.current.scrollLeft = panStart.scrollLeft - deltaX
      
      // Scroll the track content vertically (synced with headers)
      trackContentRef.current.scrollTop = panStart.scrollTop - deltaY
    }
    
    const handleMouseUp = () => {
      setIsPanning(false)
      setPanStart(null)
    }
    
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isPanning, panStart])

  // Handle scroll wheel - Ctrl+Scroll to zoom, regular scroll to pan horizontally
  const handleWheel = (e) => {
    if (!timelineRef.current) return
    
    // Ctrl/Cmd + Scroll = Zoom (centered on mouse position)
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      
      // Zoom delta - scroll up = zoom in, scroll down = zoom out
      const zoomDelta = e.deltaY > 0 ? -20 : 20
      
      // Get mouse position relative to timeline for zoom centering
      const rect = timelineRef.current.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const scrollLeft = timelineRef.current.scrollLeft
      
      // Calculate time position under mouse before zoom
      const timeAtMouse = (mouseX + scrollLeft) / pixelsPerSecond
      
      // Apply zoom
      const newZoom = Math.max(20, Math.min(2000, zoom + zoomDelta))
      setZoom(newZoom)
      
      // Calculate new pixels per second
      const newPixelsPerSecond = newZoom / 5
      
      // Adjust scroll to keep the time position under the mouse
      const newScrollLeft = (timeAtMouse * newPixelsPerSecond) - mouseX
      
      // Apply scroll adjustment after a tiny delay to let the zoom render
      requestAnimationFrame(() => {
        if (timelineRef.current) {
          timelineRef.current.scrollLeft = Math.max(0, newScrollLeft)
        }
      })
    } else {
      // Regular scroll = pan horizontally (and vertically if shift held)
      // Allow native vertical scrolling for tracks, but also support horizontal
      if (e.shiftKey) {
        // Shift+Scroll = horizontal pan
        e.preventDefault()
        timelineRef.current.scrollLeft += e.deltaY
      }
      // Otherwise let native scroll behavior handle it (vertical track scrolling)
    }
  }

  // Handle drag over for drop zones
  const handleDragOver = (e, trackId) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropTarget(trackId)
  }

  const handleDragLeave = () => {
    setDropTarget(null)
  }

  // Handle drop from assets
  const handleDrop = (e, trackId) => {
    e.preventDefault()
    setDropTarget(null)
    
    const assetId = e.dataTransfer.getData('assetId')
    if (!assetId) return
    
    const asset = assets.find(a => a.id === assetId)
    if (!asset) return
    
    // Calculate drop time based on mouse position
    // Need to account for timeline scroll position
    const rect = e.currentTarget.getBoundingClientRect()
    const scrollLeft = timelineRef.current?.scrollLeft || 0
    const x = e.clientX - rect.left + scrollLeft
    const startTime = Math.max(0, x / pixelsPerSecond)
    
    // Check if asset type matches track type
    const track = tracks.find(t => t.id === trackId)
    if (!track) return
    
    // Video assets go on video tracks, audio on audio tracks
    const isVideoAsset = asset.type === 'video' || asset.type === 'image'
    const isVideoTrack = track.type === 'video'
    
    if ((isVideoAsset && isVideoTrack) || (!isVideoAsset && !isVideoTrack)) {
      addClip(trackId, asset, startTime, timelineFps)

      // If this is a video asset with audio enabled, also add an audio clip
      if (asset.type === 'video' && isVideoTrack && asset.audioEnabled !== false) {
        const audioTrack = tracks.find(t => t.type === 'audio' && !t.locked)
        if (audioTrack) {
          const audioAsset = { ...asset, type: 'audio' }
          addClip(audioTrack.id, audioAsset, startTime, timelineFps)
        }
      }
    }
  }

  // Handle clip selection (supports multi-select with Shift/Ctrl)
  const handleClipClick = (e, clip) => {
    e.stopPropagation()
    
    // Switch to timeline preview mode when clicking on a clip
    // Also pause asset playback if it's playing
    setPreviewMode('timeline')
    if (assetIsPlaying) {
      setAssetIsPlaying(false)
    }
    
    // Multi-select support
    const isShiftHeld = e.shiftKey
    const isCtrlHeld = e.ctrlKey || e.metaKey // metaKey for Mac Cmd
    
    selectClip(clip.id, {
      addToSelection: isShiftHeld,
      toggleSelection: isCtrlHeld
    })
    
    // Note: We don't move the playhead when selecting clips - 
    // the playhead stays where it is and the user can scrub independently.
  }

  // Handle clip right-click context menu
  const handleClipContextMenu = (e, clip) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Select the clip if not already selected
    if (!selectedClipIds.includes(clip.id)) {
      selectClip(clip.id)
    }
    
    setClipContextMenu({
      x: e.clientX,
      y: e.clientY,
      clipId: clip.id
    })
    setMaskSubmenuOpen(false)
  }

  // Close clip context menu
  useEffect(() => {
    if (!clipContextMenu) return
    
    const handleClick = () => {
      setClipContextMenu(null)
      setMaskSubmenuOpen(false)
    }
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setClipContextMenu(null)
        setMaskSubmenuOpen(false)
      }
    }
    
    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleEscape)
    
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [clipContextMenu])

  // Context menu actions
  const handleContextMenuAction = (action) => {
    const clip = clips.find(c => c.id === clipContextMenu?.clipId)
    if (!clip) return
    
    switch (action) {
      case 'add-mask':
        // Ensure single selection on this clip
        selectClip(clip.id)
        requestMaskPicker(clip.id, { openPicker: true })
        break
      case 'flush-cache': {
        const targetIds = selectedClipIds.includes(clip.id) ? selectedClipIds : [clip.id]
        targetIds.forEach((clipId) => {
          const targetClip = clips.find(c => c.id === clipId)
          if (!targetClip) return
          renderCacheService.clearCache(clipId)
          clearDiskCacheUrl(clipId)
          if (targetClip.cachePath && currentProjectHandle) {
            deleteRenderCache(currentProjectHandle, targetClip.cachePath).catch(err => {
              console.warn('Failed to delete cache from disk:', err)
            })
          }
          clearClipCache(clipId)
        })
        break
      }
      case 'delete':
        if (selectedClipIds.length > 1 && selectedClipIds.includes(clip.id)) {
          removeSelectedClips()
        } else {
          removeClip(clip.id)
        }
        break
      case 'duplicate':
        // Duplicate clip right after current position
        const asset = assets.find(a => a.id === clip.assetId)
        if (asset) {
          addClip(clip.trackId, asset, clip.startTime + clip.duration + 0.1, timelineFps)
        }
        break
      case 'split':
        // Split clip at playhead (seamless: second clip continues from cut in source)
        if (playheadPosition > clip.startTime && playheadPosition < clip.startTime + clip.duration) {
          const splitTime = playheadPosition - clip.startTime
          const remainder = clip.duration - splitTime
          const sourceTimeAtCut = (clip.trimStart || 0) + splitTime * getTimeScale(clip)
          saveToHistory()
          resizeClip(clip.id, splitTime)
          const asset = assets.find(a => a.id === clip.assetId)
          if (asset) {
            const newClip = addClip(clip.trackId, asset, playheadPosition, timelineFps)
            if (newClip) {
              updateClipTrim(newClip.id, { trimStart: sourceTimeAtCut })
              resizeClip(newClip.id, remainder)
            }
          }
        }
        break
      case 'set-in':
        // Set clip start to playhead position
        if (playheadPosition > clip.startTime && playheadPosition < clip.startTime + clip.duration) {
          const newDuration = (clip.startTime + clip.duration) - playheadPosition
          moveClip(clip.id, clip.trackId, playheadPosition)
          resizeClip(clip.id, newDuration)
        }
        break
      case 'set-out':
        // Set clip end to playhead position
        if (playheadPosition > clip.startTime && playheadPosition < clip.startTime + clip.duration) {
          resizeClip(clip.id, playheadPosition - clip.startTime)
        }
        break
      case 'preview':
        // This explicitly opens the source asset in preview mode
        // Note: This will show it in Assets panel preview, not timeline mode
        const previewAsset = assets.find(a => a.id === clip.assetId)
        if (previewAsset) {
          setPreview(previewAsset)
          // Clear the preview after setting so it triggers the asset panel but doesn't persist
          // Actually, just set it - user can double-click in Assets to preview
        }
        break
    }
    
    setMaskSubmenuOpen(false)
    setClipContextMenu(null)
  }

  const handleApplyMaskFromContextMenu = (maskAssetId) => {
    const clip = clips.find(c => c.id === clipContextMenu?.clipId)
    if (!clip) return

    selectClip(clip.id)
    addMaskEffect(clip.id, maskAssetId)
    requestMaskPicker(clip.id, { openPicker: false })
    setMaskSubmenuOpen(false)
    setClipContextMenu(null)
  }

  // Handle clip deletion (deletes all selected if multiple)
  const handleDeleteClip = (e, clipId) => {
    e.stopPropagation()
    // If this clip is selected and there are multiple selections, delete all
    if (selectedClipIds.includes(clipId) && selectedClipIds.length > 1) {
      removeSelectedClips()
    } else {
      removeClip(clipId)
    }
  }

  // Handle trim start (mousedown on handle)
  const handleTrimStart = (e, clipId, edge) => {
    e.stopPropagation()
    e.preventDefault()
    
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    
    // Save to history before trimming starts
    saveToHistory()
    
    const timeScale = getTimeScale(clip)
    const startTrimEnd = clip.trimEnd ?? clip.sourceDuration ?? ((clip.trimStart || 0) + clip.duration * timeScale)

    setTrimState({
      clipId,
      edge,
      startX: e.clientX,
      startTime: clip.startTime,
      startDuration: clip.duration,
      startTrimStart: clip.trimStart || 0,
      startTrimEnd: startTrimEnd,
    })
    
    selectClip(clipId)
  }

  // Handle trim move (mousemove when trimming)
  useEffect(() => {
    if (!trimState) return
    
    const handleMouseMove = (e) => {
      const deltaX = e.clientX - trimState.startX
      const deltaTime = deltaX / pixelsPerSecond
      
      const clip = clips.find(c => c.id === trimState.clipId)
      if (!clip) return
      const timeScale = getTimeScale(clip)
      
      // Find neighboring clips on the same track to prevent trimming past them
      const trackClips = clips.filter(c => c.trackId === clip.trackId && c.id !== clip.id)
      
      // Find the clip immediately to the left (ends before or at our start)
      const leftNeighbor = trackClips
        .filter(c => c.startTime + c.duration <= clip.startTime + 0.01) // Small tolerance
        .sort((a, b) => (b.startTime + b.duration) - (a.startTime + a.duration))[0]
      
      // Find the clip immediately to the right (starts at or after our end)
      const rightNeighbor = trackClips
        .filter(c => c.startTime >= clip.startTime + clip.duration - 0.01) // Small tolerance
        .sort((a, b) => a.startTime - b.startTime)[0]
      
      if (trimState.edge === 'left') {
        // Trimming from left: adjust startTime, duration, and trimStart
        // When extending the head (dragging left), we're revealing more footage from the start
        // When shortening the head (dragging right), we're hiding footage from the start
        
        let newStartTime = Math.max(0, trimState.startTime + deltaTime)
        const maxStartTime = trimState.startTime + trimState.startDuration - 0.5 // Keep min 0.5s
        newStartTime = Math.min(newStartTime, maxStartTime)
        
        // Calculate how much we're trying to change the head position
        let timeDelta = newStartTime - trimState.startTime
        
        // Calculate what the new trimStart would be
        // If timeDelta is negative (extending left), trimStart decreases
        // trimStart can't go below 0 (can't reveal footage before the source start)
        let newTrimStart = trimState.startTrimStart + timeDelta * timeScale
        if (newTrimStart < 0) {
          // Clamp: can only extend to where trimStart would be 0
          const minStartTime = trimState.startTime - (trimState.startTrimStart / timeScale)
          newStartTime = Math.max(newStartTime, minStartTime)
          timeDelta = newStartTime - trimState.startTime
          newTrimStart = 0
        }
        
        // Don't trim past the left neighbor's end
        if (leftNeighbor) {
          const leftNeighborEnd = leftNeighbor.startTime + leftNeighbor.duration
          if (newStartTime < leftNeighborEnd) {
            newStartTime = leftNeighborEnd
            timeDelta = newStartTime - trimState.startTime
            newTrimStart = trimState.startTrimStart + timeDelta * timeScale
          }
        }
        
        // Apply snapping to the new start time
        const snapResult = snapTrim(newStartTime, trimState.clipId)
        if (snapResult.snapped) {
          // Only apply snap if it doesn't violate constraints
          let snappedTime = snapResult.time
          
          // Check source footage constraint
          const snappedTrimStart = trimState.startTrimStart + (snappedTime - trimState.startTime) * timeScale
          if (snappedTrimStart < 0) {
            snappedTime = trimState.startTime - (trimState.startTrimStart / timeScale)
          }
          
          // Check neighbor constraint
          if (leftNeighbor) {
            snappedTime = Math.max(snappedTime, leftNeighbor.startTime + leftNeighbor.duration)
          }
          
          if (snappedTime === snapResult.time) {
            newStartTime = snapResult.time
            timeDelta = newStartTime - trimState.startTime
            newTrimStart = trimState.startTrimStart + timeDelta * timeScale
            setActiveSnapTime(snapResult.time)
          } else {
            clearActiveSnap()
          }
        } else {
          clearActiveSnap()
        }
        
        // Calculate the new duration
        const newDuration = trimState.startDuration - timeDelta
        
        // Update the clip with all trim-related properties at once
        updateClipTrim(trimState.clipId, {
          startTime: newStartTime,
          duration: newDuration,
          trimStart: Math.max(0, newTrimStart) // Ensure trimStart doesn't go negative
        })
      } else {
        // Trimming from right: adjust duration and trimEnd
        let newEndTime = trimState.startTime + trimState.startDuration + deltaTime
        
        // Don't trim past the right neighbor's start
        if (rightNeighbor) {
          newEndTime = Math.min(newEndTime, rightNeighbor.startTime)
        }
        
        // Apply snapping to the new end time
        const snapResult = snapTrim(newEndTime, trimState.clipId)
        if (snapResult.snapped) {
          // Only apply snap if it doesn't go past the neighbor
          let snappedTime = snapResult.time
          if (rightNeighbor) {
            snappedTime = Math.min(snappedTime, rightNeighbor.startTime)
          }
          if (snappedTime === snapResult.time) {
            newEndTime = snapResult.time
            setActiveSnapTime(snapResult.time)
          } else {
            clearActiveSnap()
          }
        } else {
          clearActiveSnap()
        }
        
        let newDuration = Math.max(0.5, newEndTime - trimState.startTime)
        
        // Don't exceed source duration if we have it
        // The maximum duration is limited by how much source footage is available
        // from the current trimStart to the end of the source
        const sourceDuration = clip.sourceDuration || Infinity
        const currentTrimStart = clip.trimStart || 0
        const maxPossibleDuration = (sourceDuration - currentTrimStart) / timeScale
        newDuration = Math.min(newDuration, maxPossibleDuration)
        
        // Calculate the new trimEnd (where in the source footage the clip ends)
        const newTrimEnd = currentTrimStart + (newDuration * timeScale)
        
        updateClipTrim(trimState.clipId, {
          duration: newDuration,
          trimEnd: Math.min(newTrimEnd, sourceDuration)
        })
      }
    }
    
    const handleMouseUp = () => {
      setTrimState(null)
      clearActiveSnap()
    }
    
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [trimState, clips, pixelsPerSecond, moveClip, resizeClip, snapTrim, setActiveSnapTime, clearActiveSnap])

  // Handle clip drag start (mousedown on clip body, not trim handles)
  const handleClipDragStart = (e, clip) => {
    // Don't start drag if clicking on trim handles or delete button
    if (e.target.closest('[data-trim-handle]') || e.target.closest('button')) {
      return
    }
    
    e.stopPropagation()
    e.preventDefault()
    
    // Store original positions of all selected clips for multi-drag
    const clipsToMove = selectedClipIds.includes(clip.id) 
      ? clips.filter(c => selectedClipIds.includes(c.id))
      : [clip]
    
    setClipDragState({
      clipId: clip.id,
      startX: e.clientX,
      startY: e.clientY,
      originalStartTime: clip.startTime,
      originalTrackId: clip.trackId,
      hasMoved: false,
      lastDeltaTime: 0,
      originalPositions: clipsToMove.map(c => ({ id: c.id, startTime: c.startTime }))
    })
    
    // Only change selection if this clip isn't already selected
    if (!selectedClipIds.includes(clip.id)) {
      selectClip(clip.id)
    }
  }

  // Handle clip dragging (mousemove when dragging a clip)
  // Supports moving multiple selected clips together
  useEffect(() => {
    if (!clipDragState) return
    
    const handleMouseMove = (e) => {
      const deltaX = e.clientX - clipDragState.startX
      const deltaY = e.clientY - clipDragState.startY
      
      // Check if we've moved enough to consider it a drag (prevents accidental drags on click)
      const hasMoved = clipDragState.hasMoved || Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3
      
      if (!hasMoved) {
        setClipDragState(prev => ({ ...prev, hasMoved: false }))
        return
      }
      
      setClipDragState(prev => ({ ...prev, hasMoved: true }))
      
      const clip = clips.find(c => c.id === clipDragState.clipId)
      if (!clip) return
      
      // Calculate new start time based on mouse movement
      const deltaTime = deltaX / pixelsPerSecond
      let proposedStartTime = Math.max(0, clipDragState.originalStartTime + deltaTime)
      
      // Apply snapping (only for the primary dragged clip)
      const snapResult = snapClipPosition(clipDragState.clipId, proposedStartTime, clip.duration)
      
      let finalDeltaTime = deltaTime
      if (snapResult.snapped) {
        proposedStartTime = snapResult.startTime
        finalDeltaTime = proposedStartTime - clipDragState.originalStartTime
        setActiveSnapTime(snapResult.snapInfo.snapPoint.time)
      } else {
        clearActiveSnap()
      }
      
      // Handle vertical track switching (only for single clip drag)
      let newTrackId = clipDragState.originalTrackId
      const isDraggingMultiple = selectedClipIds.includes(clipDragState.clipId) && selectedClipIds.length > 1
      
      // Use track content ref for Y (scrollable area where tracks live); layout: video tracks (h-12), spacer (h-5), audio tracks (h-10)
      if (!isDraggingMultiple && trackContentRef.current) {
        const contentRect = trackContentRef.current.getBoundingClientRect()
        const relativeY = e.clientY - contentRect.top + trackContentRef.current.scrollTop
        
        const trackType = clip.type || 'video'
        const relevantTracks = tracks.filter(t => t.type === trackType)
        const videoTrackHeight = 48
        const audioSectionHeight = 20
        
        let currentY = trackType === 'video' ? 0 : videoTracks.length * videoTrackHeight + audioSectionHeight
        
        for (const track of relevantTracks) {
          const height = track.type === 'video' ? videoTrackHeight : getAudioTrackHeight(track)
          if (relativeY >= currentY && relativeY < currentY + height) {
            if (!track.locked) newTrackId = track.id
            break
          }
          currentY += height
        }
      }
      
      // Update clip position(s) - don't resolve overlaps during drag, only on mouse up
      if (isDraggingMultiple) {
        // Move all selected clips together by the same delta (no overlap resolution yet)
        moveSelectedClips(finalDeltaTime - (clipDragState.lastDeltaTime || 0), null, false)
        setClipDragState(prev => ({ ...prev, lastDeltaTime: finalDeltaTime, currentTrackId: newTrackId }))
      } else {
        // Move single clip (no overlap resolution yet)
        moveClip(clipDragState.clipId, newTrackId, proposedStartTime, false)
        setClipDragState(prev => ({ ...prev, currentTrackId: newTrackId, currentStartTime: proposedStartTime }))
      }
    }
    
    const handleMouseUp = () => {
      // On mouse up, resolve overlaps for the final position (NLE overwrite behavior)
      if (clipDragState && clipDragState.hasMoved) {
        const isDraggingMultiple = selectedClipIds.includes(clipDragState.clipId) && selectedClipIds.length > 1
        
        if (isDraggingMultiple) {
          // For multi-clip drag, resolve overlaps with delta of 0 (clips already in position)
          moveSelectedClips(0, null, true)
        } else {
          // For single clip drag, resolve overlaps at the current position
          const clip = clips.find(c => c.id === clipDragState.clipId)
          if (clip) {
            moveClip(clipDragState.clipId, clip.trackId, clip.startTime, true)
          }
        }
      }
      
      setClipDragState(null)
      clearActiveSnap()
    }
    
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [clipDragState, clips, pixelsPerSecond, tracks, videoTracks, moveClip, moveSelectedClips, selectedClipIds, snapClipPosition, setActiveSnapTime, clearActiveSnap])

  // Handle adding transition between adjacent clips - show type menu
  const handleAddTransition = (e, clipA, clipB) => {
    e.stopPropagation()
    // Show transition type menu at click position
    setTransitionMenu({
      x: e.clientX,
      y: e.clientY,
      clipA,
      clipB
    })
  }
  
  // Select transition type and duration from menu
  const handleSelectTransition = (type, durationSeconds) => {
    if (transitionMenu) {
      const result = addTransition(transitionMenu.clipA.id, transitionMenu.clipB.id, type, durationSeconds)
      if (!result) {
        // Show warning if transition couldn't be added (insufficient handles)
        console.warn('Could not add transition - insufficient handles')
      }
      setTransitionMenu(null)
    }
  }
  
  const parseTransitionDrop = (e) => {
    const raw = e.dataTransfer.getData('application/x-storyflow-transition')
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  
  // Calculate which duration options are available based on handles
  const getAvailableDurations = () => {
    if (!transitionMenu) return []
    const maxDuration = getMaxTransitionDuration(transitionMenu.clipA.id, transitionMenu.clipB.id)
    return TRANSITION_DURATIONS.filter(d => d.seconds <= maxDuration)
  }
  
  // Close transition menu when clicking outside
  useEffect(() => {
    if (!transitionMenu) return
    
    const handleClick = () => setTransitionMenu(null)
    const handleEscape = (e) => {
      if (e.key === 'Escape') setTransitionMenu(null)
    }
    
    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleEscape)
    
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [transitionMenu])

  // Handle transition duration dragging
  useEffect(() => {
    if (!transitionDragState) return
    
    const handleMouseMove = (e) => {
      const deltaX = e.clientX - transitionDragState.startX
      // Duration changes by drag amount (2 pixels = 0.1 seconds)
      const deltaDuration = deltaX / 20
      
      let newDuration
      if (transitionDragState.edge === 'left') {
        // Left edge: decreasing duration
        newDuration = Math.max(0.1, Math.min(3, transitionDragState.startDuration - deltaDuration))
      } else {
        // Right edge: increasing duration
        newDuration = Math.max(0.1, Math.min(3, transitionDragState.startDuration + deltaDuration))
      }
      
      updateTransition(transitionDragState.transitionId, { duration: parseFloat(newDuration.toFixed(2)) })
    }
    
    const handleMouseUp = () => {
      setTransitionDragState(null)
    }
    
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [transitionDragState, updateTransition])

  // Handle roll edit (dragging between two adjacent clips)
  useEffect(() => {
    if (!rollEditState) return
    
    const handleMouseMove = (e) => {
      const deltaX = e.clientX - rollEditState.startX
      const deltaTime = deltaX / pixelsPerSecond
      
      // Calculate new edit point
      let newEditPoint = rollEditState.originalEditPoint + deltaTime
      
      // Constraints:
      // 1. clipA must have at least 0.5s duration
      const clipAMinEnd = (rollEditState.originalEditPoint - rollEditState.clipAOriginalDuration) + 0.5
      // 2. clipB must have at least 0.5s duration  
      const clipBMaxStart = rollEditState.clipBOriginalStart + rollEditState.clipBOriginalDuration - 0.5
      // 3. Don't go past clipA's source duration (if available)
      const clipA = clips.find(c => c.id === rollEditState.clipAId)
      const clipAMaxEnd = clipA?.sourceDuration 
        ? (rollEditState.originalEditPoint - rollEditState.clipAOriginalDuration) + clipA.sourceDuration
        : Infinity
      // 4. Don't go past clipB's trim start (can't reveal content before the source)
      const clipB = clips.find(c => c.id === rollEditState.clipBId)
      const clipBMinStart = clipB?.trimStart 
        ? rollEditState.clipBOriginalStart - clipB.trimStart
        : 0
      
      // Apply constraints
      newEditPoint = Math.max(newEditPoint, clipAMinEnd)
      newEditPoint = Math.min(newEditPoint, clipBMaxStart)
      newEditPoint = Math.min(newEditPoint, clipAMaxEnd)
      newEditPoint = Math.max(newEditPoint, clipBMinStart)
      
      // Calculate new values
      const actualDelta = newEditPoint - rollEditState.originalEditPoint
      const newClipADuration = rollEditState.clipAOriginalDuration + actualDelta
      const newClipBStart = rollEditState.clipBOriginalStart + actualDelta
      const newClipBDuration = rollEditState.clipBOriginalDuration - actualDelta
      
      // Update both clips
      resizeClip(rollEditState.clipAId, newClipADuration)
      moveClip(rollEditState.clipBId, clipB?.trackId, newClipBStart, false)
      resizeClip(rollEditState.clipBId, newClipBDuration)
    }
    
    const handleMouseUp = () => {
      setRollEditState(null)
    }
    
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [rollEditState, clips, pixelsPerSecond, resizeClip, moveClip])

  // Get transition between two clips (if exists)
  const getTransitionBetween = (clipAId, clipBId) => {
    return transitions.find(t => 
      (t.clipAId === clipAId && t.clipBId === clipBId) ||
      (t.clipAId === clipBId && t.clipBId === clipAId)
    )
  }

  // Find adjacent or overlapping clips (for showing transition buttons/zones)
  // With the overlap model, clips with transitions will overlap
  const getAdjacentClips = (trackId) => {
    const trackClips = clips
      .filter(c => c.trackId === trackId)
      .sort((a, b) => a.startTime - b.startTime)
    
    const pairs = []
    for (let i = 0; i < trackClips.length - 1; i++) {
      const clipA = trackClips[i]
      const clipB = trackClips[i + 1]
      const clipAEnd = clipA.startTime + clipA.duration
      
      // Check if clips are adjacent (within 0.5s gap) OR overlapping (transition exists)
      const gap = clipB.startTime - clipAEnd
      const isOverlapping = clipB.startTime < clipAEnd
      
      if (isOverlapping || Math.abs(gap) < 0.5) {
        // Check if there's a transition between these clips
        const transition = getTransitionBetween(clipA.id, clipB.id)
        pairs.push({ clipA, clipB, transition, isOverlapping })
      }
    }
    return pairs
  }

  // Get track icon
  const getTrackIcon = (track) => {
    if (track.type === 'video') return <Video className="w-3 h-3" />
    return <Volume2 className="w-3 h-3" />
  }

  // Get track color class
  const getTrackColor = (track) => {
    if (track.type === 'video') return 'bg-sf-clip-video/30 text-[#5a909a]'
    return 'bg-sf-clip-audio/30 text-[#4d8a70]'
  }

  // Check if track can be deleted (must have at least one of each type)
  const canDeleteTrack = (track) => {
    const tracksOfType = tracks.filter(t => t.type === track.type)
    return tracksOfType.length > 1
  }

  // Handle track rename
  const handleStartRename = (track) => {
    setRenamingTrackId(track.id)
    setRenameValue(track.name)
  }

  const handleFinishRename = () => {
    if (renamingTrackId && renameValue.trim()) {
      renameTrack(renamingTrackId, renameValue.trim())
    }
    setRenamingTrackId(null)
    setRenameValue('')
  }

  const handleCancelRename = () => {
    setRenamingTrackId(null)
    setRenameValue('')
  }

  // Handle track delete with confirmation for tracks that have clips
  const handleDeleteTrack = (track) => {
    const trackClips = clips.filter(c => c.trackId === track.id)
    if (trackClips.length > 0) {
      // Confirm if track has clips
      if (!window.confirm(`Delete "${track.name}"? This will also delete ${trackClips.length} clip${trackClips.length > 1 ? 's' : ''} on this track.`)) {
        return
      }
    }
    removeTrack(track.id)
  }

  // ==================== TRACK REORDER DRAG HANDLERS ====================
  const handleTrackDragStart = (e, track, indexInGroup) => {
    e.stopPropagation()
    setTrackDragState({
      trackId: track.id,
      trackType: track.type,
      startY: e.clientY,
      originalIndex: indexInGroup
    })
    setTrackDropTarget(indexInGroup)
  }

  const handleTrackDragMove = (e) => {
    if (!trackDragState) return
    
    // Calculate which index we're hovering over
    const tracksOfType = trackDragState.trackType === 'video' ? videoTracks : audioTracks
    const draggedTrack = tracksOfType.find(t => t.id === trackDragState.trackId)
    const trackHeight = trackDragState.trackType === 'video' ? 48 : (draggedTrack ? getAudioTrackHeight(draggedTrack) : 40)
    const deltaY = e.clientY - trackDragState.startY
    const indexDelta = Math.round(deltaY / trackHeight)
    const newIndex = Math.max(0, Math.min(tracksOfType.length - 1, trackDragState.originalIndex + indexDelta))
    
    if (newIndex !== trackDropTarget) {
      setTrackDropTarget(newIndex)
    }
  }

  const handleTrackDragEnd = () => {
    if (trackDragState && trackDropTarget !== null && trackDropTarget !== trackDragState.originalIndex) {
      reorderTrack(trackDragState.trackId, trackDropTarget)
    }
    setTrackDragState(null)
    setTrackDropTarget(null)
  }

  // Track drag mouse move/up listeners
  useEffect(() => {
    if (!trackDragState) return
    
    const handleMouseMove = (e) => handleTrackDragMove(e)
    const handleMouseUp = () => handleTrackDragEnd()
    
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [trackDragState, trackDropTarget])

  // Generate time markers
  const timeMarkers = []
  const markerInterval = zoom > 100 ? 5 : 10
  for (let i = 0; i <= duration; i += markerInterval) {
    timeMarkers.push(i)
  }

  return (
    <div className="h-full bg-sf-dark-900 border-t border-sf-dark-700 flex flex-col">
      {/* Timeline Header - Track controls and zoom only (transport controls are above) */}
      <div className="h-7 bg-sf-dark-800 border-b border-sf-dark-700 flex items-center px-2 gap-3">
        {/* Add Track Buttons */}
        <div className="flex items-center gap-1">
          <button 
            onClick={() => addTrack('video')}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[10px] text-sf-text-secondary transition-colors"
          >
            <Plus className="w-3 h-3" />
            Video
          </button>
          <button 
            onClick={() => addTrack('audio', { channels: 'mono' })}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[10px] text-sf-text-secondary transition-colors"
            title="Add mono audio track"
          >
            <Plus className="w-3 h-3" />
            Mono
          </button>
          <button 
            onClick={() => addTrack('audio', { channels: 'stereo' })}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[10px] text-sf-text-secondary transition-colors"
            title="Add stereo audio track"
          >
            <Plus className="w-3 h-3" />
            Stereo
          </button>
        </div>
        
        {/* Snapping Toggle */}
        <button
          onClick={toggleSnapping}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${
            snappingEnabled 
              ? 'bg-sf-accent/20 text-sf-accent border border-sf-accent/50' 
              : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
          }`}
          title={`Snapping ${snappingEnabled ? 'ON' : 'OFF'} (S to toggle)`}
        >
          <Magnet className={`w-3 h-3 ${snappingEnabled ? 'text-sf-accent' : ''}`} />
          Snap
        </button>
        
        {/* Ripple Edit Toggle */}
        <button
          onClick={toggleRippleEdit}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${
            rippleEditMode 
              ? 'bg-sf-accent/20 text-sf-accent border border-sf-accent/50' 
              : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
          }`}
          title={`Ripple Edit ${rippleEditMode ? 'ON' : 'OFF'} (R to toggle) - Moving clips shifts subsequent clips`}
        >
          <ArrowRightLeft className={`w-3 h-3 ${rippleEditMode ? 'text-sf-accent' : ''}`} />
          Ripple
        </button>
        
        {/* Separator */}
        <div className="w-px h-4 bg-sf-dark-600" />
        
        {/* Undo/Redo Buttons */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={undo}
            disabled={!canUndo()}
            className={`p-1 rounded transition-colors ${
              canUndo() 
                ? 'hover:bg-sf-dark-600 text-sf-text-secondary' 
                : 'text-sf-dark-600 cursor-not-allowed'
            }`}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo()}
            className={`p-1 rounded transition-colors ${
              canRedo() 
                ? 'hover:bg-sf-dark-600 text-sf-text-secondary' 
                : 'text-sf-dark-600 cursor-not-allowed'
            }`}
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
        
        {/* Selection count */}
        {selectedClipIds.length > 1 && (
          <span className="text-[10px] text-sf-accent">{selectedClipIds.length} selected</span>
        )}
        
        {/* Clip count */}
        <span className="text-[10px] text-sf-text-muted">{clips.length} clips</span>
        
        {/* Info & Zoom */}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoom(Math.max(20, zoom - 50))}
              className="p-0.5 hover:bg-sf-dark-600 rounded text-sf-text-muted"
              title="Zoom Out"
            >
              <span className="text-xs">−</span>
            </button>
            <input
              type="range"
              min="20"
              max="2000"
              value={zoom}
              onChange={(e) => setZoom(parseInt(e.target.value))}
              className="w-24 h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
            />
            <button
              onClick={() => setZoom(Math.min(2000, zoom + 50))}
              className="p-0.5 hover:bg-sf-dark-600 rounded text-sf-text-muted"
              title="Zoom In"
            >
              <span className="text-xs">+</span>
            </button>
            <span className="text-[10px] text-sf-text-muted w-12">{zoom}%</span>
          </div>
          
          {/* Hints */}
          <span className="text-[9px] text-sf-text-muted">Ctrl+Scroll=Zoom | Space+Drag=Pan | Alt+Drag=Marquee</span>
        </div>
      </div>

      {/* Timeline Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Track Headers - Resizable */}
        <div 
          className="flex-shrink-0 border-r border-sf-dark-700 flex flex-col relative"
          style={{ width: `${trackHeadersWidth}px` }}
        >
          {/* Time ruler header spacer */}
          <div className="h-5 flex-shrink-0 border-b border-sf-dark-700 bg-sf-dark-800" />
          
          {/* Resize handle */}
          <div
            className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-sf-accent/50 active:bg-sf-accent z-20 group"
            onMouseDown={(e) => {
              e.preventDefault()
              setIsResizingHeaders(true)
              resizeStartX.current = e.clientX
              resizeStartWidth.current = trackHeadersWidth
            }}
          >
            {/* Visual indicator on hover */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-sf-dark-500 rounded opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          
          {/* Scrollable track headers container */}
          <div 
            ref={trackHeadersRef}
            className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-sf-dark-900 scrollbar-thumb-sf-dark-600"
            onScroll={(e) => {
              // Sync scroll with track content
              if (trackContentRef.current) {
                trackContentRef.current.scrollTop = e.target.scrollTop
              }
            }}
          >
          
          {/* Video Tracks */}
          {videoTracks.map((track, index) => {
            const isDragging = trackDragState?.trackId === track.id
            const isDropTarget = trackDragState?.trackType === 'video' && trackDropTarget === index && !isDragging
            
            return (
            <div 
              key={track.id}
              onClick={() => setActiveTrack(track.id)}
              title={activeTrackId === track.id ? 'Active track — press X to split at playhead' : 'Click to set as active track (X cuts at playhead on this track)'}
              className={`h-12 flex items-center px-2 gap-1 border-b border-sf-dark-700 hover:bg-sf-dark-800 transition-colors group/track cursor-pointer ${
                track.locked ? 'bg-sf-dark-800/50' : ''
              } ${isDragging ? 'opacity-50 bg-sf-dark-700' : ''} ${isDropTarget ? 'border-t-2 border-t-purple-500' : ''}`}
            >
              <div
                className={`p-0.5 rounded hover:bg-sf-dark-600 ${track.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  !track.locked && handleTrackDragStart(e, track, index)
                }}
              >
                <GripVertical className={`w-3 h-3 ${track.locked ? 'text-sf-dark-600' : 'text-sf-dark-500'}`} />
              </div>
              {/* Track type box — red outline when active (Resolve style) */}
              <div
                className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${getTrackColor(track)} ${
                  activeTrackId === track.id ? 'ring-2 ring-red-500 ring-offset-1 ring-offset-sf-dark-800' : ''
                }`}
              >
                {getTrackIcon(track)}
              </div>
              
              {/* Track name - editable */}
              {renamingTrackId === track.id ? (
                <div className="flex-1 flex items-center gap-1">
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleFinishRename()
                      if (e.key === 'Escape') handleCancelRename()
                    }}
                    autoFocus
                    className="w-full bg-sf-dark-700 text-[11px] text-sf-text-primary px-1 py-0.5 rounded border border-sf-accent outline-none"
                  />
                  <button onClick={(e) => { e.stopPropagation(); handleFinishRename() }} className="p-0.5 hover:bg-sf-dark-600 rounded">
                    <Check className="w-3 h-3 text-green-400" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleCancelRename() }} className="p-0.5 hover:bg-sf-dark-600 rounded">
                    <X className="w-3 h-3 text-sf-text-muted" />
                  </button>
                </div>
              ) : (
                <span 
                  className="text-[11px] text-sf-text-primary flex-1 truncate cursor-pointer hover:text-sf-accent"
                  onDoubleClick={(e) => { e.stopPropagation(); handleStartRename(track) }}
                  title="Double-click to rename"
                >
                  {track.name}
                </span>
              )}
              
              <div className="flex items-center gap-0.5">
                {/* Rename button */}
                <button 
                  onClick={(e) => { e.stopPropagation(); handleStartRename(track) }}
                  className="p-0.5 hover:bg-sf-dark-600 rounded opacity-0 group-hover/track:opacity-100 transition-opacity"
                  title="Rename track"
                >
                  <Pencil className="w-3 h-3 text-sf-text-muted" />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); toggleTrackVisibility(track.id) }}
                  className="p-0.5 hover:bg-sf-dark-600 rounded"
                >
                  {track.visible ? (
                    <Eye className="w-3 h-3 text-sf-text-muted" />
                  ) : (
                    <EyeOff className="w-3 h-3 text-sf-text-muted opacity-50" />
                  )}
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); toggleTrackLock(track.id) }}
                  className="p-0.5 hover:bg-sf-dark-600 rounded"
                >
                  {track.locked ? (
                    <Lock className="w-3 h-3 text-sf-warning" />
                  ) : (
                    <Unlock className="w-3 h-3 text-sf-text-muted" />
                  )}
                </button>
                {/* Delete track button */}
                {canDeleteTrack(track) && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDeleteTrack(track) }}
                    className="p-0.5 hover:bg-sf-error/30 rounded opacity-0 group-hover/track:opacity-100 transition-opacity"
                    title="Delete track"
                  >
                    <X className="w-3 h-3 text-sf-error" />
                  </button>
                )}
                {/* Primary track (Flame style) — click to set as active for X cut */}
                <button
                  onClick={(e) => { e.stopPropagation(); setActiveTrack(track.id) }}
                  className={`min-w-[18px] h-[18px] flex items-center justify-center rounded text-[10px] font-bold transition-colors ${
                    activeTrackId === track.id
                      ? 'bg-red-500 text-white'
                      : 'bg-sf-dark-600 text-sf-text-muted hover:bg-sf-dark-500 hover:text-sf-text-secondary'
                  }`}
                  title={activeTrackId === track.id ? 'Primary track (X cuts here)' : 'Set as primary track'}
                >
                  P
                </button>
              </div>
            </div>
          )})}
          
          {/* Audio Section Divider */}
          <div className="h-5 bg-sf-dark-800 border-b border-sf-dark-700 flex items-center px-2">
            <span className="text-[9px] text-sf-text-muted uppercase tracking-wider">Audio</span>
            <button 
              onClick={() => onOpenAudioGenerate && onOpenAudioGenerate('music')}
              className="ml-auto p-0.5 hover:bg-sf-dark-700 rounded" 
              title="Generate AI Audio"
            >
              <Sparkles className="w-3 h-3 text-sf-accent" />
            </button>
          </div>
          
          {/* Audio Tracks */}
          {audioTracks.map((track, index) => {
            const isDragging = trackDragState?.trackId === track.id
            const isDropTarget = trackDragState?.trackType === 'audio' && trackDropTarget === index && !isDragging
            
            const isStereo = track.type === 'audio' && track.channels !== 'mono'
            const headerHeight = track.type === 'video' ? 48 : getAudioTrackHeight(track)
            
            return (
            <div 
              key={track.id}
              onClick={() => setActiveTrack(track.id)}
              title={activeTrackId === track.id ? 'Active track — press X to split at playhead' : 'Click to set as active track (X cuts at playhead on this track)'}
              className={`flex flex-col px-2 gap-0 border-b border-sf-dark-700 hover:bg-sf-dark-800 transition-colors group/track cursor-pointer ${
                track.locked ? 'bg-sf-dark-800/50' : ''
              } ${isDragging ? 'opacity-50 bg-sf-dark-700' : ''} ${isDropTarget ? 'border-t-2 border-t-purple-500' : ''}`}
              style={{ minHeight: headerHeight, height: headerHeight }}
            >
              <div className="flex-1 flex items-center gap-1 min-h-0">
                <div
                  className={`p-0.5 rounded hover:bg-sf-dark-600 ${track.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    !track.locked && handleTrackDragStart(e, track, index)
                  }}
                >
                  <GripVertical className={`w-3 h-3 ${track.locked ? 'text-sf-dark-600' : 'text-sf-dark-500'}`} />
                </div>
                <div
                  className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${getTrackColor(track)} ${
                    activeTrackId === track.id ? 'ring-2 ring-red-500 ring-offset-1 ring-offset-sf-dark-800' : ''
                  }`}
                >
                  {getTrackIcon(track)}
                </div>
                {renamingTrackId === track.id ? (
                  <div className="flex-1 flex items-center gap-1">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleFinishRename()
                        if (e.key === 'Escape') handleCancelRename()
                      }}
                      autoFocus
                      className="w-full bg-sf-dark-700 text-[11px] text-sf-text-primary px-1 py-0.5 rounded border border-sf-accent outline-none"
                    />
                    <button onClick={(e) => { e.stopPropagation(); handleFinishRename() }} className="p-0.5 hover:bg-sf-dark-600 rounded">
                      <Check className="w-3 h-3 text-green-400" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleCancelRename() }} className="p-0.5 hover:bg-sf-dark-600 rounded">
                      <X className="w-3 h-3 text-sf-text-muted" />
                    </button>
                  </div>
                ) : (
                  <span 
                    className="text-[11px] text-sf-text-primary flex-1 truncate cursor-pointer hover:text-sf-accent"
                    onDoubleClick={(e) => { e.stopPropagation(); handleStartRename(track) }}
                    title="Double-click to rename"
                  >
                    {track.name}
                    {track.type === 'audio' && track.channels && (
                      <span className="text-[9px] text-sf-text-muted ml-0.5">
                        ({track.channels})
                      </span>
                    )}
                  </span>
                )}
              
              <div className="flex items-center gap-0.5">
                {/* Rename button */}
                <button 
                  onClick={(e) => { e.stopPropagation(); handleStartRename(track) }}
                  className="p-0.5 hover:bg-sf-dark-600 rounded opacity-0 group-hover/track:opacity-100 transition-opacity"
                  title="Rename track"
                >
                  <Pencil className="w-3 h-3 text-sf-text-muted" />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); toggleTrackMute(track.id) }}
                  className="p-0.5 hover:bg-sf-dark-600 rounded"
                >
                  {track.muted ? (
                    <VolumeX className="w-3 h-3 text-sf-error" />
                  ) : (
                    <Volume2 className="w-3 h-3 text-sf-text-muted" />
                  )}
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); toggleTrackLock(track.id) }}
                  className="p-0.5 hover:bg-sf-dark-600 rounded"
                >
                  {track.locked ? (
                    <Lock className="w-3 h-3 text-sf-warning" />
                  ) : (
                    <Unlock className="w-3 h-3 text-sf-text-muted" />
                  )}
                </button>
                {/* Delete track button */}
                {canDeleteTrack(track) && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDeleteTrack(track) }}
                    className="p-0.5 hover:bg-sf-error/30 rounded opacity-0 group-hover/track:opacity-100 transition-opacity"
                    title="Delete track"
                  >
                    <X className="w-3 h-3 text-sf-error" />
                  </button>
                )}
                {/* Primary track (Flame style) — click to set as active for X cut */}
                <button
                  onClick={(e) => { e.stopPropagation(); setActiveTrack(track.id) }}
                  className={`min-w-[18px] h-[18px] flex items-center justify-center rounded text-[10px] font-bold transition-colors ${
                    activeTrackId === track.id
                      ? 'bg-red-500 text-white'
                      : 'bg-sf-dark-600 text-sf-text-muted hover:bg-sf-dark-500 hover:text-sf-text-secondary'
                  }`}
                  title={activeTrackId === track.id ? 'Primary track (X cuts here)' : 'Set as primary track'}
                >
                  P
                </button>
              </div>
              </div>
              {isStereo && (
                <div className="flex items-center justify-around text-[9px] text-sf-text-muted border-t border-sf-dark-700/80 flex-shrink-0 py-0.5">
                  <span>L</span>
                  <span>R</span>
                </div>
              )}
            </div>
          )})}
          </div>
        </div>

        {/* Track Content Area */}
        <div 
          ref={timelineRef}
          className={`flex-1 overflow-x-auto overflow-y-hidden relative bg-sf-dark-900 flex flex-col ${
            isPanning ? 'cursor-grabbing select-none' : 
            isSpaceHeld ? 'cursor-grab' : 
            isScrubbing ? 'cursor-ew-resize select-none' : ''
          }`}
          onMouseDown={handleTimelineMouseDown}
          onWheel={handleWheel}
        >
          {/* Inner container that stretches to fill available space */}
          <div className="min-w-full flex flex-col flex-1" style={{ width: `max(100%, ${duration * pixelsPerSecond}px)` }}>
            {/* Time Ruler - Fixed at top */}
            <div className="h-5 flex-shrink-0 bg-sf-dark-800 border-b border-sf-dark-700 flex items-end relative">
            {timeMarkers.map((time) => (
              <div
                key={time}
                className="absolute bottom-0 text-[10px] text-sf-text-muted"
                style={{ left: `${time * pixelsPerSecond}px` }}
              >
                <div className="h-2 w-px bg-sf-dark-600 mb-0.5" />
                <span className="ml-1">{time}s</span>
              </div>
            ))}
          </div>

          {/* Scrollable tracks container */}
          <div 
            ref={trackContentRef}
            className="flex-1 overflow-y-auto overflow-x-hidden"
            onScroll={(e) => {
              // Sync scroll with track headers
              if (trackHeadersRef.current) {
                trackHeadersRef.current.scrollTop = e.target.scrollTop
              }
            }}
          >
          {/* Video Tracks Content */}
          {videoTracks.map((track) => {
            const trackClips = clips.filter(c => c.trackId === track.id)
            
            return (
              <div 
                key={track.id}
                className={`h-12 border-b border-sf-dark-700 relative ${
                  !track.visible ? 'opacity-40' : ''
                } ${track.locked ? 'pointer-events-none opacity-50 bg-sf-dark-800' : ''} ${
                  dropTarget === track.id ? 'bg-sf-accent/10' : track.locked ? '' : 'bg-sf-dark-900'
                }`}
                onDragOver={(e) => handleDragOver(e, track.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, track.id)}
              >
                {trackClips.map((clip) => {
                  const clipWidth = clip.duration * pixelsPerSecond
                  // Calculate how many thumbnail frames to show (roughly one per 60px)
                  const thumbCount = Math.max(1, Math.floor(clipWidth / 60))
                  const isTextClip = clip.type === 'text'
                  
                  return (
                  <div
                    key={clip.id}
                    data-clip="true"
                    onMouseDown={(e) => handleClipDragStart(e, clip)}
                    onClick={(e) => handleClipClick(e, clip)}
                    onContextMenu={(e) => handleClipContextMenu(e, clip)}
                    className={`absolute top-0.5 bottom-0.5 rounded-sm cursor-grab group overflow-hidden ${
                      selectedClipIds.includes(clip.id) ? 'ring-2 ring-white ring-offset-1 ring-offset-sf-dark-900' : ''
                    } ${trimState?.clipId === clip.id ? 'ring-2 ring-sf-accent' : ''} ${
                      clipDragState && (clipDragState.clipId === clip.id || (selectedClipIds.includes(clip.id) && selectedClipIds.includes(clipDragState.clipId)))
                        ? 'ring-2 ring-sf-accent cursor-grabbing z-30' : ''
                    }`}
                    style={{ 
                      left: `${clip.startTime * pixelsPerSecond}px`, 
                      width: `${clipWidth}px`,
                      minWidth: '24px',
                    }}
                  >
                    {(() => {
                      const edgeTransitions = edgeTransitionsByClipId.get(clip.id) || []
                      const hasIn = edgeTransitions.some(t => t.edge === 'in')
                      const hasOut = edgeTransitions.some(t => t.edge === 'out')
                      return (
                        <>
                          {hasIn && (
                            <div className="absolute left-0 top-0 bottom-0 w-2 bg-gradient-to-r from-purple-500/50 to-transparent pointer-events-none" />
                          )}
                          {hasOut && (
                            <div className="absolute right-0 top-0 bottom-0 w-2 bg-gradient-to-l from-purple-500/50 to-transparent pointer-events-none" />
                          )}
                        </>
                      )
                    })()}
                    {/* Text Clip Rendering */}
                    {isTextClip ? (
                      <>
                        {/* Text clip background with accent color bar */}
                        <div 
                          className="absolute inset-0 bg-gradient-to-b from-sf-accent/30 to-sf-accent-muted/40"
                          style={{ borderTop: `3px solid ${clip.color}` }}
                        />
                        
                        {/* Text pattern background */}
                        <div className="absolute inset-0 top-[3px] flex items-center justify-center overflow-hidden">
                          <div className="absolute inset-0 opacity-20">
                            {/* Repeating "T" pattern to indicate text */}
                            <div className="flex flex-wrap gap-2 p-1">
                              {Array.from({ length: Math.ceil(clipWidth / 20) }).map((_, i) => (
                                <Type key={i} className="w-4 h-4 text-sf-accent" />
                              ))}
                            </div>
                          </div>
                        </div>
                        
                        {/* Text preview */}
                        <div className="absolute inset-0 top-[3px] flex items-center justify-center px-2 overflow-hidden">
                          <span 
                            className="text-[11px] text-sf-text-primary font-medium truncate"
                            style={{
                              textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                              fontFamily: clip.textProperties?.fontFamily || 'Inter'
                            }}
                          >
                            {clip.textProperties?.text || 'Text'}
                          </span>
                        </div>
                        
                        {/* Text icon badge - top left */}
                        <div className="absolute top-1 left-1 z-10 flex items-center gap-1">
                          <div className="bg-sf-accent/80 rounded px-1 py-0.5 flex items-center gap-0.5">
                            <Type className="w-2.5 h-2.5 text-white" />
                            <span className="text-[8px] text-white font-medium">TEXT</span>
                          </div>
                        </div>
                        
                        {/* Duration badge - bottom right */}
                        <div className="absolute bottom-1 right-1 px-1 py-0.5 bg-black/60 rounded text-[8px] text-white/90 font-mono">
                          {clip.duration.toFixed(1)}s
                        </div>
                        
                        {/* Keyframe markers */}
                        {clip.keyframes && Object.keys(clip.keyframes).length > 0 && (
                          <div className="absolute bottom-[3px] left-0 right-0 h-2 pointer-events-none">
                            {getAllKeyframeTimes(clip.keyframes).map((kf, i) => (
                              <div
                                key={`kf-${i}-${kf.time}`}
                                className="absolute w-2 h-2 -translate-x-1/2"
                                style={{ left: `${(kf.time / clip.duration) * 100}%` }}
                                title={`Keyframe at ${kf.time.toFixed(2)}s: ${kf.properties.join(', ')}`}
                              >
                                <Diamond className="w-2 h-2 text-yellow-400 fill-yellow-400" />
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : clip.type === 'image' ? (
                      <>
                        {/* Image Clip Rendering */}
                        {/* Clip background with color bar at top - purple tint for images */}
                        <div 
                          className="absolute inset-0 bg-[#1e1a28]"
                          style={{ 
                            borderTop: `3px solid #6b5080`,
                          }}
                        />
                        
                        {/* Single image thumbnail repeated */}
                        {getClipUrl(clip) && (
                          <div className="absolute inset-0 top-[3px] flex overflow-hidden">
                            <img
                              src={getClipUrl(clip)}
                              alt={clip.name}
                              className="h-full object-cover opacity-80 pointer-events-none"
                              style={{ 
                                width: '100%',
                                objectFit: 'cover',
                              }}
                              draggable={false}
                              onContextMenu={(e) => e.preventDefault()}
                            />
                          </div>
                        )}
                        
                        {/* Gradient overlay for text readability */}
                        <div className="absolute inset-x-0 top-[3px] h-6 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
                        
                        {/* Image badge - top left */}
                        <div className="absolute top-1 left-1 z-10 flex items-center gap-1">
                          <div className="bg-purple-500/80 rounded px-1 py-0.5 flex items-center gap-0.5">
                            <ImageIcon className="w-2.5 h-2.5 text-white" />
                            <span className="text-[8px] text-white font-medium">IMG</span>
                          </div>
                        </div>
                        
                        {/* Clip label */}
                        <div className="absolute top-1 left-12 right-6 z-10">
                          <span className="text-[10px] text-white font-medium truncate block drop-shadow-md">
                            {clip.name}
                          </span>
                        </div>
                        
                        {/* Duration badge - bottom right */}
                        <div className="absolute bottom-1 right-1 px-1 py-0.5 bg-black/60 rounded text-[8px] text-white/90 font-mono">
                          {clip.duration.toFixed(1)}s
                        </div>
                        
                        {/* Keyframe markers */}
                        {clip.keyframes && Object.keys(clip.keyframes).length > 0 && (
                          <div className="absolute bottom-[3px] left-0 right-0 h-2 pointer-events-none">
                            {getAllKeyframeTimes(clip.keyframes).map((kf, i) => (
                              <div
                                key={`kf-${i}-${kf.time}`}
                                className="absolute w-2 h-2 -translate-x-1/2"
                                style={{ left: `${(kf.time / clip.duration) * 100}%` }}
                                title={`Keyframe at ${kf.time.toFixed(2)}s: ${kf.properties.join(', ')}`}
                              >
                                <Diamond className="w-2 h-2 text-yellow-400 fill-yellow-400" />
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {/* Video Clip Rendering */}
                        {/* Clip background with color bar at top - Resolve-style desaturated teal */}
                        <div 
                          className="absolute inset-0 bg-[#1a2528]"
                          style={{ 
                            borderTop: `3px solid #3d7080`,
                          }}
                        />
                        
                        {/* Filmstrip thumbnails */}
                        {getClipUrl(clip) && (
                          <div className="absolute inset-0 top-[3px] flex overflow-hidden">
                            {Array.from({ length: thumbCount }).map((_, i) => (
                              <div 
                                key={i} 
                                className="flex-shrink-0 h-full relative overflow-hidden"
                                style={{ width: `${clipWidth / thumbCount}px` }}
                              >
                                <video
                                  src={getClipUrl(clip)}
                                  className="absolute inset-0 w-full h-full object-cover opacity-80 pointer-events-none"
                                  muted
                                  style={{
                                    // Offset each thumbnail to show different part of video
                                    objectPosition: `${(i / Math.max(1, thumbCount - 1)) * 100}% center`
                                  }}
                                  onContextMenu={(e) => e.preventDefault()}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {/* Gradient overlay for text readability */}
                        <div className="absolute inset-x-0 top-[3px] h-6 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
                        
                        {/* Clip label - top left */}
                        <div className="absolute top-1 left-1.5 right-6 z-10">
                          <span className="text-[10px] text-white font-medium truncate block drop-shadow-md">
                            {clip.name}
                          </span>
                        </div>
                        
                        {/* Effects/Cache indicator - top right area */}
                        {(clip.effects?.length > 0) && (
                          <div className="absolute top-1 right-8 z-10 flex items-center gap-1">
                            {/* Effect badge */}
                            <div className="bg-purple-500/80 rounded px-1 py-0.5 flex items-center gap-0.5" title="Has effects">
                              <Zap className="w-2.5 h-2.5 text-white" />
                            </div>
                            {/* Cache status indicator */}
                            {clip.cacheStatus === 'cached' && (
                              <div className="bg-green-500/80 rounded px-1 py-0.5" title="Cached">
                                <Check className="w-2.5 h-2.5 text-white" />
                              </div>
                            )}
                            {clip.cacheStatus === 'invalid' && (
                              <div className="bg-yellow-500/80 rounded px-1 py-0.5" title="Cache outdated">
                                <AlertTriangle className="w-2.5 h-2.5 text-white" />
                              </div>
                            )}
                            {clip.cacheStatus === 'rendering' && (
                              <div className="bg-blue-500/80 rounded px-1 py-0.5 animate-pulse" title={`Rendering ${clip.cacheProgress || 0}%`}>
                                <Loader2 className="w-2.5 h-2.5 text-white animate-spin" />
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* Duration badge - bottom right */}
                        <div className="absolute bottom-1 right-1 px-1 py-0.5 bg-black/60 rounded text-[8px] text-white/90 font-mono">
                          {clip.duration.toFixed(1)}s
                        </div>
                        
                        {/* Keyframe markers */}
                        {clip.keyframes && Object.keys(clip.keyframes).length > 0 && (
                          <div className="absolute bottom-[3px] left-0 right-0 h-2 pointer-events-none">
                            {getAllKeyframeTimes(clip.keyframes).map((kf, i) => (
                              <div
                                key={`kf-${i}-${kf.time}`}
                                className="absolute w-2 h-2 -translate-x-1/2"
                                style={{ left: `${(kf.time / clip.duration) * 100}%` }}
                                title={`Keyframe at ${kf.time.toFixed(2)}s: ${kf.properties.join(', ')}`}
                              >
                                <Diamond className="w-2 h-2 text-yellow-400 fill-yellow-400" />
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 transition-colors pointer-events-none" />
                    
                    {/* Left trim handle - wider hit area for easier grabbing */}
                    <div 
                      data-trim-handle="true"
                      onMouseDown={(e) => handleTrimStart(e, clip.id, 'left')}
                      className="absolute left-0 top-0 bottom-0 w-4 bg-white/0 group-hover:bg-white/20 cursor-ew-resize transition-colors flex items-center justify-start z-20"
                    >
                      <div className="w-1 h-8 bg-white/0 group-hover:bg-white/90 rounded-r transition-colors ml-0" />
                    </div>
                    
                    {/* Right trim handle - wider hit area for easier grabbing */}
                    <div 
                      data-trim-handle="true"
                      onMouseDown={(e) => handleTrimStart(e, clip.id, 'right')}
                      className="absolute right-0 top-0 bottom-0 w-4 bg-white/0 group-hover:bg-white/20 cursor-ew-resize transition-colors flex items-center justify-end z-20"
                    >
                      <div className="w-1 h-8 bg-white/0 group-hover:bg-white/90 rounded-l transition-colors mr-0" />
                    </div>
                    
                    {/* Left/Right edge borders */}
                    <div className="absolute left-0 top-0 bottom-0 w-px bg-black/40 pointer-events-none" />
                    <div className="absolute right-0 top-0 bottom-0 w-px bg-black/40 pointer-events-none" />
                  </div>
                  )
                })}
                
                {/* Roll edit zones and transition buttons/overlays between adjacent clips */}
                {getAdjacentClips(track.id).map(({ clipA, clipB, transition, isOverlapping }) => {
                  const clipAEnd = clipA.startTime + clipA.duration
                  
                  if (transition && isOverlapping) {
                    // Show transition overlay zone for overlapping clips
                    const overlapStart = clipB.startTime
                    const overlapEnd = clipAEnd
                    const overlapWidth = (overlapEnd - overlapStart) * pixelsPerSecond
                    const overlapX = overlapStart * pixelsPerSecond
                    const centerX = overlapX + overlapWidth / 2
                    
                    return (
                      <div
                        key={`transition-${clipA.id}-${clipB.id}`}
                        className="absolute top-0 bottom-0 z-25 pointer-events-none"
                        style={{ left: `${overlapX}px`, width: `${overlapWidth}px` }}
                      >
                        {/* Transition overlap visualization - diagonal stripes */}
                        <div 
                          className="absolute inset-0 opacity-40"
                          style={{
                            background: `repeating-linear-gradient(
                              -45deg,
                              transparent,
                              transparent 3px,
                              rgba(139, 92, 246, 0.5) 3px,
                              rgba(139, 92, 246, 0.5) 6px
                            )`
                          }}
                        />
                        
                        {/* Edit point marker (center of transition) */}
                        <div 
                          className="absolute top-0 bottom-0 w-px bg-purple-400"
                          style={{ left: `${overlapWidth / 2}px` }}
                        />
                        
                        {/* Transition controls - centered on the overlap */}
                        <div 
                          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto group/trans"
                        >
                          {/* Transition icon button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              removeTransition(transition.id)
                            }}
                            className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center hover:bg-sf-error transition-colors shadow-lg"
                            title={`${transition.type} (${Math.round(transition.duration * FRAME_RATE)} frames) - Click to remove`}
                          >
                            <span className="text-[10px] text-white">
                              {TRANSITION_TYPES.find(t => t.id === transition.type)?.icon || '⚪'}
                            </span>
                          </button>
                          
                          {/* Duration label */}
                          <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-purple-300 whitespace-nowrap bg-sf-dark-800/80 px-1 rounded">
                            {Math.round(transition.duration * FRAME_RATE)}f
                          </div>
                        </div>
                      </div>
                    )
                  }
                  
                  // Non-overlapping adjacent clips - show add transition button / drop target
                  const editPointX = clipAEnd * pixelsPerSecond
                  const dropKey = `${clipA.id}-${clipB.id}`
                  const isDropTarget = transitionDropTarget === dropKey
                  
                  return (
                    <div
                      key={`edit-${clipA.id}-${clipB.id}`}
                      className={`absolute top-0 bottom-0 z-20 group/edit ${isDropTarget ? 'bg-purple-500/10' : ''}`}
                      style={{ left: `${editPointX - 8}px`, width: '16px' }}
                      onDragOver={(e) => {
                        const payload = parseTransitionDrop(e)
                        if (!payload) return
                        e.preventDefault()
                        if (transitionDropTarget !== dropKey) {
                          setTransitionDropTarget(dropKey)
                        }
                      }}
                      onDragLeave={() => {
                        if (transitionDropTarget === dropKey) {
                          setTransitionDropTarget(null)
                        }
                      }}
                      onDrop={(e) => {
                        const payload = parseTransitionDrop(e)
                        if (!payload) return
                        e.preventDefault()
                        setTransitionDropTarget(null)
                        const { type, duration } = payload
                        const existingTransition = getTransitionBetween(clipA.id, clipB.id)
                        if (existingTransition) {
                          updateTransition(existingTransition.id, { type, duration })
                        } else {
                          addTransition(clipA.id, clipB.id, type, duration)
                        }
                      }}
                    >
                      {/* Roll edit handle */}
                      <div
                        className="absolute inset-0 cursor-ew-resize flex items-center justify-center"
                        onMouseDown={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          saveToHistory()
                          setRollEditState({
                            clipAId: clipA.id,
                            clipBId: clipB.id,
                            startX: e.clientX,
                            originalEditPoint: clipAEnd,
                            clipAOriginalDuration: clipA.duration,
                            clipBOriginalStart: clipB.startTime,
                            clipBOriginalDuration: clipB.duration
                          })
                        }}
                        title="Drag to roll edit (extend one clip, shorten the other)"
                      >
                        <div className="w-0.5 h-full bg-white/0 group-hover/edit:bg-yellow-400/70 transition-colors" />
                      </div>
                      
                      {/* Add transition button */}
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
                        <button
                          onClick={(e) => handleAddTransition(e, clipA, clipB)}
                          className="w-5 h-5 rounded-full bg-sf-dark-600 border border-sf-dark-400 flex items-center justify-center hover:bg-purple-600 hover:border-purple-500 transition-colors opacity-0 group-hover/edit:opacity-100"
                          title="Add transition"
                        >
                          <Plus className="w-3 h-3 text-white" />
                        </button>
                      </div>
                    </div>
                  )
                })}
                
                {/* Empty track hint */}
                {trackClips.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-[10px] text-sf-text-muted">
                      Drag video from Assets here
                    </span>
                  </div>
                )}
              </div>
            )
          })}
          
          {/* Audio Section Spacer */}
          <div className="h-5 bg-sf-dark-800 border-b border-sf-dark-700 flex items-center">
            <span className="text-[10px] text-sf-text-muted ml-2 uppercase tracking-wider">Audio</span>
          </div>
          
          {/* Audio Tracks Content */}
          {audioTracks.map((track) => {
            const trackClips = clips.filter(c => c.trackId === track.id)
            const isStereoContent = track.channels !== 'mono'
            const contentHeight = getAudioTrackHeight(track)
            
            return (
              <div 
                key={track.id}
                className={`border-b border-sf-dark-700 relative flex flex-col ${
                  track.muted ? 'opacity-40' : ''
                } ${track.locked ? 'pointer-events-none opacity-50 bg-sf-dark-800' : ''} ${
                  dropTarget === track.id ? 'bg-sf-accent/10' : track.locked ? '' : 'bg-sf-dark-900'
                }`}
                style={{ height: contentHeight, minHeight: contentHeight }}
                onDragOver={(e) => handleDragOver(e, track.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, track.id)}
              >
                {isStereoContent && (
                  <div className="absolute left-0 right-0 top-1/2 h-px bg-sf-dark-600 z-10 pointer-events-none flex items-center justify-center">
                    <span className="text-[8px] text-sf-text-muted bg-sf-dark-900 px-1">L / R</span>
                  </div>
                )}
                {trackClips.map((clip) => {
                  const clipWidth = clip.duration * pixelsPerSecond
                  // Generate deterministic waveform based on clip id
                  const waveformBars = Math.max(Math.floor(clipWidth / 3), 8)
                  const seed = clip.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
                  
                  return (
                  <div
                    key={clip.id}
                    data-clip="true"
                    onMouseDown={(e) => handleClipDragStart(e, clip)}
                    onClick={(e) => handleClipClick(e, clip)}
                    onContextMenu={(e) => handleClipContextMenu(e, clip)}
                    className={`absolute top-0.5 bottom-0.5 rounded-sm cursor-grab group overflow-hidden ${
                      selectedClipIds.includes(clip.id) ? 'ring-2 ring-white ring-offset-1 ring-offset-sf-dark-900' : ''
                    } ${clipDragState && (clipDragState.clipId === clip.id || (selectedClipIds.includes(clip.id) && selectedClipIds.includes(clipDragState.clipId)))
                        ? 'ring-2 ring-sf-accent cursor-grabbing z-30' : ''}`}
                    style={{ 
                      left: `${clip.startTime * pixelsPerSecond}px`, 
                      width: `${clipWidth}px`,
                      minWidth: '24px',
                    }}
                  >
                    {/* Clip background with color bar at top */}
                    <div 
                      className="absolute inset-0"
                      style={{ 
                        backgroundColor: clip.color,
                        opacity: 0.3
                      }}
                    />
                    <div 
                      className="absolute inset-x-0 top-0 h-[3px]"
                      style={{ backgroundColor: clip.color }}
                    />
                    
                    {/* Waveform visualization */}
                    <div className="absolute inset-0 top-[3px] flex items-center px-0.5 gap-px overflow-hidden">
                      {Array.from({ length: waveformBars }).map((_, i) => {
                        // Pseudo-random but deterministic height based on index and seed
                        const h = Math.abs(Math.sin(seed + i * 0.7) * 0.6 + Math.cos(seed * 0.3 + i * 1.2) * 0.4) * 70 + 15
                        return (
                          <div 
                            key={i} 
                            className="flex-1 min-w-[1px] max-w-[3px] rounded-sm"
                            style={{ 
                              height: `${h}%`,
                              backgroundColor: clip.color,
                              opacity: 0.8
                            }}
                          />
                        )
                      })}
                    </div>
                    
                    {/* Clip label - top left with background */}
                    <div className="absolute top-[4px] left-1 right-5 z-10">
                      <span 
                        className="text-[9px] text-white font-medium truncate block px-1 py-0.5 rounded"
                        style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
                      >
                        {clip.name}
                      </span>
                    </div>
                    
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors pointer-events-none" />
                    
                    {/* Left/Right edge borders */}
                    <div className="absolute left-0 top-0 bottom-0 w-px bg-black/40 pointer-events-none" />
                    <div className="absolute right-0 top-0 bottom-0 w-px bg-black/40 pointer-events-none" />
                    
                    {/* Trim handles on hover - wider hit area for easier grabbing */}
                    <div 
                      data-trim-handle="true"
                      onMouseDown={(e) => handleTrimStart(e, clip.id, 'left')}
                      className="absolute left-0 top-0 bottom-0 w-4 bg-white/0 group-hover:bg-white/20 cursor-ew-resize transition-colors z-20 flex items-center justify-start"
                    >
                      <div className="w-1 h-6 bg-white/0 group-hover:bg-white/90 rounded-r transition-colors" />
                    </div>
                    <div 
                      data-trim-handle="true"
                      onMouseDown={(e) => handleTrimStart(e, clip.id, 'right')}
                      className="absolute right-0 top-0 bottom-0 w-4 bg-white/0 group-hover:bg-white/20 cursor-ew-resize transition-colors z-20 flex items-center justify-end"
                    >
                      <div className="w-1 h-6 bg-white/0 group-hover:bg-white/90 rounded-l transition-colors" />
                    </div>
                  </div>
                  )
                })}
                
                {/* Roll edit zones between adjacent audio clips */}
                {getAdjacentClips(track.id).map(({ clipA, clipB }) => {
                  const editPointX = (clipA.startTime + clipA.duration) * pixelsPerSecond
                  
                  return (
                    <div
                      key={`edit-${clipA.id}-${clipB.id}`}
                      className="absolute top-0 bottom-0 z-20 group/edit"
                      style={{ left: `${editPointX - 8}px`, width: '16px' }}
                    >
                      {/* Roll edit handle */}
                      <div
                        className="absolute inset-0 cursor-ew-resize flex items-center justify-center"
                        onMouseDown={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          saveToHistory()
                          setRollEditState({
                            clipAId: clipA.id,
                            clipBId: clipB.id,
                            startX: e.clientX,
                            originalEditPoint: clipA.startTime + clipA.duration,
                            clipAOriginalDuration: clipA.duration,
                            clipBOriginalStart: clipB.startTime,
                            clipBOriginalDuration: clipB.duration
                          })
                        }}
                        title="Drag to roll edit"
                      >
                        <div className="w-0.5 h-full bg-white/0 group-hover/edit:bg-yellow-400/70 transition-colors" />
                      </div>
                    </div>
                  )
                })}
                
              </div>
            )
          })}
          </div>

          </div>
          
          {/* Marquee Selection Rectangle */}
          {marqueeState && (
            <div
              className="absolute border-2 border-sf-accent bg-sf-accent/10 z-30 pointer-events-none"
              style={{
                left: `${Math.min(marqueeState.startX, marqueeState.currentX)}px`,
                top: `${Math.min(marqueeState.startY, marqueeState.currentY)}px`,
                width: `${Math.abs(marqueeState.currentX - marqueeState.startX)}px`,
                height: `${Math.abs(marqueeState.currentY - marqueeState.startY)}px`,
              }}
            />
          )}
          
          {/* In Point Marker */}
          {inPoint !== null && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-[#5a7a9e] z-15 pointer-events-none"
              style={{ left: `${inPoint * pixelsPerSecond}px` }}
            >
              {/* In point indicator at top */}
              <div className="absolute -top-0.5 left-0 w-3 h-3 bg-[#5a7a9e] flex items-center justify-center">
                <span className="text-[8px] text-white font-bold">I</span>
              </div>
            </div>
          )}
          
          {/* Out Point Marker */}
          {outPoint !== null && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-[#5a7a9e] z-15 pointer-events-none"
              style={{ left: `${outPoint * pixelsPerSecond}px` }}
            >
              {/* Out point indicator at top */}
              <div className="absolute -top-0.5 right-0 w-3 h-3 bg-[#5a7a9e] flex items-center justify-center">
                <span className="text-[8px] text-white font-bold">O</span>
              </div>
            </div>
          )}
          
          {/* I/O Range Highlight */}
          {inPoint !== null && outPoint !== null && inPoint < outPoint && (
            <div
              className="absolute top-0 bottom-0 bg-[#5a7a9e]/10 z-5 pointer-events-none border-t border-b border-[#5a7a9e]/30"
              style={{ 
                left: `${inPoint * pixelsPerSecond}px`,
                width: `${(outPoint - inPoint) * pixelsPerSecond}px`
              }}
            />
          )}
          
          {/* Snap Guide Lines */}
          {activeSnapTime !== null && snappingEnabled && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-yellow-400 z-20 pointer-events-none"
              style={{ 
                left: `${activeSnapTime * pixelsPerSecond}px`,
                boxShadow: '0 0 8px 2px rgba(250, 204, 21, 0.4)'
              }}
            >
              {/* Snap indicator at top */}
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-yellow-400 rotate-45" />
              {/* Snap time tooltip */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-yellow-400 text-black text-[9px] font-mono px-1 py-0.5 rounded whitespace-nowrap">
                {activeSnapTime.toFixed(2)}s
              </div>
            </div>
          )}
          
          {/* Playhead (30% thinner: w-0.5 → ~1.4px) */}
          <div
            className={`absolute top-0 bottom-0 bg-yellow-500 z-10 ${isScrubbing ? 'pointer-events-none' : ''}`}
            style={{ left: `${playheadPosition * pixelsPerSecond}px`, width: '1.4px' }}
          >
            {/* Playhead handle (draggable) */}
            <div 
              className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-4 h-3 bg-yellow-500 cursor-ew-resize hover:bg-yellow-400 transition-colors"
              style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                setIsScrubbing(true)
              }}
              title="Drag to scrub"
            />
            {/* Notch at active track (Flame-style) — aligns with primary track */}
            {activeTrackId && (() => {
              const videoTrackHeight = 48
              const audioSectionHeight = 20
              const timeRulerHeight = 20
              const notchHeight = 10
              const vi = videoTracks.findIndex(t => t.id === activeTrackId)
              const ai = audioTracks.findIndex(t => t.id === activeTrackId)
              let centerY = 0
              if (vi >= 0) centerY = timeRulerHeight + vi * videoTrackHeight + videoTrackHeight / 2
              else if (ai >= 0) {
                const track = audioTracks[ai]
                centerY = timeRulerHeight + videoTracks.length * videoTrackHeight + audioSectionHeight + getAudioTrackOffset(audioTracks, ai) + getAudioTrackHeight(track) / 2
              }
              else return null
              const top = centerY - notchHeight / 2
              return (
                <div
                  className="absolute left-0 w-2 h-2.5 bg-yellow-500 pointer-events-none"
                  style={{ top: `${top}px`, clipPath: 'polygon(0 50%, 100% 0, 100% 100%)' }}
                  title="Primary track"
                />
              )
            })()}
            {/* Playhead line extension for easier grabbing */}
            <div 
              className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-full cursor-ew-resize"
              onMouseDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                setIsScrubbing(true)
              }}
            />
          </div>
        </div>
        
        {/* Audio Meter Panel - Right side, full height of track panel, resizes with it */}
        <div className="flex-shrink-0 flex flex-col border-l border-sf-dark-700 w-[72px] min-h-0">
          {/* Time ruler header spacer - aligns with time ruler */}
          <div className="h-5 flex-shrink-0 border-b border-sf-dark-700 bg-sf-dark-800" />
          
          {/* Meter fills remaining height and resizes with track panel */}
          <div className="flex-1 min-h-0 flex flex-col">
            <MasterAudioMeter className="flex-1 min-h-0" />
          </div>
        </div>
      </div>
      
      {/* Transition Type Selection Menu (Portal) - Resolve-style */}
      {transitionMenu && (() => {
        const availableDurations = getAvailableDurations()
        const maxDuration = getMaxTransitionDuration(transitionMenu.clipA.id, transitionMenu.clipB.id)
        const maxFrames = Math.floor(maxDuration * FRAME_RATE)
        
        return (
          <div
            className="fixed z-50 bg-sf-dark-800 border border-sf-dark-600 rounded-lg shadow-xl py-1 min-w-[200px]"
            style={{ 
              left: `${transitionMenu.x}px`, 
              top: `${transitionMenu.y}px`,
              transform: 'translate(-50%, 8px)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {availableDurations.length > 0 ? (
              <>
                <div className="px-2 py-1 text-[10px] text-sf-text-muted uppercase tracking-wider border-b border-sf-dark-600 mb-1">
                  Add Transition ({maxFrames} frames max)
                </div>
                {availableDurations.map((duration) => (
                  <button
                    key={duration.frames}
                    onClick={() => handleSelectTransition('dissolve', duration.seconds)}
                    className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
                  >
                    <span className="w-4 text-center">⚪</span>
                    <span>Add {duration.frames} frame Cross Dissolve</span>
                  </button>
                ))}
                <div className="h-px bg-sf-dark-600 my-1" />
                <div className="px-2 py-1 text-[10px] text-sf-text-muted uppercase tracking-wider">
                  Other Transitions
                </div>
                {TRANSITION_TYPES.filter(t => t.id !== 'dissolve').map((type) => (
                  <button
                    key={type.id}
                    onClick={() => handleSelectTransition(type.id, availableDurations[1]?.seconds || availableDurations[0]?.seconds || 0.5)}
                    className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
                  >
                    <span className="w-4 text-center">{type.icon}</span>
                    <span>{type.name}</span>
                  </button>
                ))}
              </>
            ) : (
              <div className="px-3 py-2 text-xs text-sf-text-muted">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-sf-accent" />
                  <span className="font-medium text-sf-text-primary">Insufficient Handles</span>
                </div>
                <p className="text-[10px] leading-tight">
                  Cannot add transition. The clips need more footage before/after their trim points.
                  Extend the clips or use source media with more footage.
                </p>
              </div>
            )}
          </div>
        )
      })()}
      
      {/* Clip Context Menu (Portal) */}
      {clipContextMenu && (
        <div
          className="fixed z-50 bg-sf-dark-800 border border-sf-dark-600 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ 
            left: `${clipContextMenu.x}px`, 
            top: `${clipContextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const contextClip = clips.find(c => c.id === clipContextMenu.clipId)
            const track = tracks.find(t => t.id === contextClip?.trackId)
            const isVideoClip = track?.type === 'video'
            if (!isVideoClip) return null
            
            return (
              <>
                <div className="relative">
                  <button
                    onClick={() => setMaskSubmenuOpen((prev) => !prev)}
                    className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
                  >
                    <span className="w-4 text-center">🪄</span>
                    <span>Add Mask…</span>
                    <ChevronRight className="ml-auto w-3 h-3 text-sf-text-muted" />
                  </button>
                  
                  {maskSubmenuOpen && (
                    <div
                      className="absolute top-0 left-full ml-1 bg-sf-dark-800 border border-sf-dark-600 rounded-lg shadow-xl py-1 min-w-[220px] z-50 max-h-60 overflow-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => handleContextMenuAction('add-mask')}
                        className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
                      >
                        <span className="w-4 text-center">🧭</span>
                        <span>Open Mask Picker…</span>
                      </button>
                      
                      <div className="h-px bg-sf-dark-600 my-1" />
                      
                      {availableMasks.length > 0 ? (
                        availableMasks.map((mask) => (
                          <button
                            key={mask.id}
                            onClick={() => handleApplyMaskFromContextMenu(mask.id)}
                            className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
                          >
                            <span className="w-4 text-center">🎭</span>
                            <span className="truncate">{mask.name}</span>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-xs text-sf-text-muted">
                          No masks found
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="h-px bg-sf-dark-600 my-1" />
              </>
            )
          })()}
          {(() => {
            const contextClip = clips.find(c => c.id === clipContextMenu.clipId)
            const hasCache =
              !!contextClip?.cacheUrl ||
              !!contextClip?.cachePath ||
              (contextClip?.cacheStatus && contextClip.cacheStatus !== 'none')

            if (!hasCache) return null

            return (
              <>
                <button
                  onClick={() => handleContextMenuAction('flush-cache')}
                  className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
                >
                  <span className="w-4 text-center">🧹</span>
                  <span>Flush Render Cache</span>
                </button>
                <div className="h-px bg-sf-dark-600 my-1" />
              </>
            )
          })()}
          <button
            onClick={() => handleContextMenuAction('preview')}
            className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
          >
            <span className="w-4 text-center">👁</span>
            <span>Preview</span>
          </button>
          
          <div className="h-px bg-sf-dark-600 my-1" />
          
          <button
            onClick={() => handleContextMenuAction('split')}
            className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
            title="Split selected clip at playhead (or press X to split on active track)"
          >
            <span className="w-4 text-center">✂️</span>
            <span>Split at Playhead</span>
            <span className="ml-auto text-sf-text-muted text-[10px]">X</span>
          </button>
          
          <button
            onClick={() => handleContextMenuAction('duplicate')}
            className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
          >
            <span className="w-4 text-center">📋</span>
            <span>Duplicate</span>
            <span className="ml-auto text-sf-text-muted text-[10px]">⌘D</span>
          </button>
          
          <div className="h-px bg-sf-dark-600 my-1" />
          
          <button
            onClick={() => handleContextMenuAction('set-in')}
            className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
            title="Set clip start to playhead"
          >
            <span className="w-4 text-center">⟨</span>
            <span>Set In to Playhead</span>
          </button>
          
          <button
            onClick={() => handleContextMenuAction('set-out')}
            className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
            title="Set clip end to playhead"
          >
            <span className="w-4 text-center">⟩</span>
            <span>Set Out to Playhead</span>
          </button>
          
          <div className="h-px bg-sf-dark-600 my-1" />
          
          <button
            onClick={() => handleContextMenuAction('delete')}
            className="w-full px-3 py-1.5 text-left text-xs text-sf-error hover:bg-sf-error/20 flex items-center gap-2 transition-colors"
          >
            <span className="w-4 text-center">🗑️</span>
            <span>{selectedClipIds.length > 1 ? `Delete ${selectedClipIds.length} clips` : 'Delete'}</span>
            <span className="ml-auto text-sf-text-muted text-[10px]">Del</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default Timeline
