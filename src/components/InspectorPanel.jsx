import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { 
  Move, RotateCw, Maximize2, Clock, Layers,
  ChevronDown, ChevronRight, ChevronLeft, Sparkles,
  Zap, Eye, SlidersHorizontal, CircleDot,
  FlipHorizontal, FlipVertical, Link, Unlink, Crop,
  Anchor, RotateCcw, Type, AlignLeft, AlignCenter, AlignRight,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  Diamond, ChevronFirst, ChevronLast,
  FileVideo, FileImage, FileAudio, HardDrive, Calendar, Info,
  Wand2, Trash2, EyeOff, Plus, Play, Loader2, Check, AlertTriangle, X
} from 'lucide-react'
import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'
import useProjectStore from '../stores/projectStore'
import renderCacheService from '../services/renderCache'
import { saveRenderCache, deleteRenderCache, writeGeneratedOverlayToProject, isElectron } from '../services/fileSystem'
import { getKeyframeAtTime, getAnimatedTransform, getAnimatedAdjustmentSettings, EASING_OPTIONS } from '../utils/keyframes'
import { TEXT_ANIMATION_PRESETS, TEXT_ANIMATION_MODE_OPTIONS } from '../utils/textAnimationPresets'
import { DEFAULT_ADJUSTMENT_SETTINGS, normalizeAdjustmentSettings } from '../utils/adjustments'
import { clearDiskCacheUrl } from './VideoLayerRenderer'
import { FRAME_RATE, TRANSITION_TYPES, TRANSITION_DEFAULT_SETTINGS } from '../constants/transitions'
import {
  DEFAULT_LETTERBOX_ASPECT,
  LETTERBOX_ASPECT_PRESETS,
  resolveLetterboxAspect,
  getLetterboxContentRect,
  generateLetterboxOverlayBlob,
} from '../utils/overlayGenerators'
import {
  DEFAULT_AUDIO_CLIP_GAIN_DB,
  MIN_AUDIO_CLIP_GAIN_DB,
  MAX_AUDIO_CLIP_GAIN_DB,
  normalizeAudioClipGainDb,
} from '../utils/audioClipGain'

const TRANSITION_DEFAULT_DURATION_KEY = 'comfystudio-transition-default-duration-frames'
const INSPECTOR_EXPANDED_SECTIONS_KEY = 'comfystudio-inspector-expanded-sections-v1'
const DEFAULT_INSPECTOR_EXPANDED_SECTIONS = ['clipInfo', 'transform', 'crop', 'timing', 'effects', 'text', 'style', 'animation', 'adjustments']

const padTimecodeUnit = (value) => String(Math.max(0, Math.trunc(value) || 0)).padStart(2, '0')
const normalizeLinkGroupId = (value) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

const formatInspectorTimecode = (seconds, fps = FRAME_RATE) => {
  if (!Number.isFinite(Number(seconds))) return 'Unknown'
  const roundedFps = Math.max(1, Math.round(Number(fps) || FRAME_RATE))
  const totalFrames = Math.max(0, Math.round(Number(seconds) * roundedFps))
  const frames = totalFrames % roundedFps
  const totalSeconds = Math.floor(totalFrames / roundedFps)
  const secs = totalSeconds % 60
  const mins = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return `${padTimecodeUnit(hours)}:${padTimecodeUnit(mins)}:${padTimecodeUnit(secs)}:${padTimecodeUnit(frames)}`
}

const formatInspectorFrameRate = (fps) => {
  if (!Number.isFinite(Number(fps)) || Number(fps) <= 0) return 'Unknown'
  const rounded = Math.round(Number(fps) * 100) / 100
  if (Number.isInteger(rounded)) return String(rounded)
  return rounded.toFixed(2).replace(/\.?0+$/, '')
}

const formatInspectorResolution = (width, height) => {
  const safeWidth = Math.round(Number(width) || 0)
  const safeHeight = Math.round(Number(height) || 0)
  if (safeWidth <= 0 || safeHeight <= 0) return 'Unknown'
  return `${safeWidth}x${safeHeight}`
}

const getFileExtensionLabel = (filename) => {
  if (!filename) return 'Unknown'
  const parts = filename.split('.')
  return parts.length > 1 ? parts.pop().toUpperCase() : 'Unknown'
}

const CODEC_LABELS = {
  h264: 'H.264',
  hevc: 'H.265 / HEVC',
  h265: 'H.265 / HEVC',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  aac: 'AAC',
  mp3: 'MP3',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  pcm_s16le: 'PCM S16LE',
  pcm_s24le: 'PCM S24LE',
  pcm_f32le: 'PCM F32LE',
}

const formatMediaCodecLabel = (codec) => {
  if (!codec) return 'Unknown'
  const normalized = String(codec).trim().toLowerCase()
  return CODEC_LABELS[normalized] || String(codec).toUpperCase()
}

const formatAssetFormatLabel = (asset) => {
  if (!asset) return 'Unknown'
  const mimeSubtype = asset.mimeType?.split('/')?.[1]
  if (mimeSubtype) {
    return mimeSubtype.split(';')[0].toUpperCase()
  }
  return getFileExtensionLabel(asset.name)
}

// Draggable number input component - click and drag to change value
function DraggableNumberInput({ value, onChange, onCommit, min, max, step = 1, sensitivity = 0.5, suffix = '', className = '' }) {
  const [isDragging, setIsDragging] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value.toString())
  const startX = useRef(0)
  const startValue = useRef(0)
  const inputRef = useRef(null)
  
  // Update edit value when value changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(value.toString())
    }
  }, [value, isEditing])
  
  // Handle drag
  useEffect(() => {
    if (!isDragging) return
    
    const handleMouseMove = (e) => {
      const deltaX = e.clientX - startX.current
      let newValue = startValue.current + (deltaX * sensitivity * step)
      
      // Apply min/max constraints
      if (min !== undefined) newValue = Math.max(min, newValue)
      if (max !== undefined) newValue = Math.min(max, newValue)
      
      // Round to step
      newValue = Math.round(newValue / step) * step
      
      onChange(newValue)
    }
    
    const handleMouseUp = () => {
      setIsDragging(false)
      onCommit && onCommit(value)
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
  }, [isDragging, onChange, onCommit, value, min, max, step, sensitivity])
  
  const handleMouseDown = (e) => {
    if (isEditing) return
    e.preventDefault()
    startX.current = e.clientX
    startValue.current = value
    setIsDragging(true)
  }
  
  const handleDoubleClick = () => {
    setIsEditing(true)
    setEditValue(value.toString())
    setTimeout(() => inputRef.current?.select(), 0)
  }
  
  const handleInputBlur = () => {
    setIsEditing(false)
    let newValue = parseFloat(editValue) || 0
    if (min !== undefined) newValue = Math.max(min, newValue)
    if (max !== undefined) newValue = Math.min(max, newValue)
    onChange(newValue)
    onCommit && onCommit(newValue)
  }
  
  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      handleInputBlur()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setEditValue(value.toString())
    }
  }
  
  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleInputBlur}
        onKeyDown={handleInputKeyDown}
        autoFocus
        className={`w-full bg-sf-dark-700 border border-sf-accent rounded px-2 py-1 text-xs text-sf-text-primary focus:outline-none ${className}`}
      />
    )
  }
  
  return (
    <div
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      className={`w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary cursor-ew-resize select-none hover:border-sf-dark-500 transition-colors ${className}`}
      title="Drag to adjust, double-click to edit"
    >
      {Math.round(value * 100) / 100}{suffix}
    </div>
  )
}

// Available fonts for text clips
const FONT_OPTIONS = [
  'Inter', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 
  'Courier New', 'Verdana', 'Impact', 'Comic Sans MS', 'Trebuchet MS'
]

/**
 * Keyframe button component - shows diamond icon that can be clicked to toggle keyframes
 * Yellow = keyframe at current time, Gray = no keyframe, Blue outline = property has keyframes
 */
function KeyframeButton({ clipId, property, clip, playheadPosition }) {
  const { 
    toggleKeyframe, 
    goToNextKeyframe, 
    goToPrevKeyframe,
  } = useTimelineStore()
  
  // Calculate clip-relative time
  const clipTime = playheadPosition - (clip?.startTime || 0)
  
  // Check if keyframe exists at current time
  const keyframes = clip?.keyframes?.[property] || []
  const keyframeAtTime = getKeyframeAtTime(keyframes, clipTime, 0.05)
  const hasKeyframesForProperty = keyframes.length > 0
  
  // Handle click - toggle keyframe at current position
  const handleClick = (e) => {
    e.stopPropagation()
    toggleKeyframe(clipId, property)
  }
  
  // Handle navigation to prev/next keyframe
  const handlePrev = (e) => {
    e.stopPropagation()
    goToPrevKeyframe(clipId, property)
  }
  
  const handleNext = (e) => {
    e.stopPropagation()
    goToNextKeyframe(clipId, property)
  }
  
  return (
    <div className="flex items-center gap-0.5 ml-1">
      {/* Previous keyframe button */}
      {hasKeyframesForProperty && (
        <button
          onClick={handlePrev}
          className="p-0.5 hover:bg-sf-dark-600 rounded transition-colors opacity-60 hover:opacity-100"
          title="Go to previous keyframe"
        >
          <ChevronFirst className="w-3 h-3 text-sf-text-muted" />
        </button>
      )}
      
      {/* Keyframe toggle button (diamond) */}
      <button
        onClick={handleClick}
        className={`p-0.5 rounded transition-colors ${
          keyframeAtTime 
            ? 'bg-yellow-400/18 hover:bg-yellow-400/28 shadow-[0_0_10px_rgba(253,224,71,0.18)]' 
            : hasKeyframesForProperty
              ? 'bg-sf-dark-600 hover:bg-sf-dark-500 ring-1 ring-sky-400/40'
              : 'hover:bg-sf-dark-600'
        }`}
        title={keyframeAtTime ? 'Remove keyframe' : 'Add keyframe'}
      >
        <Diamond 
          className={`w-3 h-3 ${
            keyframeAtTime 
              ? 'text-white fill-yellow-300 drop-shadow-[0_0_8px_rgba(253,224,71,0.85)] scale-110' 
              : hasKeyframesForProperty
                ? 'text-sky-300 fill-sky-400/70'
                : 'text-sf-text-muted'
          }`} 
        />
      </button>
      
      {/* Next keyframe button */}
      {hasKeyframesForProperty && (
        <button
          onClick={handleNext}
          className="p-0.5 hover:bg-sf-dark-600 rounded transition-colors opacity-60 hover:opacity-100"
          title="Go to next keyframe"
        >
          <ChevronLast className="w-3 h-3 text-sf-text-muted" />
        </button>
      )}
    </div>
  )
}

function InspectorPanel({ isExpanded, onToggleExpanded }) {
  const [expandedSections, setExpandedSections] = useState(() => {
    try {
      const raw = localStorage.getItem(INSPECTOR_EXPANDED_SECTIONS_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (Array.isArray(parsed)) {
        const normalized = parsed.filter((section) => typeof section === 'string')
        if (normalized.length > 0) {
          return normalized
        }
      }
    } catch (_) {}
    return DEFAULT_INSPECTOR_EXPANDED_SECTIONS
  })
  const [showMaskPicker, setShowMaskPicker] = useState(false)
  const [renderProgress, setRenderProgress] = useState(null) // { status, progress, error }
  const [isRendering, setIsRendering] = useState(false)
  const [textAnimationMode, setTextAnimationMode] = useState('inOut')
  const [letterboxAspectPreset, setLetterboxAspectPreset] = useState(String(DEFAULT_LETTERBOX_ASPECT))
  const [letterboxCustomAspect, setLetterboxCustomAspect] = useState(String(DEFAULT_LETTERBOX_ASPECT))
  const [letterboxBarColor, setLetterboxBarColor] = useState('#000000')
  const [isUpdatingLetterbox, setIsUpdatingLetterbox] = useState(false)
  const [letterboxUpdateError, setLetterboxUpdateError] = useState(null)
  const textContentInputRef = useRef(null)
  
  // Get selected clip from timeline store
  const { 
    selectedClipIds, 
    selectedTransitionId,
    clips, 
    tracks,
    transitions,
    playheadPosition,
    updateClipTransform, 
    updateClipAdjustments,
    resetClipTransform,
    updateTextProperties,
    applyTextAnimationPreset,
    clearTextAnimationPreset,
    removeClip,
    resizeClip,
    updateClipSpeed,
    updateClipReverse,
    updateAudioClipProperties,
    toggleKeyframe,
    setKeyframe,
    saveToHistory,
    // Effects
    addEffect,
    removeEffect,
    updateEffect,
    toggleEffect,
    addMaskEffect,
    getClipEffects,
    updateTransition,
    setTransitionAlignment,
    removeTransition,
    getMaxTransitionDurationForAlignment,
    getMaxEdgeTransitionDuration,
    // Cache
    setCacheStatus,
    setCacheUrl,
    clearClipCache,
    maskPickerRequest,
    clearMaskPickerRequest,
    textEditRequest,
    clearTextEditRequest,
  } = useTimelineStore()
  
  // Get assets store functions (needed for render cache)
  const { assets, getAssetById, getAllMasks, updateAsset } = useAssetsStore()
  
  const selectedTransition = selectedTransitionId
    ? transitions.find(t => t.id === selectedTransitionId) || null
    : null
  const orderedSelectedClips = useMemo(
    () => selectedClipIds
      .map((clipId) => clips.find((clip) => clip.id === clipId))
      .filter(Boolean),
    [clips, selectedClipIds]
  )
  const linkedInspectorPair = useMemo(() => {
    if (orderedSelectedClips.length !== 2) return null

    const [firstClip, secondClip] = orderedSelectedClips
    const linkGroupId = normalizeLinkGroupId(firstClip?.linkGroupId)
    if (!linkGroupId || linkGroupId !== normalizeLinkGroupId(secondClip?.linkGroupId)) {
      return null
    }

    const firstTrack = tracks.find((track) => track.id === firstClip.trackId)
    const secondTrack = tracks.find((track) => track.id === secondClip.trackId)
    if (!firstTrack || !secondTrack) return null

    const audioClip = firstTrack.type === 'audio'
      ? firstClip
      : (secondTrack.type === 'audio' ? secondClip : null)
    const visualClip = firstTrack.type === 'video'
      ? firstClip
      : (secondTrack.type === 'video' ? secondClip : null)

    if (!audioClip || !visualClip) return null

    return {
      linkGroupId,
      audioClip,
      visualClip,
    }
  }, [orderedSelectedClips, tracks])
  const selectionSignature = useMemo(
    () => orderedSelectedClips.map((clip) => clip.id).join('|'),
    [orderedSelectedClips]
  )
  const [inspectorClipId, setInspectorClipId] = useState(null)
  useEffect(() => {
    setInspectorClipId(orderedSelectedClips[0]?.id || null)
  }, [selectionSignature])
  const selectedClip = useMemo(() => {
    if (orderedSelectedClips.length === 0) return null
    if (inspectorClipId) {
      const focusedClip = orderedSelectedClips.find((clip) => clip.id === inspectorClipId)
      if (focusedClip) return focusedClip
    }
    return orderedSelectedClips[0] || null
  }, [orderedSelectedClips, inspectorClipId])
  const transformHistorySessionClipRef = useRef(null)
  const adjustmentHistorySessionClipRef = useRef(null)

  useEffect(() => {
    if (!selectedClip || selectedClip.type !== 'text') return
    const mode = selectedClip?.titleAnimation?.mode
    if (mode === 'in' || mode === 'out' || mode === 'inOut') {
      setTextAnimationMode(mode)
    }
  }, [selectedClip?.id, selectedClip?.type, selectedClip?.titleAnimation?.mode])

  // If a mask picker request comes in for this clip, open inspector + effects
  useEffect(() => {
    if (!maskPickerRequest || !selectedClip) return
    if (maskPickerRequest.clipId !== selectedClip.id) return
    
    if (!isExpanded) {
      onToggleExpanded()
    }
    setExpandedSections(prev =>
      prev.includes('effects') ? prev : [...prev, 'effects']
    )
    if (maskPickerRequest.openPicker) {
      setShowMaskPicker(true)
    } else {
      setShowMaskPicker(false)
    }
    clearMaskPickerRequest()
  }, [maskPickerRequest, selectedClip?.id, isExpanded, onToggleExpanded, clearMaskPickerRequest])

  useEffect(() => {
    if (!textEditRequest) return

    if (!selectedClipIds.includes(textEditRequest.clipId)) {
      clearTextEditRequest()
      return
    }

    if (!selectedClip || selectedClip.id !== textEditRequest.clipId || selectedClip.type !== 'text') {
      return
    }

    if (!isExpanded) {
      onToggleExpanded()
    }
    setExpandedSections((prev) => (
      prev.includes('text') ? prev : [...prev, 'text']
    ))

    let frameId = 0
    let attempts = 0
    let isCancelled = false

    const focusTextContent = () => {
      if (isCancelled) return

      const textarea = textContentInputRef.current
      if (textarea) {
        textarea.focus()
        if (textEditRequest.selectAll !== false) {
          textarea.select()
        } else {
          const length = textarea.value.length
          textarea.setSelectionRange(length, length)
        }
        clearTextEditRequest()
        return
      }

      attempts += 1
      if (attempts < 8) {
        frameId = window.requestAnimationFrame(focusTextContent)
      } else {
        clearTextEditRequest()
      }
    }

    frameId = window.requestAnimationFrame(focusTextContent)
    return () => {
      isCancelled = true
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [
    textEditRequest,
    selectedClipIds,
    selectedClip,
    isExpanded,
    onToggleExpanded,
    clearTextEditRequest,
  ])
  
  // Get track info for the selected clip
  const selectedTrack = selectedClip 
    ? tracks.find(t => t.id === selectedClip.trackId) 
    : null
  const selectedAsset = selectedClip?.assetId ? getAssetById(selectedClip.assetId) : null
  
  // Check if it's a video, text, or audio clip
  const isTextClip = selectedClip?.type === 'text'
  const isAdjustmentClip = selectedClip?.type === 'adjustment'
  const isVideoClip = selectedTrack?.type === 'video' && !isTextClip && !isAdjustmentClip
  const isAudioClip = selectedTrack?.type === 'audio'
  
  // Get transform with defaults for legacy clips
  const getTransform = useCallback(() => {
    if (!selectedClip) return null
    return selectedClip.transform || {
      positionX: 0, positionY: 0,
      scaleX: 100, scaleY: 100, scaleLinked: true,
      rotation: 0, anchorX: 50, anchorY: 50, opacity: 100,
      flipH: false, flipV: false,
      cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0,
      blendMode: 'normal',
      blur: 0,
    }
  }, [selectedClip])

  // Blend mode options (CSS mix-blend-mode values)
  const BLEND_MODES = [
    { value: 'normal', label: 'Normal' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'screen', label: 'Screen' },
    { value: 'overlay', label: 'Overlay' },
    { value: 'darken', label: 'Darken' },
    { value: 'lighten', label: 'Lighten' },
    { value: 'color-dodge', label: 'Color Dodge' },
    { value: 'color-burn', label: 'Color Burn' },
    { value: 'hard-light', label: 'Hard Light' },
    { value: 'soft-light', label: 'Soft Light' },
    { value: 'difference', label: 'Difference' },
    { value: 'exclusion', label: 'Exclusion' },
    { value: 'hue', label: 'Hue' },
    { value: 'saturation', label: 'Saturation' },
    { value: 'color', label: 'Color' },
    { value: 'luminosity', label: 'Luminosity' },
  ]
  
  const transform = getTransform()
  
  // Calculate clip-relative time for keyframes
  const clipTime = selectedClip ? playheadPosition - selectedClip.startTime : 0
  
  // Get animated transform values (with keyframes applied)
  const animatedTransform = useMemo(() => {
    if (!selectedClip) return transform
    return getAnimatedTransform(selectedClip, clipTime) || transform
  }, [selectedClip, clipTime, transform])

  const animatedAdjustments = useMemo(() => {
    if (!selectedClip || selectedClip.type !== 'adjustment') {
      return normalizeAdjustmentSettings(selectedClip?.adjustments || {})
    }
    return normalizeAdjustmentSettings(
      getAnimatedAdjustmentSettings(selectedClip, clipTime) || selectedClip.adjustments || {}
    )
  }, [selectedClip, clipTime])
  
  // Check if a property has keyframes
  const propertyHasKeyframes = useCallback((property) => {
    return selectedClip?.keyframes?.[property]?.length > 0
  }, [selectedClip])

  useEffect(() => {
    transformHistorySessionClipRef.current = null
    adjustmentHistorySessionClipRef.current = null
  }, [selectedClip?.id])

  const hasTransformChanges = useCallback((updates) => {
    if (!transform || !updates || typeof updates !== 'object') return false
    return Object.entries(updates).some(([property, nextValue]) => transform[property] !== nextValue)
  }, [transform])

  const baseAdjustments = useMemo(
    () => normalizeAdjustmentSettings(selectedClip?.adjustments || {}),
    [selectedClip?.adjustments]
  )

  const hasAdjustmentChanges = useCallback((updates) => {
    if (!updates || typeof updates !== 'object') return false
    return Object.entries(updates).some(([property, nextValue]) => baseAdjustments[property] !== nextValue)
  }, [baseAdjustments])

  const applyTransformUpdatesWithHistory = useCallback((updates, keepSessionOpen = false) => {
    if (!selectedClip || !updates || typeof updates !== 'object') return false

    const hasPendingSession = transformHistorySessionClipRef.current === selectedClip.id
    const changed = hasTransformChanges(updates)
    if (!hasPendingSession && !changed) return false

    if (!hasPendingSession) {
      saveToHistory()
    }
    if (changed) {
      updateClipTransform(selectedClip.id, updates, false)
    }

    transformHistorySessionClipRef.current = keepSessionOpen ? selectedClip.id : null
    return true
  }, [selectedClip, hasTransformChanges, saveToHistory, updateClipTransform])

  const applyAdjustmentUpdatesWithHistory = useCallback((updates, keepSessionOpen = false) => {
    if (!selectedClip || !updates || typeof updates !== 'object') return false

    const hasPendingSession = adjustmentHistorySessionClipRef.current === selectedClip.id
    const changed = hasAdjustmentChanges(updates)
    if (!hasPendingSession && !changed) return false

    if (!hasPendingSession) {
      saveToHistory()
    }
    if (changed) {
      updateClipAdjustments(selectedClip.id, updates, false)
    }

    adjustmentHistorySessionClipRef.current = keepSessionOpen ? selectedClip.id : null
    return true
  }, [selectedClip, hasAdjustmentChanges, saveToHistory, updateClipAdjustments])
  
  // Update transform handler (doesn't save to history for realtime sliders)
  // Also adds/updates keyframe if property is keyframed
  const handleTransformChange = useCallback((key, value) => {
    if (!selectedClip) return
    const applied = applyTransformUpdatesWithHistory({ [key]: value }, true)
    if (!applied) return
    
    // If this property has keyframes, also update the keyframe at current time
    if (propertyHasKeyframes(key)) {
      setKeyframe(selectedClip.id, key, clipTime, value, 'easeInOut', { saveHistory: false })
    }
    
    // Handle linked scale: if scaleX or scaleY changes and scale is linked, also update the other
    const isScaleProperty = key === 'scaleX' || key === 'scaleY'
    const isLinked = transform?.scaleLinked && isScaleProperty
    if (isLinked) {
      const otherKey = key === 'scaleX' ? 'scaleY' : 'scaleX'
      if (propertyHasKeyframes(otherKey)) {
        setKeyframe(selectedClip.id, otherKey, clipTime, value, 'easeInOut', { saveHistory: false })
      }
    }
  }, [selectedClip, applyTransformUpdatesWithHistory, propertyHasKeyframes, setKeyframe, clipTime, transform])
  
  // Save to history when user finishes editing (on blur or mouse up)
  const handleTransformCommit = useCallback((key, value) => {
    if (!selectedClip) return
    applyTransformUpdatesWithHistory({ [key]: value }, false)
  }, [selectedClip, applyTransformUpdatesWithHistory])

  // Reset individual slider to default on double-click
  const handleSliderReset = useCallback((property, defaultValue) => {
    if (!selectedClip) return
    const isScale = property === 'scaleX' || property === 'scaleY'
    const isLinked = transform?.scaleLinked && isScale
    const updates = isScale && isLinked
      ? { scaleX: 100, scaleY: 100 }
      : { [property]: defaultValue }
    const applied = applyTransformUpdatesWithHistory(updates, false)
    if (!applied) return
    for (const key of Object.keys(updates)) {
      if (propertyHasKeyframes(key)) {
        setKeyframe(selectedClip.id, key, clipTime, updates[key], 'easeInOut', { saveHistory: false })
      }
    }
  }, [selectedClip, transform?.scaleLinked, applyTransformUpdatesWithHistory, propertyHasKeyframes, setKeyframe, clipTime])
  
  // Reset all transform
  const handleResetTransform = useCallback(() => {
    if (!selectedClip) return
    resetClipTransform(selectedClip.id)
  }, [selectedClip, resetClipTransform])

  // Shared clip adjustment handlers (video/image/text/adjustment)
  const handleClipAdjustmentChange = useCallback((key, value) => {
    if (!selectedClip) return
    const applied = applyAdjustmentUpdatesWithHistory({ [key]: value }, true)
    if (!applied) return
    if (propertyHasKeyframes(key)) {
      setKeyframe(selectedClip.id, key, clipTime, value, 'easeInOut', { saveHistory: false })
    }
  }, [selectedClip, applyAdjustmentUpdatesWithHistory, propertyHasKeyframes, setKeyframe, clipTime])

  const handleClipAdjustmentCommit = useCallback((key, value) => {
    if (!selectedClip) return
    applyAdjustmentUpdatesWithHistory({ [key]: value }, false)
  }, [selectedClip, applyAdjustmentUpdatesWithHistory])

  const handleClipAdjustmentsReset = useCallback(() => {
    if (!selectedClip) return
    applyAdjustmentUpdatesWithHistory(DEFAULT_ADJUSTMENT_SETTINGS, false)
  }, [selectedClip, applyAdjustmentUpdatesWithHistory])
  
  const [audioData, setAudioData] = useState({
    name: '',
    type: 'audio',
    gainDb: DEFAULT_AUDIO_CLIP_GAIN_DB,
    fadeIn: 0,
    fadeOut: 0,
  })

  useEffect(() => {
    if (!selectedClip || !isAudioClip) return
    setAudioData((prev) => ({
      ...prev,
      name: selectedClip.name || '',
      type: selectedClip.type || 'audio',
      gainDb: normalizeAudioClipGainDb(selectedClip.gainDb),
      fadeIn: Number.isFinite(Number(selectedClip.fadeIn)) ? Number(selectedClip.fadeIn) : 0,
      fadeOut: Number.isFinite(Number(selectedClip.fadeOut)) ? Number(selectedClip.fadeOut) : 0,
    }))
  }, [selectedClip?.id, selectedClip?.name, selectedClip?.type, selectedClip?.gainDb, selectedClip?.fadeIn, selectedClip?.fadeOut, isAudioClip])

  const handleAudioGainChange = useCallback((nextValue) => {
    const value = normalizeAudioClipGainDb(nextValue)
    setAudioData((prev) => ({ ...prev, gainDb: value }))
    if (selectedClip?.type === 'audio') {
      updateAudioClipProperties(selectedClip.id, { gainDb: value }, true)
    }
  }, [selectedClip, updateAudioClipProperties])

  const toggleSection = (section) => {
    setExpandedSections(prev => 
      prev.includes(section) 
        ? prev.filter(s => s !== section)
        : [...prev, section]
    )
  }

  useEffect(() => {
    try {
      localStorage.setItem(INSPECTOR_EXPANDED_SECTIONS_KEY, JSON.stringify(expandedSections))
    } catch (_) {}
  }, [expandedSections])

  // Get project handle for saving cache to disk
  const { currentProjectHandle, getCurrentTimelineSettings } = useProjectStore()
  const currentTimelineSettings = getCurrentTimelineSettings?.() || null
  const timecodeFps = Math.max(1, Math.round(Number(currentTimelineSettings?.fps) || FRAME_RATE))

  useEffect(() => {
    if (!selectedAsset || selectedAsset.type !== 'video') return
    if (!isElectron() || typeof window === 'undefined' || typeof window.electronAPI?.getVideoFps !== 'function') return
    if (!selectedAsset.absolutePath) return
    if (selectedAsset.videoCodec && selectedAsset.audioCodec && selectedAsset.fps) return

    let cancelled = false

    window.electronAPI.getVideoFps(selectedAsset.absolutePath)
      .then((result) => {
        if (cancelled || !result?.success) return

        const mergedSettings = { ...(selectedAsset.settings || {}) }
        let didChange = false

        if (Number.isFinite(Number(result.fps)) && !Number.isFinite(Number(selectedAsset.fps))) {
          mergedSettings.fps = result.fps
          didChange = true
        }

        if (result.videoCodec && result.videoCodec !== selectedAsset.videoCodec) {
          didChange = true
        }

        if (result.audioCodec && result.audioCodec !== selectedAsset.audioCodec) {
          didChange = true
        }

        if (!didChange) return

        updateAsset(selectedAsset.id, {
          fps: Number.isFinite(Number(result.fps)) ? result.fps : selectedAsset.fps,
          videoCodec: result.videoCodec || selectedAsset.videoCodec || null,
          audioCodec: result.audioCodec || selectedAsset.audioCodec || null,
          settings: mergedSettings,
        })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [
    selectedAsset,
    selectedAsset?.absolutePath,
    selectedAsset?.audioCodec,
    selectedAsset?.fps,
    selectedAsset?.id,
    selectedAsset?.settings,
    selectedAsset?.type,
    selectedAsset?.videoCodec,
    updateAsset,
  ])

  // Handle render cache for clips with effects
  const handleRenderCache = useCallback(async () => {
    if (!selectedClip || isRendering) return
    
    const enabledEffects = (selectedClip.effects || []).filter(e => e.enabled)
    if (enabledEffects.length === 0) return

    // Get the video URL
    const asset = getAssetById(selectedClip.assetId)
    const videoUrl = asset?.url || selectedClip.url
    if (!videoUrl) {
      setRenderProgress({ status: 'error', error: 'No video URL found' })
      return
    }

    setIsRendering(true)
    setCacheStatus(selectedClip.id, 'rendering', 0)
    setRenderProgress({ status: 'starting', progress: 0 })

    try {
      // Get the blob from render service
      const { blobUrl, blob } = await renderCacheService.renderClipWithEffects(
        selectedClip,
        videoUrl,
        enabledEffects,
        getAssetById,
        {
          fps: 30,
          onProgress: (progress) => {
            setRenderProgress(progress)
            if (progress.progress !== undefined) {
              setCacheStatus(selectedClip.id, 'rendering', progress.progress)
            }
          }
        }
      )

      // Save to disk if we have a project handle
      let cachePath = null
      if (currentProjectHandle && blob) {
        try {
          setRenderProgress({ status: 'saving', progress: 98 })
          cachePath = await saveRenderCache(currentProjectHandle, selectedClip.id, blob, {
            clipId: selectedClip.id,
            duration: selectedClip.duration,
            effects: enabledEffects.map(e => ({ id: e.id, type: e.type })),
          })
          console.log('Saved render cache to:', cachePath)
        } catch (saveErr) {
          console.warn('Failed to save cache to disk:', saveErr)
          // Continue with blob URL even if disk save fails
        }
      }

      // Store the cached URL in the clip (and path if saved)
      setCacheUrl(selectedClip.id, blobUrl, cachePath)
      setRenderProgress({ status: 'complete', progress: 100 })
    } catch (err) {
      console.error('Render cache failed:', err)
      setRenderProgress({ status: 'error', error: err.message })
      setCacheStatus(selectedClip.id, 'none', 0)
    } finally {
      setIsRendering(false)
    }
  }, [selectedClip, isRendering, getAssetById, setCacheStatus, setCacheUrl, currentProjectHandle])

  // Cancel render
  const handleCancelRender = useCallback(() => {
    if (selectedClip && isRendering) {
      renderCacheService.cancelRender(selectedClip.id)
      setIsRendering(false)
      setRenderProgress(null)
      setCacheStatus(selectedClip.id, 'none', 0)
    }
  }, [selectedClip, isRendering, setCacheStatus])

  // Clear cache
  const handleClearCache = useCallback(async () => {
    if (selectedClip) {
      // Clear from memory (render cache service)
      renderCacheService.clearCache(selectedClip.id)
      
      // Clear from disk cache URL map (VideoLayerRenderer)
      clearDiskCacheUrl(selectedClip.id)
      
      // Delete from disk if we have a cache path
      if (selectedClip.cachePath && currentProjectHandle) {
        try {
          await deleteRenderCache(currentProjectHandle, selectedClip.cachePath)
          console.log('Deleted render cache from disk:', selectedClip.cachePath)
        } catch (err) {
          console.warn('Failed to delete cache from disk:', err)
        }
      }
      
      clearClipCache(selectedClip.id)
      setRenderProgress(null)
    }
  }, [selectedClip, clearClipCache, currentProjectHandle])

  const renderSectionHeader = (id, title, icon) => {
    const Icon = icon
    const isSectionExpanded = expandedSections.includes(id)
    return (
      <button
        onClick={() => toggleSection(id)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-sf-dark-800 hover:bg-sf-dark-700 transition-colors"
      >
        {isSectionExpanded ? (
          <ChevronDown className="w-3 h-3 text-sf-text-muted" />
        ) : (
          <ChevronRight className="w-3 h-3 text-sf-text-muted" />
        )}
        <Icon className="w-4 h-4 text-sf-text-muted" />
        <span className="text-xs font-medium text-sf-text-primary uppercase tracking-wider">{title}</span>
      </button>
    )
  }

  // Render Video Clip Inspector (with 2D transforms)
  const renderVideoClipInspector = () => {
    if (!selectedClip || !transform) return null

    return (
      <>
        {renderClipSummaryHeader({
          title: selectedClip.name || (selectedClip.type === 'image' ? 'Image Clip' : 'Video Clip'),
          subtitle: `${selectedTrack?.name || 'Unknown Track'} • ${selectedClip.type === 'image' ? 'Image clip' : 'Video clip'}`,
          icon: selectedClip.type === 'image' ? FileImage : FileVideo,
          iconToneClassName: selectedClip.type === 'image' ? 'text-emerald-200' : 'text-blue-100',
          iconBgClassName: selectedClip.type === 'image' ? 'bg-emerald-500/20' : 'bg-blue-500/20',
          badges: [
            {
              label: 'type',
              value: selectedClip.type === 'image' ? 'IMAGE' : 'VIDEO',
              className: selectedClip.type === 'image'
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-blue-500/15 text-blue-300',
            },
            {
              label: 'timeline-fps',
              value: `${timecodeFps} FPS`,
            },
          ],
          actions: (
            <button 
              onClick={handleResetTransform}
              className="w-full py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[11px] text-sf-text-secondary hover:text-sf-text-primary transition-colors flex items-center justify-center gap-1.5"
              title="Reset all transform properties to default"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Transform
            </button>
          ),
        })}

        {/* Transform Section */}
        {renderSectionHeader('transform', 'Transform', Move)}
        {expandedSections.includes('transform') && (
          <div className="p-3 space-y-3 border-b border-sf-dark-700">
            {/* Position */}
            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1.5 flex items-center gap-1">
                <Move className="w-3 h-3" /> Position
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[9px] text-sf-text-muted">X</label>
                    <KeyframeButton 
                      clipId={selectedClip?.id} 
                      property="positionX" 
                      clip={selectedClip}
                      playheadPosition={playheadPosition}
                    />
                  </div>
                  <div className="flex items-center">
                    <DraggableNumberInput
                      value={animatedTransform?.positionX ?? transform.positionX}
                      onChange={(val) => handleTransformChange('positionX', val)}
                      onCommit={(val) => handleTransformCommit('positionX', val)}
                      step={1}
                      sensitivity={1}
                    />
                    <span className="ml-1 text-[9px] text-sf-text-muted">px</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[9px] text-sf-text-muted">Y</label>
                    <KeyframeButton 
                      clipId={selectedClip?.id} 
                      property="positionY" 
                      clip={selectedClip}
                      playheadPosition={playheadPosition}
                    />
                  </div>
                  <div className="flex items-center">
                    <DraggableNumberInput
                      value={animatedTransform?.positionY ?? transform.positionY}
                      onChange={(val) => handleTransformChange('positionY', val)}
                      onCommit={(val) => handleTransformCommit('positionY', val)}
                      step={1}
                      sensitivity={1}
                    />
                    <span className="ml-1 text-[9px] text-sf-text-muted">px</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Scale with Link toggle */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] text-sf-text-muted flex items-center gap-1">
                  <Maximize2 className="w-3 h-3" /> Scale
                </label>
                <div className="flex items-center gap-1">
                  <KeyframeButton 
                    clipId={selectedClip?.id} 
                    property="scaleX" 
                    clip={selectedClip}
                    playheadPosition={playheadPosition}
                  />
                  <button
                    onClick={() => handleTransformCommit('scaleLinked', !transform.scaleLinked)}
                    className={`p-1 rounded transition-colors ${transform.scaleLinked ? 'bg-sf-accent/30 text-sf-accent' : 'hover:bg-sf-dark-700 text-sf-text-muted'}`}
                    title={transform.scaleLinked ? 'Unlink X/Y Scale' : 'Link X/Y Scale'}
                  >
                    {transform.scaleLinked ? <Link className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
                  </button>
                </div>
              </div>
              
              {transform.scaleLinked ? (
                // Single scale slider when linked
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-[9px] text-sf-text-muted">Uniform</span>
                    <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedTransform?.scaleX ?? transform.scaleX)}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="400"
                    value={animatedTransform?.scaleX ?? transform.scaleX}
                    onChange={(e) => handleTransformChange('scaleX', parseInt(e.target.value))}
                    onMouseUp={(e) => handleTransformCommit('scaleX', parseInt(e.target.value))}
                    onDoubleClick={() => handleSliderReset('scaleX', 100)}
                    title="Double-click to reset to 100%"
                    className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                  />
                </div>
              ) : (
                // Separate X/Y sliders when unlinked
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-[9px] text-sf-text-muted">Width (X)</span>
                      <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedTransform?.scaleX ?? transform.scaleX)}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="400"
                      value={transform.scaleX}
                      onChange={(e) => handleTransformChange('scaleX', parseInt(e.target.value))}
                      onMouseUp={(e) => handleTransformCommit('scaleX', parseInt(e.target.value))}
                      onDoubleClick={() => handleSliderReset('scaleX', 100)}
                      title="Double-click to reset to 100%"
                      className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-[9px] text-sf-text-muted">Height (Y)</span>
                      <span className="text-[10px] text-sf-text-secondary">{transform.scaleY}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="400"
                      value={transform.scaleY}
                      onChange={(e) => handleTransformChange('scaleY', parseInt(e.target.value))}
                      onMouseUp={(e) => handleTransformCommit('scaleY', parseInt(e.target.value))}
                      onDoubleClick={() => handleSliderReset('scaleY', 100)}
                      title="Double-click to reset to 100%"
                      className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Rotation */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-sf-text-muted flex items-center gap-1">
                  <RotateCw className="w-3 h-3" /> Rotation
                </label>
                <div className="flex items-center gap-1">
                  <KeyframeButton 
                    clipId={selectedClip?.id} 
                    property="rotation" 
                    clip={selectedClip}
                    playheadPosition={playheadPosition}
                  />
                  <input
                    type="number"
                    value={Math.round(animatedTransform?.rotation ?? transform.rotation)}
                    onChange={(e) => handleTransformChange('rotation', parseFloat(e.target.value) || 0)}
                    onBlur={(e) => handleTransformCommit('rotation', parseFloat(e.target.value) || 0)}
                    className="w-14 bg-sf-dark-700 border border-sf-dark-600 rounded px-1.5 py-0.5 text-[10px] text-sf-text-primary focus:outline-none focus:border-sf-accent text-right"
                  />
                  <span className="text-[10px] text-sf-text-secondary">°</span>
                </div>
              </div>
              <input
                type="range"
                min="-180"
                max="180"
                value={animatedTransform?.rotation ?? transform.rotation}
                onChange={(e) => handleTransformChange('rotation', parseInt(e.target.value))}
                onMouseUp={(e) => handleTransformCommit('rotation', parseInt(e.target.value))}
                onDoubleClick={() => handleSliderReset('rotation', 0)}
                title="Double-click to reset to 0°"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            {/* Flip Controls */}
            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1.5">Flip</label>
              <div className="flex gap-2">
                <button
                  onClick={() => handleTransformCommit('flipH', !transform.flipH)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs transition-colors ${
                    transform.flipH 
                      ? 'bg-sf-accent text-white' 
                      : 'bg-sf-dark-700 text-sf-text-secondary hover:bg-sf-dark-600'
                  }`}
                >
                  <FlipHorizontal className="w-3.5 h-3.5" />
                  Horizontal
                </button>
                <button
                  onClick={() => handleTransformCommit('flipV', !transform.flipV)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs transition-colors ${
                    transform.flipV 
                      ? 'bg-sf-accent text-white' 
                      : 'bg-sf-dark-700 text-sf-text-secondary hover:bg-sf-dark-600'
                  }`}
                >
                  <FlipVertical className="w-3.5 h-3.5" />
                  Vertical
                </button>
              </div>
            </div>

            {/* Opacity */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-sf-text-muted flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Opacity
                </label>
                <div className="flex items-center gap-1">
                  <KeyframeButton 
                    clipId={selectedClip?.id} 
                    property="opacity" 
                    clip={selectedClip}
                    playheadPosition={playheadPosition}
                  />
                  <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedTransform?.opacity ?? transform.opacity)}%</span>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={animatedTransform?.opacity ?? transform.opacity}
                onChange={(e) => handleTransformChange('opacity', parseInt(e.target.value))}
                onMouseUp={(e) => handleTransformCommit('opacity', parseInt(e.target.value))}
                onDoubleClick={() => handleSliderReset('opacity', 100)}
                title="Double-click to reset to 100%"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            {/* Blur (video / image / text only) */}
            {(selectedClip?.type === 'video' || selectedClip?.type === 'image' || selectedClip?.type === 'text') && (
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] text-sf-text-muted flex items-center gap-1">
                    <CircleDot className="w-3 h-3" /> Blur
                  </label>
                  <div className="flex items-center gap-1">
                    <KeyframeButton 
                      clipId={selectedClip?.id} 
                      property="blur" 
                      clip={selectedClip}
                      playheadPosition={playheadPosition}
                    />
                    <span className="text-[10px] text-sf-text-secondary">{(animatedTransform?.blur ?? transform.blur ?? 0).toFixed(1)}px</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="0.25"
                  value={animatedTransform?.blur ?? transform.blur ?? 0}
                  onChange={(e) => handleTransformChange('blur', parseFloat(e.target.value))}
                  onMouseUp={(e) => handleTransformCommit('blur', parseFloat(e.target.value))}
                  onDoubleClick={() => handleSliderReset('blur', 0)}
                  title="Double-click to reset to 0px"
                  className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                />
              </div>
            )}

            {/* Blend Mode (video / image / text only) */}
            {(selectedClip?.type === 'video' || selectedClip?.type === 'image' || selectedClip?.type === 'text') && (
              <div>
                <label className="text-[10px] text-sf-text-muted block mb-1">
                  Blend Mode
                </label>
                <select
                  value={transform.blendMode ?? 'normal'}
                  onChange={(e) => {
                    handleTransformChange('blendMode', e.target.value)
                    handleTransformCommit('blendMode', e.target.value)
                  }}
                  className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                >
                  {BLEND_MODES.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Anchor Point */}
            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1.5 flex items-center gap-1">
                <Anchor className="w-3 h-3" /> Anchor Point
              </label>
              <div className="grid grid-cols-3 gap-1">
                {[
                  [0, 0], [50, 0], [100, 0],
                  [0, 50], [50, 50], [100, 50],
                  [0, 100], [50, 100], [100, 100],
                ].map(([x, y], i) => (
                  <button
                    key={i}
                    onClick={() => {
                      handleTransformChange('anchorX', x)
                      handleTransformCommit('anchorY', y)
                    }}
                    className={`h-6 rounded text-[9px] transition-colors ${
                      transform.anchorX === x && transform.anchorY === y
                        ? 'bg-sf-accent text-white'
                        : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
                    }`}
                    title={`Anchor ${x}%, ${y}%`}
                  >
                    {x === 50 && y === 50 ? '●' : '○'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="text-[9px] text-sf-text-muted block mb-0.5">X</label>
                  <DraggableNumberInput
                    value={transform.anchorX}
                    onChange={(val) => handleTransformChange('anchorX', val)}
                    onCommit={(val) => handleTransformCommit('anchorX', val)}
                    min={0}
                    max={100}
                    step={1}
                    sensitivity={0.5}
                  />
                </div>
                <div>
                  <label className="text-[9px] text-sf-text-muted block mb-0.5">Y</label>
                  <DraggableNumberInput
                    value={transform.anchorY}
                    onChange={(val) => handleTransformChange('anchorY', val)}
                    onCommit={(val) => handleTransformCommit('anchorY', val)}
                    min={0}
                    max={100}
                    step={1}
                    sensitivity={0.5}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Crop Section */}
        {renderSectionHeader('crop', 'Crop', Crop)}
        {expandedSections.includes('crop') && (
          <div className="p-3 space-y-3 border-b border-sf-dark-700">
            {/* Visual Crop Preview */}
            <div className="relative w-full aspect-video bg-sf-dark-800 rounded overflow-hidden">
              <div 
                className="absolute bg-sf-dark-600 border border-sf-dark-500"
                style={{
                  left: `${transform.cropLeft}%`,
                  right: `${transform.cropRight}%`,
                  top: `${transform.cropTop}%`,
                  bottom: `${transform.cropBottom}%`,
                }}
              >
                <div className="w-full h-full flex items-center justify-center text-[9px] text-sf-text-muted">
                  Preview
                </div>
              </div>
            </div>

            {/* Crop Sliders */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-[9px] text-sf-text-muted">Top</label>
                  <span className="text-[9px] text-sf-text-secondary">{transform.cropTop}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={transform.cropTop}
                  onChange={(e) => handleTransformChange('cropTop', parseInt(e.target.value))}
                  onMouseUp={(e) => handleTransformCommit('cropTop', parseInt(e.target.value))}
                  onDoubleClick={() => { handleTransformChange('cropTop', 0); handleTransformCommit('cropTop', 0) }}
                  title="Double-click to reset to 0"
                  className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                />
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-[9px] text-sf-text-muted">Bottom</label>
                  <span className="text-[9px] text-sf-text-secondary">{transform.cropBottom}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={transform.cropBottom}
                  onChange={(e) => handleTransformChange('cropBottom', parseInt(e.target.value))}
                  onMouseUp={(e) => handleTransformCommit('cropBottom', parseInt(e.target.value))}
                  onDoubleClick={() => { handleTransformChange('cropBottom', 0); handleTransformCommit('cropBottom', 0) }}
                  title="Double-click to reset to 0"
                  className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                />
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-[9px] text-sf-text-muted">Left</label>
                  <span className="text-[9px] text-sf-text-secondary">{transform.cropLeft}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={transform.cropLeft}
                  onChange={(e) => handleTransformChange('cropLeft', parseInt(e.target.value))}
                  onMouseUp={(e) => handleTransformCommit('cropLeft', parseInt(e.target.value))}
                  onDoubleClick={() => { handleTransformChange('cropLeft', 0); handleTransformCommit('cropLeft', 0) }}
                  title="Double-click to reset to 0"
                  className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                />
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-[9px] text-sf-text-muted">Right</label>
                  <span className="text-[9px] text-sf-text-secondary">{transform.cropRight}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={transform.cropRight}
                  onChange={(e) => handleTransformChange('cropRight', parseInt(e.target.value))}
                  onMouseUp={(e) => handleTransformCommit('cropRight', parseInt(e.target.value))}
                  onDoubleClick={() => { handleTransformChange('cropRight', 0); handleTransformCommit('cropRight', 0) }}
                  title="Double-click to reset to 0"
                  className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                />
              </div>
            </div>

            <button 
              onClick={() => {
                handleTransformChange('cropTop', 0)
                handleTransformChange('cropBottom', 0)
                handleTransformChange('cropLeft', 0)
                handleTransformCommit('cropRight', 0)
              }}
              className="w-full text-[10px] text-sf-accent hover:text-sf-accent-hover transition-colors"
            >
              Reset Crop
            </button>
          </div>
        )}

        {renderStandardClipAdjustmentsSection()}

        {/* Timing Section */}
        {renderSectionHeader('timing', 'Timing', Clock)}
        {expandedSections.includes('timing') && (
          <div className="p-3 space-y-3 border-b border-sf-dark-700">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] text-sf-text-muted block mb-1">Start Time</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={selectedClip.startTime?.toFixed(2)}
                    disabled
                    className="w-full bg-sf-dark-800 border border-sf-dark-700 rounded px-2 py-1 text-xs text-sf-text-muted cursor-not-allowed"
                  />
                  <span className="ml-1 text-[9px] text-sf-text-muted">s</span>
                </div>
              </div>
              <div>
                <label className="text-[9px] text-sf-text-muted block mb-1">Duration</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="0.01"
                    min="0.04"
                    value={selectedClip.duration?.toFixed(3)}
                    onChange={(e) => {
                      const parsed = parseFloat(e.target.value)
                      if (Number.isFinite(parsed)) resizeClip(selectedClip.id, parsed)
                    }}
                    className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                  />
                  <span className="ml-1 text-[9px] text-sf-text-muted">s</span>
                </div>
              </div>
            </div>

            {(selectedClip.type === 'video' || selectedClip.type === 'audio') && (
              <div className="space-y-2">
                <div>
                  <label className="text-[9px] text-sf-text-muted block mb-1">Speed</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0.25"
                      max="4"
                      step="0.25"
                      value={Number.isFinite(Number(selectedClip.speed)) ? Number(selectedClip.speed) : 1}
                      onChange={(e) => updateClipSpeed(selectedClip.id, parseFloat(e.target.value) || 1, false)}
                      onMouseUp={(e) => updateClipSpeed(selectedClip.id, parseFloat(e.target.value) || 1, true)}
                      className="flex-1"
                    />
                    <input
                      type="number"
                      min="0.25"
                      max="4"
                      step="0.25"
                      value={(Number.isFinite(Number(selectedClip.speed)) ? Number(selectedClip.speed) : 1).toFixed(2)}
                      onChange={(e) => updateClipSpeed(selectedClip.id, parseFloat(e.target.value) || 1, false)}
                      onBlur={(e) => updateClipSpeed(selectedClip.id, parseFloat(e.target.value) || 1, true)}
                      className="w-16 bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                    />
                    <span className="text-[9px] text-sf-text-muted">x</span>
                  </div>
                </div>

                {selectedClip.type === 'video' && (
                  <label className="flex items-center gap-2 text-[9px] text-sf-text-muted">
                    <input
                      type="checkbox"
                      checked={!!selectedClip.reverse}
                      onChange={(e) => updateClipReverse(selectedClip.id, e.target.checked, true)}
                    />
                    Reverse
                  </label>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] text-sf-text-muted block mb-1">Trim Start</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={selectedClip.trimStart?.toFixed(2)}
                    disabled
                    className="w-full bg-sf-dark-800 border border-sf-dark-700 rounded px-2 py-1 text-xs text-sf-text-muted cursor-not-allowed"
                  />
                  <span className="ml-1 text-[9px] text-sf-text-muted">s</span>
                </div>
              </div>
              <div>
                <label className="text-[9px] text-sf-text-muted block mb-1">Trim End</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="0.1"
                    value={selectedClip.trimEnd?.toFixed(2)}
                    disabled
                    className="w-full bg-sf-dark-800 border border-sf-dark-700 rounded px-2 py-1 text-xs text-sf-text-muted cursor-not-allowed"
                  />
                  <span className="ml-1 text-[9px] text-sf-text-muted">s</span>
                </div>
              </div>
            </div>

            <div className="text-[9px] text-sf-text-muted">
              Source Duration:{' '}
              {selectedClip.type === 'image' || selectedClip.sourceDuration === Infinity || selectedClip.sourceDuration === 'Infinity'
                ? 'Infinity'
                : (Number.isFinite(Number(selectedClip.sourceDuration)) && Number(selectedClip.sourceDuration) > 0
                    ? `${Number(selectedClip.sourceDuration).toFixed(2)}s`
                    : 'Unknown')}
            </div>
          </div>
        )}

        {/* Effects Section */}
        {renderSectionHeader('effects', 'Effects', Zap)}
        {expandedSections.includes('effects') && (
          <div className="p-3 space-y-2 border-b border-sf-dark-700">
            {/* Render existing effects */}
            {(selectedClip.effects || []).map((effect, index) => (
              <div key={effect.id} className="bg-sf-dark-800 rounded overflow-hidden">
                {/* Effect Header */}
                <div className="flex items-center gap-2 px-2 py-1.5 bg-sf-dark-700">
                  <button
                    onClick={() => toggleEffect(selectedClip.id, effect.id)}
                    className={`p-1 rounded transition-colors ${
                      effect.enabled ? 'text-purple-400' : 'text-sf-text-muted'
                    }`}
                    title={effect.enabled ? 'Disable effect' : 'Enable effect'}
                  >
                    {effect.enabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </button>
                  <span className="flex-1 text-xs text-sf-text-primary capitalize">
                    {effect.type === 'mask' ? 'Mask' : effect.type}
                  </span>
                  <button
                    onClick={() => removeEffect(selectedClip.id, effect.id)}
                    className="p-1 hover:bg-sf-dark-600 rounded text-sf-text-muted hover:text-sf-error transition-colors"
                    title="Remove effect"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                
                {/* Mask Effect Controls */}
                {effect.type === 'mask' && effect.enabled && (
                  <div className="p-2 space-y-2">
                    {/* Mask Asset Info */}
                    {(() => {
                      const maskAsset = getAssetById(effect.maskAssetId)
                      return maskAsset ? (
                        <div className="flex items-center gap-2 p-2 bg-sf-dark-900 rounded">
                          <Wand2 className="w-3.5 h-3.5 text-purple-400" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-sf-text-primary truncate">{maskAsset.name}</p>
                            <p className="text-[9px] text-sf-text-muted">
                              {maskAsset.frameCount > 1 ? `${maskAsset.frameCount} frames` : 'Single frame'}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[10px] text-sf-text-muted p-2 bg-sf-dark-900 rounded">
                          Mask asset not found
                        </div>
                      )
                    })()}
                    
                    {/* Invert Toggle */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-sf-text-secondary">Invert Mask</span>
                      <button
                        onClick={() => updateEffect(selectedClip.id, effect.id, { invertMask: !effect.invertMask }, true)}
                        className={`w-8 h-4 rounded-full transition-colors ${
                          effect.invertMask ? 'bg-purple-500' : 'bg-sf-dark-600'
                        }`}
                      >
                        <div className={`w-3 h-3 rounded-full bg-white transition-transform ${
                          effect.invertMask ? 'translate-x-4' : 'translate-x-0.5'
                        }`} />
                      </button>
                    </div>
                    
                    {/* Feather (future implementation) */}
                    {/* <div className="flex items-center justify-between">
                      <span className="text-[10px] text-sf-text-secondary">Feather</span>
                      <input
                        type="range"
                        min="0"
                        max="20"
                        value={effect.feather || 0}
                        onChange={(e) => updateEffect(selectedClip.id, effect.id, { feather: parseInt(e.target.value) })}
                        className="w-20 h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
                      />
                    </div> */}
                  </div>
                )}
              </div>
            ))}
            
            {/* Render Cache Section - Only show if clip has effects */}
            {(selectedClip.effects || []).some(e => e.enabled) && (
              <div className="bg-sf-dark-800 rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-sf-text-secondary uppercase tracking-wider">Render Cache</span>
                  {/* Cache Status Badge */}
                  {selectedClip.cacheStatus === 'cached' && (
                    <span className="flex items-center gap-1 text-[9px] text-green-400">
                      <Check className="w-3 h-3" />
                      Cached
                    </span>
                  )}
                  {selectedClip.cacheStatus === 'invalid' && (
                    <span className="flex items-center gap-1 text-[9px] text-yellow-400">
                      <AlertTriangle className="w-3 h-3" />
                      Outdated
                    </span>
                  )}
                  {(!selectedClip.cacheStatus || selectedClip.cacheStatus === 'none') && (
                    <span className="flex items-center gap-1 text-[9px] text-sf-text-muted">
                      Not cached
                    </span>
                  )}
                </div>
                
                {/* Progress Bar (when rendering) */}
                {isRendering && renderProgress && (
                  <div className="space-y-1">
                    <div className="h-1.5 bg-sf-dark-600 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-purple-500 transition-all duration-200"
                        style={{ width: `${renderProgress.progress || 0}%` }}
                      />
                    </div>
                    <p className="text-[9px] text-sf-text-muted">
                      {renderProgress.status === 'loading' && 'Loading video...'}
                      {renderProgress.status === 'loading_masks' && 'Loading mask frames...'}
                      {renderProgress.status === 'rendering' && `Rendering frame ${renderProgress.frame || 0}/${renderProgress.totalFrames || '?'}...`}
                      {renderProgress.status === 'encoding' && 'Encoding video...'}
                    </p>
                  </div>
                )}
                
                {/* Error message */}
                {renderProgress?.status === 'error' && (
                  <p className="text-[9px] text-red-400">
                    Error: {renderProgress.error}
                  </p>
                )}
                
                {/* Action Buttons */}
                <div className="flex gap-2">
                  {!isRendering ? (
                    <>
                      <button
                        onClick={handleRenderCache}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-[10px] rounded transition-colors"
                      >
                        <Play className="w-3 h-3" />
                        {selectedClip.cacheStatus === 'cached' ? 'Re-render' : 
                         selectedClip.cacheStatus === 'invalid' ? 'Update Cache' : 'Render Cache'}
                      </button>
                      {selectedClip.cacheStatus === 'cached' && (
                        <button
                          onClick={handleClearCache}
                          className="px-2 py-1.5 bg-sf-dark-600 hover:bg-sf-dark-500 text-sf-text-muted hover:text-sf-text-primary text-[10px] rounded transition-colors"
                          title="Clear cache"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={handleCancelRender}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-red-600 hover:bg-red-500 text-white text-[10px] rounded transition-colors"
                    >
                      <X className="w-3 h-3" />
                      Cancel
                    </button>
                  )}
                </div>
                
                {/* Info text */}
                <p className="text-[9px] text-sf-text-muted">
                  {selectedClip.cacheStatus === 'cached' 
                    ? 'Using cached render for smooth playback'
                    : 'Render cache for smooth masked playback'}
                </p>
              </div>
            )}
            
            {/* Add Mask Effect Button */}
            {availableMasks.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowMaskPicker(!showMaskPicker)}
                  className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-purple-500/50 rounded text-xs text-purple-400 hover:border-purple-500 hover:bg-purple-500/10 transition-colors"
                >
                  <Wand2 className="w-3 h-3" />
                  Add Mask Effect
                </button>
                
                {/* Mask Picker Dropdown */}
                {showMaskPicker && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-sf-dark-800 border border-sf-dark-600 rounded-lg shadow-xl z-10 max-h-48 overflow-auto">
                    <div className="p-2 border-b border-sf-dark-600">
                      <span className="text-[10px] text-sf-text-muted uppercase tracking-wider">Select Mask</span>
                    </div>
                    {availableMasks.map(mask => (
                      <button
                        key={mask.id}
                        onClick={() => {
                          addMaskEffect(selectedClip.id, mask.id)
                          setShowMaskPicker(false)
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 transition-colors"
                      >
                        <Layers className="w-3.5 h-3.5 text-purple-400" />
                        <div className="flex-1 min-w-0">
                          <p className="truncate">{mask.name}</p>
                          <p className="text-[9px] text-sf-text-muted">
                            {mask.prompt ? `"${mask.prompt}"` : 'No prompt'}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* No masks available message */}
            {availableMasks.length === 0 && (selectedClip.effects || []).length === 0 && (
              <div className="text-center py-3">
                <Wand2 className="w-6 h-6 text-sf-text-muted mx-auto mb-2 opacity-50" />
                <p className="text-[10px] text-sf-text-muted">No effects applied</p>
                <p className="text-[9px] text-sf-text-muted mt-1">
                  Generate masks from the Assets panel
                </p>
              </div>
            )}
            
            {/* Placeholder for future effects */}
            <div className="pt-2 border-t border-sf-dark-600">
              <p className="text-[9px] text-sf-text-muted text-center">
                More effects coming soon
              </p>
            </div>
          </div>
        )}
      </>
    )
  }

  const renderAdjustmentClipInspector = () => {
    if (!selectedClip || !transform) return null
    const adjustments = animatedAdjustments

    const handleAdjustmentChange = (key, value) => handleClipAdjustmentChange(key, value)
    const handleAdjustmentCommit = (key, value) => handleClipAdjustmentCommit(key, value)

    return (
      <>
        {renderClipSummaryHeader({
          title: selectedClip.name || 'Adjustment Layer',
          subtitle: `${selectedTrack?.name || 'Unknown Track'} • Adjustment clip`,
          icon: SlidersHorizontal,
          iconToneClassName: 'text-violet-100',
          iconBgClassName: 'bg-violet-500/20',
          badges: [
            {
              label: 'type',
              value: 'ADJUSTMENT',
              className: 'bg-violet-500/15 text-violet-300',
            },
            {
              label: 'timeline-fps',
              value: `${timecodeFps} FPS`,
            },
          ],
          actions: (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleResetTransform}
                className="py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[11px] text-sf-text-secondary hover:text-sf-text-primary transition-colors flex items-center justify-center gap-1.5"
                title="Reset transform properties"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Transform
              </button>
              <button
                onClick={handleClipAdjustmentsReset}
                className="py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[11px] text-sf-text-secondary hover:text-sf-text-primary transition-colors flex items-center justify-center gap-1.5"
                title="Reset adjustment controls"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Adjustments
              </button>
            </div>
          ),
        })}

        {renderSectionHeader('transform', 'Transform', Move)}
        {expandedSections.includes('transform') && (
          <div className="p-3 space-y-3 border-b border-sf-dark-700">
            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1.5 flex items-center gap-1">
                <Move className="w-3 h-3" /> Position
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[9px] text-sf-text-muted">X</label>
                    <KeyframeButton
                      clipId={selectedClip?.id}
                      property="positionX"
                      clip={selectedClip}
                      playheadPosition={playheadPosition}
                    />
                  </div>
                  <div className="flex items-center">
                    <DraggableNumberInput
                      value={animatedTransform?.positionX ?? transform.positionX}
                      onChange={(val) => handleTransformChange('positionX', val)}
                      onCommit={(val) => handleTransformCommit('positionX', val)}
                      step={1}
                      sensitivity={1}
                    />
                    <span className="ml-1 text-[9px] text-sf-text-muted">px</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[9px] text-sf-text-muted">Y</label>
                    <KeyframeButton
                      clipId={selectedClip?.id}
                      property="positionY"
                      clip={selectedClip}
                      playheadPosition={playheadPosition}
                    />
                  </div>
                  <div className="flex items-center">
                    <DraggableNumberInput
                      value={animatedTransform?.positionY ?? transform.positionY}
                      onChange={(val) => handleTransformChange('positionY', val)}
                      onCommit={(val) => handleTransformCommit('positionY', val)}
                      step={1}
                      sensitivity={1}
                    />
                    <span className="ml-1 text-[9px] text-sf-text-muted">px</span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-sf-text-muted flex items-center gap-1">
                  <Maximize2 className="w-3 h-3" /> Scale
                </label>
                <div className="flex items-center gap-1">
                  <KeyframeButton
                    clipId={selectedClip?.id}
                    property="scaleX"
                    clip={selectedClip}
                    playheadPosition={playheadPosition}
                  />
                  <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedTransform?.scaleX ?? transform.scaleX)}%</span>
                </div>
              </div>
              <input
                type="range"
                min="10"
                max="400"
                value={animatedTransform?.scaleX ?? transform.scaleX}
                onChange={(e) => handleTransformChange('scaleX', parseInt(e.target.value))}
                onMouseUp={(e) => handleTransformCommit('scaleX', parseInt(e.target.value))}
                onDoubleClick={() => handleSliderReset('scaleX', 100)}
                title="Double-click to reset to 100%"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-sf-text-muted flex items-center gap-1">
                  <RotateCw className="w-3 h-3" /> Rotation
                </label>
                <div className="flex items-center gap-1">
                  <KeyframeButton
                    clipId={selectedClip?.id}
                    property="rotation"
                    clip={selectedClip}
                    playheadPosition={playheadPosition}
                  />
                  <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedTransform?.rotation ?? transform.rotation)}deg</span>
                </div>
              </div>
              <input
                type="range"
                min="-180"
                max="180"
                value={animatedTransform?.rotation ?? transform.rotation}
                onChange={(e) => handleTransformChange('rotation', parseInt(e.target.value))}
                onMouseUp={(e) => handleTransformCommit('rotation', parseInt(e.target.value))}
                onDoubleClick={() => handleSliderReset('rotation', 0)}
                title="Double-click to reset to 0deg"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1.5">Flip</label>
              <div className="flex gap-2">
                <button
                  onClick={() => handleTransformCommit('flipH', !(animatedTransform?.flipH ?? transform.flipH))}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs transition-colors ${
                    (animatedTransform?.flipH ?? transform.flipH)
                      ? 'bg-sf-accent text-white'
                      : 'bg-sf-dark-700 text-sf-text-secondary hover:bg-sf-dark-600'
                  }`}
                >
                  <FlipHorizontal className="w-3.5 h-3.5" />
                  Horizontal
                </button>
                <button
                  onClick={() => handleTransformCommit('flipV', !(animatedTransform?.flipV ?? transform.flipV))}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs transition-colors ${
                    (animatedTransform?.flipV ?? transform.flipV)
                      ? 'bg-sf-accent text-white'
                      : 'bg-sf-dark-700 text-sf-text-secondary hover:bg-sf-dark-600'
                  }`}
                >
                  <FlipVertical className="w-3.5 h-3.5" />
                  Vertical
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1.5 flex items-center gap-1">
                <Anchor className="w-3 h-3" /> Anchor Point
              </label>
              <div className="grid grid-cols-3 gap-1">
                {[
                  [0, 0], [50, 0], [100, 0],
                  [0, 50], [50, 50], [100, 50],
                  [0, 100], [50, 100], [100, 100],
                ].map(([x, y], i) => (
                  <button
                    key={i}
                    onClick={() => {
                      const applied = applyTransformUpdatesWithHistory({ anchorX: x, anchorY: y }, false)
                      if (!applied) return
                      if (propertyHasKeyframes('anchorX')) {
                        setKeyframe(selectedClip.id, 'anchorX', clipTime, x, 'easeInOut', { saveHistory: false })
                      }
                      if (propertyHasKeyframes('anchorY')) {
                        setKeyframe(selectedClip.id, 'anchorY', clipTime, y, 'easeInOut', { saveHistory: false })
                      }
                    }}
                    className={`h-6 rounded text-[9px] transition-colors ${
                      Math.round(animatedTransform?.anchorX ?? transform.anchorX) === x
                        && Math.round(animatedTransform?.anchorY ?? transform.anchorY) === y
                        ? 'bg-sf-accent text-white'
                        : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
                    }`}
                    title={`Anchor ${x}%, ${y}%`}
                  >
                    {x === 50 && y === 50 ? '●' : '○'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[9px] text-sf-text-muted">X</label>
                    <KeyframeButton
                      clipId={selectedClip?.id}
                      property="anchorX"
                      clip={selectedClip}
                      playheadPosition={playheadPosition}
                    />
                  </div>
                  <DraggableNumberInput
                    value={animatedTransform?.anchorX ?? transform.anchorX}
                    onChange={(val) => handleTransformChange('anchorX', val)}
                    onCommit={(val) => handleTransformCommit('anchorX', val)}
                    min={0}
                    max={100}
                    step={1}
                    sensitivity={0.5}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[9px] text-sf-text-muted">Y</label>
                    <KeyframeButton
                      clipId={selectedClip?.id}
                      property="anchorY"
                      clip={selectedClip}
                      playheadPosition={playheadPosition}
                    />
                  </div>
                  <DraggableNumberInput
                    value={animatedTransform?.anchorY ?? transform.anchorY}
                    onChange={(val) => handleTransformChange('anchorY', val)}
                    onCommit={(val) => handleTransformCommit('anchorY', val)}
                    min={0}
                    max={100}
                    step={1}
                    sensitivity={0.5}
                  />
                </div>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-sf-text-muted flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Opacity
                </label>
                <div className="flex items-center gap-1">
                  <KeyframeButton
                    clipId={selectedClip?.id}
                    property="opacity"
                    clip={selectedClip}
                    playheadPosition={playheadPosition}
                  />
                  <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedTransform?.opacity ?? transform.opacity)}%</span>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={animatedTransform?.opacity ?? transform.opacity}
                onChange={(e) => handleTransformChange('opacity', parseInt(e.target.value))}
                onMouseUp={(e) => handleTransformCommit('opacity', parseInt(e.target.value))}
                onDoubleClick={() => handleSliderReset('opacity', 100)}
                title="Double-click to reset to 100%"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1">
                Blend Mode
              </label>
              <select
                value={transform.blendMode ?? 'normal'}
                onChange={(e) => {
                  handleTransformChange('blendMode', e.target.value)
                  handleTransformCommit('blendMode', e.target.value)
                }}
                className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
              >
                {BLEND_MODES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {renderSectionHeader('crop', 'Crop', Crop)}
        {expandedSections.includes('crop') && (
          <div className="p-3 space-y-3 border-b border-sf-dark-700">
            <div className="relative w-full aspect-video bg-sf-dark-800 rounded overflow-hidden">
              <div
                className="absolute bg-sf-dark-600 border border-sf-dark-500"
                style={{
                  left: `${animatedTransform?.cropLeft ?? transform.cropLeft}%`,
                  right: `${animatedTransform?.cropRight ?? transform.cropRight}%`,
                  top: `${animatedTransform?.cropTop ?? transform.cropTop}%`,
                  bottom: `${animatedTransform?.cropBottom ?? transform.cropBottom}%`,
                }}
              >
                <div className="w-full h-full flex items-center justify-center text-[9px] text-sf-text-muted">
                  Preview
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[9px] text-sf-text-muted">Top</label>
                  <div className="flex items-center gap-1">
                    <KeyframeButton
                      clipId={selectedClip?.id}
                      property="cropTop"
                      clip={selectedClip}
                      playheadPosition={playheadPosition}
                    />
                    <span className="text-[9px] text-sf-text-secondary">{Math.round(animatedTransform?.cropTop ?? transform.cropTop)}%</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={animatedTransform?.cropTop ?? transform.cropTop}
                  onChange={(e) => handleTransformChange('cropTop', parseInt(e.target.value))}
                  onMouseUp={(e) => handleTransformCommit('cropTop', parseInt(e.target.value))}
                  onDoubleClick={() => handleSliderReset('cropTop', 0)}
                  title="Double-click to reset to 0"
                  className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[9px] text-sf-text-muted">Bottom</label>
                  <div className="flex items-center gap-1">
                    <KeyframeButton
                      clipId={selectedClip?.id}
                      property="cropBottom"
                      clip={selectedClip}
                      playheadPosition={playheadPosition}
                    />
                    <span className="text-[9px] text-sf-text-secondary">{Math.round(animatedTransform?.cropBottom ?? transform.cropBottom)}%</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={animatedTransform?.cropBottom ?? transform.cropBottom}
                  onChange={(e) => handleTransformChange('cropBottom', parseInt(e.target.value))}
                  onMouseUp={(e) => handleTransformCommit('cropBottom', parseInt(e.target.value))}
                  onDoubleClick={() => handleSliderReset('cropBottom', 0)}
                  title="Double-click to reset to 0"
                  className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[9px] text-sf-text-muted">Left</label>
                  <div className="flex items-center gap-1">
                    <KeyframeButton
                      clipId={selectedClip?.id}
                      property="cropLeft"
                      clip={selectedClip}
                      playheadPosition={playheadPosition}
                    />
                    <span className="text-[9px] text-sf-text-secondary">{Math.round(animatedTransform?.cropLeft ?? transform.cropLeft)}%</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={animatedTransform?.cropLeft ?? transform.cropLeft}
                  onChange={(e) => handleTransformChange('cropLeft', parseInt(e.target.value))}
                  onMouseUp={(e) => handleTransformCommit('cropLeft', parseInt(e.target.value))}
                  onDoubleClick={() => handleSliderReset('cropLeft', 0)}
                  title="Double-click to reset to 0"
                  className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[9px] text-sf-text-muted">Right</label>
                  <div className="flex items-center gap-1">
                    <KeyframeButton
                      clipId={selectedClip?.id}
                      property="cropRight"
                      clip={selectedClip}
                      playheadPosition={playheadPosition}
                    />
                    <span className="text-[9px] text-sf-text-secondary">{Math.round(animatedTransform?.cropRight ?? transform.cropRight)}%</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={animatedTransform?.cropRight ?? transform.cropRight}
                  onChange={(e) => handleTransformChange('cropRight', parseInt(e.target.value))}
                  onMouseUp={(e) => handleTransformCommit('cropRight', parseInt(e.target.value))}
                  onDoubleClick={() => handleSliderReset('cropRight', 0)}
                  title="Double-click to reset to 0"
                  className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                />
              </div>
            </div>

            <button
              onClick={() => {
                const resetCrop = {
                  cropTop: 0,
                  cropBottom: 0,
                  cropLeft: 0,
                  cropRight: 0,
                }
                const applied = applyTransformUpdatesWithHistory(resetCrop, false)
                if (!applied) return
                for (const [property, value] of Object.entries(resetCrop)) {
                  if (propertyHasKeyframes(property)) {
                    setKeyframe(selectedClip.id, property, clipTime, value, 'easeInOut', { saveHistory: false })
                  }
                }
              }}
              className="w-full text-[10px] text-sf-accent hover:text-sf-accent-hover transition-colors"
            >
              Reset Crop
            </button>
          </div>
        )}

        {renderSectionHeader('adjustments', 'Adjustments', Sparkles)}
        {expandedSections.includes('adjustments') && (
          <div className="p-3 space-y-3 border-b border-sf-dark-700">
            <p className="text-[10px] text-sf-text-muted">
              Applies to clips below this layer.
            </p>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-sf-text-muted">Exposure</label>
                <div className="flex items-center gap-1">
                  <KeyframeButton
                    clipId={selectedClip?.id}
                    property="brightness"
                    clip={selectedClip}
                    playheadPosition={playheadPosition}
                  />
                  <span className="text-[10px] text-sf-text-secondary">{Math.round(adjustments.brightness)}</span>
                </div>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={adjustments.brightness}
                onChange={(e) => handleAdjustmentChange('brightness', Number(e.target.value))}
                onMouseUp={(e) => handleAdjustmentCommit('brightness', Number(e.target.value))}
                onDoubleClick={() => handleAdjustmentCommit('brightness', DEFAULT_ADJUSTMENT_SETTINGS.brightness)}
                title="Double-click to reset to 0"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-sf-text-muted">Contrast</label>
                <div className="flex items-center gap-1">
                  <KeyframeButton
                    clipId={selectedClip?.id}
                    property="contrast"
                    clip={selectedClip}
                    playheadPosition={playheadPosition}
                  />
                  <span className="text-[10px] text-sf-text-secondary">{Math.round(adjustments.contrast)}</span>
                </div>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={adjustments.contrast}
                onChange={(e) => handleAdjustmentChange('contrast', Number(e.target.value))}
                onMouseUp={(e) => handleAdjustmentCommit('contrast', Number(e.target.value))}
                onDoubleClick={() => handleAdjustmentCommit('contrast', DEFAULT_ADJUSTMENT_SETTINGS.contrast)}
                title="Double-click to reset to 0"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-sf-text-muted">Saturation</label>
                <div className="flex items-center gap-1">
                  <KeyframeButton
                    clipId={selectedClip?.id}
                    property="saturation"
                    clip={selectedClip}
                    playheadPosition={playheadPosition}
                  />
                  <span className="text-[10px] text-sf-text-secondary">{Math.round(adjustments.saturation)}</span>
                </div>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={adjustments.saturation}
                onChange={(e) => handleAdjustmentChange('saturation', Number(e.target.value))}
                onMouseUp={(e) => handleAdjustmentCommit('saturation', Number(e.target.value))}
                onDoubleClick={() => handleAdjustmentCommit('saturation', DEFAULT_ADJUSTMENT_SETTINGS.saturation)}
                title="Double-click to reset to 0"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-sf-text-muted">Gain</label>
                <div className="flex items-center gap-1">
                  <KeyframeButton
                    clipId={selectedClip?.id}
                    property="gain"
                    clip={selectedClip}
                    playheadPosition={playheadPosition}
                  />
                  <span className="text-[10px] text-sf-text-secondary">{Math.round(adjustments.gain)}</span>
                </div>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={adjustments.gain}
                onChange={(e) => handleAdjustmentChange('gain', Number(e.target.value))}
                onMouseUp={(e) => handleAdjustmentCommit('gain', Number(e.target.value))}
                onDoubleClick={() => handleAdjustmentCommit('gain', DEFAULT_ADJUSTMENT_SETTINGS.gain)}
                title="Double-click to reset to 0"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-sf-text-muted">Gamma</label>
                <div className="flex items-center gap-1">
                  <KeyframeButton
                    clipId={selectedClip?.id}
                    property="gamma"
                    clip={selectedClip}
                    playheadPosition={playheadPosition}
                  />
                  <span className="text-[10px] text-sf-text-secondary">{Math.round(adjustments.gamma)}</span>
                </div>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={adjustments.gamma}
                onChange={(e) => handleAdjustmentChange('gamma', Number(e.target.value))}
                onMouseUp={(e) => handleAdjustmentCommit('gamma', Number(e.target.value))}
                onDoubleClick={() => handleAdjustmentCommit('gamma', DEFAULT_ADJUSTMENT_SETTINGS.gamma)}
                title="Double-click to reset to 0"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-sf-text-muted">Offset</label>
                <div className="flex items-center gap-1">
                  <KeyframeButton
                    clipId={selectedClip?.id}
                    property="offset"
                    clip={selectedClip}
                    playheadPosition={playheadPosition}
                  />
                  <span className="text-[10px] text-sf-text-secondary">{Math.round(adjustments.offset)}</span>
                </div>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={adjustments.offset}
                onChange={(e) => handleAdjustmentChange('offset', Number(e.target.value))}
                onMouseUp={(e) => handleAdjustmentCommit('offset', Number(e.target.value))}
                onDoubleClick={() => handleAdjustmentCommit('offset', DEFAULT_ADJUSTMENT_SETTINGS.offset)}
                title="Double-click to reset to 0"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-sf-text-muted">Hue</label>
                <div className="flex items-center gap-1">
                  <KeyframeButton
                    clipId={selectedClip?.id}
                    property="hue"
                    clip={selectedClip}
                    playheadPosition={playheadPosition}
                  />
                  <span className="text-[10px] text-sf-text-secondary">{Math.round(adjustments.hue)}deg</span>
                </div>
              </div>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={adjustments.hue}
                onChange={(e) => handleAdjustmentChange('hue', Number(e.target.value))}
                onMouseUp={(e) => handleAdjustmentCommit('hue', Number(e.target.value))}
                onDoubleClick={() => handleAdjustmentCommit('hue', DEFAULT_ADJUSTMENT_SETTINGS.hue)}
                title="Double-click to reset to 0deg"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-sf-text-muted">Blur</label>
                <div className="flex items-center gap-1">
                  <KeyframeButton
                    clipId={selectedClip?.id}
                    property="blur"
                    clip={selectedClip}
                    playheadPosition={playheadPosition}
                  />
                  <span className="text-[10px] text-sf-text-secondary">{adjustments.blur.toFixed(1)}px</span>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                step="0.25"
                value={adjustments.blur}
                onChange={(e) => handleAdjustmentChange('blur', Number(e.target.value))}
                onMouseUp={(e) => handleAdjustmentCommit('blur', Number(e.target.value))}
                onDoubleClick={() => handleAdjustmentCommit('blur', DEFAULT_ADJUSTMENT_SETTINGS.blur)}
                title="Double-click to reset to 0px"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>
          </div>
        )}

        {renderSectionHeader('timing', 'Timing', Clock)}
        {expandedSections.includes('timing') && (
          <div className="p-3 space-y-3 border-b border-sf-dark-700">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] text-sf-text-muted block mb-1">Start Time</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={selectedClip.startTime?.toFixed(2)}
                    disabled
                    className="w-full bg-sf-dark-800 border border-sf-dark-700 rounded px-2 py-1 text-xs text-sf-text-muted cursor-not-allowed"
                  />
                  <span className="ml-1 text-[9px] text-sf-text-muted">s</span>
                </div>
              </div>
              <div>
                <label className="text-[9px] text-sf-text-muted block mb-1">Duration</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="0.01"
                    min="0.04"
                    value={selectedClip.duration?.toFixed(3)}
                    onChange={(e) => {
                      const parsed = parseFloat(e.target.value)
                      if (Number.isFinite(parsed)) resizeClip(selectedClip.id, parsed)
                    }}
                    className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                  />
                  <span className="ml-1 text-[9px] text-sf-text-muted">s</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  const renderStandardClipAdjustmentsSection = () => (
    <>
      {renderSectionHeader('adjustments', 'Adjustments', Sparkles)}
      {expandedSections.includes('adjustments') && (
        <div className="p-3 space-y-3 border-b border-sf-dark-700">
          <p className="text-[10px] text-sf-text-muted">
            Applies to this clip.
          </p>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] text-sf-text-muted">Exposure</label>
              <div className="flex items-center gap-1">
                <KeyframeButton
                  clipId={selectedClip?.id}
                  property="brightness"
                  clip={selectedClip}
                  playheadPosition={playheadPosition}
                />
                <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedAdjustments.brightness)}</span>
              </div>
            </div>
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={animatedAdjustments.brightness}
              onChange={(e) => handleClipAdjustmentChange('brightness', Number(e.target.value))}
              onMouseUp={(e) => handleClipAdjustmentCommit('brightness', Number(e.target.value))}
              onDoubleClick={() => handleClipAdjustmentCommit('brightness', DEFAULT_ADJUSTMENT_SETTINGS.brightness)}
              title="Double-click to reset to 0"
              className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] text-sf-text-muted">Contrast</label>
              <div className="flex items-center gap-1">
                <KeyframeButton
                  clipId={selectedClip?.id}
                  property="contrast"
                  clip={selectedClip}
                  playheadPosition={playheadPosition}
                />
                <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedAdjustments.contrast)}</span>
              </div>
            </div>
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={animatedAdjustments.contrast}
              onChange={(e) => handleClipAdjustmentChange('contrast', Number(e.target.value))}
              onMouseUp={(e) => handleClipAdjustmentCommit('contrast', Number(e.target.value))}
              onDoubleClick={() => handleClipAdjustmentCommit('contrast', DEFAULT_ADJUSTMENT_SETTINGS.contrast)}
              title="Double-click to reset to 0"
              className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] text-sf-text-muted">Saturation</label>
              <div className="flex items-center gap-1">
                <KeyframeButton
                  clipId={selectedClip?.id}
                  property="saturation"
                  clip={selectedClip}
                  playheadPosition={playheadPosition}
                />
                <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedAdjustments.saturation)}</span>
              </div>
            </div>
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={animatedAdjustments.saturation}
              onChange={(e) => handleClipAdjustmentChange('saturation', Number(e.target.value))}
              onMouseUp={(e) => handleClipAdjustmentCommit('saturation', Number(e.target.value))}
              onDoubleClick={() => handleClipAdjustmentCommit('saturation', DEFAULT_ADJUSTMENT_SETTINGS.saturation)}
              title="Double-click to reset to 0"
              className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] text-sf-text-muted">Gain</label>
              <div className="flex items-center gap-1">
                <KeyframeButton
                  clipId={selectedClip?.id}
                  property="gain"
                  clip={selectedClip}
                  playheadPosition={playheadPosition}
                />
                <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedAdjustments.gain)}</span>
              </div>
            </div>
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={animatedAdjustments.gain}
              onChange={(e) => handleClipAdjustmentChange('gain', Number(e.target.value))}
              onMouseUp={(e) => handleClipAdjustmentCommit('gain', Number(e.target.value))}
              onDoubleClick={() => handleClipAdjustmentCommit('gain', DEFAULT_ADJUSTMENT_SETTINGS.gain)}
              title="Double-click to reset to 0"
              className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] text-sf-text-muted">Gamma</label>
              <div className="flex items-center gap-1">
                <KeyframeButton
                  clipId={selectedClip?.id}
                  property="gamma"
                  clip={selectedClip}
                  playheadPosition={playheadPosition}
                />
                <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedAdjustments.gamma)}</span>
              </div>
            </div>
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={animatedAdjustments.gamma}
              onChange={(e) => handleClipAdjustmentChange('gamma', Number(e.target.value))}
              onMouseUp={(e) => handleClipAdjustmentCommit('gamma', Number(e.target.value))}
              onDoubleClick={() => handleClipAdjustmentCommit('gamma', DEFAULT_ADJUSTMENT_SETTINGS.gamma)}
              title="Double-click to reset to 0"
              className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] text-sf-text-muted">Offset</label>
              <div className="flex items-center gap-1">
                <KeyframeButton
                  clipId={selectedClip?.id}
                  property="offset"
                  clip={selectedClip}
                  playheadPosition={playheadPosition}
                />
                <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedAdjustments.offset)}</span>
              </div>
            </div>
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={animatedAdjustments.offset}
              onChange={(e) => handleClipAdjustmentChange('offset', Number(e.target.value))}
              onMouseUp={(e) => handleClipAdjustmentCommit('offset', Number(e.target.value))}
              onDoubleClick={() => handleClipAdjustmentCommit('offset', DEFAULT_ADJUSTMENT_SETTINGS.offset)}
              title="Double-click to reset to 0"
              className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] text-sf-text-muted">Hue</label>
              <div className="flex items-center gap-1">
                <KeyframeButton
                  clipId={selectedClip?.id}
                  property="hue"
                  clip={selectedClip}
                  playheadPosition={playheadPosition}
                />
                <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedAdjustments.hue)}deg</span>
              </div>
            </div>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={animatedAdjustments.hue}
              onChange={(e) => handleClipAdjustmentChange('hue', Number(e.target.value))}
              onMouseUp={(e) => handleClipAdjustmentCommit('hue', Number(e.target.value))}
              onDoubleClick={() => handleClipAdjustmentCommit('hue', DEFAULT_ADJUSTMENT_SETTINGS.hue)}
              title="Double-click to reset to 0deg"
              className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] text-sf-text-muted">Blur</label>
              <div className="flex items-center gap-1">
                <KeyframeButton
                  clipId={selectedClip?.id}
                  property="blur"
                  clip={selectedClip}
                  playheadPosition={playheadPosition}
                />
                <span className="text-[10px] text-sf-text-secondary">{animatedAdjustments.blur.toFixed(1)}px</span>
              </div>
            </div>
            <input
              type="range"
              min="0"
              max="50"
              step="0.25"
              value={animatedAdjustments.blur}
              onChange={(e) => handleClipAdjustmentChange('blur', Number(e.target.value))}
              onMouseUp={(e) => handleClipAdjustmentCommit('blur', Number(e.target.value))}
              onDoubleClick={() => handleClipAdjustmentCommit('blur', DEFAULT_ADJUSTMENT_SETTINGS.blur)}
              title="Double-click to reset to 0px"
              className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
            />
          </div>
        </div>
      )}
    </>
  )

  // Text property handlers
  const handleTextPropertyChange = useCallback((key, value) => {
    if (!selectedClip) return
    updateTextProperties(selectedClip.id, { [key]: value }, false)
  }, [selectedClip, updateTextProperties])
  
  const handleTextPropertyCommit = useCallback((key, value) => {
    if (!selectedClip) return
    updateTextProperties(selectedClip.id, { [key]: value }, true)
  }, [selectedClip, updateTextProperties])

  const handleApplyTextAnimationPreset = useCallback((presetId) => {
    if (!selectedClip || selectedClip.type !== 'text') return
    applyTextAnimationPreset(selectedClip.id, presetId, textAnimationMode)
  }, [selectedClip, applyTextAnimationPreset, textAnimationMode])

  const handleClearTextAnimationPreset = useCallback(() => {
    if (!selectedClip || selectedClip.type !== 'text') return
    clearTextAnimationPreset(selectedClip.id)
  }, [selectedClip, clearTextAnimationPreset])

  // Get text properties with defaults
  const getTextProps = useCallback(() => {
    if (!selectedClip || selectedClip.type !== 'text') return null
    return selectedClip.textProperties || {
      text: 'Sample Text',
      fontFamily: 'Inter',
      fontSize: 64,
      fontWeight: 'bold',
      fontStyle: 'normal',
      textColor: '#FFFFFF',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      backgroundPadding: 20,
      textAlign: 'center',
      verticalAlign: 'center',
      strokeColor: '#000000',
      strokeWidth: 0,
      letterSpacing: 0,
      lineHeight: 1.2,
      shadow: false,
      shadowColor: 'rgba(0,0,0,0.5)',
      shadowBlur: 4,
      shadowOffsetX: 2,
      shadowOffsetY: 2,
    }
  }, [selectedClip])

  // Render Text Clip Inspector
  const renderTextClipInspector = () => {
    if (!selectedClip || !transform) return null
    const textProps = getTextProps()
    if (!textProps) return null
    const activeAnimationPresetId = selectedClip?.titleAnimation?.presetId || 'none'
    
    return (
      <>
        {renderClipSummaryHeader({
          title: selectedClip.name || 'Text Clip',
          subtitle: `${selectedTrack?.name || 'Unknown Track'} • Text clip`,
          icon: Type,
          iconToneClassName: 'text-amber-100',
          iconBgClassName: 'bg-amber-500/20',
          badges: [
            {
              label: 'type',
              value: 'TEXT',
              className: 'bg-amber-500/15 text-amber-300',
            },
            {
              label: 'timeline-fps',
              value: `${timecodeFps} FPS`,
            },
          ],
          actions: (
            <button 
              onClick={handleResetTransform}
              className="w-full py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[11px] text-sf-text-secondary hover:text-sf-text-primary transition-colors flex items-center justify-center gap-1.5"
              title="Reset all transform properties to default"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Transform
            </button>
          ),
        })}

        {/* Text Content Section */}
        {renderSectionHeader('text', 'Text Content', Type)}
        {expandedSections.includes('text') && (
          <div className="p-3 space-y-3 border-b border-sf-dark-700">
            {/* Text Content */}
            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1">Content</label>
              <textarea
                ref={textContentInputRef}
                value={textProps.text}
                onChange={(e) => handleTextPropertyChange('text', e.target.value)}
                onBlur={(e) => handleTextPropertyCommit('text', e.target.value)}
                className="w-full h-20 bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary resize-none focus:outline-none focus:border-sf-accent"
                placeholder="Enter text..."
              />
            </div>

            {/* Font Family */}
            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1">Font</label>
              <select
                value={textProps.fontFamily}
                onChange={(e) => handleTextPropertyCommit('fontFamily', e.target.value)}
                className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
              >
                {FONT_OPTIONS.map(font => (
                  <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
                ))}
              </select>
            </div>

            {/* Font Size and Weight */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-sf-text-muted block mb-1">Size</label>
                <DraggableNumberInput
                  value={textProps.fontSize}
                  onChange={(val) => handleTextPropertyChange('fontSize', val)}
                  onCommit={(val) => handleTextPropertyCommit('fontSize', val)}
                  min={8}
                  max={300}
                  step={1}
                  sensitivity={0.5}
                  suffix="px"
                />
              </div>
              <div>
                <label className="text-[9px] text-sf-text-muted block mb-1">Weight</label>
                <select
                  value={textProps.fontWeight}
                  onChange={(e) => handleTextPropertyCommit('fontWeight', e.target.value)}
                  className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                >
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                  <option value="100">Thin</option>
                  <option value="300">Light</option>
                  <option value="500">Medium</option>
                  <option value="600">Semi Bold</option>
                  <option value="800">Extra Bold</option>
                </select>
              </div>
            </div>

            {/* Text Alignment */}
            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1.5">Alignment</label>
              <div className="grid grid-cols-2 gap-2">
                {/* Horizontal */}
                <div className="flex gap-1">
                  {[
                    { value: 'left', icon: AlignLeft },
                    { value: 'center', icon: AlignCenter },
                    { value: 'right', icon: AlignRight },
                  ].map(({ value, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => handleTextPropertyCommit('textAlign', value)}
                      className={`flex-1 p-1.5 rounded text-xs transition-colors ${
                        textProps.textAlign === value
                          ? 'bg-sf-accent text-white'
                          : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
                      }`}
                      title={`Align ${value}`}
                    >
                      <Icon className="w-3.5 h-3.5 mx-auto" />
                    </button>
                  ))}
                </div>
                {/* Vertical */}
                <div className="flex gap-1">
                  {[
                    { value: 'top', icon: AlignVerticalJustifyStart },
                    { value: 'center', icon: AlignVerticalJustifyCenter },
                    { value: 'bottom', icon: AlignVerticalJustifyEnd },
                  ].map(({ value, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => handleTextPropertyCommit('verticalAlign', value)}
                      className={`flex-1 p-1.5 rounded text-xs transition-colors ${
                        textProps.verticalAlign === value
                          ? 'bg-sf-accent text-white'
                          : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
                      }`}
                      title={`Vertical ${value}`}
                    >
                      <Icon className="w-3.5 h-3.5 mx-auto" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Colors & Style Section */}
        {renderSectionHeader('style', 'Colors & Style', Sparkles)}
        {expandedSections.includes('style') && (
          <div className="p-3 space-y-3 border-b border-sf-dark-700">
            {/* Text Color */}
            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1">Text Color</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={textProps.textColor}
                  onChange={(e) => handleTextPropertyChange('textColor', e.target.value)}
                  onBlur={(e) => handleTextPropertyCommit('textColor', e.target.value)}
                  className="w-8 h-8 rounded border border-sf-dark-600 cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={textProps.textColor}
                  onChange={(e) => handleTextPropertyChange('textColor', e.target.value)}
                  onBlur={(e) => handleTextPropertyCommit('textColor', e.target.value)}
                  className="flex-1 bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                />
              </div>
            </div>

            {/* Stroke */}
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-[10px] text-sf-text-muted">Stroke</label>
                <span className="text-[10px] text-sf-text-secondary">{textProps.strokeWidth}px</span>
              </div>
              <div className="flex gap-2 mb-2">
                <input
                  type="color"
                  value={textProps.strokeColor}
                  onChange={(e) => handleTextPropertyChange('strokeColor', e.target.value)}
                  onBlur={(e) => handleTextPropertyCommit('strokeColor', e.target.value)}
                  className="w-8 h-8 rounded border border-sf-dark-600 cursor-pointer bg-transparent"
                />
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={textProps.strokeWidth}
                  onChange={(e) => handleTextPropertyChange('strokeWidth', parseInt(e.target.value))}
                  onMouseUp={(e) => handleTextPropertyCommit('strokeWidth', parseInt(e.target.value))}
                  className="flex-1 h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent self-center"
                />
              </div>
            </div>

            {/* Background */}
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-[10px] text-sf-text-muted">Background</label>
                <span className="text-[10px] text-sf-text-secondary">{textProps.backgroundOpacity}%</span>
              </div>
              <div className="flex gap-2 mb-2">
                <input
                  type="color"
                  value={textProps.backgroundColor}
                  onChange={(e) => handleTextPropertyChange('backgroundColor', e.target.value)}
                  onBlur={(e) => handleTextPropertyCommit('backgroundColor', e.target.value)}
                  className="w-8 h-8 rounded border border-sf-dark-600 cursor-pointer bg-transparent"
                />
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={textProps.backgroundOpacity}
                  onChange={(e) => handleTextPropertyChange('backgroundOpacity', parseInt(e.target.value))}
                  onMouseUp={(e) => handleTextPropertyCommit('backgroundOpacity', parseInt(e.target.value))}
                  className="flex-1 h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent self-center"
                />
              </div>
            </div>

            {/* Shadow Toggle */}
            <div className="flex items-center gap-2 p-2 bg-sf-dark-800 rounded">
              <input
                type="checkbox"
                id="textShadowInspector"
                checked={textProps.shadow}
                onChange={(e) => handleTextPropertyCommit('shadow', e.target.checked)}
                className="w-3.5 h-3.5 rounded border-sf-dark-600 bg-sf-dark-700 text-sf-accent focus:ring-sf-accent cursor-pointer"
              />
              <label htmlFor="textShadowInspector" className="text-[11px] text-sf-text-secondary cursor-pointer flex-1">
                Drop shadow
              </label>
            </div>
          </div>
        )}

        {/* Title Animation Section */}
        {renderSectionHeader('animation', 'Animation', Sparkles)}
        {expandedSections.includes('animation') && (
          <div className="p-3 space-y-3 border-b border-sf-dark-700">
            <div>
              <label className="text-[10px] text-sf-text-muted uppercase tracking-wider block mb-1.5">Mode</label>
              <div className="grid grid-cols-3 gap-1">
                {TEXT_ANIMATION_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setTextAnimationMode(option.id)}
                    className={`py-1 rounded text-[10px] transition-colors ${
                      textAnimationMode === option.id
                        ? 'bg-sf-accent text-white'
                        : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-sf-text-muted uppercase tracking-wider block mb-1.5">Presets</label>
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={handleClearTextAnimationPreset}
                  className={`px-2 py-1 rounded text-[10px] transition-colors ${
                    activeAnimationPresetId === 'none'
                      ? 'bg-sf-accent text-white'
                      : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
                  }`}
                >
                  None
                </button>
                {TEXT_ANIMATION_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handleApplyTextAnimationPreset(preset.id)}
                    className={`px-2 py-1 rounded text-[10px] transition-colors ${
                      activeAnimationPresetId === preset.id
                        ? 'bg-sf-accent text-white'
                        : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
                    }`}
                    title={`Apply ${preset.name}`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-[10px] text-sf-text-muted">
              Presets add keyframes for position, scale, rotation, and opacity.
            </p>
          </div>
        )}

        {/* Transform Section (shared with video) */}
        {renderSectionHeader('transform', 'Transform', Move)}
        {expandedSections.includes('transform') && (
          <div className="p-3 space-y-3 border-b border-sf-dark-700">
            {/* Position */}
            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1.5 flex items-center gap-1">
                <Move className="w-3 h-3" /> Position
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] text-sf-text-muted block mb-0.5">X</label>
                  <div className="flex items-center">
                    <DraggableNumberInput
                      value={animatedTransform?.positionX ?? transform.positionX}
                      onChange={(val) => handleTransformChange('positionX', val)}
                      onCommit={(val) => handleTransformCommit('positionX', val)}
                      step={1}
                      sensitivity={1}
                    />
                    <span className="ml-1 text-[9px] text-sf-text-muted">px</span>
                  </div>
                </div>
                <div>
                  <label className="text-[9px] text-sf-text-muted block mb-0.5">Y</label>
                  <div className="flex items-center">
                    <DraggableNumberInput
                      value={animatedTransform?.positionY ?? transform.positionY}
                      onChange={(val) => handleTransformChange('positionY', val)}
                      onCommit={(val) => handleTransformCommit('positionY', val)}
                      step={1}
                      sensitivity={1}
                    />
                    <span className="ml-1 text-[9px] text-sf-text-muted">px</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Scale */}
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-[10px] text-sf-text-muted flex items-center gap-1">
                  <Maximize2 className="w-3 h-3" /> Scale
                </label>
                <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedTransform?.scaleX ?? transform.scaleX)}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="400"
                value={animatedTransform?.scaleX ?? transform.scaleX}
                onChange={(e) => handleTransformChange('scaleX', parseInt(e.target.value))}
                onMouseUp={(e) => handleTransformCommit('scaleX', parseInt(e.target.value))}
                onDoubleClick={() => handleSliderReset('scaleX', 100)}
                title="Double-click to reset to 100%"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            {/* Rotation */}
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-[10px] text-sf-text-muted flex items-center gap-1">
                  <RotateCw className="w-3 h-3" /> Rotation
                </label>
                <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedTransform?.rotation ?? transform.rotation)}°</span>
              </div>
              <input
                type="range"
                min="-180"
                max="180"
                value={animatedTransform?.rotation ?? transform.rotation}
                onChange={(e) => handleTransformChange('rotation', parseInt(e.target.value))}
                onMouseUp={(e) => handleTransformCommit('rotation', parseInt(e.target.value))}
                onDoubleClick={() => handleSliderReset('rotation', 0)}
                title="Double-click to reset to 0°"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            {/* Opacity */}
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-[10px] text-sf-text-muted flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Opacity
                </label>
                <span className="text-[10px] text-sf-text-secondary">{Math.round(animatedTransform?.opacity ?? transform.opacity)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={animatedTransform?.opacity ?? transform.opacity}
                onChange={(e) => handleTransformChange('opacity', parseInt(e.target.value))}
                onMouseUp={(e) => handleTransformCommit('opacity', parseInt(e.target.value))}
                onDoubleClick={() => handleSliderReset('opacity', 100)}
                title="Double-click to reset to 100%"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            {/* Blur */}
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-[10px] text-sf-text-muted flex items-center gap-1">
                  <CircleDot className="w-3 h-3" /> Blur
                </label>
                <span className="text-[10px] text-sf-text-secondary">{(animatedTransform?.blur ?? transform.blur ?? 0).toFixed(1)}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                step="0.25"
                value={animatedTransform?.blur ?? transform.blur ?? 0}
                onChange={(e) => handleTransformChange('blur', parseFloat(e.target.value))}
                onMouseUp={(e) => handleTransformCommit('blur', parseFloat(e.target.value))}
                onDoubleClick={() => handleSliderReset('blur', 0)}
                title="Double-click to reset to 0px"
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            {/* Blend Mode */}
            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1">
                Blend Mode
              </label>
              <select
                value={transform.blendMode ?? 'normal'}
                onChange={(e) => {
                  handleTransformChange('blendMode', e.target.value)
                  handleTransformCommit('blendMode', e.target.value)
                }}
                className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
              >
                {BLEND_MODES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {renderStandardClipAdjustmentsSection()}

        {/* Timing Section */}
        {renderSectionHeader('timing', 'Timing', Clock)}
        {expandedSections.includes('timing') && (
          <div className="p-3 space-y-3 border-b border-sf-dark-700">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] text-sf-text-muted block mb-1">Start Time</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={selectedClip.startTime?.toFixed(2)}
                    disabled
                    className="w-full bg-sf-dark-800 border border-sf-dark-700 rounded px-2 py-1 text-xs text-sf-text-muted cursor-not-allowed"
                  />
                  <span className="ml-1 text-[9px] text-sf-text-muted">s</span>
                </div>
              </div>
              <div>
                <label className="text-[9px] text-sf-text-muted block mb-1">Duration</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="0.01"
                    min="0.04"
                    value={selectedClip.duration?.toFixed(3)}
                    onChange={(e) => {
                      const parsed = parseFloat(e.target.value)
                      if (Number.isFinite(parsed)) resizeClip(selectedClip.id, parsed)
                    }}
                    className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                  />
                  <span className="ml-1 text-[9px] text-sf-text-muted">s</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // Render Audio Inspector
  const renderAudioInspector = () => (
    <>
      {renderClipSummaryHeader({
        title: selectedClip?.name || audioData.name || 'Audio Clip',
        subtitle: `${selectedTrack?.name || 'Unknown Track'} • Audio clip`,
        icon: FileAudio,
        iconToneClassName: 'text-fuchsia-100',
        iconBgClassName: 'bg-fuchsia-500/20',
        badges: [
          {
            label: 'type',
            value: 'AUDIO',
            className: 'bg-fuchsia-500/15 text-fuchsia-300',
          },
          {
            label: 'timeline-fps',
            value: `${timecodeFps} FPS`,
          },
        ],
      })}

      {/* Gain */}
      <div className="p-3 space-y-3 border-b border-sf-dark-700">
        <div className="flex items-end justify-between gap-3">
          <div>
            <label className="text-[10px] text-sf-text-muted">Gain</label>
            <p className="mt-1 text-[10px] text-sf-text-secondary">
              Boost or trim this clip for preview playback and export.
            </p>
          </div>
          <div className="w-24">
            <input
              type="number"
              min={MIN_AUDIO_CLIP_GAIN_DB}
              max={MAX_AUDIO_CLIP_GAIN_DB}
              step="0.5"
              value={audioData.gainDb}
              onChange={(e) => handleAudioGainChange(e.target.value)}
              className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-right text-sf-text-primary focus:outline-none focus:border-sf-accent"
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-sf-text-muted">Clip Gain</span>
            <span className="text-[10px] text-sf-text-secondary">
              {audioData.gainDb > 0 ? '+' : ''}{audioData.gainDb.toFixed(1)} dB
            </span>
          </div>
          <input
            type="range"
            min={MIN_AUDIO_CLIP_GAIN_DB}
            max={MAX_AUDIO_CLIP_GAIN_DB}
            step="0.5"
            value={audioData.gainDb}
            onChange={(e) => handleAudioGainChange(e.target.value)}
            className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
          />
          <div className="mt-1 flex justify-between text-[10px] text-sf-text-muted">
            <span>{MIN_AUDIO_CLIP_GAIN_DB} dB</span>
            <span>0 dB</span>
            <span>+{MAX_AUDIO_CLIP_GAIN_DB} dB</span>
          </div>
        </div>
      </div>

      {/* Fades */}
      <div className="p-3 space-y-3 border-b border-sf-dark-700">
        <h4 className="text-[10px] text-sf-text-muted uppercase tracking-wider">Fades</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-sf-text-muted block mb-1">Fade In</label>
            <div className="flex items-center">
              <input
                type="number"
                step="0.1"
                min="0"
                value={audioData.fadeIn}
                onChange={(e) => {
                  const value = Math.max(0, parseFloat(e.target.value) || 0)
                  setAudioData({ ...audioData, fadeIn: value })
                  if (selectedClip) {
                    updateAudioClipProperties(selectedClip.id, { fadeIn: value }, true)
                  }
                }}
                className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
              />
              <span className="ml-1 text-[10px] text-sf-text-muted">s</span>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-sf-text-muted block mb-1">Fade Out</label>
            <div className="flex items-center">
              <input
                type="number"
                step="0.1"
                min="0"
                value={audioData.fadeOut}
                onChange={(e) => {
                  const value = Math.max(0, parseFloat(e.target.value) || 0)
                  setAudioData({ ...audioData, fadeOut: value })
                  if (selectedClip) {
                    updateAudioClipProperties(selectedClip.id, { fadeOut: value }, true)
                  }
                }}
                className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
              />
              <span className="ml-1 text-[10px] text-sf-text-muted">s</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )

  // Get current preview from assets store (assets, getAssetById, getAllMasks already destructured above)
  const { currentPreview, previewMode } = useAssetsStore()
  const isCurrentPreviewLetterbox = currentPreview?.settings?.overlayKind === 'letterbox'
  const resolvedLetterboxAspect = useMemo(
    () => resolveLetterboxAspect(letterboxAspectPreset, letterboxCustomAspect, DEFAULT_LETTERBOX_ASPECT),
    [letterboxAspectPreset, letterboxCustomAspect]
  )
  const hasValidLetterboxAspect = Number.isFinite(resolvedLetterboxAspect) && resolvedLetterboxAspect > 0
  const letterboxPreviewDimensions = useMemo(() => {
    if (!isCurrentPreviewLetterbox) return { width: 1920, height: 1080 }
    const width = Math.max(1, Math.round(Number(currentPreview?.settings?.width ?? currentPreview?.width ?? 1920) || 1920))
    const height = Math.max(1, Math.round(Number(currentPreview?.settings?.height ?? currentPreview?.height ?? 1080) || 1080))
    return { width, height }
  }, [isCurrentPreviewLetterbox, currentPreview?.settings?.width, currentPreview?.settings?.height, currentPreview?.width, currentPreview?.height])
  const letterboxPreviewBars = useMemo(() => {
    if (!hasValidLetterboxAspect) return null
    const rect = getLetterboxContentRect(
      letterboxPreviewDimensions.width,
      letterboxPreviewDimensions.height,
      resolvedLetterboxAspect
    )
    return {
      topPct: (rect.offsetY / letterboxPreviewDimensions.height) * 100,
      bottomPct: ((letterboxPreviewDimensions.height - (rect.offsetY + rect.height)) / letterboxPreviewDimensions.height) * 100,
      leftPct: (rect.offsetX / letterboxPreviewDimensions.width) * 100,
      rightPct: ((letterboxPreviewDimensions.width - (rect.offsetX + rect.width)) / letterboxPreviewDimensions.width) * 100,
    }
  }, [letterboxPreviewDimensions.width, letterboxPreviewDimensions.height, resolvedLetterboxAspect, hasValidLetterboxAspect])

  useEffect(() => {
    if (!isCurrentPreviewLetterbox) return
    const settings = currentPreview?.settings || {}
    const targetAspect = resolveLetterboxAspect(
      String(settings.aspectPreset || settings.targetAspect || DEFAULT_LETTERBOX_ASPECT),
      settings.customAspect,
      DEFAULT_LETTERBOX_ASPECT
    )
    const explicitPreset = String(settings.aspectPreset || '')
    const knownPreset = LETTERBOX_ASPECT_PRESETS.find((preset) => preset.id === explicitPreset)
    const approxPreset = LETTERBOX_ASPECT_PRESETS.find(
      (preset) => preset.value != null && Math.abs(Number(preset.value) - Number(targetAspect)) < 0.005
    )
    const nextPreset = knownPreset
      ? knownPreset.id
      : (approxPreset?.id || 'custom')

    setLetterboxAspectPreset(nextPreset)
    setLetterboxCustomAspect(String(settings.customAspect || targetAspect.toFixed(2)))
    setLetterboxBarColor(settings.barColor || '#000000')
    setLetterboxUpdateError(null)
  }, [
    isCurrentPreviewLetterbox,
    currentPreview?.id,
    currentPreview?.settings?.targetAspect,
    currentPreview?.settings?.aspectPreset,
    currentPreview?.settings?.customAspect,
    currentPreview?.settings?.barColor,
  ])

  const handleApplyLetterboxOverlay = useCallback(async () => {
    if (!currentPreview || currentPreview.settings?.overlayKind !== 'letterbox') return
    if (!hasValidLetterboxAspect) {
      setLetterboxUpdateError('Enter a valid aspect ratio greater than 0.')
      return
    }

    const width = letterboxPreviewDimensions.width
    const height = letterboxPreviewDimensions.height
    const nextSettings = {
      ...(currentPreview.settings || {}),
      width,
      height,
      overlayKind: 'letterbox',
      targetAspect: resolvedLetterboxAspect,
      aspectPreset: letterboxAspectPreset,
      customAspect: letterboxAspectPreset === 'custom' ? letterboxCustomAspect : null,
      barColor: letterboxBarColor,
    }

    setLetterboxUpdateError(null)
    setIsUpdatingLetterbox(true)
    try {
      const blob = await generateLetterboxOverlayBlob(width, height, resolvedLetterboxAspect, letterboxBarColor)
      if (isElectron() && typeof currentProjectHandle === 'string' && currentProjectHandle) {
        const persisted = await writeGeneratedOverlayToProject(
          currentProjectHandle,
          blob,
          currentPreview.name || `Letterbox ${resolvedLetterboxAspect.toFixed(2)}:1`,
          'image',
          nextSettings
        )
        updateAsset(currentPreview.id, {
          ...persisted,
          settings: nextSettings,
          width,
          height,
          type: 'image',
        })
      } else {
        const url = URL.createObjectURL(blob)
        updateAsset(currentPreview.id, {
          url,
          mimeType: 'image/png',
          size: blob.size,
          isImported: false,
          path: null,
          absolutePath: null,
          settings: nextSettings,
          width,
          height,
          type: 'image',
        })
      }
    } catch (err) {
      setLetterboxUpdateError(err?.message || 'Could not update letterbox overlay.')
    } finally {
      setIsUpdatingLetterbox(false)
    }
  }, [
    currentPreview,
    hasValidLetterboxAspect,
    letterboxPreviewDimensions.width,
    letterboxPreviewDimensions.height,
    resolvedLetterboxAspect,
    letterboxAspectPreset,
    letterboxCustomAspect,
    letterboxBarColor,
    currentProjectHandle,
    updateAsset,
  ])
  
  // Get available mask assets for the effect picker
  const availableMasks = useMemo(() => {
    return assets.filter(a => a.type === 'mask')
  }, [assets])
  
  // Format file size
  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }
  
  // Format duration
  const formatDuration = (seconds) => {
    if (!seconds && seconds !== 0) return 'Unknown'
    const mins = Math.floor(seconds / 60)
    const secs = (seconds % 60).toFixed(2)
    return mins > 0 ? `${mins}m ${parseFloat(secs).toFixed(1)}s` : `${parseFloat(secs).toFixed(2)}s`
  }

  function renderClipSummaryHeader({
    title,
    subtitle,
    icon: Icon,
    iconToneClassName = 'text-sf-text-primary',
    iconBgClassName = 'bg-sf-dark-700',
    badges = [],
    actions = null,
  }) {
    if (!selectedClip) return null

    const clipStart = Number(selectedClip.startTime) || 0
    const clipDuration = Math.max(0, Number(selectedClip.duration) || 0)
    const clipEnd = clipStart + clipDuration

    const sourceDuration = Number(selectedAsset?.settings?.duration ?? selectedAsset?.duration)
    const clipSourceFps = Number(selectedAsset?.settings?.fps ?? selectedAsset?.fps)
    const sourceTimecodeFps = Math.max(1, Math.round(clipSourceFps || timecodeFps || FRAME_RATE))
    const rawTimeScale = Number(selectedClip?.sourceTimeScale)
    const speed = Number(selectedClip?.speed)
    const effectiveTimeScale = (Number.isFinite(rawTimeScale) && rawTimeScale > 0 ? rawTimeScale : 1)
      * (Number.isFinite(speed) && speed > 0 ? speed : 1)
    const sourceIn = Number.isFinite(Number(selectedClip?.trimStart))
      ? Number(selectedClip.trimStart)
      : null
    const sourceOut = Number.isFinite(Number(selectedClip?.trimEnd))
      ? Number(selectedClip.trimEnd)
      : (sourceIn !== null
          ? sourceIn + clipDuration * effectiveTimeScale
          : (Number.isFinite(sourceDuration) ? sourceDuration : null))

    const assetWidth = selectedAsset?.settings?.width ?? selectedAsset?.width
    const assetHeight = selectedAsset?.settings?.height ?? selectedAsset?.height
    const assetFps = selectedAsset?.settings?.fps ?? selectedAsset?.fps
    const videoCodec = selectedAsset?.videoCodec || null
    const audioCodec = selectedAsset?.audioCodec || null
    const formatLabel = formatAssetFormatLabel(selectedAsset)

    const infoItems = [
      { label: 'Start', value: formatInspectorTimecode(clipStart, timecodeFps) },
      { label: 'Duration', value: formatInspectorTimecode(clipDuration, timecodeFps) },
      { label: 'End', value: formatInspectorTimecode(clipEnd, timecodeFps) },
    ]

    if ((selectedClip.type === 'video' || selectedClip.type === 'audio') && sourceIn !== null) {
      infoItems.push({ label: 'Source In', value: formatInspectorTimecode(sourceIn, sourceTimecodeFps) })
    }
    if ((selectedClip.type === 'video' || selectedClip.type === 'audio') && sourceOut !== null) {
      infoItems.push({ label: 'Source Out', value: formatInspectorTimecode(sourceOut, sourceTimecodeFps) })
    }
    if (assetWidth || assetHeight) {
      infoItems.push({ label: 'Resolution', value: formatInspectorResolution(assetWidth, assetHeight) })
    }
    if (Number.isFinite(Number(assetFps)) && Number(assetFps) > 0) {
      infoItems.push({ label: 'FPS', value: `${formatInspectorFrameRate(assetFps)} fps` })
    }
    if (selectedClip.type === 'video' && videoCodec) {
      infoItems.push({ label: 'Codec', value: formatMediaCodecLabel(videoCodec) })
    }
    if (selectedClip.type === 'video' && audioCodec) {
      infoItems.push({ label: 'Audio Codec', value: formatMediaCodecLabel(audioCodec) })
    }
    if (selectedClip.type === 'audio' && audioCodec) {
      infoItems.push({ label: 'Codec', value: formatMediaCodecLabel(audioCodec) })
    }
    if (selectedAsset) {
      infoItems.push({ label: 'Format', value: formatLabel })
    }
    if (selectedAsset?.size) {
      infoItems.push({ label: 'Size', value: formatFileSize(selectedAsset.size) })
    }

    return (
      <>
        {renderSectionHeader('clipInfo', 'Clip Info', Info)}
        {expandedSections.includes('clipInfo') && (
          <div className="p-3 border-b border-sf-dark-700 space-y-3">
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg ${iconBgClassName} flex items-center justify-center flex-shrink-0`}>
                <Icon className={`w-5 h-5 ${iconToneClassName}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sf-text-primary truncate" title={title}>
                  {title}
                </p>
                <p className="text-[10px] text-sf-text-muted truncate">
                  {subtitle}
                </p>
              </div>
              {badges.length > 0 && (
                <div className="flex flex-wrap justify-end gap-1 max-w-[45%]">
                  {badges.map((badge) => (
                    <span
                      key={`${badge.label}-${badge.value}`}
                      className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium ${badge.className || 'bg-sf-dark-700 text-sf-text-secondary'}`}
                    >
                      {badge.value}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {infoItems.map((item) => (
                <div key={`${item.label}-${item.value}`} className="rounded border border-sf-dark-700 bg-sf-dark-900/70 px-2 py-1.5 min-w-0">
                  <div className="text-[9px] uppercase tracking-wider text-sf-text-muted">{item.label}</div>
                  <div className="mt-0.5 truncate text-[11px] font-medium text-sf-text-primary" title={item.value}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            {actions && (
              <div className="space-y-2">
                {actions}
              </div>
            )}
          </div>
        )}
      </>
    )
  }
  
  // Format date
  const formatDate = (isoString) => {
    if (!isoString) return 'Unknown'
    const date = new Date(isoString)
    return date.toLocaleDateString(undefined, { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  // Get file extension
  const getFileExtension = (filename) => {
    return getFileExtensionLabel(filename)
  }
  
  // Render Asset Info Panel
  const renderAssetInfo = () => {
    if (!currentPreview) return null
    
    const asset = currentPreview
    const isVideo = asset.type === 'video'
    const isImage = asset.type === 'image'
    const isAudio = asset.type === 'audio'
    
    // Get icon based on type
    const TypeIcon = isVideo ? FileVideo : isImage ? FileImage : FileAudio
    const typeColor = isVideo ? 'text-blue-400' : isImage ? 'text-green-400' : 'text-purple-400'
    const typeBgColor = isVideo ? 'bg-blue-500' : isImage ? 'bg-green-500' : 'bg-purple-500'
    
    return (
      <>
        {/* Asset Info Header */}
        <div className="p-3 border-b border-sf-dark-700">
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-10 h-10 ${typeBgColor} rounded flex items-center justify-center flex-shrink-0`}>
              <TypeIcon className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sf-text-primary truncate" title={asset.name}>
                {asset.name}
              </p>
              <p className="text-[10px] text-sf-text-muted">
                {asset.isImported ? 'Imported' : 'AI Generated'} • {asset.type?.charAt(0).toUpperCase() + asset.type?.slice(1)}
              </p>
            </div>
          </div>
          
          {/* Badge */}
          <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
            asset.isImported ? 'bg-sf-dark-700 text-sf-text-secondary' : 'bg-sf-accent/20 text-sf-accent'
          }`}>
            {asset.isImported ? 'IMPORTED' : 'AI GENERATED'}
          </div>
        </div>

        {/* File Details Section */}
        <div className="p-3 border-b border-sf-dark-700">
          <h4 className="text-[10px] text-sf-text-muted uppercase tracking-wider mb-3 flex items-center gap-1">
            <Info className="w-3 h-3" />
            File Details
          </h4>
          
          <div className="space-y-2.5">
            {/* File Type */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-sf-text-muted">Type</span>
              <span className={`text-[11px] font-medium ${typeColor}`}>
                {asset.type?.toUpperCase() || 'Unknown'}
              </span>
            </div>
            
            {/* Format/Extension */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-sf-text-muted">Format</span>
              <span className="text-[11px] text-sf-text-primary">
                {asset.mimeType?.split('/')[1]?.toUpperCase() || getFileExtension(asset.name)}
              </span>
            </div>
            
            {/* File Size */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-sf-text-muted flex items-center gap-1">
                <HardDrive className="w-3 h-3" />
                Size
              </span>
              <span className="text-[11px] text-sf-text-primary">
                {formatFileSize(asset.size)}
              </span>
            </div>
            
            {/* Duration (video/audio only) */}
            {(isVideo || isAudio) && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-sf-text-muted flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Duration
                </span>
                <span className="text-[11px] text-sf-text-primary">
                  {formatDuration(asset.settings?.duration || asset.duration)}
                </span>
              </div>
            )}
            
            {/* Resolution (video/image only) */}
            {(isVideo || isImage) && (asset.settings?.width || asset.width) && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-sf-text-muted flex items-center gap-1">
                  <Maximize2 className="w-3 h-3" />
                  Resolution
                </span>
                <span className="text-[11px] text-sf-text-primary">
                  {asset.settings?.width || asset.width}×{asset.settings?.height || asset.height}
                </span>
              </div>
            )}
            
            {/* Frame Rate (video only) */}
            {isVideo && (asset.settings?.fps || asset.fps) && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-sf-text-muted">Frame Rate</span>
                <span className="text-[11px] text-sf-text-primary">
                  {formatInspectorFrameRate(asset.settings?.fps || asset.fps)} fps
                </span>
              </div>
            )}

            {isVideo && asset.videoCodec && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-sf-text-muted">Video Codec</span>
                <span className="text-[11px] text-sf-text-primary">
                  {formatMediaCodecLabel(asset.videoCodec)}
                </span>
              </div>
            )}

            {(isVideo || isAudio) && asset.audioCodec && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-sf-text-muted">{isAudio ? 'Codec' : 'Audio Codec'}</span>
                <span className="text-[11px] text-sf-text-primary">
                  {formatMediaCodecLabel(asset.audioCodec)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Letterbox Overlay Controls */}
        {asset.settings?.overlayKind === 'letterbox' && (
          <div className="p-3 border-b border-sf-dark-700 space-y-3">
            <h4 className="text-[10px] text-sf-text-muted uppercase tracking-wider mb-1">Letterbox Overlay</h4>
            <p className="text-[11px] text-sf-text-muted">
              Update ratio and bar color, then re-generate this overlay.
            </p>

            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1">Aspect ratio</label>
              <select
                value={letterboxAspectPreset}
                onChange={(e) => setLetterboxAspectPreset(e.target.value)}
                className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
              >
                {LETTERBOX_ASPECT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select>
            </div>

            {letterboxAspectPreset === 'custom' && (
              <div>
                <label className="text-[10px] text-sf-text-muted block mb-1">Custom ratio (W:H)</label>
                <input
                  type="number"
                  min={0.1}
                  max={10}
                  step={0.01}
                  value={letterboxCustomAspect}
                  onChange={(e) => setLetterboxCustomAspect(e.target.value)}
                  className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                />
              </div>
            )}

            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1">Bar color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={letterboxBarColor}
                  onChange={(e) => setLetterboxBarColor(e.target.value)}
                  className="w-10 h-8 rounded border border-sf-dark-600 cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={letterboxBarColor}
                  onChange={(e) => setLetterboxBarColor(e.target.value)}
                  className="flex-1 bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary font-mono focus:outline-none focus:border-sf-accent"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1">Preview</label>
              <div
                className="relative w-full rounded border border-sf-dark-600 overflow-hidden bg-sf-dark-900"
                style={{ aspectRatio: `${letterboxPreviewDimensions.width} / ${letterboxPreviewDimensions.height}` }}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-sf-accent/30 via-sf-dark-700 to-purple-500/25" />
                {letterboxPreviewBars && (
                  <>
                    {letterboxPreviewBars.topPct > 0.001 && (
                      <div className="absolute left-0 right-0 top-0" style={{ height: `${letterboxPreviewBars.topPct}%`, backgroundColor: letterboxBarColor }} />
                    )}
                    {letterboxPreviewBars.bottomPct > 0.001 && (
                      <div className="absolute left-0 right-0 bottom-0" style={{ height: `${letterboxPreviewBars.bottomPct}%`, backgroundColor: letterboxBarColor }} />
                    )}
                    {letterboxPreviewBars.leftPct > 0.001 && (
                      <div className="absolute top-0 bottom-0 left-0" style={{ width: `${letterboxPreviewBars.leftPct}%`, backgroundColor: letterboxBarColor }} />
                    )}
                    {letterboxPreviewBars.rightPct > 0.001 && (
                      <div className="absolute top-0 bottom-0 right-0" style={{ width: `${letterboxPreviewBars.rightPct}%`, backgroundColor: letterboxBarColor }} />
                    )}
                  </>
                )}
                <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white">
                  {hasValidLetterboxAspect ? `${resolvedLetterboxAspect.toFixed(2)}:1` : 'Invalid ratio'}
                </div>
              </div>
            </div>

            {letterboxUpdateError && (
              <p className="text-[11px] text-sf-error">{letterboxUpdateError}</p>
            )}

            <button
              type="button"
              onClick={() => { void handleApplyLetterboxOverlay() }}
              disabled={isUpdatingLetterbox || !hasValidLetterboxAspect}
              className="w-full px-3 py-1.5 text-xs text-white rounded bg-sf-accent hover:bg-sf-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUpdatingLetterbox ? 'Updating overlay…' : 'Update Letterbox Overlay'}
            </button>
          </div>
        )}
        
        {/* Metadata Section */}
        <div className="p-3 border-b border-sf-dark-700">
          <h4 className="text-[10px] text-sf-text-muted uppercase tracking-wider mb-3 flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Metadata
          </h4>
          
          <div className="space-y-2.5">
            {/* Created Date */}
            <div className="flex items-start justify-between">
              <span className="text-[11px] text-sf-text-muted">Created</span>
              <span className="text-[11px] text-sf-text-primary text-right">
                {formatDate(asset.createdAt)}
              </span>
            </div>
            
            {/* Imported Date (if imported) */}
            {asset.imported && (
              <div className="flex items-start justify-between">
                <span className="text-[11px] text-sf-text-muted">Imported</span>
                <span className="text-[11px] text-sf-text-primary text-right">
                  {formatDate(asset.imported)}
                </span>
              </div>
            )}
            
            {/* File Path (if imported) */}
            {asset.path && (
              <div>
                <span className="text-[11px] text-sf-text-muted block mb-1">Path</span>
                <span className="text-[10px] text-sf-text-secondary block break-all bg-sf-dark-800 rounded px-2 py-1">
                  {asset.path}
                </span>
              </div>
            )}
          </div>
        </div>
        
        {/* AI Generation Info (if AI-generated) */}
        {!asset.isImported && asset.prompt && (
          <div className="p-3 border-b border-sf-dark-700">
            <h4 className="text-[10px] text-sf-text-muted uppercase tracking-wider mb-3 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Generation Details
            </h4>
            
            <div className="space-y-2.5">
              {/* Prompt */}
              <div>
                <span className="text-[11px] text-sf-text-muted block mb-1">Prompt</span>
                <p className="text-[11px] text-sf-text-primary bg-sf-dark-800 rounded px-2 py-1.5 leading-relaxed">
                  {asset.prompt}
                </p>
              </div>
              
              {/* Negative Prompt */}
              {asset.negativePrompt && (
                <div>
                  <span className="text-[11px] text-sf-text-muted block mb-1">Negative Prompt</span>
                  <p className="text-[10px] text-sf-text-secondary bg-sf-dark-800 rounded px-2 py-1.5">
                    {asset.negativePrompt}
                  </p>
                </div>
              )}
              
              {/* Seed */}
              {asset.seed !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-sf-text-muted">Seed</span>
                  <span className="text-[11px] text-sf-text-primary font-mono">
                    {asset.seed}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </>
    )
  }
  
  // Resolve-style transition inspector
  const renderTransitionInspector = () => {
    if (!selectedTransition) return null

    const transitionMeta = TRANSITION_TYPES.find(t => t.id === selectedTransition.type)
    const alignment = selectedTransition?.settings?.alignment || 'center'
    const durationFrames = Math.max(1, Math.round((selectedTransition.duration || 0.5) * FRAME_RATE))
    const maxDurationSeconds = selectedTransition.kind === 'between'
      ? getMaxTransitionDurationForAlignment(
          selectedTransition.clipAId,
          selectedTransition.clipBId,
          alignment,
          selectedTransition.id
        )
      : getMaxEdgeTransitionDuration(selectedTransition.clipId)
    const maxFrames = Math.max(1, Math.floor((maxDurationSeconds || selectedTransition.duration || 0.5) * FRAME_RATE))
    const settings = selectedTransition.settings || {}
    const supportsZoom = selectedTransition.type === 'zoom-in' || selectedTransition.type === 'zoom-out'
    const supportsBlur = selectedTransition.type === 'blur'
    const transitionKindLabel = selectedTransition.kind === 'between'
      ? 'Between Clips'
      : `Edge (${selectedTransition.edge === 'in' ? 'In' : 'Out'})`

    const handleTypeChange = (nextType) => {
      updateTransition(selectedTransition.id, {
        type: nextType,
        settings: TRANSITION_DEFAULT_SETTINGS[nextType] || {},
      })
    }

    const handleDurationFramesChange = (nextFrames) => {
      const frames = Math.max(1, Math.min(maxFrames, Number(nextFrames) || 1))
      updateTransition(selectedTransition.id, { duration: frames / FRAME_RATE })
    }

    const handleSettingChange = (key, value) => {
      updateTransition(selectedTransition.id, { settings: { [key]: value } })
    }

    const handleSetDefaultDuration = () => {
      try {
        localStorage.setItem(TRANSITION_DEFAULT_DURATION_KEY, String(durationFrames))
        window.dispatchEvent(new CustomEvent('comfystudio-transition-default-duration-changed', { detail: durationFrames }))
      } catch (_) {}
    }

    return (
      <div className="p-3 space-y-3">
        <div className="bg-sf-dark-800 border border-sf-dark-600 rounded-lg p-3">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-medium text-sf-text-primary">
              Transition - {transitionMeta?.name || selectedTransition.type}
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-sf-dark-700 text-sf-text-muted">
              {transitionKindLabel}
            </span>
          </div>
          <p className="text-[11px] text-sf-text-muted">
            Select the transition segment on the timeline to edit its settings.
          </p>
        </div>

        <div className="bg-sf-dark-800 border border-sf-dark-600 rounded-lg p-3 space-y-3">
          <div>
            <label className="block text-[11px] text-sf-text-muted mb-1">Transition Type</label>
            <select
              value={selectedTransition.type}
              onChange={(e) => handleTypeChange(e.target.value)}
              className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
            >
              {TRANSITION_TYPES.map(type => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-sf-text-muted">Duration</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={maxFrames}
                value={durationFrames}
                onChange={(e) => handleDurationFramesChange(e.target.value)}
                className="w-20 bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
              />
              <span className="text-xs text-sf-text-secondary">frames</span>
              <span className="text-xs text-sf-text-muted">
                {(durationFrames / FRAME_RATE).toFixed(2)}s
              </span>
            </div>
            <div className="text-[10px] text-sf-text-muted">
              Max available: {maxFrames}f
            </div>
            <button
              onClick={handleSetDefaultDuration}
              className="mt-1 w-full px-2 py-1 rounded border border-sf-dark-600 bg-sf-dark-700 hover:bg-sf-dark-600 text-[10px] text-sf-text-secondary transition-colors"
            >
              Set as Default Duration
            </button>
          </div>

          {selectedTransition.kind === 'between' && (
            <div>
              <label className="block text-[11px] text-sf-text-muted mb-1">Alignment</label>
              <div className="grid grid-cols-3 gap-1">
                <button
                  onClick={() => setTransitionAlignment(selectedTransition.id, 'start')}
                  className={`px-2 py-1 rounded text-[10px] transition-colors ${
                    alignment === 'start'
                      ? 'bg-sf-accent/20 text-sf-accent border border-sf-accent/30'
                      : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
                  }`}
                >
                  Start
                </button>
                <button
                  onClick={() => setTransitionAlignment(selectedTransition.id, 'center')}
                  className={`px-2 py-1 rounded text-[10px] transition-colors ${
                    alignment === 'center'
                      ? 'bg-sf-accent/20 text-sf-accent border border-sf-accent/30'
                      : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
                  }`}
                >
                  Center
                </button>
                <button
                  onClick={() => setTransitionAlignment(selectedTransition.id, 'end')}
                  className={`px-2 py-1 rounded text-[10px] transition-colors ${
                    alignment === 'end'
                      ? 'bg-sf-accent/20 text-sf-accent border border-sf-accent/30'
                      : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
                  }`}
                >
                  End
                </button>
              </div>
            </div>
          )}

          {supportsZoom && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-sf-text-muted w-24">Zoom Amount</label>
              <input
                type="range"
                min={0.02}
                max={0.3}
                step={0.01}
                value={settings.zoomAmount ?? 0.1}
                onChange={(e) => handleSettingChange('zoomAmount', Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-[10px] text-sf-text-muted w-10 text-right">
                {(settings.zoomAmount ?? 0.1).toFixed(2)}
              </span>
            </div>
          )}

          {supportsBlur && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-sf-text-muted w-24">Blur Amount</label>
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={settings.blurAmount ?? 8}
                onChange={(e) => handleSettingChange('blurAmount', Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-[10px] text-sf-text-muted w-10 text-right">
                {Math.round(settings.blurAmount ?? 8)}px
              </span>
            </div>
          )}
        </div>

        <button
          onClick={() => removeTransition(selectedTransition.id)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-sf-error/20 border border-sf-error/30 hover:bg-sf-error/30 text-sf-error rounded text-xs transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Remove Transition
        </button>
      </div>
    )
  }

  // Empty state
  const renderEmptyState = () => {
    // If an asset is being previewed, show its info instead
    if (currentPreview && previewMode === 'asset') {
      return renderAssetInfo()
    }
    
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-4">
        <Layers className="w-10 h-10 text-sf-dark-600 mb-3" />
        <h3 className="text-sm font-medium text-sf-text-primary mb-1">No Selection</h3>
        <p className="text-xs text-sf-text-muted">
          Select a clip or transition on the timeline to edit its properties
        </p>
      </div>
    )
  }

  // Multi-selection info
  const renderMultiSelectInfo = () => (
    <div className="h-full flex flex-col items-center justify-center text-center p-4">
      <Layers className="w-10 h-10 text-sf-accent mb-3" />
      <h3 className="text-sm font-medium text-sf-text-primary mb-1">
        {selectedClipIds.length} Clips Selected
      </h3>
      <p className="text-xs text-sf-text-muted">
        Select a single clip to edit its transform properties
      </p>
    </div>
  )

  const renderLinkedPairInspectorSelector = () => {
    if (!linkedInspectorPair) return null

    const options = [
      {
        id: linkedInspectorPair.visualClip.id,
        label: 'Video',
        icon: FileVideo,
      },
      {
        id: linkedInspectorPair.audioClip.id,
        label: 'Audio',
        icon: FileAudio,
      },
    ]

    return (
      <div className="px-3 py-2 border-b border-sf-dark-700 bg-sf-dark-900/70">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-sf-text-muted">
              <Link className="w-3 h-3" />
              <span>Linked Pair</span>
            </div>
            <p className="mt-1 text-[10px] text-sf-text-secondary">
              Both clips stay selected. Choose which side of the pair to inspect.
            </p>
          </div>
          <div className="inline-flex rounded-md border border-sf-dark-600 bg-sf-dark-800 p-0.5 shrink-0">
            {options.map(({ id, label, icon: Icon }) => {
              const isActive = selectedClip?.id === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setInspectorClipId(id)}
                  className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                    isActive
                      ? 'bg-sf-accent text-white'
                      : 'text-sf-text-secondary hover:bg-sf-dark-700 hover:text-sf-text-primary'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const renderSelectedClipInspector = () => {
    if (isAdjustmentClip) return renderAdjustmentClipInspector()
    if (isTextClip) return renderTextClipInspector()
    if (isVideoClip) return renderVideoClipInspector()
    if (isAudioClip) return renderAudioInspector()
    return renderEmptyState()
  }

  // Content to render
  const renderContent = () => {
    // Transition selection has priority (Resolve-style)
    if (selectedTransition) return renderTransitionInspector()

    // No selection
    if (selectedClipIds.length === 0) return renderEmptyState()
    
    // Multi-selection (show info only)
    if (selectedClipIds.length > 1 && !linkedInspectorPair) return renderMultiSelectInfo()

    return (
      <>
        {renderLinkedPairInspectorSelector()}
        {renderSelectedClipInspector()}
      </>
    )
  }

  return (
    <div className="h-full flex">
      {/* Content Panel - Collapsible (on the left side of icon bar) */}
      {isExpanded && (
        <div className="flex-1 bg-sf-dark-900 border-l border-sf-dark-700 flex flex-col min-w-0 overflow-hidden">
          {/* Panel Header */}
          <div className="flex-shrink-0 h-9 bg-sf-dark-800 border-b border-sf-dark-700 flex items-center px-3">
            <span className="text-xs font-medium text-sf-text-primary">Inspector</span>
          </div>
          
          {/* Panel Content */}
          <div className="flex-1 overflow-y-auto">
            {renderContent()}
          </div>
        </div>
      )}
      
      {/* Icon Toolbar - Always Visible (on the right edge) */}
      <div className="w-12 flex-shrink-0 bg-sf-dark-950 border-l border-sf-dark-700 flex flex-col">
        {/* Inspector Icon */}
        <div className="flex-1 flex flex-col pt-2">
          <button
            onClick={onToggleExpanded}
            className={`w-full h-11 flex items-center justify-center transition-all relative group ${
              isExpanded
                ? 'text-sf-accent bg-sf-dark-800'
                : 'text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-800/50'
            }`}
            title="Inspector"
          >
            {/* Active indicator bar (on right side for right panel) */}
            {isExpanded && (
              <div className="absolute right-0 top-1 bottom-1 w-0.5 bg-sf-accent rounded-l" />
            )}
            <SlidersHorizontal className="w-5 h-5" />
            
            {/* Tooltip */}
            <div className="absolute right-full mr-2 px-2 py-1 bg-sf-dark-700 text-sf-text-primary text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
              Inspector
            </div>
          </button>
        </div>
        
        {/* Collapse/Expand Button */}
        <div className="border-t border-sf-dark-700">
          <button
            onClick={onToggleExpanded}
            className="w-full h-10 flex items-center justify-center text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-800/50 transition-colors"
            title={isExpanded ? 'Collapse panel' : 'Expand panel'}
          >
            {isExpanded ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default InspectorPanel
