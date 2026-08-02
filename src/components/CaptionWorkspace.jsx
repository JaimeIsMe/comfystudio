import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, Download, Loader2, Pause, Play, RefreshCw, RotateCcw, Sparkles, Wand2, X } from 'lucide-react'
import {
  CAPTION_PRESETS,
  DEFAULT_CAPTION_PRESET_ID,
  getCaptionPresetById,
} from '../config/captionPresets'
import { DEFAULT_KINETIC_ACCENT_COLOR, buildKineticStyleWithColors } from '../utils/kineticCaptionRenderer'
import { isElectron, writeGeneratedOverlayToProject } from '../services/fileSystem'
import { useProjectStore } from '../stores/projectStore'
import {
  buildCaptionAssetName,
  ensureCaptionsFolder,
  loadCaptionSidecar,
  saveCaptionSidecar,
} from '../services/captionProject'
import {
  transcribeAsset,
  transcribeTimelineAudio,
  resolveCaptionEngine,
  getCaptionEnginePreference,
  getCaptionModelPreference,
  setCaptionModelPreference,
  getLocalCaptionEngineStatus,
  installLocalCaptionEngine,
  canRemoveLocalCaptionModels,
  removeLocalCaptionModel,
} from '../services/captionTranscription'
import {
  generateCaptionVideoBlob,
  renderCaptionFrame,
  renderCaptionPresetPreviewDataUrl,
} from '../utils/captionRenderer'

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

// Draw a source canvas/image onto ctx using object-cover math (fill the box,
// crop the overflow), centered. Used to put a real video frame behind the
// caption overlay in the positioning preview.
function drawCover(ctx, src, dw, dh) {
  const sw = src.width || src.videoWidth || 0
  const sh = src.height || src.videoHeight || 0
  if (!sw || !sh) return
  const scale = Math.max(dw / sw, dh / sh)
  const w = sw * scale
  const h = sh * scale
  ctx.drawImage(src, (dw - w) / 2, (dh - h) / 2, w, h)
}

function formatSeconds(value) {
  const numeric = Math.max(0, Number(value) || 0)
  const minutes = Math.floor(numeric / 60)
  const seconds = numeric % 60
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`
}

function getCueEnd(cue, fallbackDuration) {
  const start = Number(cue?.start) || 0
  const rawEnd = Number(cue?.end)
  const fallback = Math.max(start + 0.4, Number(fallbackDuration) || start + 1.5)
  return Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : fallback
}

function getDraftDuration(draft, asset) {
  const cueEnd = Math.max(...((draft?.cues || []).map((cue) => Number(cue?.end) || 0)), 0)
  const assetDuration = Number(asset?.duration) || Number(asset?.settings?.duration) || 0
  return Math.max(0.4, cueEnd || assetDuration || 0.4)
}

function normalizeCueOrder(cues = [], fallbackDuration = 0) {
  return [...cues]
    .map((cue, index) => {
      const start = Math.max(0, Number(cue?.start) || 0)
      const end = getCueEnd(cue, fallbackDuration)
      return {
        ...cue,
        id: cue?.id || `cue-${index + 1}`,
        start,
        end,
        text: String(cue?.text || ''),
        override: normalizeCueOverride(cue?.override),
      }
    })
    .sort((a, b) => a.start - b.start)
}

function cuesToTranscript(cues = []) {
  return cues
    .map((cue) => String(cue?.text || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const CUE_VERTICAL_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'top', label: 'Top' },
  { id: 'middle', label: 'Middle' },
  { id: 'bottom', label: 'Bottom' },
]

const CUE_HORIZONTAL_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Center' },
  { id: 'right', label: 'Right' },
]

const CUE_MOTION_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'tamed', label: 'Tamed' },
  { id: 'excited', label: 'Excited' },
  { id: 'frenetic', label: 'Frenetic' },
]

const CAPTION_FONT_OPTIONS = [
  { id: 'Inter', label: 'Inter', value: 'Inter' },
  { id: 'Arial', label: 'Arial', value: 'Arial' },
  { id: 'Impact', label: 'Impact', value: 'Impact' },
  { id: 'Trebuchet', label: 'Trebuchet', value: 'Trebuchet MS' },
  { id: 'Georgia', label: 'Georgia', value: 'Georgia' },
  { id: 'Mono', label: 'Mono', value: 'Courier New' },
]

const SAVED_CAPTION_STYLES_KEY = 'comfystudio-saved-caption-styles'

const VALID_VERTICAL_PLACEMENTS = new Set(CUE_VERTICAL_OPTIONS.map((option) => option.id))
const VALID_HORIZONTAL_PLACEMENTS = new Set(CUE_HORIZONTAL_OPTIONS.map((option) => option.id))
const VALID_MOTION_PROFILES = new Set(CUE_MOTION_OPTIONS.map((option) => option.id))

function loadSavedCaptionStyles() {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_CAPTION_STYLES_KEY) || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((style) => style && typeof style === 'object' && style.id && style.name)
      : []
  } catch (error) {
    console.warn('[CaptionWorkspace] Could not load saved caption styles:', error)
    return []
  }
}

function persistSavedCaptionStyles(styles) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SAVED_CAPTION_STYLES_KEY, JSON.stringify(styles))
  } catch (error) {
    console.warn('[CaptionWorkspace] Could not save caption styles:', error)
  }
}

function createCaptionStyleId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `caption-style-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeCueOverride(override = {}) {
  const safeOverride = override && typeof override === 'object' ? override : {}
  return {
    verticalPlacement: VALID_VERTICAL_PLACEMENTS.has(safeOverride.verticalPlacement)
      ? safeOverride.verticalPlacement
      : 'auto',
    horizontalPlacement: VALID_HORIZONTAL_PLACEMENTS.has(safeOverride.horizontalPlacement)
      ? safeOverride.horizontalPlacement
      : 'auto',
    motionProfile: VALID_MOTION_PROFILES.has(safeOverride.motionProfile)
      ? safeOverride.motionProfile
      : 'auto',
  }
}

function CueOverrideChips({ label, value, options, onChange }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`rounded-full border px-2.5 py-1 text-[10px] transition-colors ${
              value === option.id
                ? 'border-sf-accent bg-sf-accent/20 text-sf-text-primary'
                : 'border-sf-dark-600 bg-sf-dark-900 text-sf-text-muted hover:border-sf-dark-500 hover:text-sf-text-primary'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// A free color picker row used for every preset's Text / Accent colors.
function ColorField({ icon: Icon, label, hint, value, onChange, onReset, resetDisabled }) {
  const display = String(value || '#FFFFFF').toUpperCase()
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {Icon ? <Icon className="w-4 h-4 text-sf-text-muted flex-shrink-0" /> : null}
        <div className="min-w-0">
          <div className="text-xs font-medium text-sf-text-primary">{label}</div>
          {hint ? <div className="text-[11px] text-sf-text-muted truncate">{hint}</div> : null}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <label
          className="relative inline-flex w-9 h-9 rounded-lg overflow-hidden border border-sf-dark-600 cursor-pointer"
          style={{ backgroundColor: display }}
          title="Pick any color"
        >
          <input
            type="color"
            value={display}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            aria-label={label}
          />
        </label>
        <code className="text-[11px] text-sf-text-muted font-mono uppercase w-[58px]">{display}</code>
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            disabled={resetDisabled}
            className="rounded-md border border-sf-dark-600 bg-sf-dark-900 p-1.5 text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-800 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Reset to preset default"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  leftLabel = '',
  rightLabel = '',
  onChange,
  onReset,
  resetDisabled,
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">
          {label}
          <span className="ml-2 font-mono normal-case tracking-normal text-sf-text-secondary">{value}{unit}</span>
        </div>
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            disabled={resetDisabled}
            className="text-[10px] text-sf-text-muted hover:text-sf-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {leftLabel ? <span className="w-10 text-right text-[10px] text-sf-text-muted">{leftLabel}</span> : null}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-sf-accent"
          aria-label={label}
        />
        {rightLabel ? <span className="w-10 text-[10px] text-sf-text-muted">{rightLabel}</span> : null}
      </div>
    </div>
  )
}

function createEmptyDraft(asset) {
  return {
    modelId: null,
    transcriptText: '',
    words: [],
    cues: [],
    audioDuration: Number(asset?.duration) || Number(asset?.settings?.duration) || null,
  }
}

// Session cache for timeline-scope caption work. The timeline has no source
// asset to attach a sidecar to, so without this every reopen would force a
// re-transcribe. Keyed by project handle; lives for the app session only.
const timelineCaptionSessionCache = new Map()

// An approximate TikTok UI overlaid on the positioning preview so the user can
// keep captions clear of the platform chrome (right action rail + bottom
// caption/handle/music). viewBox is the real frame size and the SVG is
// stretched onto the preview image, so coordinates are fractions of the frame.
function TikTokGuideOverlay({ w, h }) {
  const railX = w * 0.9
  const r = w * 0.04
  const glyphFs = w * 0.034
  const labelFs = w * 0.024
  const stroke = Math.max(1, w * 0.005)

  const actions = [
    { cy: h * 0.5, glyph: '♥', label: '24.1k' },
    { cy: h * 0.6, glyph: '▢', label: '318' },
    { cy: h * 0.69, glyph: '⤴', label: '1.2k' },
    { cy: h * 0.78, glyph: '↗', label: '882' },
  ]

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-none"
    >
      <defs>
        <linearGradient id="ttBottomFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(0,0,0,0)" />
          <stop offset="1" stopColor="rgba(0,0,0,0.5)" />
        </linearGradient>
      </defs>

      {/* Bottom scrim where the caption/handle/music sits */}
      <rect x="0" y={h * 0.74} width={w} height={h * 0.26} fill="url(#ttBottomFade)" />

      {/* Right action rail */}
      <circle cx={railX} cy={h * 0.4} r={r} fill="rgba(0,0,0,0.25)" stroke="white" strokeWidth={stroke} opacity="0.9" />
      {actions.map((a, i) => (
        <g key={i} opacity="0.92">
          <circle cx={railX} cy={a.cy} r={r * 0.82} fill="rgba(0,0,0,0.28)" />
          <text x={railX} y={a.cy + glyphFs * 0.35} fontSize={glyphFs} fill="white" textAnchor="middle">{a.glyph}</text>
          <text x={railX} y={a.cy + r + labelFs} fontSize={labelFs} fill="white" textAnchor="middle">{a.label}</text>
        </g>
      ))}
      <circle cx={railX} cy={h * 0.88} r={r} fill="rgba(0,0,0,0.4)" stroke="white" strokeWidth={stroke * 0.8} opacity="0.85" />

      {/* Bottom-left handle / caption / sound */}
      <text x={w * 0.045} y={h * 0.85} fontSize={glyphFs} fill="white" fontWeight="700">@yourbrand</text>
      <text x={w * 0.045} y={h * 0.89} fontSize={labelFs * 1.1} fill="white" opacity="0.9">your caption goes here #fyp</text>
      <text x={w * 0.045} y={h * 0.93} fontSize={labelFs} fill="white" opacity="0.82">♪ original sound</text>

      {/* Recommended safe area (clear of the rail and bottom text) */}
      <rect
        x={w * 0.04}
        y={h * 0.1}
        width={w * 0.78}
        height={h * 0.62}
        fill="none"
        stroke="rgba(125,220,150,0.9)"
        strokeWidth={stroke}
        strokeDasharray={`${w * 0.02} ${w * 0.014}`}
      />
      <text x={w * 0.05} y={h * 0.1 + labelFs * 1.4} fontSize={labelFs} fill="rgba(125,220,150,0.95)">safe area</text>
    </svg>
  )
}

function CaptionWorkspace({
  isOpen,
  asset,
  // 'asset' (default) — transcribe a single source clip/asset.
  // 'timeline'       — transcribe the mixed program audio of the live timeline.
  scope = 'asset',
  // Timeline scope only: whether a caption track already exists on the timeline,
  // so generating can warn that it will be replaced.
  hasExistingTimelineCaptions = false,
  // Timeline scope only: sidecar path saved by the last generated timeline
  // overlay, used to restore cues/style after an app restart when the
  // in-memory session cache is cold.
  timelineCaptionSidecarPath = null,
  currentProjectHandle,
  timelineSize,
  folders,
  addFolder,
  addAsset,
  updateAsset,
  onPlaceOnTimeline,
  onClose,
}) {
  const isTimelineScope = scope === 'timeline'
  const [selectedPresetId, setSelectedPresetId] = useState(DEFAULT_CAPTION_PRESET_ID)
  const [accentColor, setAccentColor] = useState(DEFAULT_KINETIC_ACCENT_COLOR)
  const [textColor, setTextColor] = useState(null)
  const [draft, setDraft] = useState(() => createEmptyDraft(asset))
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [placeOnTimeline, setPlaceOnTimeline] = useState(true)
  // Redesign state: the cue list is the primary surface. Selecting a cue
  // seeks the preview and opens its details in the right rail; the preview
  // folds away to give style room; the transcribe controls collapse to a
  // strip once cues exist.
  const [selectedCueId, setSelectedCueId] = useState(null)
  const [cueSearch, setCueSearch] = useState('')
  // The preview is always visible: style controls (size, nudge, colors) are
  // meaningless without live feedback. A collapsible preview shipped briefly
  // and died the same night — collapsed, dragging Size showed nothing.
  const [transcribeDetailsOpen, setTranscribeDetailsOpen] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  // 0–100 while a transcription reports real progress (mix ≈ 0–40, whisper
  // decode ≈ 40–100); null = indeterminate, spinner only.
  const [transcribeProgress, setTranscribeProgress] = useState(null)
  // 0–100 while the animated overlay records (real-time render, one percent
  // per elapsed hundredth of the timeline); null = indeterminate.
  const [generateProgress, setGenerateProgress] = useState(null)
  const [error, setError] = useState('')
  const [errorExpanded, setErrorExpanded] = useState(false)
  const [errorCopied, setErrorCopied] = useState(false)
  const [engineStatus, setEngineStatus] = useState(null)
  const [modelPreference, setModelPreference] = useState(() => getCaptionModelPreference())
  // Project-stored extra vocabulary for transcription hints; the transcription
  // seam gives it budget priority over the auto-derived project words.
  const captionVocabulary = useProjectStore((s) => s.currentProject?.settings?.captionVocabulary || '')
  const [isInstallingEngine, setIsInstallingEngine] = useState(false)
  const [engineInstallProgress, setEngineInstallProgress] = useState(null)
  const [savedCaptionStyles, setSavedCaptionStyles] = useState(() => loadSavedCaptionStyles())
  const [captionStyleName, setCaptionStyleName] = useState('')
  const [activeSavedStyleId, setActiveSavedStyleId] = useState(null)

  const [globalVertical, setGlobalVertical] = useState('auto')
  const [globalHorizontal, setGlobalHorizontal] = useState('auto')
  const [globalMotion, setGlobalMotion] = useState('auto')
  // Continuous size multiplier (1 = default), shared by both preset modes.
  const [globalSizeScale, setGlobalSizeScale] = useState(1)
  // Continuous up/down nudge as a fraction of frame height (−0.45 = higher, +0.45 = lower).
  const [globalVerticalOffset, setGlobalVerticalOffset] = useState(0)

  const [subtitlePosition, setSubtitlePosition] = useState('action-safe')
  // Shared legibility treatment for all presets (background / outline / shadow / plain).
  const [globalTextStyle, setGlobalTextStyle] = useState('background')
  const [globalFontFamily, setGlobalFontFamily] = useState('Inter')
  const [backgroundColor, setBackgroundColor] = useState('#000000')
  const [backgroundOpacity, setBackgroundOpacity] = useState(65)
  const [backgroundPadding, setBackgroundPadding] = useState(45)
  const [backgroundRadius, setBackgroundRadius] = useState(25)
  const [outlineColor, setOutlineColor] = useState('#000000')
  const [outlineThickness, setOutlineThickness] = useState(9)
  const [shadowColor, setShadowColor] = useState('#000000')
  const [shadowOpacity, setShadowOpacity] = useState(75)
  const [shadowBlur, setShadowBlur] = useState(18)
  const [shadowDistance, setShadowDistance] = useState(5)

  // A still frame grabbed from the source video, drawn behind the positioning
  // preview so placement can be judged over real footage. bgVersion bumps when
  // a new frame is captured, to re-run the preview memo.
  const bgCanvasRef = useRef(null)
  const [bgVersion, setBgVersion] = useState(0)
  // Preview-only TikTok chrome overlay to gauge caption placement vs platform UI.
  const [showTikTokOverlay, setShowTikTokOverlay] = useState(false)

  // Live animated preview: drives the same renderer at ~60fps so the caption
  // motion/timing can be watched in-window without a full render + timeline trip.
  const previewCanvasRef = useRef(null)
  const overlayCanvasRef = useRef(null)
  const previewTimeRef = useRef(1.2)
  const rafRef = useRef(0)
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false)
  const [scrubDisplay, setScrubDisplay] = useState(1.2)

  const SUBTITLE_POSITION_OPTIONS = useMemo(() => [
    { id: 'action-safe', label: 'Action Safe' },
    { id: 'title-safe', label: 'Title Safe' },
    { id: 'center', label: 'Center' },
  ], [])

  const TEXT_STYLE_OPTIONS = useMemo(() => [
    { id: 'background', label: 'Background' },
    { id: 'outline', label: 'Outline' },
    { id: 'shadow', label: 'Shadow' },
    { id: 'plain', label: 'Plain' },
  ], [])

  const previewUrls = useMemo(() => (
    CAPTION_PRESETS.reduce((map, preset) => {
      map[preset.id] = renderCaptionPresetPreviewDataUrl(preset)
      return map
    }, {})
  ), [])

  const selectedPreset = useMemo(
    () => getCaptionPresetById(selectedPresetId),
    [selectedPresetId]
  )

  const renderPreset = useMemo(() => {
    if (selectedPreset?.renderer === 'kinetic' && !selectedPreset.traditional) {
      return buildKineticStyleWithColors(selectedPreset, accentColor, textColor)
    }
    return selectedPreset
  }, [selectedPreset, accentColor, textColor])

  // The resolved base text color: the user's free pick, or the preset's default.
  // Used for the picker UI and (for subtitles) fed through as the text color.
  const effectiveTextColor = useMemo(() => {
    const presetDefault = selectedPreset?.traditional
      ? (selectedPreset?.subtitleColor || selectedPreset?.textColor)
      : selectedPreset?.textColor
    return textColor || presetDefault || '#FFFFFF'
  }, [textColor, selectedPreset])

  const captionStyleControls = useMemo(() => ({
    fontFamily: globalFontFamily,
    backgroundColor,
    backgroundOpacity,
    backgroundPadding,
    backgroundRadius,
    outlineColor,
    outlineThickness,
    shadowColor,
    shadowOpacity,
    shadowBlur,
    shadowDistance,
  }), [
    globalFontFamily,
    backgroundColor,
    backgroundOpacity,
    backgroundPadding,
    backgroundRadius,
    outlineColor,
    outlineThickness,
    shadowColor,
    shadowOpacity,
    shadowBlur,
    shadowDistance,
  ])

  const applyCaptionStyle = useCallback((style) => {
    if (!style || typeof style !== 'object') return
    const presetId = style.presetId || DEFAULT_CAPTION_PRESET_ID
    const preset = getCaptionPresetById(presetId)
    const controls = style.styleControls && typeof style.styleControls === 'object'
      ? style.styleControls
      : {}

    setSelectedPresetId(presetId)
    setAccentColor(style.accentColor || preset?.keyWordColor || DEFAULT_KINETIC_ACCENT_COLOR)
    setTextColor(style.textColor ?? null)
    setGlobalTextStyle(style.textStyle || preset?.defaultTextStyle || (preset?.traditional ? 'background' : 'plain'))
    setGlobalFontFamily(controls.fontFamily || preset?.fontFamily || 'Inter')
    setBackgroundColor(controls.backgroundColor || '#000000')
    setBackgroundOpacity(typeof controls.backgroundOpacity === 'number' ? controls.backgroundOpacity : 65)
    setBackgroundPadding(typeof controls.backgroundPadding === 'number' ? controls.backgroundPadding : (preset?.traditional ? 60 : 45))
    setBackgroundRadius(typeof controls.backgroundRadius === 'number' ? controls.backgroundRadius : (preset?.traditional ? 30 : 25))
    setOutlineColor(controls.outlineColor || '#000000')
    setOutlineThickness(typeof controls.outlineThickness === 'number' ? controls.outlineThickness : 9)
    setShadowColor(controls.shadowColor || '#000000')
    setShadowOpacity(typeof controls.shadowOpacity === 'number' ? controls.shadowOpacity : 75)
    setShadowBlur(typeof controls.shadowBlur === 'number' ? controls.shadowBlur : (preset?.traditional ? 25 : 18))
    setShadowDistance(typeof controls.shadowDistance === 'number' ? controls.shadowDistance : 5)
    setSubtitlePosition(style.subtitlePosition || preset?.subtitlePosition || 'action-safe')
    setGlobalVertical(style.globalVertical || 'auto')
    setGlobalHorizontal(style.globalHorizontal || 'auto')
    setGlobalMotion(style.globalMotion || 'auto')
    setGlobalSizeScale(typeof style.globalSizeScale === 'number' ? style.globalSizeScale : 1)
    setGlobalVerticalOffset(typeof style.globalVerticalOffset === 'number' ? style.globalVerticalOffset : 0)
    setActiveSavedStyleId(style.id || null)
    setCaptionStyleName(style.name || '')
    setStatusMessage(style.name ? `Applied caption style "${style.name}".` : 'Applied saved caption style.')
  }, [])

  const buildSavedCaptionStyle = useCallback((name, existingStyle = null) => {
    const timestamp = new Date().toISOString()
    return {
      id: existingStyle?.id || createCaptionStyleId(),
      name,
      presetId: selectedPresetId,
      presetName: selectedPreset?.name || 'Caption',
      accentColor,
      textColor,
      textStyle: globalTextStyle,
      subtitlePosition,
      globalVertical,
      globalHorizontal,
      globalMotion,
      globalSizeScale,
      globalVerticalOffset,
      styleControls: captionStyleControls,
      createdAt: existingStyle?.createdAt || timestamp,
      updatedAt: timestamp,
    }
  }, [
    accentColor,
    captionStyleControls,
    globalHorizontal,
    globalMotion,
    globalSizeScale,
    globalTextStyle,
    globalVertical,
    globalVerticalOffset,
    selectedPreset?.name,
    selectedPresetId,
    subtitlePosition,
    textColor,
  ])

  const saveCurrentCaptionStyle = useCallback(({ forceNew = false } = {}) => {
    const fallbackName = `${selectedPreset?.name || 'Caption'} style`
    const name = captionStyleName.trim() || fallbackName
    const existingStyle = !forceNew && activeSavedStyleId
      ? savedCaptionStyles.find((style) => style.id === activeSavedStyleId)
      : null
    const nextStyle = buildSavedCaptionStyle(name, existingStyle)
    const nextStyles = existingStyle
      ? savedCaptionStyles.map((style) => (style.id === existingStyle.id ? nextStyle : style))
      : [nextStyle, ...savedCaptionStyles]

    setSavedCaptionStyles(nextStyles)
    persistSavedCaptionStyles(nextStyles)
    setActiveSavedStyleId(nextStyle.id)
    setCaptionStyleName(nextStyle.name)
    setStatusMessage(existingStyle ? `Updated caption style "${nextStyle.name}".` : `Saved caption style "${nextStyle.name}".`)
  }, [activeSavedStyleId, buildSavedCaptionStyle, captionStyleName, savedCaptionStyles, selectedPreset?.name])

  const deleteSavedCaptionStyle = useCallback((styleId) => {
    const style = savedCaptionStyles.find((item) => item.id === styleId)
    const nextStyles = savedCaptionStyles.filter((item) => item.id !== styleId)
    setSavedCaptionStyles(nextStyles)
    persistSavedCaptionStyles(nextStyles)
    if (activeSavedStyleId === styleId) {
      setActiveSavedStyleId(null)
      setCaptionStyleName('')
    }
    setStatusMessage(style?.name ? `Deleted caption style "${style.name}".` : 'Deleted caption style.')
  }, [activeSavedStyleId, savedCaptionStyles])

  // Shared style overrides fed to both the preset card thumbnail and the
  // larger positioning preview, so they always agree.
  const previewGlobalOverrides = useMemo(() => (
    renderPreset?.traditional
      ? {
          ...captionStyleControls,
          subtitleColor: effectiveTextColor,
          subtitlePosition,
          textStyle: globalTextStyle,
          sizeScale: globalSizeScale,
          verticalOffset: globalVerticalOffset,
        }
      : {
          ...captionStyleControls,
          motionProfile: globalMotion !== 'auto' ? globalMotion : undefined,
          sizeScale: globalSizeScale,
          verticalPlacement: globalVertical !== 'auto' ? globalVertical : undefined,
          horizontalPlacement: globalHorizontal !== 'auto' ? globalHorizontal : undefined,
          verticalOffset: globalVerticalOffset,
          textStyle: globalTextStyle,
        }
  ), [captionStyleControls, renderPreset?.traditional, globalMotion, globalSizeScale, globalVertical, globalHorizontal, globalVerticalOffset, globalTextStyle, effectiveTextColor, subtitlePosition])

  // Live thumbnail for the selected preset card.
  const selectedPreviewUrl = useMemo(() => {
    if (!renderPreset) return null
    return renderCaptionPresetPreviewDataUrl(renderPreset, 240, 140, previewGlobalOverrides)
  }, [renderPreset, previewGlobalOverrides])

  const renderSettings = useMemo(() => ({
    width: Math.max(320, Math.round(Number(timelineSize?.width) || 1920)),
    height: Math.max(180, Math.round(Number(timelineSize?.height) || 1080)),
    fps: Math.max(12, Math.round(Number(timelineSize?.fps) || Number(asset?.fps) || 24)),
  }), [asset?.fps, timelineSize])

  // Preview canvas size at the project aspect ratio (longest edge ~480px).
  const previewDims = useMemo(() => {
    const projW = renderSettings.width
    const projH = renderSettings.height
    const longEdge = 480
    const scale = longEdge / Math.max(projW, projH)
    return {
      w: Math.max(120, Math.round(projW * scale)),
      h: Math.max(120, Math.round(projH * scale)),
    }
  }, [renderSettings])

  // Total timeline the preview plays over: the real cues' span, or the sample.
  const previewDuration = useMemo(() => {
    const maxEnd = (draft.cues || []).reduce((m, c) => Math.max(m, Number(c?.end) || 0), 0)
    return maxEnd > 0.4 ? maxEnd : 2.6
  }, [draft.cues])

  // Cues fed to the preview, each carrying the current global style overrides.
  const previewCues = useMemo(() => {
    const base = (draft.cues && draft.cues.length)
      ? draft.cues
      : [{ id: 'preview-sample', start: 0, end: 2.4, text: renderPreset?.sampleText || 'your caption here' }]
    return base.map((c) => ({ ...c, globalOverrides: previewGlobalOverrides }))
  }, [draft.cues, renderPreset, previewGlobalOverrides])

  // Draw one preview frame: footage (or gradient) behind, caption overlay on top.
  // freeze = settled still (no entrance fade) so paused/scrubbed frames never blank.
  const drawPreview = useCallback((timeSec, freeze) => {
    const canvas = previewCanvasRef.current
    if (!canvas || !renderPreset) return
    const { w, h } = previewDims
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (bgCanvasRef.current) {
      drawCover(ctx, bgCanvasRef.current, w, h)
    } else {
      const gradient = ctx.createLinearGradient(0, 0, 0, h)
      gradient.addColorStop(0, '#6b7280')
      gradient.addColorStop(1, '#374151')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, w, h)
    }

    let overlay = overlayCanvasRef.current
    if (!overlay) {
      overlay = document.createElement('canvas')
      overlayCanvasRef.current = overlay
    }
    if (overlay.width !== w) overlay.width = w
    if (overlay.height !== h) overlay.height = h
    const octx = overlay.getContext('2d')
    if (octx) {
      renderCaptionFrame({
        ctx: octx,
        width: w,
        height: h,
        preset: renderPreset,
        cues: previewCues,
        time: timeSec,
        freeze,
        transparent: true,
      })
      ctx.drawImage(overlay, 0, 0)
    }
  }, [previewDims, renderPreset, previewCues])

  // Redraw a settled still whenever paused (style/cue/footage changes, scrubbing).
  useEffect(() => {
    if (isPreviewPlaying) return
    drawPreview(previewTimeRef.current, true)
  }, [isPreviewPlaying, drawPreview, bgVersion])

  // Playback loop: advance time with the real clock and draw full-animation frames.
  useEffect(() => {
    if (!isPreviewPlaying || !isOpen) return
    if (previewTimeRef.current >= previewDuration - 0.01) previewTimeRef.current = 0
    let last = performance.now()
    let acc = 0
    const tick = (ts) => {
      const dt = (ts - last) / 1000
      last = ts
      let nt = previewTimeRef.current + dt
      if (nt >= previewDuration) nt = 0
      previewTimeRef.current = nt
      drawPreview(nt, false)
      acc += dt
      if (acc >= 0.1) { acc = 0; setScrubDisplay(nt) }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isPreviewPlaying, isOpen, previewDuration, drawPreview])

  useEffect(() => {
    if (!isOpen || !asset) return

    let cancelled = false
    setError('')
    setStatusMessage('Transcribe audio locally to begin.')
    setPlaceOnTimeline(true)
    setActiveSavedStyleId(null)
    setCaptionStyleName('')
    const nextPresetId = asset?.settings?.lastCaptionPresetId || DEFAULT_CAPTION_PRESET_ID
    setSelectedPresetId(nextPresetId)
    // Seed accent color from the saved preference, falling back to the
    // preset's registered default so the picker starts on-brand.
    const savedAccent = asset?.settings?.lastCaptionAccentColor
    const nextPreset = getCaptionPresetById(nextPresetId)
    const presetDefault = nextPreset?.keyWordColor || DEFAULT_KINETIC_ACCENT_COLOR
    setAccentColor(savedAccent || presetDefault)
    setTextColor(null)
    setGlobalTextStyle(nextPreset?.defaultTextStyle || (nextPreset?.traditional ? 'background' : 'plain'))
    setGlobalFontFamily(nextPreset?.fontFamily || 'Inter')
    setBackgroundColor('#000000')
    setBackgroundOpacity(65)
    setBackgroundPadding(nextPreset?.traditional ? 60 : 45)
    setBackgroundRadius(nextPreset?.traditional ? 30 : 25)
    setOutlineColor('#000000')
    setOutlineThickness(9)
    setShadowColor('#000000')
    setShadowOpacity(75)
    setShadowBlur(nextPreset?.traditional ? 25 : 18)
    setShadowDistance(5)
    setSubtitlePosition(nextPreset?.subtitlePosition || 'action-safe')
    setIsPreviewPlaying(false)
    previewTimeRef.current = 1.2
    setScrubDisplay(1.2)
    setDraft(createEmptyDraft(asset))

    // Hydrate a previously saved draft (cues + style) from a caption sidecar.
    // Shared by asset scope and the timeline cold-start path.
    const applySidecarDraft = (existingDraft) => {
      setDraft({
        modelId: existingDraft.modelId || null,
        transcriptText: String(existingDraft.transcriptText || ''),
        words: Array.isArray(existingDraft.words) ? existingDraft.words : [],
        cues: normalizeCueOrder(existingDraft.cues, existingDraft.audioDuration || asset?.duration),
        audioDuration: existingDraft.audioDuration || Number(asset?.duration) || null,
      })
      setSelectedPresetId(existingDraft.presetId || asset?.settings?.lastCaptionPresetId || DEFAULT_CAPTION_PRESET_ID)
      if (existingDraft.accentColor) setAccentColor(existingDraft.accentColor)
      setTextColor(existingDraft.textColor ?? null)
      if (existingDraft.textStyle) setGlobalTextStyle(existingDraft.textStyle)
      if (existingDraft.subtitlePosition) setSubtitlePosition(existingDraft.subtitlePosition)
      const existingStyleControls = existingDraft.styleControls && typeof existingDraft.styleControls === 'object'
        ? existingDraft.styleControls
        : {}
      if (existingStyleControls.fontFamily) setGlobalFontFamily(existingStyleControls.fontFamily)
      if (existingStyleControls.backgroundColor) setBackgroundColor(existingStyleControls.backgroundColor)
      if (typeof existingStyleControls.backgroundOpacity === 'number') setBackgroundOpacity(existingStyleControls.backgroundOpacity)
      if (typeof existingStyleControls.backgroundPadding === 'number') setBackgroundPadding(existingStyleControls.backgroundPadding)
      if (typeof existingStyleControls.backgroundRadius === 'number') setBackgroundRadius(existingStyleControls.backgroundRadius)
      if (existingStyleControls.outlineColor) setOutlineColor(existingStyleControls.outlineColor)
      if (typeof existingStyleControls.outlineThickness === 'number') setOutlineThickness(existingStyleControls.outlineThickness)
      if (existingStyleControls.shadowColor) setShadowColor(existingStyleControls.shadowColor)
      if (typeof existingStyleControls.shadowOpacity === 'number') setShadowOpacity(existingStyleControls.shadowOpacity)
      if (typeof existingStyleControls.shadowBlur === 'number') setShadowBlur(existingStyleControls.shadowBlur)
      if (typeof existingStyleControls.shadowDistance === 'number') setShadowDistance(existingStyleControls.shadowDistance)
    }

    // Timeline scope restores the in-memory session cache first (survives a
    // reopen), then falls back to the sidecar saved by the last generated
    // timeline overlay (survives an app restart).
    if (isTimelineScope) {
      const cached = currentProjectHandle ? timelineCaptionSessionCache.get(currentProjectHandle) : null
      if (cached?.draft) {
        setDraft(cached.draft)
        if (cached.selectedPresetId) setSelectedPresetId(cached.selectedPresetId)
        if (cached.accentColor) setAccentColor(cached.accentColor)
        setTextColor(cached.textColor ?? null)
        if (cached.globalTextStyle) setGlobalTextStyle(cached.globalTextStyle)
        if (cached.globalFontFamily) setGlobalFontFamily(cached.globalFontFamily)
        if (cached.backgroundColor) setBackgroundColor(cached.backgroundColor)
        if (typeof cached.backgroundOpacity === 'number') setBackgroundOpacity(cached.backgroundOpacity)
        if (typeof cached.backgroundPadding === 'number') setBackgroundPadding(cached.backgroundPadding)
        if (typeof cached.backgroundRadius === 'number') setBackgroundRadius(cached.backgroundRadius)
        if (cached.outlineColor) setOutlineColor(cached.outlineColor)
        if (typeof cached.outlineThickness === 'number') setOutlineThickness(cached.outlineThickness)
        if (cached.shadowColor) setShadowColor(cached.shadowColor)
        if (typeof cached.shadowOpacity === 'number') setShadowOpacity(cached.shadowOpacity)
        if (typeof cached.shadowBlur === 'number') setShadowBlur(cached.shadowBlur)
        if (typeof cached.shadowDistance === 'number') setShadowDistance(cached.shadowDistance)
        if (cached.subtitlePosition) setSubtitlePosition(cached.subtitlePosition)
        if (cached.globalVertical) setGlobalVertical(cached.globalVertical)
        if (cached.globalHorizontal) setGlobalHorizontal(cached.globalHorizontal)
        if (cached.globalMotion) setGlobalMotion(cached.globalMotion)
        if (typeof cached.globalSizeScale === 'number') setGlobalSizeScale(cached.globalSizeScale)
        if (typeof cached.globalVerticalOffset === 'number') setGlobalVerticalOffset(cached.globalVerticalOffset)
        setStatusMessage('Restored your last timeline captions — re-transcribe if the audio changed.')
      } else if (currentProjectHandle && timelineCaptionSidecarPath) {
        ;(async () => {
          try {
            const existingDraft = await loadCaptionSidecar(currentProjectHandle, timelineCaptionSidecarPath)
            if (!existingDraft || cancelled) return
            applySidecarDraft(existingDraft)
            setStatusMessage('Restored your last timeline captions — re-transcribe if the audio changed.')
          } catch (loadError) {
            if (!cancelled) {
              console.warn('Could not load the timeline caption draft:', loadError)
            }
          }
        })()
      }
      return () => {
        cancelled = true
      }
    }

    const transcriptPath = asset?.settings?.captionTranscriptPath
    if (!currentProjectHandle || !transcriptPath) return undefined

    ;(async () => {
      try {
        const existingDraft = await loadCaptionSidecar(currentProjectHandle, transcriptPath)
        if (!existingDraft || cancelled) return
        applySidecarDraft(existingDraft)
        setStatusMessage('Loaded the last saved caption draft for this video.')
      } catch (loadError) {
        if (!cancelled) {
          console.warn('Could not load existing caption draft:', loadError)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [asset, scope, currentProjectHandle, timelineCaptionSidecarPath, isOpen])

  // Grab a representative still for the positioning preview. Asset scope uses
  // the source clip (mid-point); timeline scope uses the frame under the
  // playhead (passed in via the pseudo-asset). Falls back to the gradient when
  // there's no video frame available.
  const captureUrl = isTimelineScope ? asset?.bgVideoUrl : asset?.url
  const captureTime = isTimelineScope ? Number(asset?.bgVideoTime) : NaN
  useEffect(() => {
    bgCanvasRef.current = null
    setBgVersion((v) => v + 1)
    if (!isOpen || !captureUrl) return undefined

    let cancelled = false
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'

    const capture = () => {
      if (cancelled) return
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (!vw || !vh) return
      try {
        const cap = 1280
        const s = Math.min(1, cap / Math.max(vw, vh))
        const frame = document.createElement('canvas')
        frame.width = Math.round(vw * s)
        frame.height = Math.round(vh * s)
        const fctx = frame.getContext('2d')
        if (!fctx) return
        fctx.drawImage(video, 0, 0, frame.width, frame.height)
        bgCanvasRef.current = frame
        setBgVersion((v) => v + 1)
      } catch (_) {
        bgCanvasRef.current = null
      }
    }

    const onLoaded = () => {
      const fallback = Math.min(1, (Number(video.duration) || 2) / 2)
      const target = Number.isFinite(captureTime) ? Math.max(0, captureTime) : fallback
      try {
        video.currentTime = target
      } catch (_) {
        capture()
      }
    }

    video.addEventListener('loadeddata', onLoaded, { once: true })
    video.addEventListener('seeked', capture, { once: true })
    video.src = captureUrl

    return () => {
      cancelled = true
      video.removeAttribute('src')
      try { video.load() } catch (_) { /* noop */ }
    }
  }, [captureUrl, captureTime, isOpen])

  // The engine row needs to know whether the local whisper engine is
  // installed; refresh whenever the dialog opens.
  useEffect(() => {
    if (!isOpen) return undefined
    let cancelled = false
    getLocalCaptionEngineStatus().then((status) => {
      if (!cancelled) setEngineStatus(status)
    })
    return () => { cancelled = true }
  }, [isOpen])

  if (!isOpen || !asset) return null

  const busy = isTranscribing || isGenerating
  const cueDuration = getDraftDuration(draft, asset)

  const CAPTION_MODEL_TIERS = [
    { id: 'base', label: 'Fast', size: '142 MB' },
    { id: 'small', label: 'Accurate', size: '466 MB' },
    { id: 'large-v3-turbo', label: 'Best', size: '1.6 GB' },
  ]
  const engineStatusLoaded = Boolean(engineStatus)
  const localEngineSupported = Boolean(engineStatus?.platformSupported)
  // Platforms without a whisper build (macOS until our CI produces one) keep
  // captions on ComfyUI instead of losing them outright.
  const platformUsesComfy = engineStatusLoaded && !localEngineSupported
  const hasEngineBinary = Boolean(engineStatus?.binaryPath)
  const installedModelIds = new Set((engineStatus?.models || []).map((m) => m.id))
  const selectedTier = CAPTION_MODEL_TIERS.find((tier) => tier.id === modelPreference) || CAPTION_MODEL_TIERS[0]
  const selectedTierInstalled = hasEngineBinary && installedModelIds.has(selectedTier.id)
  const canRemoveModels = canRemoveLocalCaptionModels()
  const removableTiers = CAPTION_MODEL_TIERS.filter(
    (tier) => installedModelIds.has(tier.id) && tier.id !== selectedTier.id
  )
  // The retired ComfyUI path stays reachable through a localStorage escape
  // hatch only ('velorn-caption-engine' = 'comfyui') — no UI for it.
  const captionsUseComfy = getCaptionEnginePreference() === 'comfyui' || platformUsesComfy
  const engineReady = captionsUseComfy || selectedTierInstalled
  const showEngineInstall = !captionsUseComfy && localEngineSupported && !selectedTierInstalled
  const engineStatusLine = platformUsesComfy
    ? 'Local captions are not available on this platform yet — using ComfyUI (Qwen3-ASR).'
    : captionsUseComfy
      ? 'Using ComfyUI (Qwen3-ASR) — legacy override.'
      : isInstallingEngine
        ? (engineInstallProgress?.message || 'Installing caption engine…')
        : selectedTierInstalled
          ? (selectedTier.id === 'large-v3-turbo'
            ? 'Runs on this machine — top accuracy, roughly realtime on CPU.'
            : 'Runs on this machine — no ComfyUI needed.')
          : 'One-time download — captions run on this machine, no ComfyUI needed.'

  // Timeline mode can always transcribe (the audio mixer will report no-audio
  // conditions at mix time with a clear message). Asset mode still needs a
  // video with an audio track.
  const canTranscribe = engineReady && !isInstallingEngine && (isTimelineScope
    ? !busy
    : (asset.type === 'video' && asset.hasAudio !== false && !busy))
  const canGenerate = draft.cues.length > 0 && !busy && addAsset

  const updateCue = (cueId, field, value) => {
    setDraft((prev) => {
      const nextCues = normalizeCueOrder(
        prev.cues.map((cue) => (
          cue.id === cueId
            ? { ...cue, [field]: field === 'text' ? value : Number(value) }
            : cue
        )),
        prev.audioDuration || cueDuration
      )
      return {
        ...prev,
        cues: nextCues,
        transcriptText: cuesToTranscript(nextCues),
      }
    })
  }

  const updateCueOverride = (cueId, field, value) => {
    setDraft((prev) => {
      const nextCues = normalizeCueOrder(
        prev.cues.map((cue) => (
          cue.id === cueId
            ? {
                ...cue,
                override: {
                  ...normalizeCueOverride(cue.override),
                  [field]: value,
                },
              }
            : cue
        )),
        prev.audioDuration || cueDuration
      )

      return {
        ...prev,
        cues: nextCues,
        transcriptText: cuesToTranscript(nextCues),
      }
    })
  }

  const removeCue = (cueId) => {
    setDraft((prev) => {
      const nextCues = prev.cues.filter((cue) => cue.id !== cueId)
      return {
        ...prev,
        cues: nextCues,
        transcriptText: cuesToTranscript(nextCues),
      }
    })
  }

  // Persist the timeline caption setup so reopening the dialog restores the
  // transcription and style choices instead of forcing a re-transcribe.
  const stashTimelineSession = (draftToStash) => {
    if (!isTimelineScope || !currentProjectHandle || !draftToStash) return
    timelineCaptionSessionCache.set(currentProjectHandle, {
      draft: draftToStash,
      selectedPresetId,
      accentColor,
      textColor,
      globalTextStyle,
      globalFontFamily,
      backgroundColor,
      backgroundOpacity,
      backgroundPadding,
      backgroundRadius,
      outlineColor,
      outlineThickness,
      shadowColor,
      shadowOpacity,
      shadowBlur,
      shadowDistance,
      subtitlePosition,
      globalVertical,
      globalHorizontal,
      globalMotion,
      globalSizeScale,
      globalVerticalOffset,
    })
  }

  const refreshEngineStatus = async () => {
    const status = await getLocalCaptionEngineStatus()
    setEngineStatus(status)
    return status
  }

  const handleModelPreferenceChange = (value) => {
    setCaptionModelPreference(value)
    setModelPreference(value)
  }

  const handleInstallEngine = async () => {
    setError('')
    setErrorExpanded(false)
    setIsInstallingEngine(true)
    setEngineInstallProgress(null)
    try {
      await installLocalCaptionEngine({
        modelId: modelPreference,
        onProgress: (update) => setEngineInstallProgress(update),
      })
      const status = await refreshEngineStatus()
      setStatusMessage(status?.available
        ? 'Local caption engine installed — transcription now runs on this machine.'
        : 'The install finished but the engine did not come up — try again or use ComfyUI.')
    } catch (installError) {
      setError(installError?.message || 'Caption engine install failed.')
      await refreshEngineStatus()
    } finally {
      setIsInstallingEngine(false)
      setEngineInstallProgress(null)
    }
  }

  const handleRemoveModel = async (modelId) => {
    setError('')
    setErrorExpanded(false)
    try {
      const result = await removeLocalCaptionModel(modelId)
      await refreshEngineStatus()
      const tier = CAPTION_MODEL_TIERS.find((t) => t.id === modelId)
      const freedMB = Math.round((Number(result?.freedBytes) || 0) / 1e6)
      setStatusMessage(`Removed the ${tier?.label || modelId} model${freedMB ? ` — freed ${freedMB} MB` : ''}.`)
    } catch (removeError) {
      setError(removeError?.message || 'Could not remove the caption model.')
      await refreshEngineStatus()
    }
  }

  const handleTranscribe = async () => {
    setError('')
    setErrorExpanded(false)
    setIsTranscribing(true)
    try {
      const engine = await resolveCaptionEngine()
      const engineLabel = engine === 'local' ? 'the local engine' : 'Qwen3-ASR (ComfyUI)'
      setStatusMessage(
        isTimelineScope
          ? `Mixing timeline audio for ${engineLabel}…`
          : (engine === 'local'
            ? 'Transcribing on this machine…'
            : 'Connecting to ComfyUI for Qwen3-ASR transcription...')
      )

      const onProgress = (progress) => {
        setStatusMessage(progress?.message || 'Transcribing…')
        const value = Number(progress?.progress)
        setTranscribeProgress(Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null)
      }

      const nextDraft = isTimelineScope
        ? await transcribeTimelineAudio({ onProgress })
        : await transcribeAsset(asset, { onProgress })

      const normalizedDraft = {
        ...nextDraft,
        cues: normalizeCueOrder(nextDraft.cues, nextDraft.audioDuration || asset?.duration),
      }
      setDraft(normalizedDraft)
      stashTimelineSession(normalizedDraft)

      setStatusMessage(`Transcribed ${nextDraft.cues.length} caption cues with ${engineLabel}.`)
    } catch (transcriptionError) {
      setError(
        transcriptionError?.message
        || (isTimelineScope
          ? 'Could not transcribe the timeline audio.'
          : 'Could not transcribe this video.')
      )
    } finally {
      setIsTranscribing(false)
      setTranscribeProgress(null)
    }
  }

  const handleGenerate = async () => {
    if (!canGenerate) return
    if (!currentProjectHandle || typeof currentProjectHandle !== 'string') {
      setError('Open a desktop project before generating captions.')
      return
    }

    // The destructive step lives here, not at open: generating a timeline pass
    // replaces the caption track already on the timeline.
    if (isTimelineScope && placeOnTimeline && hasExistingTimelineCaptions) {
      const ok = window.confirm(
        'This will replace the captions track currently on your timeline with the new one.\n\nContinue?'
      )
      if (!ok) return
    }

    setError('')
    setIsGenerating(true)

    try {
      const normalizedCues = normalizeCueOrder(draft.cues, cueDuration)
      const timestamp = new Date().toISOString()

      // Keep the timeline setup so reopening to tweak doesn't lose the transcription.
      stashTimelineSession({ ...draft, cues: normalizedCues })

      // Save the editable draft as a sidecar for BOTH scopes so the rendered
      // overlay is self-describing: cues + style survive an app restart and
      // power the Edit Captions round-trip from the timeline clip. Asset
      // scope additionally bookmarks the sidecar on the source asset. Web
      // mode has no sidecars — the overlay still renders.
      const sidecarPayload = {
        version: 1,
        scope: isTimelineScope ? 'timeline' : 'asset',
        ...(isTimelineScope ? {} : {
          sourceAssetId: asset.id,
          sourceAssetName: asset.name,
          sourceAssetPath: asset.path || null,
        }),
        presetId: selectedPreset.id,
        accentColor,
        textColor,
        textStyle: globalTextStyle,
        subtitlePosition,
        styleControls: captionStyleControls,
        modelId: draft.modelId,
        transcriptText: cuesToTranscript(normalizedCues),
        words: draft.words,
        cues: normalizedCues,
        audioDuration: draft.audioDuration || cueDuration,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      let sidecar = null
      try {
        setStatusMessage('Saving editable caption draft...')
        sidecar = await saveCaptionSidecar(
          currentProjectHandle,
          isTimelineScope ? { name: 'timeline' } : asset,
          sidecarPayload
        )
      } catch (sidecarError) {
        console.warn('Could not save the caption sidecar:', sidecarError)
      }

      if (!isTimelineScope && sidecar && typeof updateAsset === 'function') {
        updateAsset(asset.id, {
          settings: {
            ...(asset.settings || {}),
            captionTranscriptPath: sidecar.path,
            lastCaptionPresetId: selectedPreset.id,
            lastCaptionUpdatedAt: timestamp,
          },
        })
      }

      setStatusMessage('Rendering animated caption overlay...')
      const renderCues = normalizedCues.map((cue) => ({
        ...cue,
        globalOverrides: {
          ...captionStyleControls,
          verticalPlacement: globalVertical,
          horizontalPlacement: globalHorizontal,
          motionProfile: globalMotion,
          sizeScale: globalSizeScale,
          verticalOffset: globalVerticalOffset,
          textStyle: globalTextStyle,
          subtitleColor: effectiveTextColor,
          subtitlePosition,
        },
      }))
      const overlayBlob = await generateCaptionVideoBlob({
        preset: renderPreset,
        cues: renderCues,
        width: renderSettings.width,
        height: renderSettings.height,
        duration: cueDuration,
        fps: renderSettings.fps,
        onProgress: (percent) => {
          setGenerateProgress(percent)
          setStatusMessage(`Rendering animated caption overlay… ${percent}%`)
        },
      })
      setGenerateProgress(null)

      const folderId = ensureCaptionsFolder(folders, addFolder)
      const assetName = buildCaptionAssetName(asset, selectedPreset)
      const captionSettings = {
        width: renderSettings.width,
        height: renderSettings.height,
        duration: cueDuration,
        fps: renderSettings.fps,
        hasAlpha: true,
        source: 'captions',
        overlayKind: 'captions',
        // The 'captionScope' tag lets the timeline find (and later replace) an
        // existing timeline-wide caption overlay. Asset-scope overlays keep
        // their source linkage as before.
        captionScope: isTimelineScope ? 'timeline' : 'asset',
        ...(isTimelineScope ? {} : { sourceAssetId: asset.id }),
        captionPresetId: selectedPreset.id,
        ...(sidecar?.path ? { captionTranscriptPath: sidecar.path } : {}),
        captionCueCount: normalizedCues.length,
        captionModelId: draft.modelId,
      }

      let createdAsset
      if (isElectron() && typeof currentProjectHandle === 'string') {
        const persisted = await writeGeneratedOverlayToProject(
          currentProjectHandle,
          overlayBlob,
          assetName,
          'video',
          captionSettings
        )

        createdAsset = addAsset({
          ...persisted,
          folderId,
          settings: {
            ...(persisted.settings || {}),
            ...captionSettings,
          },
        })
      } else {
        createdAsset = addAsset({
          name: assetName,
          type: 'video',
          url: URL.createObjectURL(overlayBlob),
          folderId,
          mimeType: overlayBlob.type || 'video/webm',
          size: overlayBlob.size,
          isImported: false,
          hasAudio: false,
          audioEnabled: false,
          duration: cueDuration,
          settings: captionSettings,
        })
      }

      if (!isTimelineScope && typeof updateAsset === 'function' && createdAsset?.id) {
        updateAsset(asset.id, {
          settings: {
            ...(asset.settings || {}),
            ...(sidecar?.path ? { captionTranscriptPath: sidecar.path } : {}),
            lastCaptionPresetId: selectedPreset.id,
            lastCaptionAccentColor: accentColor,
            lastCaptionAssetId: createdAsset.id,
            lastCaptionUpdatedAt: timestamp,
          },
        })
      }

      if (placeOnTimeline && typeof onPlaceOnTimeline === 'function' && createdAsset) {
        await onPlaceOnTimeline(createdAsset, isTimelineScope ? null : asset)
      }

      setStatusMessage('Caption overlay added to assets.')
      onClose?.()
    } catch (generationError) {
      setError(generationError?.message || 'Could not generate animated captions.')
    } finally {
      setIsGenerating(false)
      setGenerateProgress(null)
    }
  }

  const selectedCue = draft.cues.find((cue) => cue.id === selectedCueId) || null

  // Engine + vocabulary controls, shared between the first-run card and the
  // post-transcription strip. A plain render function (not a component) so the
  // controlled vocabulary input keeps focus across re-renders.
  const renderEngineControls = () => (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sf-dark-700 bg-sf-dark-950/60 p-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-sf-text-primary">Transcription model</div>
          <div className="text-[11px] text-sf-text-muted">{engineStatusLine}</div>
          {isInstallingEngine && Number.isFinite(Number(engineInstallProgress?.percent)) && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-sf-dark-700">
              <div
                className="h-full rounded-full bg-sf-accent transition-[width] duration-300"
                style={{ width: `${Math.max(2, Number(engineInstallProgress.percent))}%` }}
              />
            </div>
          )}
        </div>
        {!captionsUseComfy && (
          <div className="flex items-center gap-2">
            <select
              value={modelPreference}
              onChange={(event) => handleModelPreferenceChange(event.target.value)}
              disabled={busy || isInstallingEngine}
              className="rounded-lg border border-sf-dark-600 bg-sf-dark-950 px-2 py-1.5 text-xs text-sf-text-primary focus:border-sf-accent focus:outline-none"
            >
              {CAPTION_MODEL_TIERS.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {`${tier.label} (${tier.size})${installedModelIds.has(tier.id) ? ' ✓' : ''}${tier.id === 'large-v3-turbo' ? ' · Recommended' : ''}`}
                </option>
              ))}
            </select>
            {showEngineInstall && (
              <button
                type="button"
                onClick={handleInstallEngine}
                disabled={isInstallingEngine || busy}
                className="inline-flex items-center gap-2 rounded-lg border border-sf-accent/50 bg-sf-accent/10 px-3 py-1.5 text-xs font-medium text-sf-accent hover:bg-sf-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isInstallingEngine ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                {isInstallingEngine
                  ? (Number.isFinite(Number(engineInstallProgress?.percent))
                    ? `Downloading… ${engineInstallProgress.percent}%`
                    : 'Installing…')
                  : `Download ${selectedTier.label} (${selectedTier.size})`}
              </button>
            )}
          </div>
        )}
      </div>
      {!captionsUseComfy && canRemoveModels && removableTiers.length > 0 && !isInstallingEngine && (
        <details className="rounded-xl border border-sf-dark-700 bg-sf-dark-950/40 px-3 py-2">
          <summary className="cursor-pointer select-none text-[11px] text-sf-text-muted hover:text-sf-text-primary">
            Manage models on disk…
          </summary>
          <div className="mt-2 space-y-1.5">
            {removableTiers.map((tier) => (
              <div key={tier.id} className="flex items-center gap-2 text-[11px] text-sf-text-muted">
                <span>{tier.label} ({tier.size})</span>
                <button
                  type="button"
                  onClick={() => handleRemoveModel(tier.id)}
                  disabled={busy}
                  className="ml-auto rounded-md border border-sf-dark-600 bg-sf-dark-900 px-2 py-0.5 text-[10px] hover:border-sf-error/60 hover:text-sf-error disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
      {!captionsUseComfy && (
        <div className="rounded-xl border border-sf-dark-700 bg-sf-dark-950/60 p-3">
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium text-sf-text-primary">Vocabulary</div>
            <div
              className="cursor-help text-[10px] text-sf-text-muted"
              title="Brand names, people, jargon — helps transcription spell them right. Your project name, timeline names, and on-screen text clips are included automatically."
            >
              ⓘ
            </div>
          </div>
          <input
            type="text"
            value={captionVocabulary}
            onChange={(event) => useProjectStore.getState().updateProjectSettings({ captionVocabulary: event.target.value })}
            placeholder="e.g. Velorn, Seedance, ComfyUI"
            disabled={busy}
            className="mt-2 w-full rounded-lg border border-sf-dark-600 bg-sf-dark-950 px-2 py-1.5 text-xs text-sf-text-primary placeholder:text-sf-text-muted/60 focus:border-sf-accent focus:outline-none disabled:opacity-50"
          />
        </div>
      )}
    </div>
  )

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-7xl max-h-[92vh] overflow-hidden rounded-2xl border border-sf-dark-700 bg-sf-dark-950 shadow-[0_30px_60px_rgba(0,0,0,0.35)]">
        <div className="flex items-center justify-between border-b border-sf-dark-700 px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-sf-text-primary">
              Add Captions
            </div>
            <div className="text-xs text-sf-text-muted mt-1">
              {isTimelineScope
                ? 'Timeline program audio · places captions on a new top track'
                : `${asset.name} · local-first transcription and animated overlay export`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-3 py-2 text-xs text-sf-text-primary hover:bg-sf-dark-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex h-[calc(92vh-72px)] min-h-0 flex-col">
          {draft.cues.length === 0 ? (
            /* First run: one job on screen — get a transcript. Everything else
               (cue editing, style, preview) appears once cues exist. */
            <div className="flex-1 overflow-y-auto p-5">
              <div className="mx-auto mt-6 w-full max-w-xl rounded-2xl border border-sf-dark-700 bg-sf-dark-900/60 p-6">
                <div className="text-base font-semibold text-sf-text-primary">
                  {isTimelineScope ? 'Transcribe your timeline' : 'Transcribe this video'}
                </div>
                <div className="mt-1 mb-5 text-xs text-sf-text-muted">
                  {isTimelineScope
                    ? 'Captions follow the edited program audio — trims, gaps, mutes, and solos all honored.'
                    : 'Speech from this source becomes editable caption cues.'}
                </div>
                {!isTimelineScope && (
                  <div className="mb-4 aspect-video overflow-hidden rounded-xl border border-sf-dark-700 bg-black">
                    {asset.url ? (
                      <video
                        src={asset.url}
                        controls
                        className="h-full w-full bg-black object-contain"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm text-sf-text-muted">
                        Preview unavailable for this asset.
                      </div>
                    )}
                  </div>
                )}
                {renderEngineControls()}
                <button
                  type="button"
                  onClick={handleTranscribe}
                  disabled={!canTranscribe}
                  className="relative overflow-hidden mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sf-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-sf-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isTranscribing && Number.isFinite(transcribeProgress) && (
                    <span
                      className="absolute inset-y-0 left-0 bg-white/25 transition-[width] duration-300 ease-out"
                      style={{ width: `${transcribeProgress}%` }}
                    />
                  )}
                  <span className="relative inline-flex items-center gap-2">
                    {isTranscribing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4" />
                    )}
                    {isTranscribing
                      ? (Number.isFinite(transcribeProgress)
                        ? `Transcribing… ${Math.round(transcribeProgress)}%`
                        : 'Transcribing…')
                      : (isTimelineScope ? 'Transcribe timeline' : 'Transcribe audio')}
                  </span>
                </button>
                {isTimelineScope && (
                  <div className="mt-3 text-center text-[11px] text-sf-text-muted">
                    Busy mix? Solo the dialog or vocal track first for a much cleaner read.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
            {/* Transcription happened — collapse its controls to a strip and
               hand the window to the result. */}
            <div className="flex-shrink-0 border-b border-sf-dark-700 bg-sf-dark-950/60">
              <div className="flex items-center gap-3 px-5 py-2.5">
                <span className="h-2 w-2 flex-shrink-0 rounded-full bg-sf-success" />
                <span className="text-xs text-sf-text-primary">
                  Transcribed with <span className="font-medium">{captionsUseComfy ? 'ComfyUI' : selectedTier.label}</span>
                </span>
                <span className="text-[11px] text-sf-text-muted">
                  {draft.cues.length} cues{asset?.duration ? ` · ${formatSeconds(asset.duration)}` : ''}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTranscribe}
                    disabled={!canTranscribe}
                    className="inline-flex items-center gap-2 rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-3 py-1.5 text-xs text-sf-text-primary hover:bg-sf-dark-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isTranscribing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    {isTranscribing && Number.isFinite(transcribeProgress)
                      ? `Transcribing ${Math.round(transcribeProgress)}%`
                      : 'Re-transcribe'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTranscribeDetailsOpen((v) => !v)}
                    className="rounded-lg border border-sf-dark-600 bg-sf-dark-900 p-1.5 text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-800"
                    title="Transcription settings — model and vocabulary"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${transcribeDetailsOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </div>
              {transcribeDetailsOpen && (
                <div className="border-t border-sf-dark-700 px-5 py-3">
                  {renderEngineControls()}
                </div>
              )}
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 xl:grid-cols-[1.25fr_1fr]">
            {/* The hero: the captions themselves. */}
            <div className="flex min-h-0 flex-col border-r border-sf-dark-700">
              <div className="flex flex-shrink-0 items-center gap-3 border-b border-sf-dark-700 px-5 py-3">
                <div className="text-sm font-medium text-sf-text-primary">Captions</div>
                <div className="text-[11px] text-sf-text-muted">{cueDuration.toFixed(2)}s</div>
                <input
                  type="text"
                  value={cueSearch}
                  onChange={(event) => setCueSearch(event.target.value)}
                  placeholder="Find in captions…"
                  className="ml-auto w-48 rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-3 py-1.5 text-xs text-sf-text-primary placeholder:text-sf-text-muted/60 focus:border-sf-accent focus:outline-none"
                />
              </div>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
                {(() => {
                  const needle = cueSearch.trim().toLowerCase()
                  const visibleCues = needle
                    ? draft.cues.filter((cue) => String(cue.text || '').toLowerCase().includes(needle))
                    : draft.cues
                  if (visibleCues.length === 0) {
                    return (
                      <div className="rounded-xl border border-dashed border-sf-dark-600 bg-sf-dark-950/70 px-4 py-8 text-center text-xs text-sf-text-muted">
                        No captions match “{cueSearch.trim()}”.
                      </div>
                    )
                  }
                  return visibleCues.map((cue) => {
                    const cueIndex = draft.cues.indexOf(cue)
                    const selected = cue.id === selectedCueId
                    return (
                      <div
                        key={cue.id}
                        onClick={() => {
                          setSelectedCueId(cue.id)
                          const t = clamp(Number(cue.start) || 0, 0, previewDuration)
                          previewTimeRef.current = t
                          setScrubDisplay(t)
                          if (isPreviewPlaying) setIsPreviewPlaying(false)
                          else drawPreview(t, true)
                        }}
                        className={`grid w-full cursor-pointer grid-cols-[28px_64px_1fr_auto] items-center gap-2 rounded-lg border-l-2 px-2.5 py-1.5 ${
                          selected
                            ? 'border-sf-accent bg-sf-dark-800'
                            : 'border-transparent hover:bg-sf-dark-800/60'
                        }`}
                      >
                        <span className="text-right text-[11px] text-sf-text-muted">{cueIndex + 1}</span>
                        <span className="font-mono text-[11px] text-sf-text-muted">{formatSeconds(cue.start)}</span>
                        <input
                          type="text"
                          value={cue.text}
                          onChange={(e) => updateCue(cue.id, 'text', e.target.value)}
                          className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-sf-text-primary focus:border-sf-accent focus:bg-sf-dark-900 focus:outline-none"
                        />
                        <span className="font-mono text-[10px] text-sf-text-muted">
                          {Math.max(0, (Number(cue.end) || 0) - (Number(cue.start) || 0)).toFixed(1)}s
                        </span>
                      </div>
                    )
                  })
                })()}
              </div>
              <div className="flex-shrink-0 border-t border-sf-dark-700 px-5 py-2 text-[11px] text-sf-text-muted">
                Click a cue to preview it · type in the row to edit its text · timing and placement on the right
              </div>
            </div>


          <div className="flex min-h-0 flex-col">
          <div className="flex-shrink-0 border-b border-sf-dark-700 bg-sf-dark-950 p-5">
            <section className="rounded-2xl border border-sf-dark-700 bg-sf-dark-900/60 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="text-sm font-medium text-sf-text-primary">Preview</div>
                  <div className="text-xs text-sf-text-muted mt-1">
                    {isTimelineScope
                      ? (asset?.bgVideoUrl
                          ? 'Sample caption over the frame at your playhead.'
                          : 'Sample caption at your timeline aspect ratio.')
                      : 'Sample caption over a frame of your footage. Adjust placement below.'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTikTokOverlay((v) => !v)}
                    className={`rounded-full border px-2.5 py-1 text-[10px] transition-colors ${
                      showTikTokOverlay
                        ? 'border-sf-accent bg-sf-accent/20 text-sf-text-primary'
                        : 'border-sf-dark-600 bg-sf-dark-900 text-sf-text-muted hover:border-sf-dark-500 hover:text-sf-text-primary'
                    }`}
                    title="Show an approximate TikTok UI so you can keep captions clear of it"
                  >
                    TikTok overlay
                  </button>
                  <div className="text-[11px] text-sf-text-muted">
                    {renderSettings.width}×{renderSettings.height}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-center rounded-xl bg-black border border-sf-dark-700 overflow-hidden" style={{ maxHeight: 300 }}>
                <div className="relative" style={{ maxHeight: 300, maxWidth: '100%' }}>
                  <canvas
                    ref={previewCanvasRef}
                    className="block"
                    style={{ maxHeight: 300, maxWidth: '100%' }}
                  />
                  {showTikTokOverlay && (
                    <TikTokGuideOverlay w={renderSettings.width} h={renderSettings.height} />
                  )}
                </div>
              </div>

              {/* Play / scrub controls for the live animated preview */}
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsPreviewPlaying((p) => {
                      const next = !p
                      if (next && previewTimeRef.current >= previewDuration - 0.01) {
                        previewTimeRef.current = 0
                        setScrubDisplay(0)
                      }
                      return next
                    })
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sf-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-sf-accent/90"
                  title="Play the caption animation in this window"
                >
                  {isPreviewPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  {isPreviewPlaying ? 'Pause' : 'Play'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={previewDuration}
                  step={0.01}
                  value={Math.min(scrubDisplay, previewDuration)}
                  onChange={(e) => {
                    const t = Number(e.target.value)
                    previewTimeRef.current = t
                    setScrubDisplay(t)
                    if (isPreviewPlaying) setIsPreviewPlaying(false)
                    else drawPreview(t, true)
                  }}
                  className="flex-1 accent-sf-accent"
                  aria-label="Preview scrubber"
                />
                <span className="text-[10px] text-sf-text-muted font-mono w-16 text-right">
                  {scrubDisplay.toFixed(1)}s / {previewDuration.toFixed(1)}s
                </span>
              </div>
              {showTikTokOverlay && (
                <div className="mt-2 text-[10px] text-sf-text-muted">
                  Approximate TikTok layout — keep key text inside the dashed safe area.
                </div>
              )}
            </section>

          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-5">
            {selectedCue && (
              <section className="rounded-2xl border border-sf-dark-700 bg-sf-dark-900/60 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-sf-text-primary">
                    Cue {draft.cues.indexOf(selectedCue) + 1}
                  </div>
                  <span className="font-mono text-[11px] text-sf-text-muted">
                    {formatSeconds(selectedCue.start)} → {formatSeconds(selectedCue.end)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      removeCue(selectedCue.id)
                      setSelectedCueId(null)
                    }}
                    className="ml-auto rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-2.5 py-1 text-[11px] text-sf-text-muted hover:border-sf-error/60 hover:text-sf-error"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-sf-text-muted">
                    Start
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={selectedCue.start}
                      onChange={(e) => updateCue(selectedCue.id, 'start', e.target.value)}
                      className="mt-1 w-full rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                    />
                  </label>
                  <label className="text-[11px] text-sf-text-muted">
                    End
                    <input
                      type="number"
                      step="0.01"
                      min={selectedCue.start + 0.1}
                      value={selectedCue.end}
                      onChange={(e) => updateCue(selectedCue.id, 'end', e.target.value)}
                      className="mt-1 w-full rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <CueOverrideChips
                    label="Vertical"
                    value={selectedCue.override?.verticalPlacement || 'auto'}
                    options={CUE_VERTICAL_OPTIONS}
                    onChange={(nextValue) => updateCueOverride(selectedCue.id, 'verticalPlacement', nextValue)}
                  />
                  <CueOverrideChips
                    label="Horizontal"
                    value={selectedCue.override?.horizontalPlacement || 'auto'}
                    options={CUE_HORIZONTAL_OPTIONS}
                    onChange={(nextValue) => updateCueOverride(selectedCue.id, 'horizontalPlacement', nextValue)}
                  />
                  <CueOverrideChips
                    label="Motion"
                    value={selectedCue.override?.motionProfile || 'auto'}
                    options={CUE_MOTION_OPTIONS}
                    onChange={(nextValue) => updateCueOverride(selectedCue.id, 'motionProfile', nextValue)}
                  />
                </div>
              </section>
            )}
            <section className="rounded-2xl border border-sf-dark-700 bg-sf-dark-900/60 p-4 space-y-3">
              <div>
                <div className="text-sm font-medium text-sf-text-primary">Style</div>
                <div className="text-xs text-sf-text-muted mt-1">
                  Applies to all cues. Per-cue overrides take priority.
                </div>
              </div>

              {/* One compact row: presets and saved styles share a dropdown.
                  The live preview above is the real thumbnail. */}
              <div className="flex items-center gap-2">
                <span className="w-[64px] flex-shrink-0 text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">Preset</span>
                <select
                  value={activeSavedStyleId ? `saved:${activeSavedStyleId}` : `preset:${selectedPresetId}`}
                  onChange={(event) => {
                    const raw = event.target.value
                    if (raw.startsWith('saved:')) {
                      const style = savedCaptionStyles.find((s) => s.id === raw.slice(6))
                      if (style) applyCaptionStyle(style)
                      return
                    }
                    const preset = getCaptionPresetById(raw.slice(7))
                    if (!preset) return
                    setSelectedPresetId(preset.id)
                    setAccentColor(preset.keyWordColor || DEFAULT_KINETIC_ACCENT_COLOR)
                    setTextColor(null)
                    setGlobalTextStyle(preset.defaultTextStyle || (preset.traditional ? 'background' : 'plain'))
                    setGlobalFontFamily(preset.fontFamily || 'Inter')
                    setBackgroundColor('#000000')
                    setBackgroundOpacity(65)
                    setBackgroundPadding(preset.traditional ? 60 : 45)
                    setBackgroundRadius(preset.traditional ? 30 : 25)
                    setOutlineColor('#000000')
                    setOutlineThickness(9)
                    setShadowColor('#000000')
                    setShadowOpacity(75)
                    setShadowBlur(preset.traditional ? 25 : 18)
                    setShadowDistance(5)
                    setSubtitlePosition(preset.subtitlePosition || 'action-safe')
                    setActiveSavedStyleId(null)
                    setCaptionStyleName('')
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-sf-dark-600 bg-sf-dark-950 px-2 py-2 text-sm text-sf-text-primary focus:border-sf-accent focus:outline-none"
                >
                  <optgroup label="Presets">
                    {CAPTION_PRESETS.map((preset) => (
                      <option key={preset.id} value={`preset:${preset.id}`}>
                        {`${preset.name} — ${preset.description}`}
                      </option>
                    ))}
                  </optgroup>
                  {savedCaptionStyles.length > 0 && (
                    <optgroup label="Saved styles">
                      {savedCaptionStyles.map((style) => (
                        <option key={style.id} value={`saved:${style.id}`}>
                          {style.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {activeSavedStyleId && (
                  <button
                    type="button"
                    onClick={() => deleteSavedCaptionStyle(activeSavedStyleId)}
                    className="rounded-lg border border-sf-dark-600 bg-sf-dark-900 p-2 text-sf-text-muted hover:border-sf-error/60 hover:text-sf-error"
                    title="Delete this saved style"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="rounded-xl border border-sf-dark-700 bg-sf-dark-950/40 px-3 py-3 space-y-3">
                <ColorField
                  label="Text color"
                  hint="Base color for the words."
                  value={effectiveTextColor}
                  onChange={setTextColor}
                  onReset={() => setTextColor(null)}
                  resetDisabled={textColor === null}
                />
                {!selectedPreset?.traditional && selectedPreset?.accentCustomizable && (
                  <ColorField
                    label="Accent color"
                    hint="The word currently being spoken."
                    value={accentColor}
                    onChange={setAccentColor}
                    onReset={() => setAccentColor(selectedPreset.keyWordColor || DEFAULT_KINETIC_ACCENT_COLOR)}
                    resetDisabled={accentColor === (selectedPreset.keyWordColor || DEFAULT_KINETIC_ACCENT_COLOR)}
                  />
                )}
              </div>

              <label className="block text-xs text-sf-text-secondary">
                <span className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">
                  Font
                </span>
                <select
                  value={globalFontFamily}
                  onChange={(event) => setGlobalFontFamily(event.target.value)}
                  className="w-full rounded-lg border border-sf-dark-600 bg-sf-dark-950 px-3 py-2 text-sm text-sf-text-primary focus:border-sf-accent focus:outline-none"
                >
                  {CAPTION_FONT_OPTIONS.map((font) => (
                    <option key={font.id} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                </select>
              </label>

              <CueOverrideChips
                label="Text Style"
                value={globalTextStyle}
                options={TEXT_STYLE_OPTIONS}
                onChange={setGlobalTextStyle}
              />

              <details className="rounded-xl border border-sf-dark-700 bg-sf-dark-950/40 px-3 py-3">
                <summary className="cursor-pointer select-none text-xs font-medium text-sf-text-secondary hover:text-sf-text-primary">
                  Advanced style
                </summary>
                <div className="mt-3 space-y-4">
                  <div className="space-y-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">Background</div>
                    <ColorField
                      label="Color"
                      hint="Used when Text Style is Background."
                      value={backgroundColor}
                      onChange={setBackgroundColor}
                      onReset={() => setBackgroundColor('#000000')}
                      resetDisabled={backgroundColor === '#000000'}
                    />
                    <RangeField
                      label="Opacity"
                      value={backgroundOpacity}
                      min={0}
                      max={100}
                      step={5}
                      unit="%"
                      leftLabel="Clear"
                      rightLabel="Solid"
                      onChange={setBackgroundOpacity}
                      onReset={() => setBackgroundOpacity(65)}
                      resetDisabled={backgroundOpacity === 65}
                    />
                    <RangeField
                      label="Padding"
                      value={backgroundPadding}
                      min={10}
                      max={90}
                      step={5}
                      unit="%"
                      leftLabel="Tight"
                      rightLabel="Roomy"
                      onChange={setBackgroundPadding}
                      onReset={() => setBackgroundPadding(selectedPreset?.traditional ? 60 : 45)}
                      resetDisabled={backgroundPadding === (selectedPreset?.traditional ? 60 : 45)}
                    />
                    <RangeField
                      label="Radius"
                      value={backgroundRadius}
                      min={0}
                      max={60}
                      step={5}
                      unit="%"
                      leftLabel="Sharp"
                      rightLabel="Round"
                      onChange={setBackgroundRadius}
                      onReset={() => setBackgroundRadius(selectedPreset?.traditional ? 30 : 25)}
                      resetDisabled={backgroundRadius === (selectedPreset?.traditional ? 30 : 25)}
                    />
                  </div>

                  <div className="space-y-2 border-t border-sf-dark-700 pt-3">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">Outline</div>
                    <ColorField
                      label="Color"
                      hint="Used when Text Style is Outline."
                      value={outlineColor}
                      onChange={setOutlineColor}
                      onReset={() => setOutlineColor('#000000')}
                      resetDisabled={outlineColor === '#000000'}
                    />
                    <RangeField
                      label="Thickness"
                      value={outlineThickness}
                      min={0}
                      max={22}
                      step={1}
                      unit="%"
                      leftLabel="Thin"
                      rightLabel="Thick"
                      onChange={setOutlineThickness}
                      onReset={() => setOutlineThickness(9)}
                      resetDisabled={outlineThickness === 9}
                    />
                  </div>

                  <div className="space-y-2 border-t border-sf-dark-700 pt-3">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">Shadow</div>
                    <ColorField
                      label="Color"
                      hint="Used when Text Style is Shadow."
                      value={shadowColor}
                      onChange={setShadowColor}
                      onReset={() => setShadowColor('#000000')}
                      resetDisabled={shadowColor === '#000000'}
                    />
                    <RangeField
                      label="Opacity"
                      value={shadowOpacity}
                      min={0}
                      max={100}
                      step={5}
                      unit="%"
                      leftLabel="Clear"
                      rightLabel="Solid"
                      onChange={setShadowOpacity}
                      onReset={() => setShadowOpacity(75)}
                      resetDisabled={shadowOpacity === 75}
                    />
                    <RangeField
                      label="Blur"
                      value={shadowBlur}
                      min={0}
                      max={60}
                      step={2}
                      unit="%"
                      leftLabel="Hard"
                      rightLabel="Soft"
                      onChange={setShadowBlur}
                      onReset={() => setShadowBlur(selectedPreset?.traditional ? 25 : 18)}
                      resetDisabled={shadowBlur === (selectedPreset?.traditional ? 25 : 18)}
                    />
                    <RangeField
                      label="Distance"
                      value={shadowDistance}
                      min={0}
                      max={30}
                      step={1}
                      unit="%"
                      leftLabel="Near"
                      rightLabel="Far"
                      onChange={setShadowDistance}
                      onReset={() => setShadowDistance(5)}
                      resetDisabled={shadowDistance === 5}
                    />
                  </div>
                </div>
              </details>

              {selectedPreset?.traditional ? (
                <CueOverrideChips
                  label="Position"
                  value={subtitlePosition}
                  options={SUBTITLE_POSITION_OPTIONS}
                  onChange={setSubtitlePosition}
                />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <CueOverrideChips
                    label="Vertical"
                    value={globalVertical}
                    options={CUE_VERTICAL_OPTIONS}
                    onChange={setGlobalVertical}
                  />
                  <CueOverrideChips
                    label="Horizontal"
                    value={globalHorizontal}
                    options={CUE_HORIZONTAL_OPTIONS}
                    onChange={setGlobalHorizontal}
                  />
                  <CueOverrideChips
                    label="Motion"
                    value={globalMotion}
                    options={CUE_MOTION_OPTIONS}
                    onChange={setGlobalMotion}
                  />
                </div>
              )}

              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">
                    Size
                  </div>
                  <button
                    type="button"
                    onClick={() => setGlobalSizeScale(1)}
                    disabled={globalSizeScale === 1}
                    className="text-[10px] text-sf-text-muted hover:text-sf-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Reset to default size"
                  >
                    Reset
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-sf-text-muted w-10 text-right">Smaller</span>
                  <input
                    type="range"
                    min={30}
                    max={180}
                    step={5}
                    value={Math.round(globalSizeScale * 100)}
                    onChange={(e) => setGlobalSizeScale(Number(e.target.value) / 100)}
                    className="flex-1 accent-sf-accent"
                    aria-label="Caption size"
                  />
                  <span className="text-[10px] text-sf-text-muted w-10">Bigger</span>
                </div>
              </div>

              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">
                    Vertical nudge
                  </div>
                  <button
                    type="button"
                    onClick={() => setGlobalVerticalOffset(0)}
                    disabled={globalVerticalOffset === 0}
                    className="text-[10px] text-sf-text-muted hover:text-sf-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Center the captions vertically"
                  >
                    Reset
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-sf-text-muted w-8 text-right">Up</span>
                  <input
                    type="range"
                    min={-45}
                    max={45}
                    step={1}
                    value={Math.round(globalVerticalOffset * 100)}
                    onChange={(e) => setGlobalVerticalOffset(Number(e.target.value) / 100)}
                    className="flex-1 accent-sf-accent"
                    aria-label="Vertical nudge"
                  />
                  <span className="text-[10px] text-sf-text-muted w-8">Down</span>
                </div>
              </div>
              {/* Save Style lives at the end: name the look after you've made it. */}
              <div className="rounded-xl border border-sf-dark-700 bg-sf-dark-950/40 px-3 py-3 space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={captionStyleName}
                    onChange={(event) => setCaptionStyleName(event.target.value)}
                    placeholder="Save this look as…"
                    className="min-w-0 flex-1 rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-3 py-2 text-sm text-sf-text-primary placeholder:text-sf-text-muted focus:border-sf-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => saveCurrentCaptionStyle()}
                    className="rounded-lg bg-sf-accent px-3 py-2 text-xs font-medium text-white hover:bg-sf-accent/90"
                  >
                    {activeSavedStyleId ? 'Update Style' : 'Save Style'}
                  </button>
                  {activeSavedStyleId && (
                    <button
                      type="button"
                      onClick={() => saveCurrentCaptionStyle({ forceNew: true })}
                      className="rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-3 py-2 text-xs font-medium text-sf-text-primary hover:bg-sf-dark-800"
                    >
                      Save New
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-sf-text-muted">
                  Saves the look only: preset, font, colors, background, outline, shadow, size, motion, and placement.
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-sf-dark-700 bg-sf-dark-900/60 p-4 space-y-3">
              <div className="text-sm font-medium text-sf-text-primary">Export</div>
              <label className="flex items-center gap-2 text-xs text-sf-text-primary">
                <input
                  type="checkbox"
                  checked={placeOnTimeline}
                  onChange={(e) => setPlaceOnTimeline(e.target.checked)}
                  className="rounded border-sf-dark-500 bg-sf-dark-900 text-sf-accent focus:ring-sf-accent"
                />
                Place the generated overlay on the top video track after saving
              </label>
              <div className="text-[11px] text-sf-text-muted">
                Output: transparent WebM overlay in the root-level `Captions` asset folder.
              </div>
            </section>

          </div>
          </div>
          </div>
            </>
          )}

          <div className="flex-shrink-0 border-t border-sf-dark-700 px-5 py-4 flex items-start justify-between gap-3">
            {(statusMessage || error) ? (
              <div className="flex items-start gap-2 text-xs min-w-0 flex-1 overflow-hidden">
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-sf-accent animate-spin" />
                ) : error ? (
                  <X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-sf-error" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-sf-success" />
                )}
                {error ? (
                  (() => {
                    const fullErrorText = String(error)
                    const lines = fullErrorText.split('\n').filter(Boolean)
                    const hasDetails = lines.length > 1
                    const handleCopyError = async () => {
                      try {
                        if (navigator.clipboard?.writeText) {
                          await navigator.clipboard.writeText(fullErrorText)
                        } else {
                          // Execution fallback for ancient runtimes / locked-down clipboards.
                          const ta = document.createElement('textarea')
                          ta.value = fullErrorText
                          ta.style.position = 'fixed'
                          ta.style.opacity = '0'
                          document.body.appendChild(ta)
                          ta.select()
                          document.execCommand('copy')
                          document.body.removeChild(ta)
                        }
                        setErrorCopied(true)
                        setTimeout(() => setErrorCopied(false), 1500)
                      } catch (err) {
                        console.warn('[CaptionWorkspace] clipboard copy failed:', err)
                      }
                    }
                    return (
                      <div className="min-w-0 flex-1 text-sf-error">
                        <div className={hasDetails ? 'select-text' : 'truncate select-text'}>{lines[0] || error}</div>
                        {hasDetails && errorExpanded && (
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-sf-dark-900 border border-sf-dark-700 p-2 text-[11px] text-sf-text-muted font-mono select-text cursor-text">
                            {lines.slice(1).join('\n')}
                          </pre>
                        )}
                        <div className="mt-1 flex items-center gap-3 text-[11px]">
                          {hasDetails && (
                            <button
                              type="button"
                              onClick={() => setErrorExpanded((v) => !v)}
                              className="underline text-sf-text-muted hover:text-sf-text-primary"
                            >
                              {errorExpanded ? 'Hide details' : `Show details (${lines.length - 1} line${lines.length - 1 === 1 ? '' : 's'})`}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleCopyError}
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
                              errorCopied
                                ? 'text-sf-success bg-sf-success/10'
                                : 'text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-700'
                            }`}
                            title="Copy full error message to the clipboard"
                          >
                            {errorCopied ? (
                              <>
                                <Check className="w-3 h-3" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                Copy error
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )
                  })()
                ) : (
                  <span className="truncate text-sf-text-muted">{statusMessage}</span>
                )}
              </div>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-xl border border-sf-dark-600 bg-sf-dark-900 px-4 py-2 text-sm text-sf-text-primary hover:bg-sf-dark-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="relative overflow-hidden inline-flex items-center gap-2 rounded-xl bg-sf-accent px-4 py-2 text-sm font-medium text-white hover:bg-sf-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating && Number.isFinite(generateProgress) && (
                  <span
                    className="absolute inset-y-0 left-0 bg-white/25 transition-[width] duration-300 ease-out"
                    style={{ width: `${generateProgress}%` }}
                  />
                )}
                <span className="relative inline-flex items-center gap-2">
                  {isGenerating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {isGenerating
                    ? (Number.isFinite(generateProgress)
                      ? `Rendering… ${Math.round(generateProgress)}%`
                      : 'Generating…')
                    : 'Generate captions'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CaptionWorkspace
