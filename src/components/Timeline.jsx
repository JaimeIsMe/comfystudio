import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { 
  Volume2, VolumeX, Lock, Unlock, Eye, EyeOff, 
  Plus, Video, Type, Image as ImageIcon,
  Sparkles, GripVertical, Magnet, ArrowRightLeft, Square, X, Check, Pencil,
  Diamond, Zap, AlertTriangle, Loader2, ChevronRight, Maximize2, Flag
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

const TRANSITION_DEFAULT_DURATION_KEY = 'comfystudio-transition-default-duration-frames'
const DEFAULT_WAVEFORM_SAMPLES = 4096

// Resolve-style audio track/waveform colors
const AUDIO_TRACK_BG = '#2d4038'
const AUDIO_WAVEFORM_FILL = '#7eb8a8'
const AUDIO_WAVEFORM_CENTER_LINE = 'rgba(255,255,255,0.35)'
const AUDIO_CLIP_ACCENT = '#4a6b5c'
const ADJACENT_CLIP_UI_GAP_SECONDS = 0.5
const ROLL_EDIT_MAX_GAP_SECONDS = 1 / FRAME_RATE
const AUDIO_WAVEFORM_CACHE = new Map()
const AUDIO_WAVEFORM_PENDING = new Map()
let audioWaveformContext = null

const getAudioWaveformContext = () => {
  if (typeof window === 'undefined') return null
  if (audioWaveformContext) return audioWaveformContext
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  audioWaveformContext = new Ctx()
  return audioWaveformContext
}

const buildWaveformPeaks = (audioBuffer, sampleCount = DEFAULT_WAVEFORM_SAMPLES) => {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels || 1)
  const totalSamples = Math.max(1, audioBuffer.length || 1)
  const buckets = Math.max(32, sampleCount)
  const bucketSize = Math.max(1, Math.floor(totalSamples / buckets))
  const peaks = new Float32Array(buckets)

  for (let i = 0; i < buckets; i++) {
    const start = i * bucketSize
    const end = i === buckets - 1 ? totalSamples : Math.min(totalSamples, start + bucketSize)
    const span = Math.max(1, end - start)
    const stride = Math.max(1, Math.floor(span / 64))
    let peak = 0

    for (let channel = 0; channel < channelCount; channel++) {
      const data = audioBuffer.getChannelData(channel)
      for (let s = start; s < end; s += stride) {
        const amp = Math.abs(data[s] || 0)
        if (amp > peak) peak = amp
      }
    }
    peaks[i] = peak
  }

  let maxPeak = 0
  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i] > maxPeak) maxPeak = peaks[i]
  }
  if (maxPeak > 0) {
    for (let i = 0; i < peaks.length; i++) {
      peaks[i] = peaks[i] / maxPeak
    }
  }

  return peaks
}

const isNativeMediaUrl = (url) => /^file:\/\//i.test(url) || /^comfystudio:\/\//i.test(url)
const isAbsoluteMediaPath = (value) => (
  /^[a-zA-Z]:[\\/]/.test(String(value || ''))
  || String(value || '').startsWith('/')
)

const getAudioWaveformData = async (url, sampleCount = DEFAULT_WAVEFORM_SAMPLES) => {
  if (!url) return null
  const key = `${url}|${sampleCount}`
  if (AUDIO_WAVEFORM_CACHE.has(key)) return AUDIO_WAVEFORM_CACHE.get(key)
  if (AUDIO_WAVEFORM_PENDING.has(key)) return AUDIO_WAVEFORM_PENDING.get(key)

  const loadPromise = (async () => {
    const isElectronRuntime = typeof window !== 'undefined' && window.electronAPI?.isElectron === true
    // In Electron, decode in the main process (ffmpeg) to avoid renderer crashes.
    if (
      isElectronRuntime
      && typeof window.electronAPI?.getAudioWaveform === 'function'
      && (isNativeMediaUrl(url) || isAbsoluteMediaPath(url))
    ) {
      const result = await window.electronAPI.getAudioWaveform(url, { sampleCount })
      if (result?.success && Array.isArray(result.peaks)) {
        return {
          peaks: result.peaks,
          duration: Number(result.duration) || 0
        }
      }
      throw new Error(result?.error || 'Failed to extract waveform in main process')
    }

    // Safety: keep Electron renderer decode path to blob/data URLs only.
    const isBlobOrDataUrl = /^blob:/i.test(url) || /^data:/i.test(url)
    if (isElectronRuntime && !isBlobOrDataUrl) {
      return null
    }

    const ctx = getAudioWaveformContext()
    if (!ctx) throw new Error('Web Audio API is not available')
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to load audio: ${response.status}`)
    const arrayBuffer = await response.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    const peaks = buildWaveformPeaks(audioBuffer, sampleCount)
    return { peaks, duration: audioBuffer.duration || 0 }
  })().then((result) => {
    AUDIO_WAVEFORM_PENDING.delete(key)
    if (result) AUDIO_WAVEFORM_CACHE.set(key, result)
    return result
  }).catch((error) => {
    AUDIO_WAVEFORM_PENDING.delete(key)
    throw error
  })

  AUDIO_WAVEFORM_PENDING.set(key, loadPromise)
  return loadPromise
}

// Pixel count for canvas waveform: one sample per pixel up to 2x display width (Resolve-like resolution)
function getWaveformPixelCount(clipWidthPx) {
  return Math.min(2048, Math.max(64, Math.round(clipWidthPx)))
}

function AudioWaveformBars({ clip, clipWidth, clipUrl, waveformInput = null }) {
  const [waveform, setWaveform] = useState(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const containerRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    const mediaInput = waveformInput || clipUrl
    if (!mediaInput) {
      setWaveform(null)
      return () => { cancelled = true }
    }

    getAudioWaveformData(mediaInput)
      .then((data) => {
        if (!cancelled) setWaveform(data)
      })
      .catch(() => {
        if (!cancelled) setWaveform(null)
      })

    return () => {
      cancelled = true
    }
  }, [clipUrl, waveformInput])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setContainerSize({ w: el.offsetWidth, h: el.offsetHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [clipWidth])

  const pixelCount = getWaveformPixelCount(clipWidth)
  const amplitudePixels = useMemo(() => {
    if (!waveform?.peaks?.length) return null

    const peaks = waveform.peaks
    const sourceDurationFromClip = Number(clip.sourceDuration)
    const sourceDuration = Number.isFinite(sourceDurationFromClip) && sourceDurationFromClip > 0
      ? sourceDurationFromClip
      : Math.max(0.001, Number(waveform.duration) || 0.001)
    const trimStart = Math.max(0, Number(clip.trimStart) || 0)
    const rawTrimEnd = clip.trimEnd !== undefined && clip.trimEnd !== null
      ? Number(clip.trimEnd)
      : sourceDuration
    const trimEnd = Math.max(trimStart + 0.0001, Math.min(sourceDuration, Number.isFinite(rawTrimEnd) ? rawTrimEnd : sourceDuration))
    const sourceSpan = Math.max(0.0001, trimEnd - trimStart)
    const isReverse = Boolean(clip.reverse)

    const out = new Array(pixelCount)
    for (let i = 0; i < pixelCount; i++) {
      const progress = pixelCount <= 1 ? 0.5 : i / (pixelCount - 1)
      const sourceTime = isReverse
        ? trimEnd - (progress * sourceSpan)
        : trimStart + (progress * sourceSpan)
      const normalized = Math.max(0, Math.min(0.999999, sourceTime / sourceDuration))
      const exact = normalized * (peaks.length - 1)
      const leftIndex = Math.floor(exact)
      const rightIndex = Math.min(peaks.length - 1, leftIndex + 1)
      const mix = exact - leftIndex
      const left = peaks[leftIndex] || 0
      const right = peaks[rightIndex] || 0
      const sample = left * (1 - mix) + right * mix
      const smoothed = (sample + (peaks[leftIndex - 1] ?? left) + (peaks[rightIndex + 1] ?? right)) / 3
      out[i] = Math.max(0.04, Math.min(1, smoothed))
    }
    return out
  }, [waveform, clip.sourceDuration, clip.trimStart, clip.trimEnd, clip.reverse, pixelCount])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const w = containerSize.w
    const h = containerSize.h
    if (!canvas || w <= 0 || h <= 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)

    ctx.fillStyle = AUDIO_TRACK_BG
    ctx.fillRect(0, 0, w, h)

    const centerY = h / 2
    const halfH = (h / 2) * 0.88
    const n = amplitudePixels ? amplitudePixels.length : 0

    if (n > 0) {
      ctx.fillStyle = AUDIO_WAVEFORM_FILL
      ctx.beginPath()
      ctx.moveTo(0, centerY)
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1 || 1)) * w
        const amp = amplitudePixels[i] ?? 0.1
        const y = centerY - amp * halfH
        ctx.lineTo(x, y)
      }
      ctx.lineTo(w, centerY)
      for (let i = n - 1; i >= 0; i--) {
        const x = (i / (n - 1 || 1)) * w
        const amp = amplitudePixels[i] ?? 0.1
        const y = centerY + amp * halfH
        ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fill()
    }

    ctx.strokeStyle = AUDIO_WAVEFORM_CENTER_LINE
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, centerY)
    ctx.lineTo(w, centerY)
    ctx.stroke()
  }, [containerSize, amplitudePixels])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 top-[3px] overflow-hidden"
      style={{ backgroundColor: AUDIO_TRACK_BG }}
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  )
}

function Timeline({ onOpenAudioGenerate }) {
  const timelineRef = useRef(null)
  const trackHeadersRef = useRef(null)
  const trackContentRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragClip, setDragClip] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [draggedAssetId, setDraggedAssetId] = useState(null)
  const [draggedAssetIds, setDraggedAssetIds] = useState([])
  const [assetDropPreview, setAssetDropPreview] = useState(null) // { assetId, trackId, startTime, duration, assetType, name, willCreateTrack }
  const dragOverRafRef = useRef(null)
  const pendingAssetDragOverRef = useRef(null)
  const cancelPendingAssetDragOver = useCallback(() => {
    if (dragOverRafRef.current !== null) {
      cancelAnimationFrame(dragOverRafRef.current)
      dragOverRafRef.current = null
    }
    pendingAssetDragOverRef.current = null
  }, [])
  
  // Track headers width (resizable) — default wide enough to read labels; persisted
  const TRACK_HEADERS_MIN = 100
  const TRACK_HEADERS_MAX = 400
  const TRACK_HEADERS_STORAGE_KEY = 'comfystudio-timeline-track-headers-width'
  const VIDEO_TRACK_HEIGHT_DEFAULT = 48
  const AUDIO_TRACK_HEIGHT_MONO_DEFAULT = 40
  const AUDIO_TRACK_HEIGHT_STEREO_DEFAULT = 80
  const TRACK_HEIGHT_MIN = 32
  const TRACK_HEIGHT_MAX = 220
  const TRACK_HEIGHTS_STORAGE_KEY = 'comfystudio-timeline-track-heights-v1'
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
  const [trackHeights, setTrackHeights] = useState(() => {
    try {
      const raw = localStorage.getItem(TRACK_HEIGHTS_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (_) {
      return {}
    }
  })

  const getDefaultTrackHeight = (track) => {
    if (!track) return VIDEO_TRACK_HEIGHT_DEFAULT
    if (track.type === 'video') return VIDEO_TRACK_HEIGHT_DEFAULT
    return track.channels === 'mono' ? AUDIO_TRACK_HEIGHT_MONO_DEFAULT : AUDIO_TRACK_HEIGHT_STEREO_DEFAULT
  }

  const getTrackHeight = (track) => {
    const fallback = getDefaultTrackHeight(track)
    const custom = Number(trackHeights?.[track?.id])
    const raw = Number.isFinite(custom) ? custom : fallback
    return Math.max(TRACK_HEIGHT_MIN, Math.min(TRACK_HEIGHT_MAX, raw))
  }

  const getTrackOffset = (tracksList, index) => {
    let y = 0
    for (let i = 0; i < index; i++) y += getTrackHeight(tracksList[i])
    return y
  }
  
  // Trimming state
  const [trimState, setTrimState] = useState(null) // { clipId, edge: 'left' | 'right', startX, startValue }
  const [slipState, setSlipState] = useState(null) // { clipId, startX, startTrimStart, startTrimEnd, timeScale, minSourceDelta, maxSourceDelta }

  const getTimeScale = (clip) => {
    if (!clip) return 1
    const baseScale = clip.sourceTimeScale
      || (clip.timelineFps && clip.sourceFps ? clip.timelineFps / clip.sourceFps : 1)
    const speed = Number(clip.speed)
    const speedScale = Number.isFinite(speed) && speed > 0 ? speed : 1
    return baseScale * speedScale
  }

  const getSourceDuration = (clip) => {
    if (!clip) return Infinity
    const raw = clip.sourceDuration
    if (raw === Infinity || raw === 'Infinity') return Infinity
    if (raw === null || raw === undefined || raw === '') return Infinity
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : Infinity
  }
  
  // Scrubbing state (for dragging playhead)
  const [isScrubbing, setIsScrubbing] = useState(false)
  
  // Clip dragging state (moving clips within timeline)
  const [clipDragState, setClipDragState] = useState(null) // { clipId, startX, originalStartTime, originalTrackId }
  const clipDragHistorySavedRef = useRef(false)
  
  // Marquee selection state
  const [marqueeState, setMarqueeState] = useState(null) // { startX, startY, currentX, currentY, scrollLeft, scrollTop }
  
  // Transition type menu state
  const [transitionMenu, setTransitionMenu] = useState(null) // { x, y, clipA, clipB }
  const [defaultTransitionFrames, setDefaultTransitionFrames] = useState(() => {
    try {
      const raw = localStorage.getItem(TRANSITION_DEFAULT_DURATION_KEY)
      const parsed = Number(raw)
      if (Number.isFinite(parsed) && parsed >= 1) return Math.round(parsed)
    } catch (_) {}
    return TRANSITION_DURATIONS[1]?.frames || 12
  })
  
  // Transition drag/drop state
  const [transitionDropTarget, setTransitionDropTarget] = useState(null) // `${clipAId}-${clipBId}`
  
  // Transition dragging state
  const [transitionDragState, setTransitionDragState] = useState(null) // { transitionId, startX, startDuration }
  
  // Roll edit state (dragging between two adjacent clips)
  const [rollEditState, setRollEditState] = useState(null) // { clipAId, clipBId, startX, originalEditPoint, clipAOriginalDuration, clipBOriginalStart, clipBOriginalDuration, clipAOriginalTrimStart, clipASourceDuration, clipATimeScale, clipBOriginalTrimStart, clipBOriginalTrimEnd, clipBTimeScale }
  
  // Spacebar panning state
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState(null) // { x, y, scrollLeft, scrollTop }
  const [isSpaceHeld, setIsSpaceHeld] = useState(false)
  const spacePanningKeyDownRef = useRef(false)
  
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
  const [trackResizeState, setTrackResizeState] = useState(null) // { trackId, startY, startHeight }
  
  // Timeline store
  const {
    duration,
    zoom,
    playheadPosition,
    tracks,
    clips,
    transitions,
    selectedClipIds,
    selectedTransitionId,
    activeTrackId,
    setActiveTrack,
    snappingEnabled,
    activeSnapTime,
    rippleEditMode,
    inPoint,
    outPoint,
    markers,
    selectedMarkerId,
    addClip,
    addTextClip,
    removeClip,
    removeSelectedClips,
    moveClip,
    moveSelectedClips,
    setSelectedClipsStartTimes,
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
    selectTransition,
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
    requestMaskPicker,
    copySelectedClips,
    pasteClipsAtPlayhead,
    copiedClips,
    addMarker,
    removeMarker,
    selectMarker,
    addAdjustmentClip,
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
  const { assets, currentPreview, setPreviewMode, getAssetUrl, getAssetById, updateAsset, isPlaying: assetIsPlaying, setIsPlaying: setAssetIsPlaying } = useAssetsStore()
  const assetsById = useMemo(() => {
    const map = new Map()
    assets.forEach((asset) => {
      map.set(asset.id, asset)
    })
    return map
  }, [assets])

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

  const handleAddAdjustmentLayer = () => {
    const activeVideoTrack = tracks.find(t => t.id === activeTrackId && t.type === 'video' && !t.locked)
    const fallbackVideoTrack = tracks.find(t => t.type === 'video' && !t.locked)
    const targetTrack = activeVideoTrack || fallbackVideoTrack
    if (!targetTrack) return
    addAdjustmentClip(targetTrack.id, playheadPosition, { duration: 5 })
  }

  // Resolve-like transition pane preview (left/right clip contributions).
  const renderTransitionPreviewPane = (clip, side = 'left') => {
    const url = getClipUrl(clip)
    const objectPosition = side === 'left' ? 'right center' : 'left center'

    if (clip?.type === 'text') {
      return (
        <div className="absolute inset-0 bg-sf-accent/20 flex items-center justify-center">
          <Type className="w-3 h-3 text-white/70" />
        </div>
      )
    }

    if (!url) {
      return <div className="absolute inset-0 bg-sf-dark-700/70" />
    }

    if (clip?.type === 'image') {
      return (
        <img
          src={url}
          alt={clip?.name || 'Transition preview'}
          className="absolute inset-0 w-full h-full object-cover opacity-80 pointer-events-none"
          style={{ objectPosition }}
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
        />
      )
    }

    return (
      <video
        src={url}
        className="absolute inset-0 w-full h-full object-cover opacity-80 pointer-events-none"
        muted
        style={{ objectPosition }}
        onContextMenu={(e) => e.preventDefault()}
      />
    )
  }

  const renderAssetDropPreviewClip = (track) => {
    if (!assetDropPreview || assetDropPreview.trackId !== track.id) return null

    const previewWidth = Math.max(24, assetDropPreview.duration * pixelsPerSecond)
    const previewLeft = assetDropPreview.startTime * pixelsPerSecond
    const isAudioTrack = track.type === 'audio'
    const typeLabel = assetDropPreview.assetType === 'image'
      ? 'IMG'
      : assetDropPreview.assetType === 'audio'
        ? 'AUD'
        : 'VID'
    const tone = isAudioTrack
      ? {
          background: 'rgba(45, 64, 56, 0.55)',
          border: 'rgba(126, 184, 168, 0.9)',
          accent: AUDIO_CLIP_ACCENT,
        }
      : {
          background: 'rgba(61, 112, 128, 0.42)',
          border: 'rgba(232, 93, 4, 0.9)',
          accent: '#e85d04',
        }

    return (
      <div
        className="absolute top-0.5 bottom-0.5 rounded-sm border border-dashed pointer-events-none z-30 overflow-hidden"
        style={{
          left: `${previewLeft}px`,
          width: `${previewWidth}px`,
          minWidth: '24px',
          backgroundColor: tone.background,
          borderColor: tone.border,
        }}
      >
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: tone.accent }} />
        <div className="absolute inset-0 bg-gradient-to-b from-white/15 to-transparent" />
        <div className="absolute top-[5px] left-1 right-1 flex items-center gap-1 min-w-0">
          <span className="text-[8px] uppercase tracking-wide font-semibold text-white/90">{typeLabel}</span>
          <span className="text-[9px] text-white/90 truncate">{assetDropPreview.name}</span>
        </div>
        <div className="absolute bottom-1 right-1 text-[8px] text-white/85 bg-black/45 rounded px-1 py-0.5 font-mono">
          {assetDropPreview.duration.toFixed(1)}s
        </div>
        {assetDropPreview.willCreateTrack && (
          <div className="absolute bottom-1 left-1 text-[8px] text-white/85 bg-black/45 rounded px-1 py-0.5">
            + track on drop
          </div>
        )}
      </div>
    )
  }

  // Pixels per second based on zoom
  const pixelsPerSecond = zoom / 5

  // Zoom with playhead as pivot so the timeline zooms into/out of the playhead position
  const applyZoomWithPlayheadPivot = (newZoomValue) => {
    const clamped = Math.max(20, Math.min(2000, newZoomValue))
    if (clamped === zoom) return
    if (!timelineRef.current) {
      setZoom(clamped)
      return
    }
    const scrollLeft = timelineRef.current.scrollLeft
    const playheadViewportX = playheadPosition * pixelsPerSecond - scrollLeft
    setZoom(clamped)
    const newPixelsPerSecond = clamped / 5
    requestAnimationFrame(() => {
      if (timelineRef.current) {
        const el = timelineRef.current
        const newScrollLeft = playheadPosition * newPixelsPerSecond - playheadViewportX
        el.scrollLeft = Math.max(0, Math.min(newScrollLeft, el.scrollWidth - el.clientWidth))
      }
    })
  }

  // Frame all: fit full timeline or all clips in view
  const handleFrameAll = () => {
    if (!timelineRef.current) return
    const visibleWidth = timelineRef.current.clientWidth
    if (visibleWidth <= 0) return
    let startTime = 0
    let endTime = duration
    if (clips.length > 0) {
      startTime = Math.min(...clips.map(c => c.startTime))
      endTime = Math.max(...clips.map(c => c.startTime + c.duration))
    }
    const timeSpan = Math.max(0.5, endTime - startTime)
    const padding = 0.95
    const newZoom = Math.max(20, Math.min(2000, (5 * visibleWidth * padding) / timeSpan))
    setZoom(newZoom)
    const newPixelsPerSecond = newZoom / 5
    requestAnimationFrame(() => {
      if (timelineRef.current) {
        timelineRef.current.scrollLeft = Math.max(0, startTime * newPixelsPerSecond)
      }
    })
  }

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
    if (e.target.closest('[data-clip]') || e.target.closest('[data-trim-handle]') || e.target.closest('[data-marker-handle]')) {
      return
    }
    
    e.preventDefault()
    
    // Check for spacebar held - start panning
    if (spacePanningKeyDownRef.current) {
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
      const audioSectionHeight = 20
      const totalVideoTracksHeight = videoTracks.reduce((sum, track) => sum + getTrackHeight(track), 0)
      
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
            clipY += getTrackOffset(videoTracks, videoTrackIndex)
            const clipHeight = getTrackHeight(track)
            const clipBottom = clipY + clipHeight
            if (!(clipY >= bottom || clipBottom <= top)) clipsToSelect.push(clip.id)
          } else {
            const audioTrackIndex = audioTracks.findIndex(t => t.id === clip.trackId)
            clipY += totalVideoTracksHeight + audioSectionHeight + getTrackOffset(audioTracks, audioTrackIndex)
            const clipHeight = getTrackHeight(track)
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

      // M key - add timeline marker at playhead
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        addMarker(playheadPosition)
      }
      
      // Delete/Backspace - delete selected clips, otherwise selected transition/marker
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipIds.length > 0) {
          e.preventDefault()
          removeSelectedClips()
        } else if (selectedTransitionId) {
          e.preventDefault()
          removeTransition(selectedTransitionId)
        } else if (selectedMarkerId) {
          e.preventDefault()
          removeMarker(selectedMarkerId)
        }
      }
      
      // Escape - clear selection
      if (e.key === 'Escape') {
        clearSelection()
        selectMarker(null)
      }
      
      // Ctrl/Cmd + A - select all clips
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        const allClipIds = clips.map(c => c.id)
        useTimelineStore.getState().selectClips(allClipIds)
      }

      // Ctrl/Cmd + C - copy selected clips
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedClipIds.length > 0) {
          e.preventDefault()
          copySelectedClips()
        }
      }

      // Ctrl/Cmd + V - paste at playhead on active track
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (activeTrackId && copiedClips.length > 0) {
          e.preventDefault()
          pasteClipsAtPlayhead(activeTrackId, playheadPosition, assets)
        }
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
          resizeClip(clip.id, splitTime)
          if (clip.type === 'text') {
            // Text clips: add second clip with same text properties
            const textOptions = { ...(clip.textProperties || {}), duration: remainder }
            addTextClip(clip.trackId, textOptions, playheadPosition)
          } else if (clip.type === 'adjustment') {
            addAdjustmentClip(clip.trackId, playheadPosition, {
              duration: remainder,
              name: clip.name,
              adjustments: clip.adjustments || {},
              transform: clip.transform || {},
            })
          } else {
            // Video/audio: second clip continues from cut in source (pass duration/trim so resolveOverlaps doesn't push following clips)
            const timeScale = getTimeScale(clip)
            const sourceTimeAtCut = (clip.trimStart || 0) + splitTime * timeScale
            const sourceTrimEnd = sourceTimeAtCut + remainder * timeScale
            const asset = assets.find(a => a.id === clip.assetId)
            if (asset) {
              addClip(clip.trackId, asset, playheadPosition, timelineFps, {
                duration: remainder,
                trimStart: sourceTimeAtCut,
                trimEnd: sourceTrimEnd,
              })
            }
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [toggleSnapping, toggleRippleEdit, addMarker, selectedClipIds, selectedTransitionId, selectedMarkerId, removeSelectedClips, removeTransition, removeMarker, clearSelection, selectMarker, clips, undo, redo, activeTrackId, playheadPosition, saveToHistory, resizeClip, addClip, addTextClip, addAdjustmentClip, updateClipTrim, assets, timelineFps, copySelectedClips, pasteClipsAtPlayhead, copiedClips])

  // Spacebar panning key state (dedicated listeners so keyup cannot get "stuck")
  useEffect(() => {
    const resetSpacePanningState = () => {
      spacePanningKeyDownRef.current = false
      setIsSpaceHeld(false)
      setIsPanning(false)
      setPanStart(null)
    }

    const handleSpaceKeyDown = (e) => {
      if (e.code !== 'Space' || e.repeat) return
      const active = document.activeElement
      if (active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable)) return
      spacePanningKeyDownRef.current = true
      setIsSpaceHeld(true)
    }

    const handleSpaceKeyUp = (e) => {
      if (e.code !== 'Space') return
      resetSpacePanningState()
    }

    const handleWindowBlur = () => {
      resetSpacePanningState()
    }

    const handleVisibilityChange = () => {
      if (document.hidden) resetSpacePanningState()
    }

    window.addEventListener('keydown', handleSpaceKeyDown)
    window.addEventListener('keyup', handleSpaceKeyUp)
    window.addEventListener('blur', handleWindowBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('keydown', handleSpaceKeyDown)
      window.removeEventListener('keyup', handleSpaceKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

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

  useEffect(() => {
    const handleAssetDragStart = (e) => {
      const nextAssetId = e?.detail?.assetId
      const nextAssetIds = Array.isArray(e?.detail?.assetIds)
        ? e.detail.assetIds.filter((id) => typeof id === 'string' && id)
        : []
      if (typeof nextAssetId === 'string' && nextAssetId) {
        setDraggedAssetId(nextAssetId)
      }
      setDraggedAssetIds(nextAssetIds)
    }
    const handleAssetDragEnd = () => {
      cancelPendingAssetDragOver()
      setDraggedAssetId(null)
      setDraggedAssetIds([])
      setDropTarget(null)
      setAssetDropPreview(null)
      clearActiveSnap()
    }
    window.addEventListener('comfystudio-assets-drag-start', handleAssetDragStart)
    window.addEventListener('comfystudio-assets-drag-end', handleAssetDragEnd)
    return () => {
      window.removeEventListener('comfystudio-assets-drag-start', handleAssetDragStart)
      window.removeEventListener('comfystudio-assets-drag-end', handleAssetDragEnd)
    }
  }, [clearActiveSnap, cancelPendingAssetDragOver])

  useEffect(() => {
    const clearDropFeedback = () => {
      cancelPendingAssetDragOver()
      setDraggedAssetId(null)
      setDraggedAssetIds([])
      setDropTarget(null)
      setAssetDropPreview(null)
      clearActiveSnap()
    }
    window.addEventListener('dragend', clearDropFeedback)
    window.addEventListener('drop', clearDropFeedback)
    return () => {
      window.removeEventListener('dragend', clearDropFeedback)
      window.removeEventListener('drop', clearDropFeedback)
    }
  }, [clearActiveSnap, cancelPendingAssetDragOver])

  useEffect(() => {
    return () => {
      cancelPendingAssetDragOver()
    }
  }, [cancelPendingAssetDragOver])

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

  const getDraggedAssetIds = (dataTransfer) => {
    if (Array.isArray(draggedAssetIds) && draggedAssetIds.length > 0) return draggedAssetIds
    if (!dataTransfer) return draggedAssetIds
    const directId = dataTransfer.getData('assetId')
    const customPayload = dataTransfer.getData('application/x-comfystudio-asset-ids')
    const plainText = dataTransfer.getData('text/plain')
    const raw = customPayload || plainText
    if (!raw) {
      return directId ? [directId] : draggedAssetIds
    }
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
        return parsed.filter((id) => typeof id === 'string' && id)
      }
    } catch (_) {
      if (directId) return [directId]
      if (raw.startsWith('asset-')) return [raw]
    }
    return directId ? [directId] : draggedAssetIds
  }

  const getDraggedAssetId = (dataTransfer) => {
    const assetIds = getDraggedAssetIds(dataTransfer)
    return Array.isArray(assetIds) && assetIds.length > 0 ? assetIds[0] : null
  }

  const getDropStartTimeFromClientX = (clientX, laneLeft) => {
    const scrollLeft = timelineRef.current?.scrollLeft || 0
    const x = clientX - laneLeft + scrollLeft
    const fps = Number.isFinite(Number(timelineFps)) && Number(timelineFps) > 0
      ? Number(timelineFps)
      : FRAME_RATE
    const rawStartTime = Math.max(0, x / pixelsPerSecond)
    return Math.round(rawStartTime * fps) / fps
  }

  const getDropStartTime = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return getDropStartTimeFromClientX(e.clientX, rect.left)
  }

  const getSnappedDropStartTime = (rawStartTime, clipDuration) => {
    const snapResult = snapClipPosition(null, rawStartTime, clipDuration)
    if (snapResult.snapped) {
      return {
        startTime: Math.max(0, snapResult.startTime),
        snapTime: snapResult.snapInfo?.snapPoint?.time ?? null,
      }
    }
    return { startTime: rawStartTime, snapTime: null }
  }

  const getDropPreviewDuration = (asset, startTime) => {
    if (!asset) return 5
    const fps = Number.isFinite(Number(timelineFps)) && Number(timelineFps) > 0
      ? Number(timelineFps)
      : FRAME_RATE
    const minDuration = 1 / fps
    const isImage = asset.type === 'image'
    const assetDuration = Number(asset.duration ?? asset.settings?.duration)
    const sourceDuration = Number.isFinite(assetDuration) && assetDuration > 0 ? assetDuration : 5
    let rawDuration = isImage ? 5 : sourceDuration
    const isGeneratedOverlay = isImage && Boolean(asset?.settings?.overlayKind)

    if (isGeneratedOverlay) {
      const latestClips = useTimelineStore.getState().clips || clips
      const timelineContentEnd = latestClips.length > 0
        ? Math.max(...latestClips.map(c => c.startTime + c.duration))
        : 0
      const remainingDuration = timelineContentEnd - startTime
      rawDuration = Math.max(5, remainingDuration > 0 ? remainingDuration : 0)
    }

    const roundedDuration = Math.round(rawDuration * fps) / fps
    return Math.max(minDuration, roundedDuration)
  }

  const canDropAssetOnTrack = (asset, track) => {
    if (!asset || !track) return false
    const isVideoAsset = asset.type === 'video' || asset.type === 'image'
    const isVideoTrack = track.type === 'video'
    return (isVideoAsset && isVideoTrack) || (!isVideoAsset && !isVideoTrack)
  }

  const resolveVideoAssetHasAudio = useCallback(async (asset) => {
    if (!asset || asset.type !== 'video') return null
    if (typeof asset.hasAudio === 'boolean') return asset.hasAudio

    const canProbeViaElectron = (
      typeof window !== 'undefined'
      && window.isElectron
      && window.electronAPI
      && typeof window.electronAPI.getVideoFps === 'function'
      && typeof asset.absolutePath === 'string'
      && asset.absolutePath.length > 0
    )
    if (!canProbeViaElectron) return null

    try {
      const fpsResult = await window.electronAPI.getVideoFps(asset.absolutePath)
      if (typeof fpsResult?.hasAudio !== 'boolean') return null
      const hasAudio = fpsResult.hasAudio
      if (hasAudio) {
        updateAsset(asset.id, { hasAudio: true })
      } else {
        updateAsset(asset.id, { hasAudio: false, audioEnabled: false })
      }
      return hasAudio
    } catch (err) {
      console.warn('Failed to probe video audio stream:', err)
      return null
    }
  }, [updateAsset])

  const resolveDropTrackForAsset = (asset, requestedTrackId, { allowCreateTrack = false } = {}) => {
    let targetTrackId = requestedTrackId
    let willCreateTrack = false
    const isOverlayAsset = asset.type === 'image' && Boolean(asset?.settings?.overlayKind)

    if (!isOverlayAsset) {
      return { targetTrackId, willCreateTrack }
    }

    const latestState = useTimelineStore.getState()
    const latestTracks = latestState.tracks || []
    const latestClips = latestState.clips || []
    const unlockedVideoTracks = latestTracks.filter(t => t.type === 'video' && !t.locked)
    const isOverlayClip = (clip) => {
      if (clip.type !== 'image') return false
      const clipAsset = assetsById.get(clip.assetId)
      return Boolean(clipAsset?.settings?.overlayKind)
    }

    const reusableOverlayTrack = unlockedVideoTracks.find((trackCandidate) => {
      const clipsOnTrack = latestClips.filter(c => c.trackId === trackCandidate.id)
      return clipsOnTrack.length === 0 || clipsOnTrack.every(isOverlayClip)
    })

    if (reusableOverlayTrack) {
      targetTrackId = reusableOverlayTrack.id
      return { targetTrackId, willCreateTrack }
    }

    if (allowCreateTrack) {
      const newTrack = addTrack('video')
      if (newTrack?.id) {
        targetTrackId = newTrack.id
        willCreateTrack = true
      }
      return { targetTrackId, willCreateTrack }
    }

    const requestedTrack = latestTracks.find(t => t.id === requestedTrackId)
    if (requestedTrack?.type === 'video' && !requestedTrack.locked) {
      targetTrackId = requestedTrack.id
    } else if (unlockedVideoTracks.length > 0) {
      targetTrackId = unlockedVideoTracks[0].id
    }
    willCreateTrack = true
    return { targetTrackId, willCreateTrack }
  }

  // Handle drag over for drop zones
  const handleDragOver = (e, trackId) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'

    const laneLeft = e.currentTarget.getBoundingClientRect().left
    pendingAssetDragOverRef.current = {
      trackId,
      assetId: getDraggedAssetId(e.dataTransfer),
      clientX: e.clientX,
      laneLeft,
    }

    if (dragOverRafRef.current !== null) return

    dragOverRafRef.current = requestAnimationFrame(() => {
      dragOverRafRef.current = null
      const payload = pendingAssetDragOverRef.current
      pendingAssetDragOverRef.current = null
      if (!payload) return

      const { assetId, clientX, laneLeft: pendingLaneLeft, trackId: pendingTrackId } = payload

      if (!assetId) {
        setDropTarget(pendingTrackId)
        setAssetDropPreview(null)
        clearActiveSnap()
        return
      }

      const asset = assetsById.get(assetId)
      if (!asset) {
        setDropTarget(null)
        setAssetDropPreview(null)
        clearActiveSnap()
        return
      }

      const rawStartTime = getDropStartTimeFromClientX(clientX, pendingLaneLeft)
      const { targetTrackId, willCreateTrack } = resolveDropTrackForAsset(asset, pendingTrackId, { allowCreateTrack: false })
      const latestTracks = useTimelineStore.getState().tracks
      const targetTrack = latestTracks.find(t => t.id === targetTrackId) || tracks.find(t => t.id === targetTrackId)

      if (!canDropAssetOnTrack(asset, targetTrack)) {
        setDropTarget(null)
        setAssetDropPreview(null)
        clearActiveSnap()
        return
      }

      const duration = getDropPreviewDuration(asset, rawStartTime)
      const { startTime, snapTime } = getSnappedDropStartTime(rawStartTime, duration)
      setDropTarget(targetTrackId)
      if (snapTime !== null) {
        setActiveSnapTime(snapTime)
      } else {
        clearActiveSnap()
      }
      setAssetDropPreview((prev) => {
        const next = {
          assetId: asset.id,
          trackId: targetTrackId,
          startTime,
          duration,
          assetType: asset.type,
          name: asset.name,
          willCreateTrack,
        }
        if (
          prev &&
          prev.assetId === next.assetId &&
          prev.trackId === next.trackId &&
          prev.assetType === next.assetType &&
          prev.name === next.name &&
          prev.willCreateTrack === next.willCreateTrack &&
          Math.abs(prev.startTime - next.startTime) < 0.0001 &&
          Math.abs(prev.duration - next.duration) < 0.0001
        ) {
          return prev
        }
        return next
      })
    })
  }

  const handleDragLeave = (e) => {
    if (e.currentTarget?.contains(e.relatedTarget)) return
    cancelPendingAssetDragOver()
    setDropTarget(null)
    setAssetDropPreview(null)
    clearActiveSnap()
  }

  // Handle drop from assets
  const handleDrop = async (e, trackId) => {
    e.preventDefault()
    cancelPendingAssetDragOver()
    setDropTarget(null)
    setAssetDropPreview(null)
    clearActiveSnap()
    
    const assetIds = getDraggedAssetIds(e.dataTransfer)
    if (!Array.isArray(assetIds) || assetIds.length === 0) return

    const droppedAssets = assetIds
      .map((assetId) => assetsById.get(assetId))
      .filter(Boolean)
    if (droppedAssets.length === 0) return

    let nextStartTime = getDropStartTime(e)
    let insertedAny = false

    for (const asset of droppedAssets) {
      const { targetTrackId } = resolveDropTrackForAsset(asset, trackId, { allowCreateTrack: true })

      // Check if asset type matches target track type
      const latestTracks = useTimelineStore.getState().tracks
      const track = latestTracks.find(t => t.id === targetTrackId) || tracks.find(t => t.id === targetTrackId)
      if (!track || !canDropAssetOnTrack(asset, track)) continue

      const duration = getDropPreviewDuration(asset, nextStartTime)
      const { startTime } = insertedAny
        ? { startTime: nextStartTime }
        : getSnappedDropStartTime(nextStartTime, duration)
      const insertedClip = addClip(targetTrackId, asset, startTime, timelineFps)
      if (!insertedClip) continue

      insertedAny = true
      nextStartTime = insertedClip.startTime + insertedClip.duration

      // If this is a video asset with an audio stream enabled, also add an audio clip.
      let shouldAddAudioClip = false
      if (asset.type === 'video' && track.type === 'video' && asset.audioEnabled !== false) {
        if (asset.hasAudio === false) {
          shouldAddAudioClip = false
        } else if (asset.hasAudio === true) {
          shouldAddAudioClip = true
        } else {
          const probedHasAudio = await resolveVideoAssetHasAudio(asset)
          shouldAddAudioClip = probedHasAudio !== false
        }
      }
      if (shouldAddAudioClip) {
        const latestTracksAfterDrop = useTimelineStore.getState().tracks
        const audioTrack = latestTracksAfterDrop.find(t => t.type === 'audio' && !t.locked)
        if (audioTrack) {
          const audioAsset = { ...asset, type: 'audio' }
          addClip(audioTrack.id, audioAsset, insertedClip.startTime, timelineFps)
        }
      }
    }

    if (insertedAny) {
      setPreviewMode('timeline')
      if (assetIsPlaying) {
        setAssetIsPlaying(false)
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
        if (!(clip.type === 'video' || clip.type === 'image')) break
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
        if (clip.type === 'text') {
          const textOptions = { ...(clip.textProperties || {}), duration: clip.duration }
          addTextClip(clip.trackId, textOptions, clip.startTime + clip.duration + 0.1)
        } else if (clip.type === 'adjustment') {
          addAdjustmentClip(clip.trackId, clip.startTime + clip.duration + 0.1, {
            duration: clip.duration,
            name: clip.name,
            adjustments: clip.adjustments || {},
            transform: clip.transform || {},
          })
        } else {
          const asset = assets.find(a => a.id === clip.assetId)
          if (asset) {
            addClip(clip.trackId, asset, clip.startTime + clip.duration + 0.1, timelineFps)
          }
        }
        break
      case 'split':
        // Split clip at playhead (seamless: second clip continues from cut in source; text = duplicate props)
        if (playheadPosition > clip.startTime && playheadPosition < clip.startTime + clip.duration) {
          const splitTime = playheadPosition - clip.startTime
          const remainder = clip.duration - splitTime
          saveToHistory()
          resizeClip(clip.id, splitTime)
          if (clip.type === 'text') {
            const textOptions = { ...(clip.textProperties || {}), duration: remainder }
            addTextClip(clip.trackId, textOptions, playheadPosition)
          } else if (clip.type === 'adjustment') {
            addAdjustmentClip(clip.trackId, playheadPosition, {
              duration: remainder,
              name: clip.name,
              adjustments: clip.adjustments || {},
              transform: clip.transform || {},
            })
          } else {
            const timeScale = getTimeScale(clip)
            const sourceTimeAtCut = (clip.trimStart || 0) + splitTime * timeScale
            const sourceTrimEnd = sourceTimeAtCut + remainder * timeScale
            const asset = assets.find(a => a.id === clip.assetId)
            if (asset) {
              addClip(clip.trackId, asset, playheadPosition, timelineFps, {
                duration: remainder,
                trimStart: sourceTimeAtCut,
                trimEnd: sourceTrimEnd,
              })
            }
          }
        }
        break
    }
    
    setMaskSubmenuOpen(false)
    setClipContextMenu(null)
  }

  const handleApplyMaskFromContextMenu = (maskAssetId) => {
    const clip = clips.find(c => c.id === clipContextMenu?.clipId)
    if (!clip) return
    if (!(clip.type === 'video' || clip.type === 'image')) return

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

    // Trimming must be exclusive: cancel any in-flight drag/edit gesture to avoid
    // multiple mousemove handlers fighting and moving neighboring clips.
    if (clipDragState) setClipDragState(null)
    if (transitionDragState) setTransitionDragState(null)
    if (rollEditState) setRollEditState(null)
    if (slipState) setSlipState(null)
    clearActiveSnap()
    
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
        const minClipDurationSec = 1 / (timelineFps || 24)
        const maxStartTime = trimState.startTime + trimState.startDuration - minClipDurationSec
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
        
        const minClipDurationSec = 1 / (timelineFps || 24)
        let newDuration = Math.max(minClipDurationSec, newEndTime - trimState.startTime)
        
        // Don't exceed source duration if we have it
        // The maximum duration is limited by how much source footage is available
        // from the current trimStart to the end of the source
        const currentTrimStart = trimState.startTrimStart
        const rawSourceDuration = clip.sourceDuration
        const parsedSourceDuration = rawSourceDuration === Infinity || rawSourceDuration === 'Infinity'
          ? Infinity
          : (rawSourceDuration === null || rawSourceDuration === undefined || rawSourceDuration === ''
              ? null
              : Number(rawSourceDuration))
        const sourceDuration = parsedSourceDuration === Infinity || clip.type === 'image'
          ? Infinity
          : ((Number.isFinite(parsedSourceDuration) && parsedSourceDuration > 0)
              ? parsedSourceDuration
              : trimState.startTrimEnd)
        if (Number.isFinite(sourceDuration)) {
          const maxPossibleDuration = (sourceDuration - currentTrimStart) / timeScale
          newDuration = Math.max(0.01, Math.min(newDuration, maxPossibleDuration))
        }
        
        // Calculate the new trimEnd (where in the source footage the clip ends)
        const unclampedTrimEnd = currentTrimStart + (newDuration * timeScale)
        const newTrimEnd = Number.isFinite(sourceDuration)
          ? Math.min(unclampedTrimEnd, sourceDuration)
          : unclampedTrimEnd
        
        updateClipTrim(trimState.clipId, {
          duration: newDuration,
          trimEnd: newTrimEnd
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
    if (trimState || slipState || e.target.closest('[data-trim-handle]') || e.target.closest('button')) {
      return
    }
    
    e.stopPropagation()
    e.preventDefault()

    const isShiftHeld = e.shiftKey
    const isCtrlHeld = e.ctrlKey || e.metaKey // metaKey for Mac Cmd
    const hasSelectionModifier = isShiftHeld || isCtrlHeld

    const sourceDuration = getSourceDuration(clip)
    const canSlip = e.altKey
      && (clip.type === 'video' || clip.type === 'audio')
      && Number.isFinite(sourceDuration)
    if (canSlip) {
      if (clipDragState) setClipDragState(null)
      if (transitionDragState) setTransitionDragState(null)
      if (rollEditState) setRollEditState(null)
      clearActiveSnap()
      saveToHistory()

      const timeScale = Math.max(0.0001, getTimeScale(clip))
      const startTrimStart = Math.max(0, Number(clip.trimStart) || 0)
      const computedTrimEnd = startTrimStart + clip.duration * timeScale
      const explicitTrimEnd = Number(clip.trimEnd)
      const baseTrimEnd = Number.isFinite(explicitTrimEnd) ? explicitTrimEnd : computedTrimEnd
      const startTrimEnd = Math.max(
        startTrimStart + 0.0001,
        Math.min(sourceDuration, baseTrimEnd)
      )
      const minSourceDelta = -startTrimStart
      const maxSourceDelta = Number.isFinite(sourceDuration)
        ? (sourceDuration - startTrimEnd)
        : Infinity

      setSlipState({
        clipId: clip.id,
        startX: e.clientX,
        startTrimStart,
        startTrimEnd,
        timeScale,
        minSourceDelta,
        maxSourceDelta: Math.max(minSourceDelta, maxSourceDelta),
      })

      if (!selectedClipIds.includes(clip.id) && !hasSelectionModifier) {
        selectClip(clip.id)
      }
      return
    }
    
    // Store original positions of all selected clips for multi-drag
    const clipsToMove = selectedClipIds.includes(clip.id) 
      ? clips.filter(c => selectedClipIds.includes(c.id))
      : [clip]
    clipDragHistorySavedRef.current = false
    
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
    if (!selectedClipIds.includes(clip.id) && !hasSelectionModifier) {
      selectClip(clip.id)
    }
  }

  // Handle slip edit (Alt+drag on clip body)
  useEffect(() => {
    if (!slipState || trimState) return

    const handleMouseMove = (e) => {
      const deltaX = e.clientX - slipState.startX
      const deltaTime = deltaX / pixelsPerSecond
      const fps = timelineFps || 24
      const quantizedDeltaTime = Math.round(deltaTime * fps) / fps
      const proposedSourceDelta = quantizedDeltaTime * slipState.timeScale
      const boundedSourceDelta = Math.max(
        slipState.minSourceDelta,
        Math.min(proposedSourceDelta, slipState.maxSourceDelta)
      )

      const newTrimStart = slipState.startTrimStart + boundedSourceDelta
      const newTrimEnd = slipState.startTrimEnd + boundedSourceDelta
      updateClipTrim(slipState.clipId, {
        trimStart: Math.max(0, newTrimStart),
        trimEnd: Math.max(newTrimStart + 0.0001, newTrimEnd),
      })
    }

    const handleMouseUp = () => {
      setSlipState(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [slipState, trimState, pixelsPerSecond, timelineFps, updateClipTrim])

  // Handle clip dragging (mousemove when dragging a clip)
  // Supports moving multiple selected clips together
  useEffect(() => {
    if (!clipDragState || trimState || slipState) return
    
    const handleMouseMove = (e) => {
      const deltaX = e.clientX - clipDragState.startX
      const deltaY = e.clientY - clipDragState.startY
      
      // Check if we've moved enough to consider it a drag (prevents accidental drags on click)
      const hasMoved = clipDragState.hasMoved || Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3
      
      if (!hasMoved) {
        setClipDragState(prev => ({ ...prev, hasMoved: false }))
        return
      }

      // Save one undo snapshot at the start of an actual drag gesture.
      if (!clipDragHistorySavedRef.current) {
        saveToHistory()
        clipDragHistorySavedRef.current = true
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
      
      // Use track content ref for Y (scrollable area where tracks live)
      if (!isDraggingMultiple && trackContentRef.current) {
        const contentRect = trackContentRef.current.getBoundingClientRect()
        const relativeY = e.clientY - contentRect.top + trackContentRef.current.scrollTop
        
        // Image/text/adjustment clips stay on video tracks; only pure audio clips map to audio tracks
        const trackType = (clip.type === 'image' || clip.type === 'text' || clip.type === 'adjustment') ? 'video' : (clip.type || 'video')
        const relevantTracks = tracks.filter(t => t.type === trackType)
        const audioSectionHeight = 20
        const totalVideoTracksHeight = videoTracks.reduce((sum, track) => sum + getTrackHeight(track), 0)
        
        let currentY = trackType === 'video' ? 0 : totalVideoTracksHeight + audioSectionHeight
        
        for (const track of relevantTracks) {
          const height = getTrackHeight(track)
          if (relativeY >= currentY && relativeY < currentY + height) {
            if (!track.locked) newTrackId = track.id
            break
          }
          currentY += height
        }
      }
      
      // Update clip position(s) - don't resolve overlaps during drag, only on mouse up
      if (isDraggingMultiple) {
        // Set all selected clips to original + total delta; keep group in sequence at timeline start
        const proposed = clipDragState.originalPositions.map(({ id, startTime }) => ({
          id,
          startTime: startTime + finalDeltaTime
        }))
        const minStart = Math.min(...proposed.map((p) => p.startTime))
        const shift = minStart < 0 ? -minStart : 0
        const updates = proposed.map(({ id, startTime }) => ({
          id,
          startTime: Math.max(0, startTime + shift)
        }))
        setSelectedClipsStartTimes(updates)
        setClipDragState(prev => ({ ...prev, currentTrackId: newTrackId }))
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
      clipDragHistorySavedRef.current = false
      clearActiveSnap()
    }
    
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [clipDragState, trimState, slipState, clips, pixelsPerSecond, tracks, videoTracks, moveClip, moveSelectedClips, setSelectedClipsStartTimes, selectedClipIds, snapClipPosition, setActiveSnapTime, clearActiveSnap, saveToHistory])

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
    const raw = e.dataTransfer.getData('application/x-comfystudio-transition')
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  
  // Keep timeline transition menu in sync with global default duration.
  useEffect(() => {
    const handler = (e) => {
      const next = Number(e?.detail)
      if (Number.isFinite(next) && next >= 1) {
        setDefaultTransitionFrames(Math.round(next))
      }
    }
    window.addEventListener('comfystudio-transition-default-duration-changed', handler)
    return () => window.removeEventListener('comfystudio-transition-default-duration-changed', handler)
  }, [])
  
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
    if (!transitionDragState || trimState || slipState) return
    
    const handleMouseMove = (e) => {
      const deltaX = e.clientX - transitionDragState.startX
      // 1:1 with mouse: duration change in seconds = pixels moved / pixels per second
      const deltaDuration = deltaX / pixelsPerSecond
      const minDuration = 1 / FRAME_RATE
      
      let newDuration
      if (transitionDragState.edge === 'left') {
        // Left edge: decreasing duration
        newDuration = Math.max(minDuration, transitionDragState.startDuration - deltaDuration)
      } else {
        // Right edge: increasing duration
        newDuration = Math.max(minDuration, transitionDragState.startDuration + deltaDuration)
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
  }, [transitionDragState, trimState, slipState, pixelsPerSecond, updateTransition])

  // Handle roll edit (dragging between two adjacent clips)
  useEffect(() => {
    if (!rollEditState || trimState || slipState) return
    
    const handleMouseMove = (e) => {
      const deltaX = e.clientX - rollEditState.startX
      const proposedDelta = deltaX / pixelsPerSecond
      const fps = timelineFps || 24
      const minDuration = 1 / fps
      const clipATimeScale = Math.max(0.0001, Number(rollEditState.clipATimeScale) || 1)
      const clipBTimeScale = Math.max(0.0001, Number(rollEditState.clipBTimeScale) || 1)

      // Duration constraints: both clips keep at least minDuration.
      const minDeltaFromClipA = minDuration - rollEditState.clipAOriginalDuration
      const maxDeltaFromClipB = rollEditState.clipBOriginalDuration - minDuration

      // Media handle constraints:
      // - Clip A can only roll right while it still has tail handle.
      // - Clip B can only roll left while it still has head handle.
      let maxDeltaFromClipAHandles = Infinity
      if (Number.isFinite(Number(rollEditState.clipASourceDuration))) {
        const maxClipADuration = (Number(rollEditState.clipASourceDuration) - rollEditState.clipAOriginalTrimStart) / clipATimeScale
        maxDeltaFromClipAHandles = maxClipADuration - rollEditState.clipAOriginalDuration
      }
      const minDeltaFromClipBHandles = -(rollEditState.clipBOriginalTrimStart / clipBTimeScale)

      let minDelta = Math.max(minDeltaFromClipA, minDeltaFromClipBHandles)
      let maxDelta = Math.min(maxDeltaFromClipB, maxDeltaFromClipAHandles)
      if (maxDelta < minDelta) {
        const pinned = (minDelta + maxDelta) / 2
        minDelta = pinned
        maxDelta = pinned
      }

      const actualDelta = Math.max(minDelta, Math.min(proposedDelta, maxDelta))
      const newClipADuration = rollEditState.clipAOriginalDuration + actualDelta
      const newClipBStart = rollEditState.clipBOriginalStart + actualDelta
      const newClipBTrimStart = Math.max(0, rollEditState.clipBOriginalTrimStart + actualDelta * clipBTimeScale)
      
      // Rolling edit semantics:
      // - Clip A tail: adjust out-point (duration/trimEnd)
      // - Clip B head: adjust in-point (startTime/trimStart), keeping trimEnd fixed
      updateClipTrim(rollEditState.clipAId, {
        duration: newClipADuration,
        trimStart: rollEditState.clipAOriginalTrimStart,
      })
      updateClipTrim(rollEditState.clipBId, {
        startTime: newClipBStart,
        trimStart: newClipBTrimStart,
        trimEnd: rollEditState.clipBOriginalTrimEnd,
      })
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
  }, [rollEditState, trimState, slipState, pixelsPerSecond, timelineFps, updateClipTrim])

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
      
      // Check if clips are adjacent (small gap) OR overlapping (transition exists)
      const gap = clipB.startTime - clipAEnd
      const isOverlapping = clipB.startTime < clipAEnd
      
      if (isOverlapping || Math.abs(gap) < ADJACENT_CLIP_UI_GAP_SECONDS) {
        // Check if there's a transition between these clips
        const transition = getTransitionBetween(clipA.id, clipB.id)
        pairs.push({ clipA, clipB, transition, isOverlapping, gap })
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

  const handleTrackResizeStart = (e, track) => {
    e.stopPropagation()
    e.preventDefault()
    setTrackResizeState({
      trackId: track.id,
      startY: e.clientY,
      startHeight: getTrackHeight(track)
    })
  }

  const handleTrackDragMove = (e) => {
    if (!trackDragState) return
    
    // Calculate which index we're hovering over
    const tracksOfType = trackDragState.trackType === 'video' ? videoTracks : audioTracks
    const draggedTrack = tracksOfType.find(t => t.id === trackDragState.trackId)
    const trackHeight = draggedTrack ? getTrackHeight(draggedTrack) : VIDEO_TRACK_HEIGHT_DEFAULT
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

  // Persist custom track heights
  useEffect(() => {
    try {
      localStorage.setItem(TRACK_HEIGHTS_STORAGE_KEY, JSON.stringify(trackHeights))
    } catch (_) {}
  }, [trackHeights])

  // Drop stale track height entries when tracks are removed.
  useEffect(() => {
    setTrackHeights((prev) => {
      const next = {}
      const validIds = new Set(tracks.map(t => t.id))
      let changed = false
      Object.entries(prev || {}).forEach(([trackId, height]) => {
        if (validIds.has(trackId)) {
          next[trackId] = height
        } else {
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [tracks])

  // Track height resize drag listeners
  useEffect(() => {
    if (!trackResizeState) return

    const handleMouseMove = (e) => {
      const deltaY = e.clientY - trackResizeState.startY
      const nextHeight = Math.max(
        TRACK_HEIGHT_MIN,
        Math.min(TRACK_HEIGHT_MAX, Math.round(trackResizeState.startHeight + deltaY))
      )
      setTrackHeights(prev => ({
        ...(prev || {}),
        [trackResizeState.trackId]: nextHeight
      }))
    }

    const handleMouseUp = () => {
      setTrackResizeState(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [trackResizeState])

  const timecodeFps = Number.isFinite(Number(timelineFps)) && Number(timelineFps) > 0
    ? Number(timelineFps)
    : FRAME_RATE

  const formatTimelineTimecode = (seconds) => {
    const fps = Math.max(1, Math.round(timecodeFps))
    const totalFrames = Math.max(0, Math.floor((seconds || 0) * fps))
    const frames = totalFrames % fps
    const totalSeconds = Math.floor(totalFrames / fps)
    const ss = totalSeconds % 60
    const mm = Math.floor(totalSeconds / 60) % 60
    const hh = Math.floor(totalSeconds / 3600)
    const pad2 = (n) => String(n).padStart(2, '0')
    return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}:${pad2(frames)}`
  }

  const getMajorRulerStep = (pixelsPerSec) => {
    // Keep labels readable while allowing finer granularity at high zoom.
    const candidates = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
    const minSpacingPx = 95
    return candidates.find(step => step * pixelsPerSec >= minSpacingPx) || candidates[candidates.length - 1]
  }

  const rulerTicks = useMemo(() => {
    const majorStep = getMajorRulerStep(pixelsPerSecond)
    const minorDivisions = majorStep >= 60 ? 6 : (majorStep >= 10 ? 5 : (majorStep >= 1 ? 4 : 5))
    const minorStep = majorStep / minorDivisions
    const major = []
    const minor = []
    const maxSteps = Math.ceil(duration / minorStep)

    for (let i = 0; i <= maxSteps; i++) {
      const time = Number((i * minorStep).toFixed(6))
      if (time > duration + 1e-6) break
      if (i % minorDivisions === 0) major.push(time)
      else minor.push(time)
    }

    return { major, minor, majorStep, minorStep }
  }, [duration, pixelsPerSecond])

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
          <button
            onClick={() => addMarker(playheadPosition)}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[10px] text-sf-text-secondary transition-colors"
            title="Add timeline marker at playhead (M)"
          >
            <Flag className="w-3 h-3 text-yellow-400" />
            Marker
          </button>
          <button
            onClick={handleAddAdjustmentLayer}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[10px] text-sf-text-secondary transition-colors"
            title="Add adjustment layer on active video track"
          >
            <Square className="w-3 h-3 text-purple-400" />
            Adj
          </button>
          {selectedMarkerId && (
            <button
              onClick={() => removeMarker(selectedMarkerId)}
              className="flex items-center gap-1 px-1.5 py-0.5 bg-sf-dark-700 hover:bg-sf-error/30 rounded text-[10px] text-sf-text-secondary transition-colors"
              title="Remove selected marker"
            >
              <X className="w-3 h-3 text-sf-error" />
            </button>
          )}
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
        
        {/* Selection count */}
        {selectedClipIds.length > 1 && (
          <span className="text-[10px] text-sf-accent">{selectedClipIds.length} selected</span>
        )}
        
        {/* Clip count */}
        <span className="text-[10px] text-sf-text-muted">{clips.length} clips</span>
        
        {/* Info & Zoom */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleFrameAll}
            className="p-1.5 hover:bg-sf-dark-600 rounded text-sf-text-muted"
            title="Frame all – fit timeline or all clips in view"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => applyZoomWithPlayheadPivot(zoom - 50)}
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
              onChange={(e) => applyZoomWithPlayheadPivot(parseInt(e.target.value, 10))}
              className="w-24 h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
            />
            <button
              onClick={() => applyZoomWithPlayheadPivot(zoom + 50)}
              className="p-0.5 hover:bg-sf-dark-600 rounded text-sf-text-muted"
              title="Zoom In"
            >
              <span className="text-xs">+</span>
            </button>
            <span className="text-[10px] text-sf-text-muted w-12">{Math.round(zoom)}%</span>
          </div>
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
            const headerHeight = getTrackHeight(track)
            
            return (
            <div 
              key={track.id}
              onClick={() => setActiveTrack(track.id)}
              title={activeTrackId === track.id ? 'Active track — press X to split at playhead' : 'Click to set as active track (X cuts at playhead on this track)'}
              className={`relative flex items-center px-2 gap-1 border-b border-sf-dark-700 hover:bg-sf-dark-800 transition-colors group/track cursor-pointer ${
                track.locked ? 'bg-sf-dark-800/50' : ''
              } ${isDragging ? 'opacity-50 bg-sf-dark-700' : ''} ${isDropTarget ? 'border-t-2 border-t-purple-500' : ''}`}
              style={{ minHeight: headerHeight, height: headerHeight }}
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
              {/* Drag bottom edge to resize track vertically */}
              <div
                className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize z-30 group/track-resize"
                onMouseDown={(e) => handleTrackResizeStart(e, track)}
                title="Drag to resize track height"
              >
                <div className="absolute left-7 right-2 top-1/2 -translate-y-1/2 h-px bg-white/0 group-hover/track-resize:bg-white/35 transition-colors" />
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
            const headerHeight = getTrackHeight(track)
            const audioTrackNumber = index + 1
            const channelLabels = isStereo
              ? [`A${audioTrackNumber}L`, `A${audioTrackNumber}R`]
              : [`A${audioTrackNumber}`]
            
            return (
            <div 
              key={track.id}
              onClick={() => setActiveTrack(track.id)}
              title={activeTrackId === track.id ? 'Active track — press X to split at playhead' : 'Click to set as active track (X cuts at playhead on this track)'}
              className={`relative flex flex-col px-2 gap-0 border-b border-sf-dark-700 hover:bg-sf-dark-800 transition-colors group/track cursor-pointer ${
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
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onDoubleClick={(e) => { e.stopPropagation(); handleStartRename(track) }}
                    title="Double-click to rename"
                  >
                    <span className="text-[11px] text-sf-text-primary truncate block leading-tight hover:text-sf-accent">
                      {track.name}
                    </span>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {channelLabels.map((label) => (
                        <span
                          key={label}
                          className="px-1 py-0 rounded border border-sf-dark-500 bg-sf-dark-700/70 text-[9px] text-sf-text-muted leading-none"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
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
              {/* Drag bottom edge to resize track vertically */}
              <div
                className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize z-30 group/track-resize"
                onMouseDown={(e) => handleTrackResizeStart(e, track)}
                title="Drag to resize track height"
              >
                <div className="absolute left-7 right-2 top-1/2 -translate-y-1/2 h-px bg-white/0 group-hover/track-resize:bg-white/35 transition-colors" />
              </div>
            </div>
          )})}
          </div>
        </div>

        {/* Track Content Area */}
        <div 
          ref={timelineRef}
          className={`flex-1 min-h-0 overflow-x-auto overflow-y-hidden relative bg-sf-dark-900 flex flex-col ${
            isPanning ? 'cursor-grabbing select-none' : 
            isSpaceHeld ? 'cursor-grab' : 
            isScrubbing ? 'cursor-ew-resize select-none' : ''
          }`}
          onMouseDown={handleTimelineMouseDown}
          onWheel={handleWheel}
        >
          {/* Inner container that stretches to fill available space */}
          <div className="min-w-full flex flex-col flex-1 min-h-0" style={{ width: `max(100%, ${duration * pixelsPerSecond}px)` }}>
            {/* Time Ruler - professional timecode style */}
            <div
              className="h-5 flex-shrink-0 bg-gradient-to-b from-sf-dark-800 to-sf-dark-900 border-b border-sf-dark-700 relative select-none"
              onDoubleClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const time = getTimeFromMouseEvent(e)
                addMarker(time)
                setPlayheadPosition(time)
              }}
              title="Double-click to add marker"
            >
              {/* Minor ticks */}
              {rulerTicks.minor.map((time) => (
                <div
                  key={`minor-${time}`}
                  className="absolute bottom-0 w-px h-1.5 bg-sf-dark-600/80 pointer-events-none"
                  style={{ left: `${time * pixelsPerSecond}px` }}
                />
              ))}

              {/* Major ticks + timecode labels */}
              {rulerTicks.major.map((time) => (
                <div
                  key={`major-${time}`}
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ left: `${time * pixelsPerSecond}px` }}
                >
                  <div className="absolute bottom-0 w-px h-2.5 bg-sf-dark-500/95" />
                  <span className="absolute top-0.5 left-1 text-[9px] text-sf-text-muted font-mono tracking-tight whitespace-nowrap">
                    {formatTimelineTimecode(time)}
                  </span>
                </div>
              ))}

              {/* FPS indicator on far right */}
              <div className="absolute top-0.5 right-1 text-[8px] text-sf-text-muted/80 font-mono pointer-events-none">
                {Math.round(timecodeFps)} fps
              </div>
            </div>

          {/* Scrollable tracks container */}
          <div 
            ref={trackContentRef}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden hide-scrollbar"
            style={{ scrollbarWidth: 'none' }}
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
            const contentHeight = getTrackHeight(track)
            
            return (
              <div 
                key={track.id}
                className={`border-b border-sf-dark-700 relative ${
                  !track.visible ? 'opacity-40' : ''
                } ${track.locked ? 'pointer-events-none opacity-50 bg-sf-dark-800' : ''} ${
                  dropTarget === track.id ? 'bg-sf-accent/10' : track.locked ? '' : 'bg-sf-dark-900'
                }`}
                style={{ minHeight: contentHeight, height: contentHeight }}
                onDragOver={(e) => handleDragOver(e, track.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, track.id)}
              >
                {trackClips.map((clip) => {
                  const clipWidth = clip.duration * pixelsPerSecond
                  // Calculate how many thumbnail frames to show (roughly one per 60px)
                  const thumbCount = Math.max(1, Math.floor(clipWidth / 60))
                  const isTextClip = clip.type === 'text'
                  const isAdjustmentClip = clip.type === 'adjustment'
                  
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
                      slipState?.clipId === clip.id ? 'ring-2 ring-yellow-400 cursor-ew-resize z-30' : ''
                    } ${
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
                    ) : isAdjustmentClip ? (
                      <>
                        {/* Adjustment Layer Clip Rendering */}
                        <div
                          className="absolute inset-0 bg-[#2a1f3a]"
                          style={{
                            borderTop: '3px solid #a855f7',
                            backgroundImage: 'repeating-linear-gradient(135deg, rgba(168,85,247,0.28) 0px, rgba(168,85,247,0.28) 8px, rgba(30,20,45,0.65) 8px, rgba(30,20,45,0.65) 16px)',
                          }}
                        />

                        <div className="absolute inset-x-0 top-[3px] h-6 bg-gradient-to-b from-black/55 to-transparent pointer-events-none" />

                        <div className="absolute top-1 left-1 z-10 flex items-center gap-1">
                          <div className="bg-purple-600/85 rounded px-1 py-0.5 flex items-center gap-0.5">
                            <Square className="w-2.5 h-2.5 text-white" />
                            <span className="text-[8px] text-white font-medium">ADJ</span>
                          </div>
                        </div>

                        <div className="absolute inset-x-0 bottom-0 h-[14px] bg-[#4d2f69]/95 border-t border-black/45 pointer-events-none" />
                        <div className="absolute bottom-[1px] left-1.5 right-12 z-10">
                          <span className="text-[10px] text-white/95 font-medium truncate block leading-none drop-shadow-sm">
                            {clip.name || 'Adjustment Layer'}
                          </span>
                        </div>

                        <div className="absolute bottom-[1px] right-1 px-1 py-0 rounded bg-black/55 text-[8px] text-white/90 font-mono leading-none">
                          {clip.duration.toFixed(1)}s
                        </div>

                        {clip.keyframes && Object.keys(clip.keyframes).length > 0 && (
                          <div className="absolute bottom-[15px] left-0 right-0 h-2 pointer-events-none">
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
                        
                        {/* Gradient overlay for top badges readability */}
                        <div className="absolute inset-x-0 top-[3px] h-6 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
                        
                        {/* Image badge + AI/IMP tag - top left */}
                        <div className="absolute top-1 left-1 z-10 flex items-center gap-1">
                          <div className="bg-purple-500/80 rounded px-1 py-0.5 flex items-center gap-0.5">
                            <ImageIcon className="w-2.5 h-2.5 text-white" />
                            <span className="text-[8px] text-white font-medium">IMG</span>
                          </div>
                          {clip.assetId && (() => {
                            const asset = getAssetById(clip.assetId)
                            if (!asset) return null
                            return (
                              <div className={`rounded px-1 py-0.5 text-[8px] text-white font-medium ${asset.isImported ? 'bg-sf-dark-700/90' : 'bg-sf-accent/90'}`} title={asset.isImported ? 'Imported' : 'AI Generated'}>
                                {asset.isImported ? 'IMP' : 'AI'}
                              </div>
                            )
                          })()}
                        </div>
                        
                        {/* Bottom name strip (Resolve-style) */}
                        <div className="absolute inset-x-0 bottom-0 h-[14px] bg-[#3a6584]/95 border-t border-black/45 pointer-events-none" />
                        <div className="absolute bottom-[1px] left-1.5 right-12 z-10">
                          <span className="text-[10px] text-white/95 font-medium truncate block leading-none drop-shadow-sm">
                            {clip.name}
                          </span>
                        </div>

                        {/* Duration badge - bottom right */}
                        <div className="absolute bottom-[1px] right-1 px-1 py-0 rounded bg-black/55 text-[8px] text-white/90 font-mono leading-none">
                          {clip.duration.toFixed(1)}s
                        </div>
                        
                        {/* Keyframe markers */}
                        {clip.keyframes && Object.keys(clip.keyframes).length > 0 && (
                          <div className="absolute bottom-[15px] left-0 right-0 h-2 pointer-events-none">
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
                        
                        {/* Gradient overlay for top badges readability */}
                        <div className="absolute inset-x-0 top-[3px] h-6 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
                        
                        {/* AI/IMP tag - top left */}
                        <div className="absolute top-1 left-1.5 right-6 z-10 flex items-center gap-1.5 flex-wrap">
                          {clip.assetId && (() => {
                            const asset = getAssetById(clip.assetId)
                            if (!asset) return null
                            return (
                              <div className={`rounded px-1 py-0.5 text-[8px] text-white font-medium flex-shrink-0 ${asset.isImported ? 'bg-sf-dark-700/90' : 'bg-sf-accent/90'}`} title={asset.isImported ? 'Imported' : 'AI Generated'}>
                                {asset.isImported ? 'IMP' : 'AI'}
                              </div>
                            )
                          })()}
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
                        
                        {/* Bottom name strip (Resolve-style) */}
                        <div className="absolute inset-x-0 bottom-0 h-[14px] bg-[#3a6584]/95 border-t border-black/45 pointer-events-none" />
                        <div className="absolute bottom-[1px] left-1.5 right-12 z-10">
                          <span className="text-[10px] text-white/95 font-medium truncate block leading-none drop-shadow-sm">
                            {clip.name}
                          </span>
                        </div>

                        {/* Duration badge - bottom right */}
                        <div className="absolute bottom-[1px] right-1 px-1 py-0 rounded bg-black/55 text-[8px] text-white/90 font-mono leading-none">
                          {clip.duration.toFixed(1)}s
                        </div>
                        
                        {/* Keyframe markers */}
                        {clip.keyframes && Object.keys(clip.keyframes).length > 0 && (
                          <div className="absolute bottom-[15px] left-0 right-0 h-2 pointer-events-none">
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
                {renderAssetDropPreviewClip(track)}
                
                {/* Roll edit zones and transition buttons/overlays between adjacent clips */}
                {getAdjacentClips(track.id).map(({ clipA, clipB, transition, isOverlapping, gap }) => {
                  const clipAEnd = clipA.startTime + clipA.duration
                  const canRollEdit = isOverlapping || Math.abs(gap) <= ROLL_EDIT_MAX_GAP_SECONDS
                  
                  if (transition && isOverlapping) {
                    // Resolve-like transition tile over the overlap area.
                    const overlapStart = clipB.startTime
                    const overlapEnd = clipAEnd
                    const overlapWidth = (overlapEnd - overlapStart) * pixelsPerSecond
                    const overlapX = overlapStart * pixelsPerSecond
                    const isSelected = selectedTransitionId === transition.id
                    const transitionMeta = TRANSITION_TYPES.find(t => t.id === transition.type)
                    const transitionName = transitionMeta?.name || transition.type
                    const transitionFrames = Math.round(transition.duration * FRAME_RATE)

                    return (
                      <div
                        key={`transition-${clipA.id}-${clipB.id}`}
                        className={`absolute top-0 bottom-[14px] z-25 pointer-events-auto cursor-pointer group/trans ${
                          isSelected ? 'ring-2 ring-white/80 ring-inset shadow-[0_0_0_1px_rgba(255,255,255,0.4)]' : ''
                        }`}
                        style={{ left: `${overlapX}px`, width: `${overlapWidth}px` }}
                        onClick={(e) => {
                          e.stopPropagation()
                          selectTransition(transition.id)
                        }}
                        title={`${transitionName} (${transitionFrames}f)`}
                      >
                        {/* Resolve-style: dark grey-black overlay container with visible border */}
                        <div className="absolute inset-0 overflow-hidden border border-[#4a4a4a]/90 bg-[#1a1a1a]/85 rounded-[2px]">
                          {/* Left/Right preview panes (clip A + clip B) - visible through overlay */}
                          <div className="absolute inset-0 flex">
                            <div className="relative h-full w-1/2 overflow-hidden">
                              {renderTransitionPreviewPane(clipA, 'left')}
                              <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent pointer-events-none" />
                            </div>
                            <div className="relative h-full w-1/2 overflow-hidden">
                              {renderTransitionPreviewPane(clipB, 'right')}
                              <div className="absolute inset-0 bg-gradient-to-l from-black/30 to-transparent pointer-events-none" />
                            </div>
                          </div>

                          {/* Center dissolve gradient + center edit line */}
                          <div
                            className="absolute inset-0 pointer-events-none"
                            style={{
                              background: 'linear-gradient(90deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.06) 100%)'
                            }}
                          />
                          <div
                            className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[1px] bg-white/80 pointer-events-none"
                            style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.3)' }}
                          />

                          {/* Diagonal line: bottom-left to top-right (dissolve icon) - SVG so it's never clipped */}
                          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                            <line x1="0" y1="100" x2="100" y2="0" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                          </svg>

                          {/* Resolve-style top bar + vertical handle */}
                          <div className="absolute top-0 left-0 right-0 h-1.5 bg-white/95 rounded-t-[2px] pointer-events-none flex justify-center">
                            <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-1 h-2 bg-white rounded-sm shadow-sm" />
                          </div>

                          {/* Transition name - white text, prominent like Resolve */}
                          <div className="absolute top-2 left-1/2 -translate-x-1/2 max-w-[90%] px-2 py-0.5 text-[10px] font-medium text-white leading-none truncate drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                            {transitionName}
                          </div>

                          {/* Duration in grey oval/pill like Resolve */}
                          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] text-[#b0b0b0] whitespace-nowrap bg-[#2d2d2d]/95 px-2 py-0.5 rounded-full border border-[#404040]/80 leading-none">
                            {transitionFrames}f
                          </div>
                        </div>

                        {/* Resize handles (left/right) */}
                        <div
                          className={`absolute left-0 top-0 bottom-0 w-3 flex items-center justify-start z-30 cursor-ew-resize ${
                            isSelected ? 'opacity-100' : 'opacity-0 group-hover/trans:opacity-100'
                          }`}
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            setTransitionDragState({
                              transitionId: transition.id,
                              startX: e.clientX,
                              startDuration: transition.duration,
                              edge: 'left',
                            })
                          }}
                          title="Drag to adjust transition duration"
                        >
                          <div className="w-1 h-7 bg-white/90 rounded-r shadow-sm" />
                        </div>
                        <div
                          className={`absolute right-0 top-0 bottom-0 w-3 flex items-center justify-end z-30 cursor-ew-resize ${
                            isSelected ? 'opacity-100' : 'opacity-0 group-hover/trans:opacity-100'
                          }`}
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            setTransitionDragState({
                              transitionId: transition.id,
                              startX: e.clientX,
                              startDuration: transition.duration,
                              edge: 'right',
                            })
                          }}
                          title="Drag to adjust transition duration"
                        >
                          <div className="w-1 h-7 bg-white/90 rounded-l shadow-sm" />
                        </div>

                        {/* Remove transition button (hover/selected). */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            removeTransition(transition.id)
                          }}
                          className={`absolute top-1 right-1 w-5 h-5 rounded bg-sf-dark-800/90 border border-sf-dark-500 text-sf-text-muted hover:text-sf-error hover:border-sf-error transition-colors ${
                            isSelected ? 'opacity-100' : 'opacity-0 group-hover/trans:opacity-100'
                          }`}
                          title="Remove transition"
                        >
                          ×
                        </button>
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
                      style={{ left: `${editPointX - 6}px`, width: '12px' }}
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
                          selectTransition(existingTransition.id)
                        } else {
                          addTransition(clipA.id, clipB.id, type, duration)
                        }
                      }}
                    >
                      {/* Roll edit handle */}
                      <div
                        className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-1.5 flex items-center justify-center ${
                          canRollEdit ? 'cursor-ew-resize' : 'pointer-events-none cursor-default'
                        }`}
                        onMouseDown={(e) => {
                          if (!canRollEdit) return
                          e.stopPropagation()
                          e.preventDefault()
                          saveToHistory()
                          const clipATimeScale = getTimeScale(clipA)
                          const clipBTimeScale = getTimeScale(clipB)
                          const clipAOriginalTrimStart = clipA.trimStart || 0
                          const clipBOriginalTrimStart = clipB.trimStart || 0
                          const clipBOriginalTrimEnd = clipB.trimEnd
                            ?? clipB.sourceDuration
                            ?? (clipBOriginalTrimStart + clipB.duration * clipBTimeScale)
                          const clipASourceDuration = Number.isFinite(Number(clipA.sourceDuration))
                            ? Number(clipA.sourceDuration)
                            : null
                          setRollEditState({
                            clipAId: clipA.id,
                            clipBId: clipB.id,
                            startX: e.clientX,
                            originalEditPoint: clipAEnd,
                            clipAOriginalDuration: clipA.duration,
                            clipBOriginalStart: clipB.startTime,
                            clipBOriginalDuration: clipB.duration,
                            clipAOriginalTrimStart,
                            clipASourceDuration,
                            clipATimeScale,
                            clipBOriginalTrimStart,
                            clipBOriginalTrimEnd,
                            clipBTimeScale,
                          })
                        }}
                        title={canRollEdit ? 'Drag to roll edit (extend one clip, shorten the other)' : 'Roll edit available when clips touch'}
                      >
                        <div className={`w-0.5 h-full transition-colors ${canRollEdit ? 'bg-white/0 group-hover/edit:bg-yellow-400/70' : 'bg-white/0'}`} />
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
            const contentHeight = getTrackHeight(track)
            
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
                  <div className="absolute left-0 right-0 top-1/2 h-px bg-sf-dark-600/80 z-10 pointer-events-none" />
                )}
                {trackClips.map((clip) => {
                  const clipWidth = clip.duration * pixelsPerSecond
                  const clipUrl = getClipUrl(clip)
                  const clipAsset = clip.assetId ? getAssetById(clip.assetId) : null
                  const nativeWaveformInput = (
                    (clipAsset?.absolutePath || null)
                    || (isNativeMediaUrl(clipAsset?.playbackCacheUrl) ? clipAsset.playbackCacheUrl : null)
                    || (isNativeMediaUrl(clipAsset?.url) ? clipAsset.url : null)
                    || (isNativeMediaUrl(clip?.url) ? clip.url : null)
                  )
                  const waveformInput = nativeWaveformInput || clipUrl
                  
                  return (
                  <div
                    key={clip.id}
                    data-clip="true"
                    onMouseDown={(e) => handleClipDragStart(e, clip)}
                    onClick={(e) => handleClipClick(e, clip)}
                    onContextMenu={(e) => handleClipContextMenu(e, clip)}
                    className={`absolute top-0.5 bottom-0.5 rounded-sm cursor-grab group overflow-hidden ${
                      selectedClipIds.includes(clip.id) ? 'ring-2 ring-white ring-offset-1 ring-offset-sf-dark-900' : ''
                    } ${slipState?.clipId === clip.id ? 'ring-2 ring-yellow-400 cursor-ew-resize z-30' : ''} ${clipDragState && (clipDragState.clipId === clip.id || (selectedClipIds.includes(clip.id) && selectedClipIds.includes(clipDragState.clipId)))
                        ? 'ring-2 ring-sf-accent cursor-grabbing z-30' : ''}`}
                    style={{ 
                      left: `${clip.startTime * pixelsPerSecond}px`, 
                      width: `${clipWidth}px`,
                      minWidth: '24px',
                    }}
                  >
                    {/* Clip background + top accent (Resolve-style teal) */}
                    <div 
                      className="absolute inset-0"
                      style={{ backgroundColor: AUDIO_TRACK_BG }}
                    />
                    <div 
                      className="absolute inset-x-0 top-0 h-[3px]"
                      style={{ backgroundColor: AUDIO_CLIP_ACCENT }}
                    />
                    
                    {/* Real waveform visualization (Resolve-style colors) */}
                    <AudioWaveformBars
                      clip={clip}
                      clipWidth={clipWidth}
                      clipUrl={clipUrl}
                      waveformInput={waveformInput}
                    />
                    
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
                {renderAssetDropPreviewClip(track)}
                
                {/* Roll edit zones between adjacent audio clips */}
                {getAdjacentClips(track.id).map(({ clipA, clipB, isOverlapping, gap }) => {
                  const canRollEdit = isOverlapping || Math.abs(gap) <= ROLL_EDIT_MAX_GAP_SECONDS
                  if (!canRollEdit) return null
                  const editPointX = (clipA.startTime + clipA.duration) * pixelsPerSecond
                  
                  return (
                    <div
                      key={`edit-${clipA.id}-${clipB.id}`}
                      className="absolute top-0 bottom-0 z-20 group/edit"
                      style={{ left: `${editPointX - 6}px`, width: '12px' }}
                    >
                      {/* Roll edit handle */}
                      <div
                        className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-1.5 cursor-ew-resize flex items-center justify-center"
                        onMouseDown={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          saveToHistory()
                          const clipATimeScale = getTimeScale(clipA)
                          const clipBTimeScale = getTimeScale(clipB)
                          const clipAOriginalTrimStart = clipA.trimStart || 0
                          const clipBOriginalTrimStart = clipB.trimStart || 0
                          const clipBOriginalTrimEnd = clipB.trimEnd
                            ?? clipB.sourceDuration
                            ?? (clipBOriginalTrimStart + clipB.duration * clipBTimeScale)
                          const clipASourceDuration = Number.isFinite(Number(clipA.sourceDuration))
                            ? Number(clipA.sourceDuration)
                            : null
                          setRollEditState({
                            clipAId: clipA.id,
                            clipBId: clipB.id,
                            startX: e.clientX,
                            originalEditPoint: clipA.startTime + clipA.duration,
                            clipAOriginalDuration: clipA.duration,
                            clipBOriginalStart: clipB.startTime,
                            clipBOriginalDuration: clipB.duration,
                            clipAOriginalTrimStart,
                            clipASourceDuration,
                            clipATimeScale,
                            clipBOriginalTrimStart,
                            clipBOriginalTrimEnd,
                            clipBTimeScale,
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

          {/* Timeline Markers */}
          {markers.map((marker, index) => {
            const isSelected = marker.id === selectedMarkerId
            const markerLabel = marker.label?.trim() || `M${index + 1}`
            return (
              <div
                key={marker.id}
                className="absolute top-0 bottom-0 z-[18] pointer-events-none"
                style={{ left: `${marker.time * pixelsPerSecond}px` }}
              >
                <div className={`absolute top-0 bottom-0 w-px ${isSelected ? 'bg-yellow-300' : 'bg-yellow-500/70'}`} />
                <button
                  data-marker-handle="true"
                  className={`absolute -top-0.5 left-1/2 -translate-x-1/2 w-3.5 h-3.5 pointer-events-auto transition-colors ${
                    isSelected ? 'bg-yellow-300' : 'bg-yellow-500 hover:bg-yellow-400'
                  }`}
                  style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setPlayheadPosition(marker.time)
                    selectMarker(marker.id)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    removeMarker(marker.id)
                  }}
                  title={`${markerLabel} - ${formatTimelineTimecode(marker.time)} (right-click to remove)`}
                />
                {isSelected && (
                  <div className="absolute top-3.5 left-1.5 text-[9px] px-1 py-0.5 rounded bg-black/70 text-yellow-200 whitespace-nowrap pointer-events-none font-mono">
                    {markerLabel}
                  </div>
                )}
              </div>
            )
          })}
          
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
              const audioSectionHeight = 20
              const timeRulerHeight = 20
              const notchHeight = 10
              const totalVideoTracksHeight = videoTracks.reduce((sum, track) => sum + getTrackHeight(track), 0)
              const vi = videoTracks.findIndex(t => t.id === activeTrackId)
              const ai = audioTracks.findIndex(t => t.id === activeTrackId)
              let centerY = 0
              if (vi >= 0) {
                const track = videoTracks[vi]
                centerY = timeRulerHeight + getTrackOffset(videoTracks, vi) + getTrackHeight(track) / 2
              }
              else if (ai >= 0) {
                const track = audioTracks[ai]
                centerY = timeRulerHeight + totalVideoTracksHeight + audioSectionHeight + getTrackOffset(audioTracks, ai) + getTrackHeight(track) / 2
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
      
      {/* Transition menu: single "Add transition" — change type/duration in Inspector */}
      {transitionMenu && (() => {
        const maxDuration = getMaxTransitionDuration(transitionMenu.clipA.id, transitionMenu.clipB.id)
        const preferredSeconds = defaultTransitionFrames / FRAME_RATE
        const defaultSeconds = Math.min(preferredSeconds, Math.max(1 / FRAME_RATE, maxDuration))
        const canAdd = maxDuration >= 1 / FRAME_RATE

        return (
          <div
            className="fixed z-50 bg-sf-dark-800 border border-sf-dark-600 rounded-lg shadow-xl py-1 min-w-[180px]"
            style={{ 
              left: `${transitionMenu.x}px`, 
              top: `${transitionMenu.y}px`,
              transform: 'translate(-50%, 8px)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 text-[10px] text-sf-text-muted uppercase tracking-wider border-b border-sf-dark-600">
              Add transition
            </div>
            {canAdd ? (
              <button
                onClick={() => handleSelectTransition('dissolve', defaultSeconds)}
                className="w-full px-3 py-2.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
              >
                <span>Add transition</span>
              </button>
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
            const canUseMask = contextClip?.type === 'video' || contextClip?.type === 'image'
            if (!canUseMask) return null
            
            return (
              <>
                <div className="relative">
                  <button
                    onClick={() => setMaskSubmenuOpen((prev) => !prev)}
                    className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
                  >
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
                  <span>Flush Render Cache</span>
                </button>
                <div className="h-px bg-sf-dark-600 my-1" />
              </>
            )
          })()}
          <button
            onClick={() => handleContextMenuAction('split')}
            className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
            title="Split selected clip at playhead (or press X to split on active track)"
          >
            <span>Split at Playhead</span>
            <span className="ml-auto text-sf-text-muted text-[10px]">X</span>
          </button>
          
          <button
            onClick={() => handleContextMenuAction('duplicate')}
            className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
          >
            <span>Duplicate</span>
            <span className="ml-auto text-sf-text-muted text-[10px]">⌘D</span>
          </button>
          <button
            onClick={() => { copySelectedClips(); setClipContextMenu(null) }}
            className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors"
            title="Copy selected clips to paste at playhead"
          >
            <span>Copy</span>
            <span className="ml-auto text-sf-text-muted text-[10px]">Ctrl+C</span>
          </button>
          <button
            onClick={() => { pasteClipsAtPlayhead(activeTrackId, playheadPosition, assets); setClipContextMenu(null) }}
            disabled={!activeTrackId || copiedClips.length === 0}
            className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Paste at playhead on active track"
          >
            <span>Paste at Playhead</span>
            <span className="ml-auto text-sf-text-muted text-[10px]">Ctrl+V</span>
          </button>
          
          <div className="h-px bg-sf-dark-600 my-1" />
          
          <button
            onClick={() => handleContextMenuAction('delete')}
            className="w-full px-3 py-1.5 text-left text-xs text-sf-error hover:bg-sf-error/20 flex items-center gap-2 transition-colors"
          >
            <span>{selectedClipIds.length > 1 ? `Delete ${selectedClipIds.length} clips` : 'Delete'}</span>
            <span className="ml-auto text-sf-text-muted text-[10px]">Del</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default Timeline
