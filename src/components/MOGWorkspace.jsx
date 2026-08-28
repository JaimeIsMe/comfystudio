import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  FolderOpen,
  Layers3,
  MonitorPlay,
  Pause,
  Play,
  RefreshCcw,
  Search,
  Send,
  Sparkles,
  Star,
  Type,
  Wand2,
} from 'lucide-react'
import useAssetsStore from '../stores/assetsStore'
import useProjectStore from '../stores/projectStore'
import useTimelineStore from '../stores/timelineStore'
import {
  buildMogStateFromPreset,
  DEFAULT_MOG_PRESET_ID,
  getMogPresetById,
  MOG_ASPECT_RATIO_OPTIONS,
  MOG_BACKGROUND_OPTIONS,
  MOG_COLOR_PALETTES,
  MOG_DIRECTION_OPTIONS,
  MOG_EXIT_OPTIONS,
  MOG_LINE_OPTIONS,
  MOG_MASK_MODE_OPTIONS,
  MOG_PACE_OPTIONS,
  MOG_PRESET_CATEGORIES,
  MOG_PRESETS,
  MOG_TEXT_GRANULARITY_OPTIONS,
} from '../utils/mogPresets'
import {
  generateMogVideoBlob,
  renderMogFrame,
} from '../utils/mogRenderer'
import { captureTimelineFrameAt } from '../utils/captureTimelineFrame'
import { isElectron, writeGeneratedOverlayToProject } from '../services/fileSystem'
import FontFamilyPicker from './FontFamilyPicker'

const MOG_FOLDER_NAME = 'MoGraph Rendered Assets'
const MOG_FAVORITES_STORAGE_KEY = 'comfystudio-mog-favorite-presets'
const MOG_RECENTS_STORAGE_KEY = 'comfystudio-mog-recent-presets'
const MAX_RECENT_PRESETS = 8
const MOTION_FAMILY_LABELS = {
  slide: 'Slide',
  wipe: 'Wipe',
  pop: 'Pop',
  reveal: 'Reveal',
  boxBuild: 'Box Build',
  underlineGrow: 'Underline',
  drift: 'Drift',
  trackIn: 'Track In',
  stagger: 'Stagger',
  splitReveal: 'Split Reveal',
  inflateMorph: 'Inflate Morph',
}
const VALID_MOG_PRESET_IDS = new Set(MOG_PRESETS.map((preset) => preset.id))
const CHARACTER_FX_TINT_OPTIONS = [
  { id: 'none', label: 'No Tint' },
  { id: 'accent', label: 'Accent' },
  { id: 'accent2', label: 'Accent 2' },
]

function readStoredPresetIds(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey)
    const parsed = JSON.parse(raw || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id) => typeof id === 'string' && VALID_MOG_PRESET_IDS.has(id))
  } catch (_) {
    return []
  }
}

function countVisibleHeadlineCharacters(text) {
  return Array.from(String(text || '')).filter((char) => /\S/.test(char)).length
}

function resolveAspectRatioSize(baseWidth, baseHeight, aspectId) {
  const fallbackWidth = Math.max(1, Math.round(Number(baseWidth) || 1920))
  const fallbackHeight = Math.max(1, Math.round(Number(baseHeight) || 1080))
  const preset = MOG_ASPECT_RATIO_OPTIONS.find((option) => option.id === aspectId) || MOG_ASPECT_RATIO_OPTIONS[0]
  const shortEdge = Math.max(512, Math.min(fallbackWidth, fallbackHeight))

  if (preset.id === '9:16') {
    return {
      width: shortEdge,
      height: Math.round((shortEdge * preset.height) / preset.width),
      label: preset.label,
    }
  }

  if (preset.id === '1:1') {
    return {
      width: shortEdge,
      height: shortEdge,
      label: preset.label,
    }
  }

  return {
    width: Math.round((shortEdge * preset.width) / preset.height),
    height: shortEdge,
    label: preset.label,
  }
}

function StageBackground({ mode, timelineStillUrl, isTimelineStillLoading }) {
  const style = useMemo(() => {
    if (mode === 'checker') {
      return {
        backgroundColor: '#101726',
        backgroundImage: `
          linear-gradient(45deg, rgba(255,255,255,0.06) 25%, transparent 25%),
          linear-gradient(-45deg, rgba(255,255,255,0.06) 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.06) 75%),
          linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.06) 75%)
        `,
        backgroundSize: '28px 28px',
        backgroundPosition: '0 0, 0 14px, 14px -14px, -14px 0px',
      }
    }

    if (mode === 'studio' || mode === 'timelineStill') {
      return {
        background:
          'radial-gradient(circle at 50% 0%, rgba(148, 163, 184, 0.12), transparent 26%), linear-gradient(180deg, #060B16 0%, #0B1220 58%, #111827 100%)',
      }
    }

    return {
      background:
        'linear-gradient(180deg, #060B16 0%, #0B1220 58%, #111827 100%)',
    }
  }, [mode])

  return (
    <>
      {mode === 'timelineStill' && timelineStillUrl ? (
        <>
          <div
            className="absolute inset-0 scale-[1.03] bg-center bg-cover"
            style={{
              backgroundImage: `url("${timelineStillUrl}")`,
              filter: 'blur(10px) saturate(0.7) brightness(0.42)',
            }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.18)_0%,rgba(2,6,23,0.4)_42%,rgba(2,6,23,0.78)_100%)]" />
        </>
      ) : (
        <div className="absolute inset-0" style={style} />
      )}
      {mode === 'landscape' && (
        <>
          <div className="absolute inset-x-0 bottom-[10%] h-[28%] bg-sf-dark-950/45 blur-3xl" />
          <div className="absolute left-[8%] bottom-[20%] w-[32%] h-[26%] rounded-full bg-sf-dark-950/30 blur-3xl" />
          <div className="absolute right-[10%] bottom-[22%] w-[34%] h-[24%] rounded-full bg-sf-dark-950/28 blur-3xl" />
        </>
      )}
      {mode === 'timelineStill' && !timelineStillUrl && !isTimelineStillLoading && (
        <div className="absolute right-4 bottom-4 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/55">
          No timeline still available
        </div>
      )}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_52%,rgba(2,6,23,0.4)_100%)]" />
    </>
  )
}

function Section({ title, icon: Icon, open, onToggle, children }) {
  return (
    <div className="rounded-2xl border border-sf-dark-700 bg-sf-dark-900/80 overflow-hidden shadow-[0_16px_32px_rgba(0,0,0,0.18)]">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-sf-dark-800/80 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-sf-text-primary">
          <Icon className="w-4 h-4 text-sf-accent" />
          {title}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-sf-text-muted" />
        ) : (
          <ChevronDown className="w-4 h-4 text-sf-text-muted" />
        )}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  )
}

function ChoiceChips({ options, value, onChange, size = 'sm' }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded-full border px-3 ${size === 'xs' ? 'py-1 text-[10px]' : 'py-1.5 text-xs'} transition-colors ${
            value === option.id
              ? 'border-sf-accent bg-sf-accent/20 text-sf-text-primary'
              : 'border-sf-dark-600 bg-sf-dark-800 text-sf-text-muted hover:border-sf-dark-500 hover:text-sf-text-primary'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function MOGWorkspace() {
  const defaultPreset = useMemo(() => getMogPresetById(DEFAULT_MOG_PRESET_ID), [])
  const [selectedPresetId, setSelectedPresetId] = useState(defaultPreset.id)
  const [hoveredPresetId, setHoveredPresetId] = useState(null)
  const [presetSearch, setPresetSearch] = useState('')
  const [activePresetView, setActivePresetView] = useState('all')
  const [activePresetCategory, setActivePresetCategory] = useState('all')
  const [favoritePresetIds, setFavoritePresetIds] = useState(() => readStoredPresetIds(MOG_FAVORITES_STORAGE_KEY))
  const [recentPresetIds, setRecentPresetIds] = useState(() => readStoredPresetIds(MOG_RECENTS_STORAGE_KEY))
  const [controls, setControls] = useState(() => buildMogStateFromPreset(defaultPreset))
  const [isPlaying, setIsPlaying] = useState(true)
  const [previewTime, setPreviewTime] = useState(0)
  const [isRendering, setIsRendering] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [textCustomized, setTextCustomized] = useState(false)
  const [assetNameCustomized, setAssetNameCustomized] = useState(false)
  const [openSections, setOpenSections] = useState({
    quick: true,
    style: true,
    character: true,
    motion: true,
    output: true,
  })

  const previewCanvasRef = useRef(null)
  const stageViewportRef = useRef(null)
  const animationFrameRef = useRef(null)
  const lastFrameTimeRef = useRef(null)
  const previewFailedRef = useRef(false)
  const [stageViewportSize, setStageViewportSize] = useState({ width: 0, height: 0 })
  const [timelineStillUrl, setTimelineStillUrl] = useState(null)
  const [isTimelineStillLoading, setIsTimelineStillLoading] = useState(false)
  const timelineStillUrlRef = useRef(null)

  const {
    addAsset,
    addFolder,
    folders,
    setPreviewMode,
  } = useAssetsStore()

  const {
    currentProjectHandle,
    getCurrentTimelineSettings,
  } = useProjectStore()
  const playheadPosition = useTimelineStore((state) => state.playheadPosition)

  const timelineSettings = getCurrentTimelineSettings()
  const aspectSize = useMemo(
    () => resolveAspectRatioSize(
      timelineSettings?.width || 1920,
      timelineSettings?.height || 1080,
      controls.aspectRatio
    ),
    [controls.aspectRatio, timelineSettings?.height, timelineSettings?.width]
  )
  const renderWidth = aspectSize.width
  const renderHeight = aspectSize.height
  const renderFps = timelineSettings?.fps || 24
  const previewMaxDimension = controls.aspectRatio === '9:16' ? 960 : 1280
  const previewScale = Math.min(1, previewMaxDimension / Math.max(renderWidth, renderHeight))
  const previewWidth = Math.max(controls.aspectRatio === '9:16' ? 360 : 520, Math.round(renderWidth * previewScale))
  const previewHeight = Math.max(controls.aspectRatio === '9:16' ? 640 : 320, Math.round(renderHeight * previewScale))
  const duration = Math.max(1, Number(controls.duration) || 3.5)
  const stageFrameSize = useMemo(() => {
    if (!stageViewportSize.width || !stageViewportSize.height) {
      return { width: previewWidth, height: previewHeight }
    }

    const scale = Math.min(
      stageViewportSize.width / renderWidth,
      stageViewportSize.height / renderHeight
    )

    return {
      width: Math.max(1, Math.floor(renderWidth * scale)),
      height: Math.max(1, Math.floor(renderHeight * scale)),
    }
  }, [
    previewHeight,
    previewWidth,
    renderHeight,
    renderWidth,
    stageViewportSize.height,
    stageViewportSize.width,
  ])

  const selectedPreset = useMemo(() => getMogPresetById(selectedPresetId), [selectedPresetId])
  const activeStagePreset = selectedPreset
  const activeStageControls = controls
  const headlineVisibleCharacterCount = useMemo(
    () => countVisibleHeadlineCharacters(controls.headline),
    [controls.headline]
  )
  const headlineCharacterFx = useMemo(
    () => (Array.isArray(controls.headlineCharacterFx) ? controls.headlineCharacterFx : []),
    [controls.headlineCharacterFx]
  )

  const toggleSection = useCallback((key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const replaceTimelineStillUrl = useCallback((nextUrl) => {
    setTimelineStillUrl((prev) => {
      if (prev && prev !== nextUrl && prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev)
      }
      timelineStillUrlRef.current = nextUrl || null
      return nextUrl || null
    })
  }, [])

  const applyPalette = useCallback((paletteId) => {
    const palette = MOG_COLOR_PALETTES.find((entry) => entry.id === paletteId)
    if (!palette) return
    setControls((prev) => ({
      ...prev,
      textColor: palette.textColor,
      accentColor: palette.accentColor,
      accentColor2: palette.accentColor2,
      boxColor: palette.boxColor,
    }))
  }, [])

  const selectPreset = useCallback((presetId) => {
    const preset = getMogPresetById(presetId)
    setSelectedPresetId(preset.id)
    setControls((prev) => {
      const nextBase = buildMogStateFromPreset(preset)
      return {
        ...nextBase,
        headline: textCustomized ? prev.headline : nextBase.headline,
        subheadline: textCustomized ? prev.subheadline : nextBase.subheadline,
        kicker: textCustomized ? prev.kicker : nextBase.kicker,
        duration: prev.duration,
        animationDurationScale: prev.animationDurationScale,
        backgroundMode: prev.backgroundMode,
        aspectRatio: prev.aspectRatio,
        assetName: assetNameCustomized ? prev.assetName : nextBase.assetName,
      }
    })
    setPreviewTime(0)
    setIsPlaying(true)
  }, [assetNameCustomized, textCustomized])

  const updateControl = useCallback((key, value) => {
    setControls((prev) => ({ ...prev, [key]: value }))
  }, [])

  const updateTextControl = useCallback((key, value) => {
    setTextCustomized(true)
    setControls((prev) => ({ ...prev, [key]: value }))
  }, [])

  const updateAssetName = useCallback((value) => {
    setAssetNameCustomized(true)
    setControls((prev) => ({ ...prev, assetName: value }))
  }, [])

  const addHeadlineCharacterFx = useCallback(() => {
    setControls((prev) => {
      const currentRules = Array.isArray(prev.headlineCharacterFx) ? prev.headlineCharacterFx : []
      const visibleCount = Math.max(1, countVisibleHeadlineCharacters(prev.headline))
      const lastEnd = currentRules.length > 0
        ? Math.max(1, Math.round(Number(currentRules[currentRules.length - 1]?.end) || 1))
        : 0
      const start = Math.min(visibleCount, Math.max(1, lastEnd + 1))
      const end = Math.min(visibleCount, start + 1)

      return {
        ...prev,
        headlineCharacterFx: [
          ...currentRules,
          {
            id: `headline-fx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            start,
            end,
            xOffset: 0,
            yOffset: -18,
            scale: 1.12,
            opacity: 1,
            delay: 0.04,
            rotation: 0,
            tint: 'accent',
          },
        ],
      }
    })
  }, [])

  const updateHeadlineCharacterFx = useCallback((ruleId, key, value) => {
    setControls((prev) => ({
      ...prev,
      headlineCharacterFx: (Array.isArray(prev.headlineCharacterFx) ? prev.headlineCharacterFx : []).map((rule) => (
        rule.id === ruleId ? { ...rule, [key]: value } : rule
      )),
    }))
  }, [])

  const removeHeadlineCharacterFx = useCallback((ruleId) => {
    setControls((prev) => ({
      ...prev,
      headlineCharacterFx: (Array.isArray(prev.headlineCharacterFx) ? prev.headlineCharacterFx : []).filter((rule) => rule.id !== ruleId),
    }))
  }, [])

  const toggleFavoritePreset = useCallback((presetId) => {
    setFavoritePresetIds((prev) => (
      prev.includes(presetId)
        ? prev.filter((id) => id !== presetId)
        : [presetId, ...prev]
    ))
  }, [])

  const resetToPreset = useCallback(() => {
    setTextCustomized(false)
    setAssetNameCustomized(false)
    setControls((prev) => ({
      ...buildMogStateFromPreset(selectedPreset),
      duration: prev.duration,
      backgroundMode: prev.backgroundMode,
      aspectRatio: prev.aspectRatio,
    }))
    setPreviewTime(0)
    setIsPlaying(true)
    setStatusMessage('')
    setError('')
  }, [selectedPreset])

  const ensureMogFolder = useCallback(() => {
    const existing = folders.find((folder) => folder.name === MOG_FOLDER_NAME && !folder.parentId)
    if (existing) return existing.id
    const created = addFolder({ name: MOG_FOLDER_NAME, parentId: null })
    return created?.id || null
  }, [addFolder, folders])

  const handleSendToAssets = useCallback(async () => {
    setIsRendering(true)
    setError('')
    setStatusMessage('')

    try {
      const blob = await generateMogVideoBlob({
        preset: selectedPreset,
        controls,
        width: renderWidth,
        height: renderHeight,
        duration,
        fps: renderFps,
      })

      const folderId = ensureMogFolder()
      const suggestedName = (controls.assetName || selectedPreset.name || 'mog_asset').trim()
      const settings = {
        width: renderWidth,
        height: renderHeight,
        duration,
        fps: renderFps,
        aspectRatio: controls.aspectRatio,
        animationDurationScale: controls.animationDurationScale,
        textGranularity: controls.textGranularity,
        staggerStep: controls.staggerStep,
        blurAmount: controls.blurAmount,
        trackingPull: controls.trackingPull,
        overshootAmount: controls.overshootAmount,
        maskMode: controls.maskMode,
        inflateAmount: controls.inflateAmount,
        headlineCharacterFx: controls.headlineCharacterFx,
        hasAlpha: true,
        source: 'mog',
        overlayKind: 'mog',
        mogPresetId: selectedPreset.id,
        mogTemplateId: selectedPreset.templateId,
      }

      if (currentProjectHandle && isElectron() && typeof currentProjectHandle === 'string') {
        const persisted = await writeGeneratedOverlayToProject(
          currentProjectHandle,
          blob,
          suggestedName,
          'video',
          settings
        )

        addAsset({
          ...persisted,
          folderId,
          settings: {
            ...persisted.settings,
            ...settings,
          },
        })
      } else {
        const url = URL.createObjectURL(blob)
        addAsset({
          name: suggestedName,
          type: 'video',
          url,
          folderId,
          mimeType: blob.type || 'video/webm',
          size: blob.size,
          isImported: false,
          hasAudio: false,
          audioEnabled: false,
          duration,
          settings,
        })
      }

      setPreviewMode('asset')
      setStatusMessage(`Sent "${suggestedName}" to Assets.`)
    } catch (renderError) {
      setError(renderError?.message || 'Could not render this MoGraph asset.')
    } finally {
      setIsRendering(false)
    }
  }, [
    addAsset,
    controls,
    currentProjectHandle,
    duration,
    ensureMogFolder,
    renderFps,
    renderHeight,
    renderWidth,
    selectedPreset,
    setPreviewMode,
  ])

  useEffect(() => {
    setPreviewTime(0)
    setPreviewError('')
    previewFailedRef.current = false
  }, [activeStagePreset?.id, activeStageControls.duration, previewHeight, previewWidth])

  useEffect(() => {
    const viewport = stageViewportRef.current
    if (!viewport) return undefined

    const updateViewportSize = () => {
      const bounds = viewport.getBoundingClientRect()
      const nextWidth = Math.max(0, Math.floor(bounds.width))
      const nextHeight = Math.max(0, Math.floor(bounds.height))

      setStageViewportSize((prev) => (
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight }
      ))
    }

    updateViewportSize()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportSize)
      return () => window.removeEventListener('resize', updateViewportSize)
    }

    const observer = new ResizeObserver(() => updateViewportSize())
    observer.observe(viewport)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (controls.backgroundMode !== 'timelineStill') {
      setIsTimelineStillLoading(false)
      return undefined
    }

    let cancelled = false
    setIsTimelineStillLoading(true)

    captureTimelineFrameAt(playheadPosition)
      .then((result) => {
        if (cancelled) {
          if (result?.blobUrl && result.blobUrl.startsWith('blob:')) {
            URL.revokeObjectURL(result.blobUrl)
          }
          return
        }
        replaceTimelineStillUrl(result?.blobUrl || null)
      })
      .catch(() => {
        if (!cancelled) {
          replaceTimelineStillUrl(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsTimelineStillLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [controls.backgroundMode, playheadPosition, replaceTimelineStillUrl])

  useEffect(() => () => {
    const currentUrl = timelineStillUrlRef.current
    if (currentUrl && currentUrl.startsWith('blob:')) {
      URL.revokeObjectURL(currentUrl)
    }
  }, [])

  const drawPreviewFrame = useCallback((timeValue) => {
    const canvas = previewCanvasRef.current
    if (!canvas) return
    canvas.width = previewWidth
    canvas.height = previewHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      renderMogFrame({
        ctx,
        width: previewWidth,
        height: previewHeight,
        preset: activeStagePreset,
        controls: activeStageControls,
        time: timeValue,
        transparent: true,
      })

      if (previewFailedRef.current) {
        previewFailedRef.current = false
        setPreviewError('')
      }
    } catch (previewRenderError) {
      if (!previewFailedRef.current) {
        previewFailedRef.current = true
        console.error('MoGraph preview failed to render.', previewRenderError)
        setPreviewError(previewRenderError?.message || 'MoGraph preview failed to render.')
        setIsPlaying(false)
      }
    }
  }, [
    activeStageControls,
    activeStagePreset,
    previewHeight,
    previewWidth,
  ])

  useEffect(() => {
    drawPreviewFrame(previewTime)
  }, [drawPreviewFrame, previewTime])

  useEffect(() => {
    setRecentPresetIds((prev) => (
      [selectedPresetId, ...prev.filter((id) => id !== selectedPresetId)].slice(0, MAX_RECENT_PRESETS)
    ))
  }, [selectedPresetId])

  useEffect(() => {
    try {
      localStorage.setItem(MOG_FAVORITES_STORAGE_KEY, JSON.stringify(favoritePresetIds))
    } catch (_) {
      // Ignore local persistence issues in the renderer.
    }
  }, [favoritePresetIds])

  useEffect(() => {
    try {
      localStorage.setItem(MOG_RECENTS_STORAGE_KEY, JSON.stringify(recentPresetIds))
    } catch (_) {
      // Ignore local persistence issues in the renderer.
    }
  }, [recentPresetIds])

  useEffect(() => {
    if (!isPlaying) return undefined

    const tick = (timestamp) => {
      if (!lastFrameTimeRef.current) {
        lastFrameTimeRef.current = timestamp
      }
      const deltaSeconds = (timestamp - lastFrameTimeRef.current) / 1000
      lastFrameTimeRef.current = timestamp
      setPreviewTime((prev) => {
        const next = (prev + deltaSeconds) % Math.max(1, Number(activeStageControls.duration) || 3.5)
        drawPreviewFrame(next)
        return next
      })
      animationFrameRef.current = window.requestAnimationFrame(tick)
    }

    animationFrameRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      lastFrameTimeRef.current = null
    }
  }, [
    activeStageControls.duration,
    drawPreviewFrame,
    activeStageControls,
    isPlaying,
  ])

  const activePaletteId = useMemo(() => {
    const match = MOG_COLOR_PALETTES.find((palette) => (
      palette.textColor === controls.textColor
      && palette.accentColor === controls.accentColor
      && palette.accentColor2 === controls.accentColor2
      && palette.boxColor === controls.boxColor
    ))
    return match?.id || null
  }, [controls.accentColor, controls.accentColor2, controls.boxColor, controls.textColor])

  const presetCategoryCounts = useMemo(() => {
    const counts = new Map()
    MOG_PRESET_CATEGORIES.forEach((category) => counts.set(category.id, 0))
    MOG_PRESETS.forEach((preset) => {
      counts.set(preset.categoryId, (counts.get(preset.categoryId) || 0) + 1)
    })
    return counts
  }, [])

  const searchQuery = presetSearch.trim().toLowerCase()

  const matchesPresetBrowser = useCallback((preset, categoryLabel = '') => {
    if (activePresetView === 'all' && activePresetCategory !== 'all' && preset.categoryId !== activePresetCategory) {
      return false
    }
    if (!searchQuery) return true

    const motionLabel = (MOTION_FAMILY_LABELS[preset.motionFamily] || preset.motionFamily).toLowerCase()
    const characterFxLabel = Array.isArray(preset.headlineCharacterFx) && preset.headlineCharacterFx.length > 0
      ? 'character fx letter fx'
      : ''
    const haystack = [
      categoryLabel,
      preset.name,
      preset.kicker,
      preset.headline,
      preset.subheadline,
      preset.accentStyle,
      motionLabel,
      characterFxLabel,
    ].join(' ').toLowerCase()

    return haystack.includes(searchQuery)
  }, [activePresetCategory, activePresetView, searchQuery])

  const favoritePresetSet = useMemo(() => new Set(favoritePresetIds), [favoritePresetIds])

  const favoritePresets = useMemo(() => (
    favoritePresetIds
      .map((id) => MOG_PRESETS.find((preset) => preset.id === id))
      .filter(Boolean)
      .filter((preset) => {
        const category = MOG_PRESET_CATEGORIES.find((entry) => entry.id === preset.categoryId)
        return matchesPresetBrowser(preset, category?.label || '')
      })
  ), [favoritePresetIds, matchesPresetBrowser])

  const recentPresets = useMemo(() => (
    recentPresetIds
      .map((id) => MOG_PRESETS.find((preset) => preset.id === id))
      .filter(Boolean)
      .filter((preset) => {
        const category = MOG_PRESET_CATEGORIES.find((entry) => entry.id === preset.categoryId)
        return matchesPresetBrowser(preset, category?.label || '')
      })
  ), [matchesPresetBrowser, recentPresetIds])

  const visiblePresetCategories = useMemo(() => {

    return MOG_PRESET_CATEGORIES.map((category) => {
      const presets = MOG_PRESETS.filter((preset) => (
        preset.categoryId === category.id && matchesPresetBrowser(preset, category.label)
      ))

      return { ...category, presets }
    }).filter((category) => category.presets.length > 0)
  }, [matchesPresetBrowser])

  const visiblePresetCount = useMemo(
    () => {
      if (activePresetView === 'favorites') return favoritePresets.length
      if (activePresetView === 'recent') return recentPresets.length
      return visiblePresetCategories.reduce((sum, category) => sum + category.presets.length, 0)
    },
    [activePresetView, favoritePresets.length, recentPresets.length, visiblePresetCategories]
  )

  const renderPresetRow = useCallback((preset, metaLabel = null) => {
    const isSelected = preset.id === selectedPresetId
    const isHovered = preset.id === hoveredPresetId
    const isFavorite = favoritePresetSet.has(preset.id)
    const hasCharacterFx = Array.isArray(preset.headlineCharacterFx) && preset.headlineCharacterFx.length > 0
    const motionLabel = MOTION_FAMILY_LABELS[preset.motionFamily] || preset.motionFamily
    const descriptor = preset.subheadline || preset.headline || ''

    return (
      <div
        key={preset.id}
        onMouseEnter={() => setHoveredPresetId(preset.id)}
        onMouseLeave={() => setHoveredPresetId((prev) => (prev === preset.id ? null : prev))}
        className={`group relative w-full rounded-2xl border px-3 py-3 transition-all ${
          isSelected
            ? 'border-sf-accent bg-sf-dark-900/95 shadow-[0_0_0_1px_rgba(45,212,191,0.22)]'
            : isHovered
              ? hasCharacterFx
                ? 'border-fuchsia-400/40 bg-sf-dark-900 shadow-[0_0_0_1px_rgba(232,121,249,0.12)]'
                : 'border-sf-dark-500 bg-sf-dark-900'
              : hasCharacterFx
                ? 'border-fuchsia-500/20 bg-[linear-gradient(180deg,rgba(17,24,39,0.92),rgba(9,14,27,0.94))] hover:border-fuchsia-400/35 hover:bg-sf-dark-900/95'
                : 'border-sf-dark-700 bg-sf-dark-950/65 hover:border-sf-dark-500 hover:bg-sf-dark-900/90'
        }`}
      >
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => selectPreset(preset.id)}
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-medium text-sf-text-primary">{preset.name}</div>
              {isSelected && (
                <div className="rounded-full bg-sf-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-black">
                  Selected
                </div>
              )}
              {metaLabel && (
                <div className="rounded-full border border-sf-dark-600 bg-sf-dark-900 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">
                  {metaLabel}
                </div>
              )}
              {hasCharacterFx && (
                <div className="inline-flex items-center gap-1 rounded-full border border-fuchsia-400/30 bg-fuchsia-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-fuchsia-200">
                  <Wand2 className="h-3 w-3" />
                  Character FX
                </div>
              )}
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-sf-text-muted">
              {descriptor}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              {[preset.accentColor, preset.accentColor2, preset.boxColor].map((color) => (
                <span
                  key={`${preset.id}-${color}`}
                  className="h-2.5 w-2.5 rounded-full border border-white/10"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </button>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <button
              type="button"
              aria-label={isFavorite ? `Remove ${preset.name} from favorites` : `Add ${preset.name} to favorites`}
              onClick={() => toggleFavoritePreset(preset.id)}
              className={`rounded-full border p-1.5 transition-colors ${
                isFavorite
                  ? 'border-yellow-400/50 bg-yellow-400/15 text-yellow-300'
                  : 'border-sf-dark-600 bg-sf-dark-900 text-sf-text-muted hover:border-sf-dark-500 hover:text-sf-text-primary'
              }`}
            >
              <Star className="h-3.5 w-3.5" fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
            <div className="rounded-full border border-white/8 bg-black/25 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-sf-text-primary/85">
              {motionLabel}
            </div>
            {hasCharacterFx && (
              <div className="rounded-full border border-fuchsia-400/25 bg-fuchsia-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-fuchsia-200">
                Letter FX
              </div>
            )}
            <div className="rounded-full border border-sf-dark-600 bg-sf-dark-900 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">
              {preset.accentStyle}
            </div>
          </div>
        </div>
      </div>
    )
  }, [favoritePresetSet, hoveredPresetId, selectPreset, selectedPresetId, toggleFavoritePreset])

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.12),transparent_24%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.16),transparent_26%),linear-gradient(180deg,#050816_0%,#07101D_45%,#030712_100%)]">
      <div className="h-full grid grid-cols-[290px_minmax(0,1fr)_360px]">
        <aside className="min-h-0 overflow-hidden border-r border-sf-dark-700/80 bg-sf-dark-950/70 backdrop-blur">
          <div className="h-full flex flex-col">
            <div className="px-4 py-4 border-b border-sf-dark-700/80">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-sf-accent/80">
                <Sparkles className="w-3.5 h-3.5" />
                Browse & Discover
              </div>
              <h2 className="mt-2 text-2xl font-semibold text-sf-text-primary">Preset Gallery</h2>
              <p className="mt-1 text-xs text-sf-text-muted">
                Browse by category, search by vibe, and click a preset to load it into the stage.
              </p>
              <div className="mt-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sf-text-muted" />
                  <input
                    type="text"
                    value={presetSearch}
                    onChange={(e) => setPresetSearch(e.target.value)}
                    placeholder="Search presets, motion, keywords"
                    className="w-full rounded-xl border border-sf-dark-700 bg-sf-dark-900/90 pl-9 pr-3 py-2 text-sm text-sf-text-primary placeholder:text-sf-text-muted/70 focus:border-sf-accent focus:outline-none"
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActivePresetView('all')}
                    className={`rounded-full border px-3 py-1.5 text-[11px] transition-colors ${
                      activePresetView === 'all'
                        ? 'border-sf-accent bg-sf-accent text-black'
                        : 'border-sf-dark-700 bg-sf-dark-900/85 text-sf-text-muted hover:border-sf-dark-500 hover:text-sf-text-primary'
                    }`}
                  >
                    All
                    <span className="ml-1.5 text-[10px] opacity-80">{MOG_PRESETS.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePresetView('favorites')}
                    className={`rounded-full border px-3 py-1.5 text-[11px] transition-colors ${
                      activePresetView === 'favorites'
                        ? 'border-sf-accent bg-sf-accent text-black'
                        : 'border-sf-dark-700 bg-sf-dark-900/85 text-sf-text-muted hover:border-sf-dark-500 hover:text-sf-text-primary'
                    }`}
                  >
                    Favorites
                    <span className="ml-1.5 text-[10px] opacity-80">{favoritePresetIds.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePresetView('recent')}
                    className={`rounded-full border px-3 py-1.5 text-[11px] transition-colors ${
                      activePresetView === 'recent'
                        ? 'border-sf-accent bg-sf-accent text-black'
                        : 'border-sf-dark-700 bg-sf-dark-900/85 text-sf-text-muted hover:border-sf-dark-500 hover:text-sf-text-primary'
                    }`}
                  >
                    Recent
                    <span className="ml-1.5 text-[10px] opacity-80">{recentPresetIds.length}</span>
                  </button>
                </div>
                {activePresetView === 'all' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setActivePresetCategory('all')}
                      className={`rounded-full border px-3 py-1.5 text-[11px] transition-colors ${
                        activePresetCategory === 'all'
                          ? 'border-sf-accent bg-sf-accent text-black'
                          : 'border-sf-dark-700 bg-sf-dark-900/85 text-sf-text-muted hover:border-sf-dark-500 hover:text-sf-text-primary'
                      }`}
                    >
                      All Presets
                      <span className="ml-1.5 text-[10px] opacity-80">{MOG_PRESETS.length}</span>
                    </button>
                    {MOG_PRESET_CATEGORIES.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setActivePresetCategory(category.id)}
                      className={`rounded-full border px-3 py-1.5 text-[11px] transition-colors ${
                        activePresetCategory === category.id
                          ? 'border-sf-accent bg-sf-accent text-black'
                          : 'border-sf-dark-700 bg-sf-dark-900/85 text-sf-text-muted hover:border-sf-dark-500 hover:text-sf-text-primary'
                      }`}
                    >
                      {category.label}
                      <span className="ml-1.5 text-[10px] opacity-80">{presetCategoryCounts.get(category.id) || 0}</span>
                    </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-sf-text-muted">
                <span>
                  {activePresetView === 'favorites'
                    ? 'Favorite Presets'
                    : activePresetView === 'recent'
                      ? 'Recent Presets'
                      : 'Visible Presets'}
                </span>
                <span>{visiblePresetCount}</span>
              </div>
              {activePresetView === 'favorites' && favoritePresets.length === 0 && (
                <div className="rounded-2xl border border-sf-dark-700 bg-sf-dark-900/70 px-4 py-5 text-sm text-sf-text-muted">
                  No favorite presets match that search yet.
                </div>
              )}
              {activePresetView === 'recent' && recentPresets.length === 0 && (
                <div className="rounded-2xl border border-sf-dark-700 bg-sf-dark-900/70 px-4 py-5 text-sm text-sf-text-muted">
                  No recent presets match that search yet.
                </div>
              )}
              {activePresetView === 'all' && visiblePresetCategories.length === 0 && (
                <div className="rounded-2xl border border-sf-dark-700 bg-sf-dark-900/70 px-4 py-5 text-sm text-sf-text-muted">
                  No presets match that search yet. Try a different keyword or switch back to `All Presets`.
                </div>
              )}
              {activePresetView === 'favorites' && favoritePresets.length > 0 && (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Star className="h-3.5 w-3.5 text-yellow-300" fill="currentColor" />
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sf-text-muted">
                        Favorites
                      </h3>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {favoritePresets.map((preset) => {
                      const categoryLabel = MOG_PRESET_CATEGORIES.find((category) => category.id === preset.categoryId)?.label || 'Preset'
                      return renderPresetRow(preset, categoryLabel)
                    })}
                  </div>
                </section>
              )}
              {activePresetView === 'recent' && recentPresets.length > 0 && (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Clock3 className="h-3.5 w-3.5 text-sf-accent/80" />
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sf-text-muted">
                        Recently Used
                      </h3>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {recentPresets.map((preset) => {
                      const categoryLabel = MOG_PRESET_CATEGORIES.find((category) => category.id === preset.categoryId)?.label || 'Preset'
                      return renderPresetRow(preset, categoryLabel)
                    })}
                  </div>
                </section>
              )}
              {activePresetView === 'all' && visiblePresetCategories.map((category) => {
                const presets = category.presets
                return (
                  <section key={category.id}>
                    <div className="mb-3">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sf-text-muted">
                          {category.label}
                        </h3>
                        <span className="text-[10px] text-sf-text-muted/70">{presets.length}</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-4 text-sf-text-muted/80">
                        {category.description}
                      </p>
                    </div>
                    <div className="space-y-2">
                      {presets.map((preset) => renderPresetRow(preset))}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        </aside>

        <main className="min-h-0 overflow-hidden border-r border-sf-dark-700/80 flex flex-col">
          <div className="px-6 pt-5 pb-3 border-b border-sf-dark-700/80 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-sf-accent/80">
                <MonitorPlay className="w-3.5 h-3.5" />
                Motion Preview
              </div>
              <h2 className="mt-2 text-2xl font-semibold text-sf-text-primary">
                {selectedPreset.name}
              </h2>
              <p className="mt-1 text-xs text-sf-text-muted">
                Interactive stage preview with transparency-aware backgrounds, strict aspect ratios, and motion playback.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2 rounded-full border border-sf-dark-700 bg-sf-dark-900/85 px-2 py-1.5">
                {MOG_ASPECT_RATIO_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => updateControl('aspectRatio', option.id)}
                    className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                      controls.aspectRatio === option.id
                        ? 'bg-sf-accent text-black'
                        : 'text-sf-text-muted hover:bg-sf-dark-800 hover:text-sf-text-primary'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 rounded-full border border-sf-dark-700 bg-sf-dark-900/85 px-2 py-1.5">
                {MOG_BACKGROUND_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => updateControl('backgroundMode', option.id)}
                    className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                      controls.backgroundMode === option.id
                        ? 'bg-sf-accent text-black'
                        : 'text-sf-text-muted hover:bg-sf-dark-800 hover:text-sf-text-primary'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 p-6 flex flex-col">
            <div className="flex-1 min-h-0 rounded-[28px] border border-sf-dark-700/80 bg-sf-dark-950/60 overflow-hidden shadow-[0_26px_60px_rgba(0,0,0,0.28)] relative">
              <StageBackground
                mode={controls.backgroundMode}
                timelineStillUrl={timelineStillUrl}
                isTimelineStillLoading={isTimelineStillLoading}
              />
              <div className="absolute inset-0 p-5">
                <div
                  ref={stageViewportRef}
                  className="h-full rounded-[24px] border border-white/5 bg-black/10 backdrop-blur-[2px] overflow-hidden flex items-center justify-center"
                >
                  <div
                    className="relative"
                    style={{
                      width: `${stageFrameSize.width}px`,
                      height: `${stageFrameSize.height}px`,
                      aspectRatio: `${renderWidth} / ${renderHeight}`,
                    }}
                  >
                    <canvas
                      ref={previewCanvasRef}
                      className="w-full h-full object-contain rounded-[20px]"
                    />
                    <div className="pointer-events-none absolute inset-[6%] rounded-[18px] border border-dashed border-white/10" />
                    <div className="pointer-events-none absolute left-[6%] right-[6%] top-[6%] flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">
                      <span>Safe</span>
                      <span>{aspectSize.label}</span>
                    </div>
                    {previewError && (
                      <div className="absolute inset-6 rounded-[18px] border border-red-500/30 bg-black/70 px-5 py-4 text-sm text-red-200 flex items-center justify-center text-center">
                        {previewError}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-sf-dark-700 bg-sf-dark-900/75 px-5 py-4 flex items-center gap-4">
              <button
                type="button"
                onClick={() => setIsPlaying((prev) => !prev)}
                className="w-10 h-10 rounded-full bg-sf-accent text-black flex items-center justify-center hover:bg-sf-accent/90 transition-colors"
                title={isPlaying ? 'Pause preview' : 'Play preview'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreviewTime(0)
                  setIsPlaying(true)
                }}
                className="w-10 h-10 rounded-full border border-sf-dark-600 bg-sf-dark-800 text-sf-text-muted flex items-center justify-center hover:text-sf-text-primary hover:border-sf-dark-500"
                title="Restart preview"
              >
                <RefreshCcw className="w-4 h-4" />
              </button>
              <div className="flex-1">
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={Math.max(0.01, 1 / Math.max(24, renderFps))}
                  value={previewTime}
                  onChange={(e) => {
                    setIsPlaying(false)
                    setPreviewTime(Number(e.target.value))
                  }}
                  className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                />
              </div>
              <div className="text-xs text-sf-text-muted font-mono min-w-[98px] text-right">
                {previewTime.toFixed(2)}s / {duration.toFixed(2)}s
              </div>
            </div>
          </div>
        </main>

        <aside className="min-h-0 overflow-hidden bg-sf-dark-950/70 backdrop-blur">
          <div className="h-full flex flex-col">
            <div className="px-5 py-4 border-b border-sf-dark-700/80">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-sf-accent/80">
                <Wand2 className="w-3.5 h-3.5" />
                MoGraph V1
              </div>
              <h2 className="mt-2 text-lg font-semibold text-sf-text-primary">
                {selectedPreset.name}
              </h2>
              <p className="mt-1 text-xs text-sf-text-muted">
                Dense controls, low learning curve. Tune the look without ever touching keyframes.
              </p>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
              <Section
                title="Quick Edit"
                icon={Type}
                open={openSections.quick}
                onToggle={() => toggleSection('quick')}
              >
                <div>
                  <label className="text-[11px] text-sf-text-muted block mb-1.5">Headline</label>
                  <textarea
                    value={controls.headline}
                    onChange={(e) => updateTextControl('headline', e.target.value)}
                    className="w-full h-20 resize-none rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
                    placeholder="Discover your story"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-sf-text-muted block mb-1.5">Subheadline</label>
                  <input
                    type="text"
                    value={controls.subheadline}
                    onChange={(e) => updateTextControl('subheadline', e.target.value)}
                    className="w-full rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
                    placeholder="Supporting line"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-sf-text-muted block mb-1.5">Kicker</label>
                  <input
                    type="text"
                    value={controls.kicker}
                    onChange={(e) => updateTextControl('kicker', e.target.value)}
                    className="w-full rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
                    placeholder="Headline"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-sf-text-muted block mb-1.5">Line Count</label>
                  <ChoiceChips options={MOG_LINE_OPTIONS} value={controls.lineCount} onChange={(value) => updateControl('lineCount', value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-sf-text-muted block mb-1.5">Aspect Ratio</label>
                    <ChoiceChips
                      options={MOG_ASPECT_RATIO_OPTIONS}
                      value={controls.aspectRatio}
                      onChange={(value) => updateControl('aspectRatio', value)}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-sf-text-muted block mb-1.5">Clip Length</label>
                    <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2">
                      <input
                        type="range"
                        min={1}
                        max={8}
                        step={0.1}
                        value={controls.duration}
                        onChange={(e) => updateControl('duration', Number(e.target.value))}
                        className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                      />
                      <div className="mt-2 flex items-center justify-between text-[11px] text-sf-text-muted">
                        <span>{Number(controls.duration).toFixed(1)}s</span>
                        <span>{Math.round(Number(controls.duration) * renderFps)}f</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-sf-text-muted block mb-1.5">Palette</label>
                  <div className="grid grid-cols-3 gap-2">
                    {MOG_COLOR_PALETTES.map((palette) => (
                      <button
                        key={palette.id}
                        type="button"
                        onClick={() => applyPalette(palette.id)}
                        className={`rounded-xl border p-2 transition-colors ${
                          activePaletteId === palette.id
                            ? 'border-sf-accent bg-sf-dark-800'
                            : 'border-sf-dark-600 bg-sf-dark-900 hover:border-sf-dark-500'
                        }`}
                        title={palette.label}
                      >
                        <div className="flex gap-1 justify-center">
                          {[palette.textColor, palette.accentColor, palette.accentColor2, palette.boxColor].map((color) => (
                            <span
                              key={color}
                              className="w-4 h-4 rounded-full border border-white/10"
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </Section>

              <Section
                title="Style & Layout"
                icon={Layers3}
                open={openSections.style}
                onToggle={() => toggleSection('style')}
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-sf-text-muted block mb-1.5">Font</label>
                    <FontFamilyPicker
                      value={controls.fontFamily}
                      onChange={(value) => updateControl('fontFamily', value)}
                      className="w-full rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-sf-text-muted block mb-1.5">Weight</label>
                    <select
                      value={controls.fontWeight}
                      onChange={(e) => updateControl('fontWeight', e.target.value)}
                      className="w-full rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent"
                    >
                      <option value="500">Medium</option>
                      <option value="600">Semi Bold</option>
                      <option value="700">Bold</option>
                      <option value="800">Extra Bold</option>
                      <option value="900">Black</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2">
                    <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                      <span>Size</span>
                      <span>{Math.round(controls.fontSize)}px</span>
                    </div>
                    <input
                      type="range"
                      min={34}
                      max={128}
                      step={1}
                      value={controls.fontSize}
                      onChange={(e) => updateControl('fontSize', Number(e.target.value))}
                      className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                    />
                  </div>
                  <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2">
                    <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                      <span>Spacing</span>
                      <span>{Number(controls.letterSpacing).toFixed(1)}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={6}
                      step={0.25}
                      value={controls.letterSpacing}
                      onChange={(e) => updateControl('letterSpacing', Number(e.target.value))}
                      className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-sf-text-muted block mb-1.5">Alignment</label>
                  <ChoiceChips
                    options={[
                      { id: 'left', label: 'Left' },
                      { id: 'center', label: 'Center' },
                      { id: 'right', label: 'Right' },
                    ]}
                    value={controls.textAlign}
                    onChange={(value) => updateControl('textAlign', value)}
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <label className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 flex items-center gap-2 text-xs text-sf-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={controls.showBox}
                      onChange={(e) => updateControl('showBox', e.target.checked)}
                      className="accent-sf-accent"
                    />
                    Box
                  </label>
                  <label className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 flex items-center gap-2 text-xs text-sf-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={controls.showAccent}
                      onChange={(e) => updateControl('showAccent', e.target.checked)}
                      className="accent-sf-accent"
                    />
                    Accent
                  </label>
                  <label className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 flex items-center gap-2 text-xs text-sf-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={controls.showKicker}
                      onChange={(e) => updateControl('showKicker', e.target.checked)}
                      className="accent-sf-accent"
                    />
                    Kicker
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[
                    { key: 'textColor', label: 'Text' },
                    { key: 'accentColor', label: 'Accent' },
                    { key: 'boxColor', label: 'Box' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="text-[11px] text-sf-text-muted block mb-1.5">{label}</label>
                      <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-2 py-2 flex items-center gap-2">
                        <input
                          type="color"
                          value={controls[key]}
                          onChange={(e) => updateControl(key, e.target.value)}
                          className="w-8 h-8 rounded border border-sf-dark-500 bg-transparent cursor-pointer"
                        />
                        <input
                          type="text"
                          value={controls[key]}
                          onChange={(e) => updateControl(key, e.target.value)}
                          className="min-w-0 flex-1 bg-transparent text-[11px] text-sf-text-primary font-mono focus:outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2">
                    <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                      <span>Box Opacity</span>
                      <span>{Math.round(controls.boxOpacity)}%</span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={100}
                      step={1}
                      value={controls.boxOpacity}
                      onChange={(e) => updateControl('boxOpacity', Number(e.target.value))}
                      className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                    />
                  </div>
                  <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2">
                    <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                      <span>Margin</span>
                      <span>{Math.round(controls.margin)}px</span>
                    </div>
                    <input
                      type="range"
                      min={28}
                      max={140}
                      step={1}
                      value={controls.margin}
                      onChange={(e) => updateControl('margin', Number(e.target.value))}
                      className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                    />
                  </div>
                  <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2">
                    <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                      <span>Padding</span>
                      <span>{Math.round(controls.padding)}px</span>
                    </div>
                    <input
                      type="range"
                      min={14}
                      max={52}
                      step={1}
                      value={controls.padding}
                      onChange={(e) => updateControl('padding', Number(e.target.value))}
                      className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                    />
                  </div>
                </div>
              </Section>

              <Section
                title="Character FX"
                icon={Wand2}
                open={openSections.character}
                onToggle={() => toggleSection('character')}
              >
                <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-sf-text-primary">Headline-only range styling</div>
                      <p className="mt-1 text-[11px] leading-4 text-sf-text-muted">
                        Target visible headline characters only. Spaces do not count in the range numbers, and these ranges animate per character even if the main motion mode is broader.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addHeadlineCharacterFx}
                      className="shrink-0 rounded-xl border border-sf-accent/40 bg-sf-accent/10 px-3 py-2 text-xs font-medium text-sf-text-primary hover:border-sf-accent hover:bg-sf-accent/15 transition-colors"
                    >
                      Add Range
                    </button>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-sf-text-muted">
                    <span>Visible headline characters</span>
                    <span>{headlineVisibleCharacterCount}</span>
                  </div>
                </div>

                {headlineCharacterFx.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-sf-dark-600 bg-sf-dark-900/70 px-3 py-4 text-[11px] leading-4 text-sf-text-muted">
                    No character ranges yet. Add one to offset, scale, delay, fade, or tint part of the headline.
                  </div>
                ) : (
                  headlineCharacterFx.map((rule, index) => (
                    <div key={rule.id} className="rounded-2xl border border-sf-dark-600 bg-sf-dark-800/90 px-3 py-3 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-sf-text-primary">Range {index + 1}</div>
                          <div className="mt-1 text-[11px] text-sf-text-muted">
                            Characters {Math.max(1, Math.round(Number(rule.start) || 1))} to {Math.max(Math.round(Number(rule.start) || 1), Math.round(Number(rule.end) || 1))}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeHeadlineCharacterFx(rule.id)}
                          className="rounded-xl border border-sf-dark-500 bg-sf-dark-900 px-3 py-1.5 text-[11px] text-sf-text-muted hover:border-sf-dark-400 hover:text-sf-text-primary transition-colors"
                        >
                          Remove
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-[11px] text-sf-text-muted block mb-1.5">Start</label>
                          <input
                            type="number"
                            min={1}
                            max={Math.max(1, headlineVisibleCharacterCount)}
                            value={Math.max(1, Math.round(Number(rule.start) || 1))}
                            onChange={(e) => updateHeadlineCharacterFx(rule.id, 'start', Number(e.target.value))}
                            className="w-full rounded-xl border border-sf-dark-600 bg-sf-dark-900 px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-sf-text-muted block mb-1.5">End</label>
                          <input
                            type="number"
                            min={1}
                            max={Math.max(1, headlineVisibleCharacterCount)}
                            value={Math.max(1, Math.round(Number(rule.end) || 1))}
                            onChange={(e) => updateHeadlineCharacterFx(rule.id, 'end', Number(e.target.value))}
                            className="w-full rounded-xl border border-sf-dark-600 bg-sf-dark-900 px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-sf-text-muted block mb-1.5">Tint</label>
                          <select
                            value={rule.tint || 'none'}
                            onChange={(e) => updateHeadlineCharacterFx(rule.id, 'tint', e.target.value)}
                            className="w-full rounded-xl border border-sf-dark-600 bg-sf-dark-900 px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent"
                          >
                            {CHARACTER_FX_TINT_OPTIONS.map((option) => (
                              <option key={option.id} value={option.id}>{option.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-900 px-3 py-2">
                          <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                            <span>X Offset</span>
                            <span>{Math.round(Number(rule.xOffset) || 0)} px</span>
                          </div>
                          <input
                            type="range"
                            min={-120}
                            max={120}
                            step={1}
                            value={Number(rule.xOffset) || 0}
                            onChange={(e) => updateHeadlineCharacterFx(rule.id, 'xOffset', Number(e.target.value))}
                            className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                          />
                        </div>
                        <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-900 px-3 py-2">
                          <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                            <span>Lift / Drop</span>
                            <span>{Math.round(Number(rule.yOffset) || 0)} px</span>
                          </div>
                          <input
                            type="range"
                            min={-120}
                            max={120}
                            step={1}
                            value={Number(rule.yOffset) || 0}
                            onChange={(e) => updateHeadlineCharacterFx(rule.id, 'yOffset', Number(e.target.value))}
                            className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                          />
                        </div>
                        <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-900 px-3 py-2">
                          <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                            <span>Rotation</span>
                            <span>{Math.round(Number(rule.rotation) || 0)} deg</span>
                          </div>
                          <input
                            type="range"
                            min={-35}
                            max={35}
                            step={1}
                            value={Number(rule.rotation) || 0}
                            onChange={(e) => updateHeadlineCharacterFx(rule.id, 'rotation', Number(e.target.value))}
                            className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                          />
                        </div>
                        <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-900 px-3 py-2">
                          <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                            <span>Scale</span>
                            <span>{Number(rule.scale || 1).toFixed(2)}x</span>
                          </div>
                          <input
                            type="range"
                            min={0.6}
                            max={2}
                            step={0.01}
                            value={Number(rule.scale) || 1}
                            onChange={(e) => updateHeadlineCharacterFx(rule.id, 'scale', Number(e.target.value))}
                            className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-900 px-3 py-2">
                          <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                            <span>Delay Offset</span>
                            <span>{Number(rule.delay || 0).toFixed(2)}</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={0.45}
                            step={0.01}
                            value={Number(rule.delay) || 0}
                            onChange={(e) => updateHeadlineCharacterFx(rule.id, 'delay', Number(e.target.value))}
                            className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                          />
                        </div>
                        <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-900 px-3 py-2">
                          <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                            <span>Opacity</span>
                            <span>{Math.round((Number(rule.opacity) || 1) * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min={0.15}
                            max={1}
                            step={0.01}
                            value={Number(rule.opacity) || 1}
                            onChange={(e) => updateHeadlineCharacterFx(rule.id, 'opacity', Number(e.target.value))}
                            className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </Section>

              <Section
                title="Motion"
                icon={Sparkles}
                open={openSections.motion}
                onToggle={() => toggleSection('motion')}
              >
                <div>
                  <label className="text-[11px] text-sf-text-muted block mb-1.5">Animation Style</label>
                  <ChoiceChips
                    options={[
                      { id: 'slide', label: 'Slide' },
                      { id: 'drift', label: 'Drift' },
                      { id: 'wipe', label: 'Wipe' },
                      { id: 'pop', label: 'Pop' },
                      { id: 'reveal', label: 'Reveal' },
                      { id: 'trackIn', label: 'Track In' },
                      { id: 'stagger', label: 'Stagger' },
                      { id: 'splitReveal', label: 'Split' },
                      { id: 'inflateMorph', label: 'Inflate' },
                      { id: 'boxBuild', label: 'Box Build' },
                      { id: 'underlineGrow', label: 'Underline' },
                    ]}
                    value={controls.animationStyle}
                    onChange={(value) => updateControl('animationStyle', value)}
                    size="xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-sf-text-muted block mb-1.5">Direction</label>
                  <ChoiceChips options={MOG_DIRECTION_OPTIONS} value={controls.direction} onChange={(value) => updateControl('direction', value)} />
                </div>
                <div>
                  <label className="text-[11px] text-sf-text-muted block mb-1.5">Pace</label>
                  <ChoiceChips options={MOG_PACE_OPTIONS} value={controls.pace} onChange={(value) => updateControl('pace', value)} />
                </div>
                <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2">
                  <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                    <span>Build In</span>
                    <span>{Number(controls.animationDurationScale || 1).toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={3}
                    step={0.1}
                    value={controls.animationDurationScale || 1}
                    onChange={(e) => updateControl('animationDurationScale', Number(e.target.value))}
                    className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                  />
                  <div className="mt-2 flex items-center justify-between text-[11px] text-sf-text-muted">
                    <span>Snappier</span>
                    <span>Slower entrance</span>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-sf-text-muted block mb-1.5">Animate By</label>
                  <ChoiceChips
                    options={MOG_TEXT_GRANULARITY_OPTIONS}
                    value={controls.textGranularity}
                    onChange={(value) => updateControl('textGranularity', value)}
                    size="xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-sf-text-muted block mb-1.5">Mask Reveal</label>
                  <ChoiceChips
                    options={MOG_MASK_MODE_OPTIONS}
                    value={controls.maskMode}
                    onChange={(value) => updateControl('maskMode', value)}
                    size="xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2">
                    <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                      <span>Stagger</span>
                      <span>{Number(controls.staggerStep || 0).toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={0.24}
                      step={0.01}
                      value={controls.staggerStep || 0}
                      onChange={(e) => updateControl('staggerStep', Number(e.target.value))}
                      className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                    />
                  </div>
                  <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2">
                    <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                      <span>Blur In</span>
                      <span>{Math.round(Number(controls.blurAmount || 0))} px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={24}
                      step={1}
                      value={controls.blurAmount || 0}
                      onChange={(e) => updateControl('blurAmount', Number(e.target.value))}
                      className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2">
                    <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                      <span>Tracking Pull</span>
                      <span>{Number(controls.trackingPull || 0).toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min={-4}
                      max={8}
                      step={0.1}
                      value={controls.trackingPull || 0}
                      onChange={(e) => updateControl('trackingPull', Number(e.target.value))}
                      className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                    />
                  </div>
                  <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2">
                    <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                      <span>Overshoot</span>
                      <span>{Number(controls.overshootAmount || 0).toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={0.32}
                      step={0.01}
                      value={controls.overshootAmount || 0}
                      onChange={(e) => updateControl('overshootAmount', Number(e.target.value))}
                      className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                    />
                  </div>
                  <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2">
                    <div className="flex items-center justify-between text-[11px] text-sf-text-muted mb-2">
                      <span>Inflate</span>
                      <span>{Number(controls.inflateAmount || 0).toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.1}
                      value={controls.inflateAmount || 0}
                      onChange={(e) => updateControl('inflateAmount', Number(e.target.value))}
                      className="w-full h-1.5 rounded-lg bg-sf-dark-700 accent-sf-accent cursor-pointer"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-sf-text-muted block mb-1.5">Exit Style</label>
                  <ChoiceChips options={MOG_EXIT_OPTIONS} value={controls.exitStyle} onChange={(value) => updateControl('exitStyle', value)} size="xs" />
                </div>
                <button
                  type="button"
                  onClick={resetToPreset}
                  className="w-full rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary hover:border-sf-dark-500 hover:bg-sf-dark-700 transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCcw className="w-4 h-4" />
                  Reset style to preset
                </button>
              </Section>

              <Section
                title="Output"
                icon={FolderOpen}
                open={openSections.output}
                onToggle={() => toggleSection('output')}
              >
                <div>
                  <label className="text-[11px] text-sf-text-muted block mb-1.5">Asset Name</label>
                  <input
                    type="text"
                    value={controls.assetName}
                    onChange={(e) => updateAssetName(e.target.value)}
                    className="w-full rounded-xl border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
                    placeholder="Dynamic Lower Third"
                  />
                </div>
                <div className="rounded-2xl border border-sf-dark-600 bg-sf-dark-800 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between text-xs text-sf-text-muted">
                    <span>Transparency</span>
                    <span className="text-sf-success">Alpha enabled</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-sf-text-muted">
                    <span>Resolution</span>
                    <span>{renderWidth}x{renderHeight}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-sf-text-muted">
                    <span>Aspect</span>
                    <span>{aspectSize.label}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-sf-text-muted">
                    <span>Frame Rate</span>
                    <span>{renderFps} fps</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-sf-text-muted">
                    <span>Folder</span>
                    <span>{MOG_FOLDER_NAME}</span>
                  </div>
                </div>

                {error && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {error}
                  </div>
                )}
                {statusMessage && !error && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    {statusMessage}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSendToAssets}
                  disabled={isRendering}
                  className="w-full rounded-2xl bg-sf-accent px-4 py-3 text-sm font-semibold text-black hover:bg-sf-accent/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {isRendering ? (
                    <>
                      <Clock3 className="w-4 h-4 animate-spin" />
                      Rendering Transparent Asset...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send To Assets
                    </>
                  )}
                </button>
              </Section>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default MOGWorkspace
