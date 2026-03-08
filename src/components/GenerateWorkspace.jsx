import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Sparkles, Video, Image as ImageIcon, Music, RefreshCw, Loader2,
  ChevronLeft, ChevronRight, Play, Pause, Upload, X, Film, Search,
  FolderOpen, Wand2, Volume2, Mic, Clock, Settings, Terminal, ChevronDown, ChevronUp, PenLine
} from 'lucide-react'
import { jsPDF } from 'jspdf'
import ImageAnnotationModal from './ImageAnnotationModal'
import ConfirmDialog from './ConfirmDialog'
import useComfyUI from '../hooks/useComfyUI'
import useAssetsStore from '../stores/assetsStore'
import useProjectStore from '../stores/projectStore'
import { useFrameForAIStore } from '../stores/frameForAIStore'
import { BUILTIN_WORKFLOW_PATHS } from '../config/workflowRegistry'
import { comfyui } from '../services/comfyui'
import { getProjectFileUrl, importAsset, isElectron } from '../services/fileSystem'
import { enqueuePlaybackTranscode } from '../services/playbackCache'
import { buildYoloPlanFromScript, flattenYoloPlanVariants } from '../utils/yoloPlanning'
import { checkWorkflowDependencies, buildMissingDependencyClipboardText } from '../services/workflowDependencies'
import {
  ACTIVE_JOB_STATUSES,
  CATEGORY_ORDER,
  DIRECTOR_MODE_BETA_LABEL,
  GENERATED_ASSET_FOLDERS,
  HARDWARE_TIERS,
  NON_TERMINAL_JOB_STATUSES,
  OPEN_COMFY_TAB_EVENT,
  SHOT_CATEGORIES,
  VIDEO_DURATION_PRESETS,
  WORKFLOWS,
  YOLO_AD_PROFILES,
  YOLO_AD_PROFILE_RUNTIME_OPTIONS,
  YOLO_AD_REFERENCE_CONSISTENCY_OPTIONS,
  YOLO_CAMERA_PRESET_OPTIONS,
  YOLO_MUSIC_PROFILES,
  YOLO_QUEUE_CONFIRM_THRESHOLD,
  formatWorkflowHardwareRuntime,
  formatWorkflowTierSummary,
  getWorkflowDisplayLabel,
  getWorkflowHardwareInfo,
  getWorkflowTierMeta,
} from '../config/generateWorkspaceConfig'

const CATEGORY_ICONS = { video: Video, image: ImageIcon, audio: Music }
const DIRECTOR_SUBTABS = [
  {
    id: 'setup',
    label: '1. Setup',
    helper: 'Step 1: Structure, Quality, and Set References.',
  },
  {
    id: 'plan-script',
    label: '2. Script',
    helper: 'Step 2: define script/lyrics, then build your plan.',
  },
  {
    id: 'scene-shot',
    label: '3. Keyframes',
    helper: 'Step 3: review shots and create keyframe images.',
  },
  {
    id: 'video-pass',
    label: '4. Videos',
    helper: 'Step 4: create videos from keyframe images.',
  },
]

const YOLO_AD_STAGE_TIER_OPTIONS = Object.freeze({
  local: Object.freeze([
    { id: 'low', label: 'Low VRAM' },
    { id: 'quality', label: 'Quality' },
  ]),
  cloud: Object.freeze([
    { id: 'low', label: 'Low Cost' },
    { id: 'quality', label: 'Quality' },
  ]),
})

const DIRECTOR_SCRIPT_TEMPLATE = `Scene 1: Neon Arrival
Scene context: Futuristic transit terminal, blue and coral neon, reflective black tile, premium cinematic sneaker ad.

Shot 1:
Shot type: Wide shot
Keyframe prompt: Wide shot of the model stepping through sliding glass doors into a futuristic transit terminal, blue and coral neon reflecting across glossy black tile, coral-and-cream sneaker clearly visible.
Motion prompt: Starting from this exact keyframe, the model takes 2 confident steps forward while neon reflections slide across the floor. Keep the sneaker, outfit, and terminal lighting consistent.
Camera: Gentle backward tracking shot
Duration: 3

Shot 2:
Shot type: Close-up
Keyframe prompt: Close-up of the sneaker landing on reflective black tile, sharp product detail, dramatic neon reflections, premium commercial lighting.
Motion prompt: Starting from this exact close-up, the foot lands fully and rolls forward slightly while reflections shimmer across the tile surface.
Camera: Locked close-up with subtle micro push-in
Duration: 2`

async function copyTextToClipboard(text) {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = String(text || '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

function formatCountLabel(count, singular, plural = `${singular}s`) {
  const value = Number(count) || 0
  return `${value} ${value === 1 ? singular : plural}`
}

function formatCreditsValue(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 'Unknown'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(numeric)
}

const COMFY_CREDITS_PER_USD = 211

function formatUsdValue(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 'Unknown'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(numeric)
}

function formatUsdRangeFromCredits(estimatedCredits, multiplier = 1) {
  if (!estimatedCredits || typeof estimatedCredits !== 'object') return 'Unknown'
  const min = Number(estimatedCredits.min)
  const max = Number(estimatedCredits.max)
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 'Unknown'
  const scaledMin = min * Math.max(0, Number(multiplier) || 0)
  const scaledMax = max * Math.max(0, Number(multiplier) || 0)
  const usdMin = scaledMin / COMFY_CREDITS_PER_USD
  const usdMax = scaledMax / COMFY_CREDITS_PER_USD
  if (Math.abs(usdMax - usdMin) < 1e-9) return `~${formatUsdValue(usdMin)}`
  return `~${formatUsdValue(usdMin)}-${formatUsdValue(usdMax)}`
}

function formatCreditsRange(estimatedCredits, multiplier = 1) {
  if (!estimatedCredits || typeof estimatedCredits !== 'object') return 'Unknown'
  const min = Number(estimatedCredits.min)
  const max = Number(estimatedCredits.max)
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 'Unknown'
  const scaledMin = min * Math.max(0, Number(multiplier) || 0)
  const scaledMax = max * Math.max(0, Number(multiplier) || 0)
  if (Math.abs(scaledMax - scaledMin) < 1e-9) return `${formatCreditsValue(scaledMin)} credits`
  return `${formatCreditsValue(scaledMin)}-${formatCreditsValue(scaledMax)} credits`
}

function summarizeBlockingDependency(checkResult) {
  const workflowLabel = checkResult?.pack?.displayName
    || getWorkflowDisplayLabel(checkResult?.workflowId)
    || String(checkResult?.workflowId || 'workflow')

  const issues = []
  if ((checkResult?.missingNodes?.length || 0) > 0) {
    issues.push(formatCountLabel(checkResult.missingNodes.length, 'node'))
  }
  if ((checkResult?.missingModels?.length || 0) > 0) {
    issues.push(formatCountLabel(checkResult.missingModels.length, 'model'))
  }
  if (checkResult?.missingAuth) {
    issues.push('API key')
  }
  return `${workflowLabel} (${issues.join(', ') || 'requirements missing'})`
}

function buildDependencyResultMap(results = []) {
  const byWorkflow = {}
  for (const result of results) {
    const workflow = String(result?.workflowId || '').trim()
    if (!workflow) continue
    byWorkflow[workflow] = result
  }
  return byWorkflow
}

function getDependencyAggregateStatus(results = []) {
  if (!Array.isArray(results) || results.length === 0) return 'idle'
  if (results.some((result) => result?.hasPack && result?.hasBlockingIssues)) return 'missing'
  if (results.some((result) => result?.status === 'error')) return 'error'
  if (results.some((result) => result?.status === 'partial')) return 'partial'
  if (results.some((result) => result?.status === 'no-pack')) return 'no-pack'
  return 'ready'
}

function ensureAssetFolderPath(pathSegments = []) {
  const segments = (Array.isArray(pathSegments) ? pathSegments : [])
    .map((segment) => String(segment || '').trim())
    .filter(Boolean)

  if (segments.length === 0) return null

  let parentId = null
  for (const segment of segments) {
    const { folders = [], addFolder } = useAssetsStore.getState()
    if (typeof addFolder !== 'function') return parentId

    const segmentKey = segment.toLowerCase()
    let folder = folders.find((entry) => {
      const entryParentId = entry?.parentId || null
      const entryName = String(entry?.name || '').trim().toLowerCase()
      return entryParentId === parentId && entryName === segmentKey
    })

    if (!folder) {
      folder = addFolder({ name: segment, parentId })
    }

    parentId = folder?.id || parentId
  }

  return parentId
}

function clampNumberValue(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

function parseAnglesInput(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .slice(0, 8)
  }
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8)
}

function summarizeSceneText(value = '', fallback = '') {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return String(fallback || '').trim()

  let candidate = lines[0]
  candidate = candidate.replace(/^(?:scene\s+\d+|sc\s*\d+|#\s*scene|\d+\.)\s*[:\-]?\s*/i, '').trim()
  if (!candidate && lines.length > 1) candidate = lines[1]

  const firstSentence = (candidate || lines[0]).split(/(?<=[.!?])\s+/)[0]
  const compact = String(firstSentence || '').replace(/\s+/g, ' ').trim()
  if (compact.length <= 140) return compact
  return `${compact.slice(0, 137)}...`
}

function stripFileExtension(value = '') {
  return String(value || '').replace(/\.[^/.]+$/, '')
}

function slugifyNameToken(value = '', options = {}) {
  const fallback = Object.prototype.hasOwnProperty.call(options, 'fallback')
    ? String(options.fallback || '')
    : 'item'
  const maxLength = Math.max(1, Number(options.maxLength) || 32)
  let normalized = String(value || '').trim()

  try {
    normalized = normalized.normalize('NFKD')
  } catch (_) {
    // Keep original if unicode normalization is unavailable.
  }

  const slug = normalized
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()

  if (!slug) return fallback
  return slug.slice(0, maxLength)
}

function buildAdReferenceStyleNotes({
  hasProduct = false,
  hasModel = false,
  productName = '',
  modelName = '',
  consistency = 'medium',
} = {}) {
  if (!hasProduct && !hasModel) return ''

  const notes = []
  if (hasProduct) {
    notes.push(
      `Use the product from the reference image${productName ? ` (${productName})` : ''}. Keep packaging shape, brand colors, logo placement, and label details consistent across all shots.`
    )
  }
  if (hasModel) {
    notes.push(
      `Use the same person from the model reference${modelName ? ` (${modelName})` : ''}. Keep facial identity, hairstyle, skin tone, body proportions, and wardrobe consistent in every shot.`
    )
  }
  if (hasProduct && hasModel) {
    notes.push('When both appear, keep the product scale natural in hand and preserve believable interaction between model and product.')
  }

  if (consistency === 'strict') {
    notes.push('Consistency mode: strict. Prioritize matching the references over adding stylistic variation.')
    notes.push('Identity lock: this must be the exact same person in every shot and take. No identity drift, no face morphing, no hairstyle changes, and no wardrobe swaps.')
  } else if (consistency === 'soft') {
    notes.push('Consistency mode: soft. Keep identity anchors but allow moderate styling changes between shots.')
  } else {
    notes.push('Consistency mode: medium. Balance identity consistency with natural cinematic variation.')
  }
  notes.push('Keyframe rule: render a single continuous frame per prompt (no split-screen, no collage, no storyboard grids).')

  return notes.join(' ')
}

function formatReferenceConsistencyLabel(consistency = 'medium') {
  if (consistency === 'strict') return 'Strict'
  if (consistency === 'soft') return 'Soft'
  return 'Medium'
}

function normalizeShotForScene(sceneId, shot, shotIndex, fallback = {}) {
  const fallbackAngles = parseAnglesInput(fallback?.angles || ['Medium shot'])
  const parsedAngles = parseAnglesInput(shot?.angles)
  const fallbackBeat = String(fallback?.videoBeat || fallback?.imageBeat || fallback?.beat || '').trim()
  const imageBeat = String(shot?.imageBeat || shot?.beat || fallback?.imageBeat || fallback?.beat || '').trim()
  const videoBeat = String(shot?.videoBeat || shot?.beat || fallback?.videoBeat || fallbackBeat).trim()
  const shotType = String(shot?.shotType || fallback?.shotType || '').trim()
  const cameraDirection = String(shot?.cameraDirection || fallback?.cameraDirection || '').trim()
  const duration = clampNumberValue(
    shot?.durationSeconds,
    2,
    5,
    clampNumberValue(fallback?.durationSeconds, 2, 5, 3)
  )
  const takes = clampNumberValue(
    shot?.takesPerAngle,
    1,
    4,
    clampNumberValue(fallback?.takesPerAngle, 1, 4, 1)
  )

  return {
    id: `${sceneId}_SH${shotIndex + 1}`,
    index: shotIndex + 1,
    beat: videoBeat, // Legacy alias retained for old persisted plans.
    imageBeat,
    videoBeat,
    shotType,
    cameraDirection,
    durationSeconds: Number(duration.toFixed(2)),
    takesPerAngle: Math.round(takes),
    angles: parsedAngles.length > 0 ? parsedAngles : (fallbackAngles.length > 0 ? fallbackAngles : ['Medium shot']),
    cameraPresetId: String(shot?.cameraPresetId || fallback?.cameraPresetId || 'auto'),
  }
}

function resolveCameraPresetAngles(presetId, targetCount = 2) {
  const preset = YOLO_CAMERA_PRESET_OPTIONS.find((option) => option.id === presetId)
  const preferred = Array.isArray(preset?.angles) ? preset.angles : []
  const fallbackPool = ['Medium shot', 'Wide shot', 'Close-up', 'Eye level', 'Low angle', 'High angle', 'POV', 'Tracking shot']
  const count = Math.max(1, Math.min(8, Number(targetCount) || preferred.length || 1))
  return Array.from({ length: count }, (_, index) => preferred[index] || fallbackPool[index % fallbackPool.length])
}

function normalizePersistedYoloPlan(rawPlan = []) {
  if (!Array.isArray(rawPlan)) return []
  return rawPlan.map((scene, sceneIndex) => {
    const sceneId = String(scene?.id || `S${sceneIndex + 1}`)
    const shots = Array.isArray(scene?.shots) ? scene.shots : []
    return {
      ...scene,
      id: sceneId,
      index: Number(scene?.index) || (sceneIndex + 1),
      shots: shots.map((shot, shotIndex) => normalizeShotForScene(sceneId, shot, shotIndex, shot)),
    }
  })
}

function splitLyricsIntoBlocks(lyricsText = '', targetBlockCount = 8) {
  const lines = String(lyricsText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !(line.startsWith('[') && line.endsWith(']')))

  if (lines.length === 0) return []

  const blockCount = Math.max(1, Math.min(24, Number(targetBlockCount) || 8))
  const chunkSize = Math.max(1, Math.ceil(lines.length / blockCount))
  const blocks = []

  for (let index = 0; index < lines.length; index += chunkSize) {
    const chunk = lines.slice(index, index + chunkSize)
    if (chunk.length === 0) continue
    blocks.push(chunk.join(' '))
  }

  return blocks
}

function buildMusicVideoScriptFromLyrics(lyricsText = '', options = {}) {
  const {
    songTitle = '',
    storyIdea = '',
    subjectDescription = '',
    scenePalette = '',
    targetDuration = 15,
    estimatedSceneCount = 8,
  } = options

  const lyricBlocks = splitLyricsIntoBlocks(lyricsText, estimatedSceneCount)
  if (lyricBlocks.length === 0) return ''

  const intro = [
    songTitle ? `Song: ${songTitle}.` : '',
    storyIdea ? `Story arc: ${storyIdea}.` : '',
    subjectDescription ? `Main subject: ${subjectDescription}.` : '',
    scenePalette ? `Scene palette: ${scenePalette}.` : '',
    `Total duration target: ${Math.max(5, Number(targetDuration) || 15)} seconds.`,
  ].filter(Boolean).join(' ')

  const scenes = lyricBlocks.map((block, index) => {
    const cue = block.replace(/\s+/g, ' ').trim().slice(0, 300)
    return `Scene ${index + 1}: ${intro} Lyric cue: "${cue}". Keep this moment visually connected to neighboring scenes with consistent subject identity, wardrobe, and lighting style.`
  })

  return scenes.join('\n\n')
}

function buildMusicVideoStyleNotes(options = {}) {
  const { styleNotes = '', subjectDescription = '', scenePalette = '' } = options
  return [
    'Music video flow: cinematic continuity across all shots.',
    styleNotes || '',
    subjectDescription ? `Subject consistency: ${subjectDescription}.` : '',
    scenePalette ? `Location continuity: ${scenePalette}.` : '',
  ].filter(Boolean).join(' ')
}

// ============================================
// CinematographyTags Sub-component
// ============================================
function CinematographyTags({ onAddTag, selectedTags, onRemoveTag }) {
  const [activeCategory, setActiveCategory] = useState('Shot')
  const tabsRef = useRef(null)
  const scrollTabs = (dir) => tabsRef.current?.scrollBy({ left: dir * 100, behavior: 'smooth' })

  return (
    <div className="space-y-2">
      <div className="relative flex items-center">
        <button onClick={() => scrollTabs(-1)} className="absolute left-0 z-10 p-0.5 bg-sf-dark-900/90 hover:bg-sf-dark-700 rounded text-sf-text-muted"><ChevronLeft className="w-3 h-3" /></button>
        <div ref={tabsRef} className="flex gap-1 overflow-x-auto mx-5 pb-1" style={{ scrollbarWidth: 'none' }}>
          {CATEGORY_ORDER.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              className={`px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${activeCategory === cat ? 'bg-sf-accent text-white' : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'}`}
            >{cat}</button>
          ))}
        </div>
        <button onClick={() => scrollTabs(1)} className="absolute right-0 z-10 p-0.5 bg-sf-dark-900/90 hover:bg-sf-dark-700 rounded text-sf-text-muted"><ChevronRight className="w-3 h-3" /></button>
      </div>
      <div className="bg-sf-dark-800/50 rounded-lg p-2">
        <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
          {SHOT_CATEGORIES[activeCategory].map(tag => {
            const sel = selectedTags.includes(tag)
            return (
              <button key={tag} onClick={() => sel ? onRemoveTag(tag) : onAddTag(tag)}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${sel ? 'bg-sf-accent text-white' : 'bg-sf-dark-700 hover:bg-sf-dark-600 text-sf-text-secondary'}`}
              >{sel ? '+ ' : ''}{tag}</button>
            )
          })}
        </div>
      </div>
      {selectedTags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {selectedTags.map(tag => (
            <span key={tag} onClick={() => onRemoveTag(tag)} className="px-1.5 py-0.5 bg-sf-accent/20 text-sf-accent rounded text-[9px] cursor-pointer hover:bg-sf-accent/30">{tag} x</span>
          ))}
          <button onClick={() => selectedTags.forEach(onRemoveTag)} className="text-[9px] text-sf-text-muted hover:text-sf-error ml-1">Clear</button>
        </div>
      )}
    </div>
  )
}

// ============================================
// Asset Input Browser (left column)
// ============================================
function AssetInputBrowser({ selectedAsset, onSelectAsset, filterType, frameTime, onFrameTimeChange }) {
  const { assets } = useAssetsStore()
  const [search, setSearch] = useState('')
  const videoRef = useRef(null)
  const canvasRef = useRef(null)

  // Filter assets based on workflow needs
  const filtered = useMemo(() => {
    let list = assets.filter(a => a.type !== 'mask')
    if (filterType === 'image') {
      list = list.filter(a => a.type === 'image' || a.type === 'video')
    } else if (filterType === 'video') {
      list = list.filter(a => a.type === 'video')
    } else if (filterType === 'audio') {
      list = list.filter(a => a.type === 'audio')
    }
    if (search) {
      list = list.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
    }
    return list
  }, [assets, filterType, search])

  // When video loads, seek to frameTime
  useEffect(() => {
    if (videoRef.current && selectedAsset?.type === 'video') {
      videoRef.current.currentTime = frameTime || 0
    }
  }, [frameTime, selectedAsset])

  const handleVideoSeeked = () => {
    // Draw current frame to canvas for preview
    if (videoRef.current && canvasRef.current) {
      const v = videoRef.current
      const c = canvasRef.current
      c.width = v.videoWidth
      c.height = v.videoHeight
      c.getContext('2d').drawImage(v, 0, 0)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 p-2 border-b border-sf-dark-700">
        <div className="text-[10px] text-sf-text-muted uppercase tracking-wider mb-2">Input Source</div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-sf-text-muted" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search assets..."
            className="w-full pl-7 pr-2 py-1 bg-sf-dark-800 border border-sf-dark-600 rounded text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
          />
        </div>
      </div>

      {/* Selected asset preview + frame grabber */}
      {selectedAsset && (
        <div className="flex-shrink-0 border-b border-sf-dark-700 p-2">
          <div className="text-[10px] text-sf-text-muted mb-1">Selected: <span className="text-sf-text-primary">{selectedAsset.name}</span></div>
          {selectedAsset.type === 'video' && filterType === 'image' ? (
            (() => {
              const durationSec = selectedAsset.duration ?? selectedAsset.settings?.duration ?? 5
              const fps = selectedAsset.fps ?? selectedAsset.settings?.fps ?? 24
              const totalFrames = Math.max(0, Math.floor(durationSec * fps))
              const currentFrame = Math.min(totalFrames, Math.round((frameTime || 0) * fps))
              return (
                <div className="space-y-2">
                  <div className="relative aspect-video bg-sf-dark-800 rounded overflow-hidden">
                    <video
                      ref={videoRef}
                      src={selectedAsset.url}
                      className="w-full h-full object-contain"
                      muted
                      onSeeked={handleVideoSeeked}
                      onLoadedMetadata={() => { if (videoRef.current) videoRef.current.currentTime = frameTime || 0 }}
                    />
                    <canvas ref={canvasRef} className="hidden" />
                    <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white">
                      Frame {currentFrame}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-sf-text-muted w-6">0</span>
                    <input
                      type="range" min="0" max={durationSec} step={1 / Math.max(1, fps)}
                      value={frameTime || 0} onChange={e => onFrameTimeChange(parseFloat(e.target.value))}
                      className="flex-1 h-1 accent-sf-accent"
                    />
                    <span className="text-[9px] text-sf-text-muted w-8 text-right">{totalFrames}</span>
                  </div>
                  <div className="text-[9px] text-sf-text-muted">Drag slider to pick a frame from this video</div>
                </div>
              )
            })()
          ) : (
            <div className="aspect-video bg-sf-dark-800 rounded overflow-hidden">
              {selectedAsset.type === 'video' ? (
                <video src={selectedAsset.url} className="w-full h-full object-contain" muted />
              ) : selectedAsset.type === 'image' ? (
                <img src={selectedAsset.url} className="w-full h-full object-contain" alt={selectedAsset.name} />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><Music className="w-8 h-8 text-sf-text-muted" /></div>
              )}
            </div>
          )}
          <button onClick={() => onSelectAsset(null)} className="mt-1 text-[9px] text-sf-text-muted hover:text-sf-error">Clear selection</button>
        </div>
      )}

      {/* Asset grid */}
      <div className="flex-1 overflow-auto p-2">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-sf-text-muted">
            <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs">{filterType ? `No ${filterType} assets` : 'No assets'}</p>
            <p className="text-[10px]">Import media in the Assets tab</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {filtered.map(asset => {
              const isSelected = selectedAsset?.id === asset.id
              return (
                <button key={asset.id} onClick={() => onSelectAsset(asset)}
                  className={`bg-sf-dark-800 border rounded overflow-hidden text-left transition-all ${isSelected ? 'border-sf-accent ring-1 ring-sf-accent' : 'border-sf-dark-600 hover:border-sf-dark-500'}`}
                >
                  <div className="aspect-video bg-sf-dark-700 flex items-center justify-center relative overflow-hidden">
                    {asset.type === 'video' && asset.url ? (
                      <video src={asset.url} className="w-full h-full object-cover" muted preload="metadata" />
                    ) : asset.type === 'image' && asset.url ? (
                      <img src={asset.url} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <Music className="w-4 h-4 text-sf-text-muted" />
                    )}
                    <div className={`absolute top-0.5 left-0.5 px-1 py-0.5 rounded text-[7px] text-white ${asset.type === 'video' ? 'bg-blue-600/80' : asset.type === 'image' ? 'bg-green-600/80' : 'bg-purple-600/80'}`}>
                      {asset.type === 'video' ? 'VID' : asset.type === 'image' ? 'IMG' : 'AUD'}
                    </div>
                  </div>
                  <div className="px-1 py-0.5">
                    <p className="text-[9px] text-sf-text-primary truncate">{asset.name}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// Helper: Extract frame from video as File
// ============================================
async function extractFrameAsFile(videoUrl, time, filename = 'frame.png') {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'auto'
    video.src = videoUrl

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(time, video.duration - 0.01)
    }

    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d').drawImage(video, 0, 0)
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(new File([blob], filename, { type: 'image/png' }))
        } else {
          reject(new Error('Failed to extract frame'))
        }
      }, 'image/png')
    }

    video.onerror = () => reject(new Error('Failed to load video for frame extraction'))
  })
}

// ============================================
// Main GenerateWorkspace Component
// ============================================
function GenerateWorkspace() {
  // Load persisted state from localStorage
  const loadPersistedState = () => {
    try {
      const saved = localStorage.getItem('generate-workspace-state')
      if (saved) {
        const parsed = JSON.parse(saved)
        // Migrate legacy workflow id after Nano Banana 2 replacement.
        if (parsed?.workflowId === 'nano-banana-pro') {
          parsed.workflowId = 'nano-banana-2'
        }
        // Migrate removed LTX2 workflows/targets to WAN 2.2.
        if (parsed?.workflowId === 'ltx2-t2v' || parsed?.workflowId === 'ltx2-i2v') {
          parsed.workflowId = 'wan22-i2v'
        }
        if (parsed?.yoloVideoWorkflowTarget === 'ltx2-i2v' || parsed?.yoloVideoWorkflowTarget === 'both') {
          parsed.yoloVideoWorkflowTarget = 'wan22-i2v'
        }
        return parsed
      }
    } catch (error) {
      console.error('Failed to load persisted Generate workspace state:', error)
    }
    return null
  }

  const persistedState = loadPersistedState()

  // UI mode
  const [generationMode, setGenerationMode] = useState(persistedState?.generationMode || 'single')

  // Category + workflow selection
  const [category, setCategory] = useState(persistedState?.category || 'video')
  const [workflowId, setWorkflowId] = useState(persistedState?.workflowId || 'wan22-i2v')

  // Input asset (store ID, will resolve to object)
  const [selectedAssetId, setSelectedAssetId] = useState(persistedState?.selectedAssetId || null)
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [frameTime, setFrameTime] = useState(persistedState?.frameTime || 0)

  // Common generation state
  const [prompt, setPrompt] = useState(persistedState?.prompt || '')
  const [negativePrompt, setNegativePrompt] = useState(persistedState?.negativePrompt || 'blurry, low quality, watermark')
  const [seed, setSeed] = useState(persistedState?.seed || Math.floor(Math.random() * 1000000))
  const [selectedTags, setSelectedTags] = useState(persistedState?.selectedTags || [])

  // Video settings
  const [duration, setDuration] = useState(persistedState?.duration || 5)
  const [resolution, setResolution] = useState(persistedState?.resolution || { width: 1280, height: 720 })
  const [fps, setFps] = useState(persistedState?.fps || 24)
  const [wanQualityPreset, setWanQualityPreset] = useState(persistedState?.wanQualityPreset || 'face-lock')

  // Image edit settings
  const [editSteps, setEditSteps] = useState(persistedState?.editSteps || 40)
  const [editCfg, setEditCfg] = useState(persistedState?.editCfg || 4)
  const [referenceAssetId1, setReferenceAssetId1] = useState(persistedState?.referenceAssetId1 ?? null)
  const [referenceAssetId2, setReferenceAssetId2] = useState(persistedState?.referenceAssetId2 ?? null)
  const [annotationModalOpen, setAnnotationModalOpen] = useState(false)
  const [annotationInitialUrl, setAnnotationInitialUrl] = useState(null)
  const [annotationPreparing, setAnnotationPreparing] = useState(false)
  const annotationBlobUrlRef = useRef(null)

  // Music settings
  const [musicTags, setMusicTags] = useState(persistedState?.musicTags || '')
  const [lyrics, setLyrics] = useState(persistedState?.lyrics || '')
  const [musicDuration, setMusicDuration] = useState(persistedState?.musicDuration || 30)
  const [bpm, setBpm] = useState(persistedState?.bpm || 120)
  const [keyscale, setKeyscale] = useState(persistedState?.keyscale || 'C major')

  // Director mode state
  const [yoloCreationType, setYoloCreationType] = useState(persistedState?.yoloCreationType || 'ad')
  const [directorSubTab, setDirectorSubTab] = useState('setup')
  const [yoloScript, setYoloScript] = useState(persistedState?.yoloScript || '')
  const [directorFormatExpanded, setDirectorFormatExpanded] = useState(false)
  const [yoloStyleNotes, setYoloStyleNotes] = useState(persistedState?.yoloStyleNotes || '')
  const [yoloAdProductAssetId, setYoloAdProductAssetId] = useState(persistedState?.yoloAdProductAssetId ?? null)
  const [yoloAdModelAssetId, setYoloAdModelAssetId] = useState(persistedState?.yoloAdModelAssetId ?? null)
  const [yoloAdConsistency, setYoloAdConsistency] = useState(persistedState?.yoloAdConsistency || 'medium')
  const [yoloTargetDuration, setYoloTargetDuration] = useState(persistedState?.yoloTargetDuration || 30)
  const [yoloShotsPerScene, setYoloShotsPerScene] = useState(persistedState?.yoloShotsPerScene || 3)
  const [yoloAnglesPerShot, setYoloAnglesPerShot] = useState(persistedState?.yoloAnglesPerShot || 2)
  const [yoloTakesPerAngle, setYoloTakesPerAngle] = useState(persistedState?.yoloTakesPerAngle || 1)
  const [yoloAdStoryboardSource, setYoloAdStoryboardSource] = useState(() => {
    const saved = String(persistedState?.yoloAdStoryboardSource || '').trim().toLowerCase()
    if (saved === 'local' || saved === 'cloud') return saved
    const legacyOverride = String(persistedState?.yoloAdStoryboardRuntimeOverride || '').trim().toLowerCase()
    if (legacyOverride === 'local' || legacyOverride === 'cloud') return legacyOverride
    return persistedState?.yoloAdProfileRuntime === 'cloud' ? 'cloud' : 'local'
  })
  const [yoloAdVideoSource, setYoloAdVideoSource] = useState(() => {
    const saved = String(persistedState?.yoloAdVideoSource || '').trim().toLowerCase()
    if (saved === 'local' || saved === 'cloud') return saved
    const legacyOverride = String(persistedState?.yoloAdVideoRuntimeOverride || '').trim().toLowerCase()
    if (legacyOverride === 'local' || legacyOverride === 'cloud') return legacyOverride
    return persistedState?.yoloAdProfileRuntime === 'cloud' ? 'cloud' : 'local'
  })
  const [yoloAdStoryboardTier, setYoloAdStoryboardTier] = useState(() => {
    const saved = String(persistedState?.yoloAdStoryboardTier || '').trim().toLowerCase()
    if (saved === 'low' || saved === 'quality') return saved
    if (saved === 'draft') return 'low'
    if (saved === 'balanced' || saved === 'premium') return 'quality'
    const legacyProfile = String(persistedState?.yoloQualityProfile || '').trim().toLowerCase()
    if (legacyProfile === 'draft') return 'low'
    if (legacyProfile === 'balanced' || legacyProfile === 'premium') return 'quality'
    return 'low'
  })
  const [yoloAdVideoTier, setYoloAdVideoTier] = useState(() => {
    const saved = String(persistedState?.yoloAdVideoTier || '').trim().toLowerCase()
    if (saved === 'low' || saved === 'quality') return saved
    if (saved === 'draft') return 'low'
    if (saved === 'balanced' || saved === 'premium') return 'quality'
    const legacyProfile = String(persistedState?.yoloQualityProfile || '').trim().toLowerCase()
    if (legacyProfile === 'draft') return 'low'
    if (legacyProfile === 'balanced' || legacyProfile === 'premium') return 'quality'
    return 'low'
  })
  const [yoloPlan, setYoloPlan] = useState(() => normalizePersistedYoloPlan(persistedState?.yoloPlan || []))

  // Director mode music video state
  const [yoloMusicTitle, setYoloMusicTitle] = useState(persistedState?.yoloMusicTitle || '')
  const [yoloMusicLyrics, setYoloMusicLyrics] = useState(persistedState?.yoloMusicLyrics || '')
  const [yoloMusicStoryIdea, setYoloMusicStoryIdea] = useState(persistedState?.yoloMusicStoryIdea || '')
  const [yoloMusicSubject, setYoloMusicSubject] = useState(persistedState?.yoloMusicSubject || '')
  const [yoloMusicScenePalette, setYoloMusicScenePalette] = useState(persistedState?.yoloMusicScenePalette || '')
  const [yoloMusicStyleNotes, setYoloMusicStyleNotes] = useState(persistedState?.yoloMusicStyleNotes || '')
  const [yoloMusicTargetDuration, setYoloMusicTargetDuration] = useState(persistedState?.yoloMusicTargetDuration || 30)
  const [yoloMusicShotsPerScene, setYoloMusicShotsPerScene] = useState(persistedState?.yoloMusicShotsPerScene || 1)
  const [yoloMusicAnglesPerShot, setYoloMusicAnglesPerShot] = useState(persistedState?.yoloMusicAnglesPerShot || 1)
  const [yoloMusicTakesPerAngle, setYoloMusicTakesPerAngle] = useState(persistedState?.yoloMusicTakesPerAngle || 1)
  const [yoloMusicQualityProfile, setYoloMusicQualityProfile] = useState(persistedState?.yoloMusicQualityProfile || 'balanced')
  const [yoloMusicPlan, setYoloMusicPlan] = useState(() => normalizePersistedYoloPlan(persistedState?.yoloMusicPlan || []))

  // Generation queue state
  const [generationQueue, setGenerationQueue] = useState([])
  const [activeJobId, setActiveJobId] = useState(null)
  const processingRef = useRef(false)
  const queueRef = useRef([])
  const startedJobIdsRef = useRef(new Set())
  const queuePausedRef = useRef(false)
  const consecutiveRapidFailsRef = useRef(0)
  const lastJobFinishTimeRef = useRef(0)
  const RAPID_FAIL_THRESHOLD_MS = 5000
  const MAX_CONSECUTIVE_RAPID_FAILS = 3
  const MIN_JOB_INTERVAL_MS = 2000
  const [formError, setFormError] = useState(null)
  const [creatingStoryboardPdf, setCreatingStoryboardPdf] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null) // { title, message, confirmLabel, cancelLabel, tone }
  const confirmResolverRef = useRef(null)
  const [openWorkflowHint, setOpenWorkflowHint] = useState('')
  const [yoloDependencyCheckInProgress, setYoloDependencyCheckInProgress] = useState(false)
  const [yoloDependencyPanel, setYoloDependencyPanel] = useState({
    status: 'idle',
    byWorkflow: {},
    checkedAt: 0,
    error: '',
  })
  const yoloDependencyPanelVersionRef = useRef(0)
  const [dependencyCheck, setDependencyCheck] = useState({
    status: 'idle',
    hasPack: false,
    hasBlockingIssues: false,
    missingNodes: [],
    missingModels: [],
    unresolvedModels: [],
    missingAuth: false,
    error: '',
    pack: null,
    checkedAt: 0,
    workflowId: '',
  })
  const dependencyCheckVersionRef = useRef(0)
  const [comfyLogExpanded, setComfyLogExpanded] = useState(false)
  const [comfyLogLines, setComfyLogLines] = useState([])
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false)
  const [workflowInfoExpanded, setWorkflowInfoExpanded] = useState(true)
  const comfyLogEndRef = useRef(null)
  const importedMediaSignaturesRef = useRef(new Set())
  const storyboardPdfBatchesRef = useRef(new Map())
  const COMFY_LOG_MAX = 400
  const addComfyLog = useCallback((type, msg) => {
    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false })
    setComfyLogLines(prev => {
      const next = [...prev, { ts, type, msg }]
      return next.slice(-COMFY_LOG_MAX)
    })
  }, [])

  // Hooks
  const { isConnected, wsConnected, queueCount } = useComfyUI()
  const { addAsset, generateName, assets } = useAssetsStore()
  const { currentProjectHandle, currentProject } = useProjectStore()
  const frameForAI = useFrameForAIStore((s) => s.frame)
  const clearFrameForAI = useFrameForAIStore((s) => s.clearFrame)

  // When opened with timeline frame, switch to video i2v and use that frame as input
  useEffect(() => {
    if (frameForAI) {
      setCategory('video')
      setWorkflowId('wan22-i2v')
      setFormError(null)
    }
  }, [frameForAI?.blobUrl])

  // Restore selected asset from ID when assets are available
  useEffect(() => {
    if (selectedAssetId && assets.length > 0) {
      const asset = assets.find(a => a.id === selectedAssetId)
      if (asset) {
        setSelectedAsset(asset)
      } else {
        // Asset no longer exists, clear selection
        setSelectedAssetId(null)
        setSelectedAsset(null)
      }
    }
  }, [selectedAssetId, assets])

  // Persist state to localStorage whenever it changes
  useEffect(() => {
    try {
      const stateToSave = {
        generationMode,
        category,
        workflowId,
        selectedAssetId,
        frameTime,
        prompt,
        negativePrompt,
        seed,
        selectedTags,
        duration,
        resolution,
        fps,
        wanQualityPreset,
        editSteps,
        editCfg,
        referenceAssetId1,
        referenceAssetId2,
        musicTags,
        lyrics,
        musicDuration,
        bpm,
        keyscale,
        yoloCreationType,
        yoloScript,
        yoloStyleNotes,
        yoloAdProductAssetId,
        yoloAdModelAssetId,
        yoloAdConsistency,
        yoloTargetDuration,
        yoloShotsPerScene,
        yoloAnglesPerShot,
        yoloTakesPerAngle,
        yoloAdStoryboardSource,
        yoloAdVideoSource,
        yoloAdStoryboardTier,
        yoloAdVideoTier,
        yoloPlan,
        yoloMusicTitle,
        yoloMusicLyrics,
        yoloMusicStoryIdea,
        yoloMusicSubject,
        yoloMusicScenePalette,
        yoloMusicStyleNotes,
        yoloMusicTargetDuration,
        yoloMusicShotsPerScene,
        yoloMusicAnglesPerShot,
        yoloMusicTakesPerAngle,
        yoloMusicQualityProfile,
        yoloMusicPlan,
      }
      localStorage.setItem('generate-workspace-state', JSON.stringify(stateToSave))
    } catch (error) {
      console.error('Failed to save Generate workspace state:', error)
    }
  }, [
    generationMode,
    category,
    workflowId,
    selectedAssetId,
    frameTime,
    prompt,
    negativePrompt,
    seed,
    selectedTags,
    duration,
    resolution,
    fps,
    wanQualityPreset,
    editSteps,
    editCfg,
    referenceAssetId1,
    referenceAssetId2,
    musicTags,
    lyrics,
    musicDuration,
    bpm,
    keyscale,
    yoloCreationType,
    yoloScript,
    yoloStyleNotes,
    yoloAdProductAssetId,
    yoloAdModelAssetId,
    yoloAdConsistency,
    yoloTargetDuration,
    yoloShotsPerScene,
    yoloAnglesPerShot,
    yoloTakesPerAngle,
    yoloAdStoryboardSource,
    yoloAdVideoSource,
    yoloAdStoryboardTier,
    yoloAdVideoTier,
    yoloPlan,
    yoloMusicTitle,
    yoloMusicLyrics,
    yoloMusicStoryIdea,
    yoloMusicSubject,
    yoloMusicScenePalette,
    yoloMusicStyleNotes,
    yoloMusicTargetDuration,
    yoloMusicShotsPerScene,
    yoloMusicAnglesPerShot,
    yoloMusicTakesPerAngle,
    yoloMusicQualityProfile,
    yoloMusicPlan,
  ])

  // Keep queue ref in sync
  useEffect(() => {
    queueRef.current = generationQueue
  }, [generationQueue])

  // Open annotation modal with current input image (or extracted video frame)
  const openAnnotationModal = useCallback(async () => {
    if (annotationBlobUrlRef.current) {
      URL.revokeObjectURL(annotationBlobUrlRef.current)
      annotationBlobUrlRef.current = null
    }
    if (!selectedAsset) {
      setAnnotationInitialUrl(null)
      setAnnotationModalOpen(true)
      return
    }
    if (selectedAsset.type === 'image') {
      setAnnotationInitialUrl(selectedAsset.url)
      setAnnotationModalOpen(true)
      return
    }
    if (selectedAsset.type === 'video') {
      setAnnotationPreparing(true)
      try {
        const file = await extractFrameAsFile(selectedAsset.url, frameTime || 0, `frame_${Date.now()}.png`)
        const url = URL.createObjectURL(file)
        annotationBlobUrlRef.current = url
        setAnnotationInitialUrl(url)
        setAnnotationModalOpen(true)
      } catch (e) {
        console.error('Failed to extract frame for annotation', e)
      }
      setAnnotationPreparing(false)
    } else {
      setAnnotationInitialUrl(null)
      setAnnotationModalOpen(true)
    }
  }, [selectedAsset, frameTime])

  const closeAnnotationModal = useCallback(() => {
    setAnnotationModalOpen(false)
    if (annotationBlobUrlRef.current) {
      URL.revokeObjectURL(annotationBlobUrlRef.current)
      annotationBlobUrlRef.current = null
    }
  }, [])

  const handleAnnotationUseAsRef = useCallback((blob, slot) => {
    const url = URL.createObjectURL(blob)
    const name = `Annotated ref ${slot}_${Date.now()}.png`
    const newAsset = addAsset({ name, type: 'image', url })
    if (slot === 1) setReferenceAssetId1(newAsset.id)
    if (slot === 2) setReferenceAssetId2(newAsset.id)
  }, [addAsset])

  // Current workflow info
  const currentWorkflow = useMemo(() => {
    const list = WORKFLOWS[category] || []
    return list.find(w => w.id === workflowId) || list[0]
  }, [category, workflowId])

  // When category changes, pick default workflow
  useEffect(() => {
    const list = WORKFLOWS[category] || []
    if (list.length > 0 && !list.find(w => w.id === workflowId)) {
      setWorkflowId(list[0].id)
    }
  }, [category])

  useEffect(() => {
    setFormError(null)
  }, [generationMode, yoloCreationType])

  useEffect(() => {
    if (generationMode !== 'yolo') return
    setDirectorSubTab((prev) => (prev === 'setup' ? prev : 'setup'))
  }, [generationMode, yoloCreationType])

  useEffect(() => {
    setOpenWorkflowHint('')
  }, [workflowId, generationMode, category])

  const runWorkflowDependencyCheck = useCallback(async () => {
    const requestVersion = dependencyCheckVersionRef.current + 1
    dependencyCheckVersionRef.current = requestVersion

    if (generationMode !== 'single' || !workflowId) {
      setDependencyCheck({
        status: 'idle',
        hasPack: false,
        hasBlockingIssues: false,
        missingNodes: [],
        missingModels: [],
        unresolvedModels: [],
        missingAuth: false,
        error: '',
        pack: null,
        checkedAt: Date.now(),
        workflowId: workflowId || '',
      })
      return null
    }

    if (!isConnected) {
      setDependencyCheck((prev) => ({
        ...prev,
        status: 'offline',
        error: '',
        checkedAt: Date.now(),
        workflowId,
      }))
      return null
    }

    setDependencyCheck((prev) => ({
      ...prev,
      status: 'checking',
      error: '',
      checkedAt: Date.now(),
      workflowId,
    }))

    const result = await checkWorkflowDependencies(workflowId)
    if (dependencyCheckVersionRef.current !== requestVersion) return null
    setDependencyCheck(result)
    return result
  }, [generationMode, workflowId, isConnected])

  useEffect(() => {
    void runWorkflowDependencyCheck()
  }, [runWorkflowDependencyCheck])

  const validateDependenciesForQueue = useCallback(async (workflowIds, queueLabel) => {
    const normalizedIds = Array.from(new Set(
      (Array.isArray(workflowIds) ? workflowIds : [])
        .map((workflow) => String(workflow || '').trim())
        .filter(Boolean)
    ))
    if (normalizedIds.length === 0) return true

    setYoloDependencyCheckInProgress(true)
    try {
      const results = await Promise.all(normalizedIds.map((workflow) => checkWorkflowDependencies(workflow)))
      setYoloDependencyPanel({
        status: getDependencyAggregateStatus(results),
        byWorkflow: buildDependencyResultMap(results),
        checkedAt: Date.now(),
        error: '',
      })

      const blocked = results.filter((result) => result?.hasPack && result?.hasBlockingIssues)
      if (blocked.length > 0) {
        const summary = blocked.map(summarizeBlockingDependency).join('; ')
        setFormError(`Cannot queue ${queueLabel}. Missing dependencies: ${summary}.`)
        addComfyLog('error', `Blocked ${queueLabel}: ${summary}`)
        return false
      }

      const failures = results.filter((result) => result?.status === 'error')
      if (failures.length > 0) {
        addComfyLog(
          'error',
          `${queueLabel}: dependency check unavailable for ${failures.length} workflow${failures.length === 1 ? '' : 's'}. Queueing continues.`
        )
      }
      return true
    } catch (error) {
      setYoloDependencyPanel((prev) => ({
        ...prev,
        status: 'error',
        checkedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error || 'Dependency check failed'),
      }))
      addComfyLog('error', `${queueLabel}: dependency check failed. Queueing continues.`)
      return true
    } finally {
      setYoloDependencyCheckInProgress(false)
    }
  }, [addComfyLog])

  const handleCopyDependencyReport = useCallback(async () => {
    const text = buildMissingDependencyClipboardText(dependencyCheck)
    try {
      await copyTextToClipboard(text)
      addComfyLog('info', 'Dependency report copied to clipboard.')
    } catch (_) {
      setFormError('Could not copy dependency report. Copy manually from the checklist.')
    }
  }, [addComfyLog, dependencyCheck])

  const handleOpenCurrentWorkflowInComfyUi = useCallback(async () => {
    if (generationMode !== 'single') return

    const workflowPath = BUILTIN_WORKFLOW_PATHS[workflowId]
    if (!workflowPath) {
      setFormError('This workflow file is not mapped in Generate.')
      return
    }

    const comfyTabVisible = (() => {
      try {
        const stored = localStorage.getItem('comfystudio-show-comfyui-tab')
        if (stored === null) return false
        return stored === 'true'
      } catch (_) {
        return false
      }
    })()
    if (!comfyTabVisible) {
      setFormError('ComfyUI tab is hidden. Enable "Show ComfyUI tab" in Settings first.')
      return
    }

    try {
      const response = await fetch(workflowPath)
      if (!response.ok) {
        throw new Error(`Failed to fetch workflow JSON (${response.status})`)
      }
      const workflowText = await response.text()
      await copyTextToClipboard(workflowText)

      window.dispatchEvent(new CustomEvent(OPEN_COMFY_TAB_EVENT, {
        detail: { workflowId, workflowPath },
      }))

      setOpenWorkflowHint('Opened ComfyUI and copied workflow JSON. In ComfyUI canvas, press Ctrl+V to import it.')
      setFormError(null)
      addComfyLog('info', `Copied ${getWorkflowDisplayLabel(workflowId)} workflow JSON for ComfyUI import.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setFormError(`Could not open workflow in ComfyUI: ${message}`)
      setOpenWorkflowHint('')
    }
  }, [addComfyLog, generationMode, workflowId])

  const dependencyCheckInProgress = generationMode === 'single' && dependencyCheck.status === 'checking'
  const hasBlockingDependencies = generationMode === 'single' && dependencyCheck.hasBlockingIssues
  const isGenerateDisabled = (
    !isConnected
    || (generationMode === 'single' && (dependencyCheckInProgress || hasBlockingDependencies))
    || (generationMode === 'yolo' && yoloDependencyCheckInProgress)
  )

  // Build full prompt with tags
  const fullPrompt = useMemo(() => {
    const tagStr = selectedTags.length > 0 ? selectedTags.join(', ') + '. ' : ''
    return tagStr + prompt
  }, [prompt, selectedTags])

  // Frame count helper
  const getFrameCount = () => Math.round(duration * fps) + 1

  const isYoloMusicMode = generationMode === 'yolo' && yoloCreationType === 'music'
  const yoloModeKey = isYoloMusicMode ? 'music' : 'ad'
  const yoloModeLabel = isYoloMusicMode ? 'Music Video' : 'Ad'
  const yoloActivePlan = isYoloMusicMode ? yoloMusicPlan : yoloPlan
  const yoloCanEditScenes = yoloActivePlan.length > 0
  const setYoloActivePlan = isYoloMusicMode ? setYoloMusicPlan : setYoloPlan
  const yoloActiveTargetDuration = isYoloMusicMode ? yoloMusicTargetDuration : yoloTargetDuration
  const yoloActiveShotsPerScene = isYoloMusicMode ? yoloMusicShotsPerScene : yoloShotsPerScene
  const yoloActiveAnglesPerShot = isYoloMusicMode ? yoloMusicAnglesPerShot : yoloAnglesPerShot
  const yoloActiveTakesPerAngle = isYoloMusicMode ? yoloMusicTakesPerAngle : yoloTakesPerAngle
  const yoloActiveStyleNotes = isYoloMusicMode ? yoloMusicStyleNotes : yoloStyleNotes
  const yoloAdProductAsset = useMemo(
    () => assets.find((asset) => asset?.id === yoloAdProductAssetId && asset?.type === 'image') || null,
    [assets, yoloAdProductAssetId]
  )
  const yoloAdModelAsset = useMemo(
    () => assets.find((asset) => asset?.id === yoloAdModelAssetId && asset?.type === 'image') || null,
    [assets, yoloAdModelAssetId]
  )
  const yoloAdHasReferenceAnchors = Boolean(yoloAdProductAsset || yoloAdModelAsset)
  const yoloAdReferenceStyleNotes = useMemo(() => buildAdReferenceStyleNotes({
    hasProduct: Boolean(yoloAdProductAsset),
    hasModel: Boolean(yoloAdModelAsset),
    productName: yoloAdProductAsset?.name || '',
    modelName: yoloAdModelAsset?.name || '',
    consistency: yoloAdConsistency,
  }), [
    yoloAdConsistency,
    yoloAdModelAsset?.name,
    yoloAdProductAsset?.name,
    yoloAdModelAsset,
    yoloAdProductAsset,
  ])
  const yoloQueueNameLabel = useMemo(() => {
    if (isYoloMusicMode) {
      return (
        String(yoloMusicTitle || '').trim()
        || String(yoloMusicSubject || '').trim()
        || summarizeSceneText(yoloMusicStoryIdea, 'music video')
      )
    }

    const anchorLabel = [yoloAdProductAsset?.name, yoloAdModelAsset?.name]
      .map((name) => stripFileExtension(name))
      .map((name) => String(name || '').trim())
      .filter(Boolean)
      .join(' ')

    return anchorLabel || summarizeSceneText(yoloScript, 'director ad')
  }, [
    isYoloMusicMode,
    yoloAdModelAsset?.name,
    yoloAdProductAsset?.name,
    yoloMusicStoryIdea,
    yoloMusicSubject,
    yoloMusicTitle,
    yoloScript,
  ])

  const normalizeYoloAdSource = (value) => (
    String(value || '').trim().toLowerCase() === 'cloud' ? 'cloud' : 'local'
  )
  const normalizeYoloAdTier = (value) => {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === 'low' || normalized === 'quality') return normalized
    if (normalized === 'draft') return 'low'
    if (normalized === 'balanced' || normalized === 'premium') return 'quality'
    return 'low'
  }
  const yoloAdRuntimeOptions = YOLO_AD_PROFILE_RUNTIME_OPTIONS
  const yoloNormalizedAdStoryboardTier = normalizeYoloAdTier(yoloAdStoryboardTier)
  const yoloNormalizedAdVideoTier = normalizeYoloAdTier(yoloAdVideoTier)
  const yoloStoryboardProfileRuntime = !isYoloMusicMode
    ? normalizeYoloAdSource(yoloAdStoryboardSource)
    : null
  const yoloVideoProfileRuntime = !isYoloMusicMode
    ? normalizeYoloAdSource(yoloAdVideoSource)
    : null
  const yoloStoryboardUsesCloudTier = !isYoloMusicMode && yoloStoryboardProfileRuntime === 'cloud'
  const yoloVideoUsesCloudTier = !isYoloMusicMode && yoloVideoProfileRuntime === 'cloud'
  const yoloStoryboardProfileRuntimeMeta = !isYoloMusicMode
    ? (yoloAdRuntimeOptions.find((runtime) => runtime.id === yoloStoryboardProfileRuntime) || null)
    : null
  const yoloVideoProfileRuntimeMeta = !isYoloMusicMode
    ? (yoloAdRuntimeOptions.find((runtime) => runtime.id === yoloVideoProfileRuntime) || null)
    : null
  const yoloStoryboardTierOptions = !isYoloMusicMode
    ? (YOLO_AD_STAGE_TIER_OPTIONS[yoloStoryboardProfileRuntime] || YOLO_AD_STAGE_TIER_OPTIONS.local)
    : []
  const yoloVideoTierOptions = !isYoloMusicMode
    ? (YOLO_AD_STAGE_TIER_OPTIONS[yoloVideoProfileRuntime] || YOLO_AD_STAGE_TIER_OPTIONS.local)
    : []
  const yoloSelectedStoryboardTierMeta = !isYoloMusicMode
    ? (yoloStoryboardTierOptions.find((option) => option.id === yoloNormalizedAdStoryboardTier) || null)
    : null
  const yoloSelectedVideoTierMeta = !isYoloMusicMode
    ? (yoloVideoTierOptions.find((option) => option.id === yoloNormalizedAdVideoTier) || null)
    : null
  const yoloAdStoryboardProfilesForRuntime = (
    !isYoloMusicMode
      ? (YOLO_AD_PROFILES[yoloStoryboardProfileRuntime] || YOLO_AD_PROFILES.local)
      : YOLO_AD_PROFILES.local
  )
  const yoloAdVideoProfilesForRuntime = (
    !isYoloMusicMode
      ? (YOLO_AD_PROFILES[yoloVideoProfileRuntime] || YOLO_AD_PROFILES.local)
      : YOLO_AD_PROFILES.local
  )
  const yoloMusicProfile = YOLO_MUSIC_PROFILES[yoloMusicQualityProfile] || YOLO_MUSIC_PROFILES.balanced
  const yoloAdStoryboardProfile = (
    yoloAdStoryboardProfilesForRuntime[yoloNormalizedAdStoryboardTier]
    || yoloAdStoryboardProfilesForRuntime.quality
    || yoloAdStoryboardProfilesForRuntime.low
    || {}
  )
  const yoloAdVideoProfile = (
    yoloAdVideoProfilesForRuntime[yoloNormalizedAdVideoTier]
    || yoloAdVideoProfilesForRuntime.quality
    || yoloAdVideoProfilesForRuntime.low
    || {}
  )
  const yoloStoryboardWorkflowId = String(
    isYoloMusicMode
      ? yoloMusicProfile?.storyboardWorkflowId
      : yoloAdStoryboardProfile?.storyboardWorkflowId
  ).trim()
  const yoloDefaultVideoWorkflowId = String(
    isYoloMusicMode
      ? yoloMusicProfile?.videoWorkflowId
      : yoloAdVideoProfile?.videoWorkflowId
  ).trim()
  const yoloStoryboardSupportsReferenceAnchors = useMemo(() => (
    ['nano-banana-2', 'nano-banana-pro', 'image-edit-model-product', 'seedream-5-lite-image-edit'].includes(String(yoloStoryboardWorkflowId || '').trim())
  ), [yoloStoryboardWorkflowId])
  const yoloSelectedVideoWorkflowIds = useMemo(
    () => (yoloDefaultVideoWorkflowId ? [yoloDefaultVideoWorkflowId] : []),
    [yoloDefaultVideoWorkflowId]
  )
  const yoloSelectedVideoWorkflowLabel = useMemo(
    () => yoloSelectedVideoWorkflowIds.map(getWorkflowDisplayLabel).join(' + '),
    [yoloSelectedVideoWorkflowIds]
  )
  const currentWorkflowTierMeta = useMemo(
    () => getWorkflowTierMeta(workflowId),
    [workflowId]
  )
  const currentWorkflowRuntime = useMemo(
    () => getWorkflowHardwareInfo(workflowId)?.runtime || '',
    [workflowId]
  )
  const currentWorkflowRuntimeLabel = useMemo(
    () => formatWorkflowHardwareRuntime(workflowId),
    [workflowId]
  )
  const currentWorkflowUsesCloud = currentWorkflowRuntime === 'cloud'
  const yoloStoryboardTierSummary = useMemo(
    () => formatWorkflowTierSummary(yoloStoryboardWorkflowId),
    [yoloStoryboardWorkflowId]
  )
  const yoloVideoTargetTierSummary = useMemo(
    () => yoloSelectedVideoWorkflowIds.map((id) => formatWorkflowTierSummary(id)).join(' + '),
    [yoloSelectedVideoWorkflowIds]
  )
  const yoloSelectedAdStageRouting = useMemo(() => {
    if (isYoloMusicMode) return null
    const imageWorkflowId = String(yoloAdStoryboardProfile?.storyboardWorkflowId || '').trim()
    const videoWorkflowId = String(yoloAdVideoProfile?.videoWorkflowId || '').trim()
    const imageLabel = imageWorkflowId === 'image-edit-model-product'
      ? 'Qwen Image Edit 2509'
      : imageWorkflowId === 'nano-banana-2'
        ? 'Nano Banana 2'
        : getWorkflowDisplayLabel(imageWorkflowId)
    const videoLabel = videoWorkflowId === 'kling-o3-i2v'
      ? 'Kling 3.0'
      : getWorkflowDisplayLabel(videoWorkflowId)
    return {
      imageWorkflowId,
      videoWorkflowId,
      imageLabel,
      videoLabel,
      storyboardSourceLabel: yoloStoryboardProfileRuntimeMeta?.label || yoloStoryboardProfileRuntime,
      videoSourceLabel: yoloVideoProfileRuntimeMeta?.label || yoloVideoProfileRuntime,
      storyboardTierLabel: yoloSelectedStoryboardTierMeta?.label || yoloNormalizedAdStoryboardTier,
      videoTierLabel: yoloSelectedVideoTierMeta?.label || yoloNormalizedAdVideoTier,
    }
  }, [
    isYoloMusicMode,
    yoloAdStoryboardProfile,
    yoloAdVideoProfile,
    yoloStoryboardProfileRuntimeMeta,
    yoloStoryboardProfileRuntime,
    yoloVideoProfileRuntimeMeta,
    yoloVideoProfileRuntime,
    yoloSelectedStoryboardTierMeta,
    yoloNormalizedAdStoryboardTier,
    yoloSelectedVideoTierMeta,
    yoloNormalizedAdVideoTier,
  ])
  const yoloDependencyWorkflowIds = useMemo(() => Array.from(new Set([
    yoloStoryboardWorkflowId,
    ...yoloSelectedVideoWorkflowIds,
  ].map((workflow) => String(workflow || '').trim()).filter(Boolean))), [
    yoloStoryboardWorkflowId,
    yoloSelectedVideoWorkflowIds,
  ])

  const runYoloDependencySnapshotCheck = useCallback(async () => {
    const requestVersion = yoloDependencyPanelVersionRef.current + 1
    yoloDependencyPanelVersionRef.current = requestVersion

    if (generationMode !== 'yolo') {
      setYoloDependencyPanel({
        status: 'idle',
        byWorkflow: {},
        checkedAt: Date.now(),
        error: '',
      })
      return null
    }

    if (!isConnected) {
      setYoloDependencyPanel((prev) => ({
        ...prev,
        status: 'offline',
        checkedAt: Date.now(),
        error: '',
      }))
      return null
    }

    if (yoloDependencyWorkflowIds.length === 0) {
      setYoloDependencyPanel({
        status: 'idle',
        byWorkflow: {},
        checkedAt: Date.now(),
        error: '',
      })
      return null
    }

    setYoloDependencyPanel((prev) => ({
      ...prev,
      status: 'checking',
      checkedAt: Date.now(),
      error: '',
    }))

    try {
      const results = await Promise.all(yoloDependencyWorkflowIds.map((workflow) => checkWorkflowDependencies(workflow)))
      if (yoloDependencyPanelVersionRef.current !== requestVersion) return null

      setYoloDependencyPanel({
        status: getDependencyAggregateStatus(results),
        byWorkflow: buildDependencyResultMap(results),
        checkedAt: Date.now(),
        error: '',
      })
      return results
    } catch (error) {
      if (yoloDependencyPanelVersionRef.current !== requestVersion) return null
      setYoloDependencyPanel((prev) => ({
        ...prev,
        status: 'error',
        checkedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error || 'Dependency check failed'),
      }))
      return null
    }
  }, [generationMode, isConnected, yoloDependencyWorkflowIds])

  useEffect(() => {
    void runYoloDependencySnapshotCheck()
  }, [runYoloDependencySnapshotCheck])

  const yoloSceneCount = yoloActivePlan.length
  const yoloVariants = useMemo(() => flattenYoloPlanVariants(yoloActivePlan), [yoloActivePlan])
  const yoloQueueVariants = yoloVariants
  const yoloStoryboardAssetMap = useMemo(() => {
    const map = new Map()
    for (const asset of assets) {
      const key = asset?.yolo?.key
      if (!key || asset?.yolo?.stage !== 'storyboard' || asset?.type !== 'image') continue
      const assetMode = asset?.yolo?.mode
      const modeMatches = yoloModeKey === 'music'
        ? assetMode === 'music'
        : assetMode !== 'music'
      if (!modeMatches) continue
      const existing = map.get(key)
      const assetTime = new Date(asset.createdAt || 0).getTime()
      const existingTime = existing ? new Date(existing.createdAt || 0).getTime() : -1
      if (!existing || assetTime >= existingTime) {
        map.set(key, asset)
      }
    }
    return map
  }, [assets, yoloModeKey])
  const yoloStoryboardReadyCount = useMemo(
    () => yoloQueueVariants.filter((variant) => yoloStoryboardAssetMap.has(variant.key)).length,
    [yoloQueueVariants, yoloStoryboardAssetMap]
  )
  const yoloCloudCreditRows = useMemo(() => {
    const rows = []
    const keyframeRunCount = yoloQueueVariants.length
    const keyframeWorkflowId = String(yoloStoryboardWorkflowId || '').trim()
    if (keyframeWorkflowId) {
      const keyframeCheck = yoloDependencyPanel.byWorkflow?.[keyframeWorkflowId] || null
      const keyframeRuntime = getWorkflowHardwareInfo(keyframeWorkflowId)?.runtime || ''
      rows.push({
        id: `keyframes:${keyframeWorkflowId}`,
        stageLabel: 'Keyframes',
        workflowId: keyframeWorkflowId,
        workflowLabel: getWorkflowDisplayLabel(keyframeWorkflowId),
        runCount: keyframeRunCount,
        isCloud: keyframeRuntime === 'cloud',
        estimatedCredits: keyframeCheck?.estimatedCredits || null,
        hasPriceMetadata: Boolean(keyframeCheck?.hasPriceMetadata),
      })
    }

    yoloSelectedVideoWorkflowIds.forEach((videoWorkflowId, index) => {
      const normalized = String(videoWorkflowId || '').trim()
      if (!normalized) return
      const videoCheck = yoloDependencyPanel.byWorkflow?.[normalized] || null
      const videoRuntime = getWorkflowHardwareInfo(normalized)?.runtime || ''
      rows.push({
        id: `video:${normalized}:${index}`,
        stageLabel: yoloSelectedVideoWorkflowIds.length > 1 ? `Video ${index + 1}` : 'Video',
        workflowId: normalized,
        workflowLabel: getWorkflowDisplayLabel(normalized),
        runCount: yoloQueueVariants.length,
        isCloud: videoRuntime === 'cloud',
        estimatedCredits: videoCheck?.estimatedCredits || null,
        hasPriceMetadata: Boolean(videoCheck?.hasPriceMetadata),
      })
    })
    return rows
  }, [
    yoloDependencyPanel.byWorkflow,
    yoloQueueVariants.length,
    yoloSelectedVideoWorkflowIds,
    yoloStoryboardWorkflowId,
  ])
  const yoloCloudCreditProjection = useMemo(() => {
    let minTotal = 0
    let maxTotal = 0
    let hasAnyCloudRows = false
    let hasKnownCloudEstimates = false
    let hasUnknownCloudEstimates = false

    for (const row of yoloCloudCreditRows) {
      if (!row?.isCloud) continue
      hasAnyCloudRows = true
      const estimate = row?.estimatedCredits
      const runCount = Math.max(0, Number(row?.runCount) || 0)
      const min = Number(estimate?.min)
      const max = Number(estimate?.max)
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        hasUnknownCloudEstimates = true
        continue
      }
      hasKnownCloudEstimates = true
      minTotal += min * runCount
      maxTotal += max * runCount
    }

    return {
      hasAnyCloudRows,
      hasKnownCloudEstimates,
      hasUnknownCloudEstimates,
      minTotal,
      maxTotal,
    }
  }, [yoloCloudCreditRows])
  const yoloSubTabMeta = useMemo(
    () => DIRECTOR_SUBTABS.find((tab) => tab.id === directorSubTab) || DIRECTOR_SUBTABS[0],
    [directorSubTab]
  )
  const yoloSubTabHelperText = yoloSubTabMeta?.helper || ''
  const yoloSubTabTitle = yoloSubTabMeta?.label || ''
  const isYoloStillsStep = directorSubTab === 'scene-shot'
  const isYoloVideoStep = directorSubTab === 'video-pass'
  const yoloSceneStats = useMemo(() => {
    const stats = new Map()
    for (const scene of yoloActivePlan || []) {
      stats.set(scene.id, {
        shotCount: Array.isArray(scene?.shots) ? scene.shots.length : 0,
        variantCount: 0,
        readyCount: 0,
      })
    }
    for (const variant of yoloQueueVariants || []) {
      const id = variant?.sceneId
      if (!id) continue
      const current = stats.get(id) || { shotCount: 0, variantCount: 0, readyCount: 0 }
      current.variantCount += 1
      if (yoloStoryboardAssetMap.has(variant.key)) current.readyCount += 1
      stats.set(id, current)
    }
    return stats
  }, [yoloActivePlan, yoloQueueVariants, yoloStoryboardAssetMap])
  const [selectedYoloSceneId, setSelectedYoloSceneId] = useState(null)
  useEffect(() => {
    if (!Array.isArray(yoloActivePlan) || yoloActivePlan.length === 0) {
      if (selectedYoloSceneId !== null) setSelectedYoloSceneId(null)
      return
    }
    const hasSelection = yoloActivePlan.some((scene) => scene.id === selectedYoloSceneId)
    if (!hasSelection) {
      setSelectedYoloSceneId(yoloActivePlan[0].id)
    }
  }, [selectedYoloSceneId, yoloActivePlan])
  const selectedYoloSceneIndex = useMemo(
    () => yoloActivePlan.findIndex((scene) => scene.id === selectedYoloSceneId),
    [selectedYoloSceneId, yoloActivePlan]
  )
  const selectedYoloScene = useMemo(
    () => (selectedYoloSceneIndex >= 0 ? yoloActivePlan[selectedYoloSceneIndex] : null),
    [selectedYoloSceneIndex, yoloActivePlan]
  )
  useEffect(() => {
    if (generationMode !== 'yolo') return
    if ((directorSubTab === 'scene-shot' || directorSubTab === 'video-pass') && !yoloCanEditScenes) {
      setDirectorSubTab('plan-script')
    }
  }, [directorSubTab, generationMode, yoloCanEditScenes])
  const assetNameById = useMemo(() => {
    const map = new Map()
    for (const asset of assets || []) {
      if (asset?.id) map.set(asset.id, asset.name || String(asset.id))
    }
    return map
  }, [assets])

  const queuedJobs = useMemo(
    () => generationQueue.filter(j => j.status === 'queued'),
    [generationQueue]
  )
  const activeJobs = useMemo(
    () => generationQueue.filter(j => ACTIVE_JOB_STATUSES.includes(j.status)),
    [generationQueue]
  )
  const hasJobs = generationQueue.length > 0
  const queuedCount = queuedJobs.length
  const activeCount = activeJobs.length

  // Calculate aspect ratio mismatch warning (only for workflows that use an input image)
  const aspectRatioWarning = useMemo(() => {
    if (!currentWorkflow?.needsImage) return null
    if (!selectedAsset || !selectedAsset.settings) return null
    
    const inputWidth = selectedAsset.settings.width || selectedAsset.width
    const inputHeight = selectedAsset.settings.height || selectedAsset.height
    
    if (!inputWidth || !inputHeight) return null
    
    const inputAspect = inputWidth / inputHeight
    const outputAspect = resolution.width / resolution.height
    const aspectDiff = Math.abs(inputAspect - outputAspect)
    
    // Warn if aspect ratio differs by more than 5%
    if (aspectDiff > 0.05) {
      const inputLabel = inputAspect > 1 ? 'landscape' : inputAspect < 1 ? 'portrait' : 'square'
      const outputLabel = outputAspect > 1 ? 'landscape' : outputAspect < 1 ? 'portrait' : 'square'
      
      return {
        inputAspect: inputAspect.toFixed(2),
        outputAspect: outputAspect.toFixed(2),
        inputLabel,
        outputLabel,
        inputResolution: `${inputWidth}x${inputHeight}`,
        outputResolution: `${resolution.width}x${resolution.height}`,
      }
    }
    
    return null
  }, [currentWorkflow?.needsImage, selectedAsset, resolution])

  // ============================================
  // Generation queue + handler
  // ============================================
  const updateJob = useCallback((jobId, updater) => {
    setGenerationQueue(prev => prev.map(job => {
      if (job.id !== jobId) return job
      const updates = typeof updater === 'function' ? updater(job) : updater
      return { ...job, ...updates }
    }))
  }, [])

  const updateJobByPromptId = useCallback((promptId, updater) => {
    if (!promptId) return
    setGenerationQueue(prev => prev.map(job => {
      if (job.promptId !== promptId) return job
      const updates = typeof updater === 'function' ? updater(job) : updater
      return { ...job, ...updates }
    }))
  }, [])

  // Listen for ComfyUI progress events and map to jobs
  useEffect(() => {
    const handleProgress = (data) => {
      if (!data?.promptId) return
      const percent = data.max > 0 ? Math.round((data.value / data.max) * 100) : 0
      updateJobByPromptId(data.promptId, (job) => {
        if (job.status === 'done' || job.status === 'error') return job
        return {
          ...job,
          status: job.status === 'queued' ? 'running' : job.status,
          progress: Math.min(99, Math.max(job.progress || 0, percent))
        }
      })
    }

    const handleExecuting = (data) => {
      if (!data?.promptId) return
      updateJobByPromptId(data.promptId, { node: data.node })
    }

    const handleComplete = (data) => {
      if (!data?.promptId) return
      updateJobByPromptId(data.promptId, (job) => ({
        ...job,
        progress: Math.max(job.progress || 0, 100)
      }))
    }

    comfyui.on('progress', handleProgress)
    comfyui.on('executing', handleExecuting)
    comfyui.on('complete', handleComplete)

    return () => {
      comfyui.off('progress', handleProgress)
      comfyui.off('executing', handleExecuting)
      comfyui.off('complete', handleComplete)
    }
  }, [updateJobByPromptId])

  // ComfyUI activity log (executing, complete, status, errors) for troubleshooting
  const progressPercentRef = useRef({})
  useEffect(() => {
    const handleProgress = (data) => {
      if (!data?.promptId) return
      const pct = data.max > 0 ? Math.round((data.value / data.max) * 100) : 0
      const key = data.promptId
      const last = progressPercentRef.current[key]
      if (last === undefined || pct - last >= 10 || pct === 100) {
        progressPercentRef.current[key] = pct
        addComfyLog('progress', `Prompt ${String(data.promptId).slice(0, 8)}… ${pct}%`)
      }
    }
    const handleExecuting = (data) => {
      if (!data?.promptId) return
      addComfyLog('exec', data.node !== undefined ? `Executing node ${data.node}` : `Executing prompt ${String(data.promptId).slice(0, 8)}…`)
    }
    const handleExecuted = (data) => {
      if (data?.node !== undefined) addComfyLog('exec', `Executed node ${data.node}`)
    }
    const handleComplete = (data) => {
      if (data?.promptId) addComfyLog('ok', `Complete prompt ${String(data.promptId).slice(0, 8)}…`)
    }
    const handleStatus = (data) => {
      if (data?.execution_info?.queue_remaining !== undefined) {
        addComfyLog('status', `Queue: ${data.execution_info.queue_remaining} remaining`)
      }
    }
    comfyui.on('progress', handleProgress)
    comfyui.on('executing', handleExecuting)
    comfyui.on('executed', handleExecuted)
    comfyui.on('complete', handleComplete)
    comfyui.on('status', handleStatus)
    return () => {
      comfyui.off('progress', handleProgress)
      comfyui.off('executing', handleExecuting)
      comfyui.off('executed', handleExecuted)
      comfyui.off('complete', handleComplete)
      comfyui.off('status', handleStatus)
    }
  }, [addComfyLog])
  useEffect(() => {
    if (comfyLogExpanded && comfyLogEndRef.current) comfyLogEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [comfyLogExpanded, comfyLogLines])

  const openStoryboardPdfPreview = useCallback((pdfUrl) => {
    if (!pdfUrl || typeof window === 'undefined') return
    try {
      window.open(pdfUrl, '_blank', 'noopener,noreferrer')
    } catch (_) {
      // Ignore popup/open failures.
    }
  }, [])

  const exportStoryboardPdfBatch = useCallback(async (batch) => {
    if (!batch || !currentProjectHandle) return null
    const items = Array.isArray(batch.items) ? batch.items : []
    if (items.length === 0) return null

    const sortedItems = [...items].sort((a, b) => {
      const sequenceDiff = (Number(a.sequence) || 0) - (Number(b.sequence) || 0)
      if (sequenceDiff !== 0) return sequenceDiff
      return (Number(a.itemIndex) || 0) - (Number(b.itemIndex) || 0)
    })

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: true })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 32
    const headerHeight = 52
    const colGap = 18
    // Landscape layout tuned for 6 keyframe images per page (3 columns x 2 rows).
    const rowGap = 12
    const columns = 3
    const cardWidth = (pageWidth - (margin * 2) - (colGap * (columns - 1))) / columns
    const imageHeight = Math.round(cardWidth * (9 / 16))
    const labelHeight = 14
    const promptHeight = 36
    const cardHeight = imageHeight + labelHeight + promptHeight + 10
    const maxPromptLines = 3
    // Render each keyframe image at higher raster DPI to avoid pixelation in the PDF.
    const pdfRasterScale = Math.max(2, Math.min(5, 220 / 72))

    const loadImage = (src) => new Promise((resolve, reject) => {
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })

    const drawPageHeader = (pageNumber) => {
      // Reset header text color each page so later card styling doesn't tint headers.
      doc.setTextColor(0, 0, 0)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      const projectName = String(currentProject?.name || '').trim()
      doc.text(
        projectName || `Storyboard ${batch.modeLabel || 'Ad'}`,
        margin,
        margin + 14
      )
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      const subtitle = projectName
        ? `${batch.modeLabel || 'Ad'} storyboard`
        : `Generated ${new Date(batch.createdAt || Date.now()).toLocaleString()}`
      doc.text(subtitle, margin, margin + 28)
      doc.text(`Page ${pageNumber}`, margin, margin + 40)
      doc.setDrawColor(0, 0, 0)
      doc.line(margin, margin + 46, pageWidth - margin, margin + 46)
    }

    let pageNumber = 1
    let row = 0
    let col = 0
    let cursorY = margin + headerHeight
    drawPageHeader(pageNumber)

    for (let index = 0; index < sortedItems.length; index += 1) {
      const item = sortedItems[index]

      if (cursorY + cardHeight > pageHeight - margin) {
        doc.addPage()
        pageNumber += 1
        row = 0
        col = 0
        cursorY = margin + headerHeight
        drawPageHeader(pageNumber)
      }

      const cardX = margin + (col * (cardWidth + colGap))
      const cardY = cursorY
      const imageX = cardX + 1
      const imageY = cardY + 1
      const imageW = cardWidth - 2
      const imageH = imageHeight

      doc.setDrawColor(90, 90, 90)
      doc.setFillColor(20, 20, 20)
      doc.rect(cardX, cardY, cardWidth, imageHeight + labelHeight + promptHeight + 6, 'FD')

      let imagePlaced = false
      if (item?.url) {
        try {
          const img = await loadImage(item.url)
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(2, Math.floor(imageW * pdfRasterScale))
          canvas.height = Math.max(2, Math.floor(imageH * pdfRasterScale))
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.fillStyle = '#111111'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'
            const scale = Math.min(canvas.width / Math.max(1, img.width), canvas.height / Math.max(1, img.height))
            const drawW = Math.max(1, Math.round(img.width * scale))
            const drawH = Math.max(1, Math.round(img.height * scale))
            const drawX = Math.floor((canvas.width - drawW) / 2)
            const drawY = Math.floor((canvas.height - drawH) / 2)
            ctx.drawImage(img, drawX, drawY, drawW, drawH)
            const dataUrl = canvas.toDataURL('image/png')
            doc.addImage(dataUrl, 'PNG', imageX, imageY, imageW, imageH)
            imagePlaced = true
          }
        } catch (_) {
          imagePlaced = false
        }
      }

      if (!imagePlaced) {
        doc.setDrawColor(120, 120, 120)
        doc.rect(imageX, imageY, imageW, imageH)
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(8)
        doc.setTextColor(180, 180, 180)
        doc.text('Image unavailable', imageX + 8, imageY + 14)
      }

      const labelText = String(item?.shotId || item?.sceneId || '').trim().toLowerCase() || `shot_${index + 1}`
      doc.setTextColor(220, 220, 220)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.text(labelText, cardX + 4, cardY + imageHeight + 11)

      const promptText = String(item?.prompt || '').replace(/\s+/g, ' ').trim() || '(no prompt saved)'
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(205, 205, 205)
      const wrapped = doc.splitTextToSize(promptText, cardWidth - 8)
      const lines = wrapped.slice(0, maxPromptLines)
      doc.text(lines, cardX + 4, cardY + imageHeight + labelHeight + 10)

      col += 1
      if (col >= columns) {
        col = 0
        row += 1
        cursorY = margin + headerHeight + (row * (cardHeight + rowGap))
      }
    }

    const pdfBlob = doc.output('blob')
    const labelToken = slugifyNameToken(
      stripFileExtension(batch.directorLabel || ''),
      { fallback: 'keyframes', maxLength: 28 }
    )
    const dateStamp = new Date(batch.createdAt || Date.now())
      .toISOString()
      .replace(/[:.]/g, '-')
    const fileName = `director_${batch.modeKey || 'ad'}_${labelToken}_keyframes_${dateStamp}.pdf`
    const file = new File([pdfBlob], fileName, { type: 'application/pdf' })
    const imported = await importAsset(currentProjectHandle, file, 'images')

    let pdfUrl = null
    try {
      if (imported?.path) {
        pdfUrl = await getProjectFileUrl(currentProjectHandle, imported.path)
      }
    } catch (_) {
      pdfUrl = null
    }
    if (!pdfUrl) {
      pdfUrl = URL.createObjectURL(pdfBlob)
    }

    return {
      fileName,
      relativePath: imported?.path || '',
      url: pdfUrl,
      frameCount: sortedItems.length,
    }
  }, [currentProject?.name, currentProjectHandle])

  const finalizeStoryboardPdfBatchForJob = useCallback(async () => {
    // Automatic keyframe PDF export is disabled.
    // Users now explicitly generate PDFs with the "Create Storyboard PDF" button.
  }, [])

  const enqueueJob = useCallback((job) => {
    setGenerationQueue(prev => [...prev, job])
  }, [])

  const requestConfirm = useCallback(({
    title = 'Confirm action',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'danger',
  }) => {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false)
      confirmResolverRef.current = null
    }
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve
      setConfirmDialog({ title, message, confirmLabel, cancelLabel, tone })
    })
  }, [])

  const resolveConfirmDialog = useCallback((accepted) => {
    setConfirmDialog(null)
    const resolve = confirmResolverRef.current
    confirmResolverRef.current = null
    if (resolve) resolve(Boolean(accepted))
  }, [])

  useEffect(() => () => {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false)
      confirmResolverRef.current = null
    }
  }, [])

  const confirmLargeQueueBatch = useCallback(async (jobCount, label) => {
    if (jobCount <= YOLO_QUEUE_CONFIRM_THRESHOLD) return true
    return requestConfirm({
      title: 'Large queue batch',
      message: `You are about to queue ${jobCount} ${label} jobs.\n\nTip: use smaller shot/angle/take counts for quicker test batches.`,
      confirmLabel: 'Queue jobs',
      cancelLabel: 'Cancel',
      tone: 'primary',
    })
  }, [requestConfirm])

  const getExistingYoloStageKeys = useCallback((stage) => (
    new Set(
      generationQueue
        .filter((job) => {
          if (job?.yolo?.stage !== stage || !job?.yolo?.key || job.status === 'error') return false
          const jobMode = job?.yolo?.mode
          return yoloModeKey === 'music'
            ? jobMode === 'music'
            : jobMode !== 'music'
        })
        .map((job) => job.yolo.key)
    )
  ), [generationQueue, yoloModeKey])

  const handleClearGenerationQueue = useCallback(async () => {
    if (generationQueue.length === 0) return
    const hasActiveJobs = generationQueue.some((job) => ACTIVE_JOB_STATUSES.includes(job.status))
    const confirmed = await requestConfirm({
      title: 'Clear queue?',
      message: hasActiveJobs
        ? `Clear ${generationQueue.length} jobs and interrupt the active generation?`
        : `Clear ${generationQueue.length} queued/completed jobs from this session?`,
      confirmLabel: 'Clear queue',
      cancelLabel: 'Keep queue',
      tone: 'danger',
    })
    if (!confirmed) return

    if (hasActiveJobs) {
      try {
        await comfyui.interrupt()
      } catch (_) {
        // ignore interrupt failure; queue reset still proceeds
      }
    }

    setGenerationQueue([])
    setActiveJobId(null)
    processingRef.current = false
    startedJobIdsRef.current.clear()
    storyboardPdfBatchesRef.current.clear()
    queuePausedRef.current = false
    consecutiveRapidFailsRef.current = 0
    setFormError(null)
    addComfyLog('status', 'Generation queue cleared')
  }, [addComfyLog, generationQueue, requestConfirm])

  const handleResumeQueue = useCallback(() => {
    const pausedIds = queueRef.current
      .filter((job) => job.status === 'paused')
      .map((job) => job.id)
    for (const jobId of pausedIds) {
      startedJobIdsRef.current.delete(jobId)
    }
    queuePausedRef.current = false
    consecutiveRapidFailsRef.current = 0
    setGenerationQueue(prev => prev.map(j =>
      j.status === 'paused' ? { ...j, status: 'queued' } : j
    ))
    addComfyLog('status', 'Queue resumed')
  }, [addComfyLog])

  const createQueuedJob = useCallback((overrides = {}) => {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    return {
      id: jobId,
      createdAt: Date.now(),
      category,
      workflowId,
      workflowLabel: currentWorkflow?.label || workflowId,
      needsImage: !!currentWorkflow?.needsImage,
      prompt: fullPrompt,
      negativePrompt,
      tags: selectedTags,
      seed,
      duration,
      fps,
      resolution,
      wanQualityPreset,
      editSteps,
      editCfg,
      musicTags,
      lyrics,
      musicDuration,
      bpm,
      keyscale,
      inputAssetId: selectedAsset?.id || null,
      inputAssetName: selectedAsset?.name || '',
      inputFromTimelineFrame: false,
      referenceAssetId1: workflowId === 'image-edit' ? referenceAssetId1 : null,
      referenceAssetId2: workflowId === 'image-edit' ? referenceAssetId2 : null,
      frameTime: frameTime || 0,
      status: 'queued',
      progress: 0,
      promptId: null,
      node: null,
      error: null,
      ...overrides,
    }
  }, [
    bpm,
    category,
    currentWorkflow?.label,
    currentWorkflow?.needsImage,
    duration,
    editCfg,
    editSteps,
    fps,
    frameTime,
    fullPrompt,
    keyscale,
    lyrics,
    musicDuration,
    musicTags,
    negativePrompt,
    referenceAssetId1,
    referenceAssetId2,
    resolution,
    seed,
    selectedAsset?.id,
    selectedAsset?.name,
    selectedTags,
    wanQualityPreset,
    workflowId,
  ])

  const normalizeGeneratedYoloPlan = useCallback((rawPlan = []) => (
    rawPlan.map((scene, sceneIndex) => {
      const sceneId = `S${sceneIndex + 1}`
      return {
        ...scene,
        id: sceneId,
        index: sceneIndex + 1,
        shots: (scene.shots || []).map((shot, shotIndex) => (
          normalizeShotForScene(sceneId, shot, shotIndex, shot)
        )),
      }
    })
  ), [])

  const buildYoloAdPlan = useCallback(() => {
    if (!yoloScript.trim()) {
      setFormError('Paste an ad script first, then click Build Plan')
      return null
    }
    const combinedAdStyleNotes = [yoloStyleNotes, yoloAdReferenceStyleNotes].filter(Boolean).join(' ')
    const nextPlan = buildYoloPlanFromScript(yoloScript, {
      targetDurationSeconds: yoloTargetDuration,
      shotsPerScene: yoloShotsPerScene,
      anglesPerShot: yoloAnglesPerShot,
      takesPerAngle: yoloTakesPerAngle,
      styleNotes: combinedAdStyleNotes,
    })
    if (nextPlan.length === 0) {
      setFormError('Could not extract scenes from script')
      return null
    }
    const normalizedPlan = normalizeGeneratedYoloPlan(nextPlan)
    setYoloPlan(normalizedPlan)
    setFormError(null)
    return normalizedPlan
  }, [
    normalizeGeneratedYoloPlan,
    yoloAnglesPerShot,
    yoloScript,
    yoloShotsPerScene,
    yoloAdReferenceStyleNotes,
    yoloStyleNotes,
    yoloTakesPerAngle,
    yoloTargetDuration,
  ])

  const buildYoloMusicPlan = useCallback(() => {
    if (!yoloMusicLyrics.trim()) {
      setFormError('Paste song lyrics first, then click Build Plan')
      return null
    }

    const estimatedSceneCount = Math.max(
      4,
      Math.min(24, Math.round((Number(yoloMusicTargetDuration) || 30) / Math.max(1, Number(yoloMusicShotsPerScene) || 1)))
    )
    const generatedScript = buildMusicVideoScriptFromLyrics(yoloMusicLyrics, {
      songTitle: yoloMusicTitle,
      storyIdea: yoloMusicStoryIdea,
      subjectDescription: yoloMusicSubject,
      scenePalette: yoloMusicScenePalette,
      targetDuration: yoloMusicTargetDuration,
      estimatedSceneCount,
    })

    if (!generatedScript.trim()) {
      setFormError('Could not build a music video scene script from the lyrics')
      return null
    }

    const combinedStyleNotes = buildMusicVideoStyleNotes({
      styleNotes: yoloMusicStyleNotes,
      subjectDescription: yoloMusicSubject,
      scenePalette: yoloMusicScenePalette,
    })

    const nextPlan = buildYoloPlanFromScript(generatedScript, {
      targetDurationSeconds: yoloMusicTargetDuration,
      shotsPerScene: yoloMusicShotsPerScene,
      anglesPerShot: yoloMusicAnglesPerShot,
      takesPerAngle: yoloMusicTakesPerAngle,
      styleNotes: combinedStyleNotes,
    })
    if (nextPlan.length === 0) {
      setFormError('Could not extract scenes from lyrics')
      return null
    }
    const normalizedPlan = normalizeGeneratedYoloPlan(nextPlan)
    setYoloMusicPlan(normalizedPlan)
    setFormError(null)
    return normalizedPlan
  }, [
    normalizeGeneratedYoloPlan,
    yoloMusicAnglesPerShot,
    yoloMusicLyrics,
    yoloMusicScenePalette,
    yoloMusicShotsPerScene,
    yoloMusicStoryIdea,
    yoloMusicStyleNotes,
    yoloMusicSubject,
    yoloMusicTakesPerAngle,
    yoloMusicTargetDuration,
    yoloMusicTitle,
  ])

  const buildActiveYoloPlan = useCallback(() => (
    isYoloMusicMode ? buildYoloMusicPlan() : buildYoloAdPlan()
  ), [buildYoloAdPlan, buildYoloMusicPlan, isYoloMusicMode])
  const handleBuildActiveYoloPlan = useCallback(() => {
    const nextPlan = buildActiveYoloPlan()
    if (Array.isArray(nextPlan) && nextPlan.length > 0) {
      setDirectorSubTab('scene-shot')
    }
    return nextPlan
  }, [buildActiveYoloPlan])

  const updateYoloShot = useCallback((sceneId, shotId, updater) => {
    setYoloActivePlan((prevPlan) => prevPlan.map((scene) => {
      if (scene.id !== sceneId) return scene
      const nextShots = (scene.shots || []).map((shot, shotIndex) => {
        if (shot.id !== shotId) return normalizeShotForScene(scene.id, shot, shotIndex, shot)
        const updatedShot = typeof updater === 'function'
          ? updater(shot, shotIndex, scene)
          : { ...shot, ...updater }
        return normalizeShotForScene(scene.id, updatedShot, shotIndex, shot)
      })
      return { ...scene, shots: nextShots }
    }))
  }, [setYoloActivePlan])

  const handleYoloShotImageBeatChange = useCallback((sceneId, shotId, value) => {
    updateYoloShot(sceneId, shotId, (shot) => ({ ...shot, imageBeat: value }))
  }, [updateYoloShot])

  const handleYoloShotVideoBeatChange = useCallback((sceneId, shotId, value) => {
    updateYoloShot(sceneId, shotId, (shot) => ({ ...shot, videoBeat: value, beat: value }))
  }, [updateYoloShot])

  const handleYoloShotCameraDirectionChange = useCallback((sceneId, shotId, value) => {
    updateYoloShot(sceneId, shotId, (shot) => ({ ...shot, cameraDirection: value }))
  }, [updateYoloShot])

  const handleYoloShotCameraPresetChange = useCallback((sceneId, shotId, presetId) => {
    updateYoloShot(sceneId, shotId, (shot) => {
      const targetCount = Math.max(1, Number(shot?.angles?.length) || Number(yoloActiveAnglesPerShot) || 1)
      if (presetId === 'auto') {
        return {
          ...shot,
          cameraPresetId: 'auto',
          angles: String(shot?.shotType || '').trim()
            ? [String(shot.shotType).trim()]
            : shot.angles,
        }
      }
      return {
        ...shot,
        cameraPresetId: String(presetId || 'auto'),
        angles: resolveCameraPresetAngles(presetId, targetCount),
      }
    })
  }, [updateYoloShot, yoloActiveAnglesPerShot])

  const handleYoloShotDurationChange = useCallback((sceneId, shotId, value) => {
    updateYoloShot(sceneId, shotId, (shot) => ({
      ...shot,
      durationSeconds: clampNumberValue(value, 2, 5, shot.durationSeconds),
    }))
  }, [updateYoloShot])

  const handleYoloShotTakesChange = useCallback((sceneId, shotId, value) => {
    updateYoloShot(sceneId, shotId, (shot) => ({
      ...shot,
      takesPerAngle: Math.round(clampNumberValue(value, 1, 4, shot.takesPerAngle)),
    }))
  }, [updateYoloShot])

  const queueYoloStoryboardVariants = useCallback(async (variants, options = {}) => {
    const {
      allowExistingDoneKeys = false,
      skipConfirm = false,
      sourceLabel = `${DIRECTOR_MODE_BETA_LABEL} ${yoloModeLabel.toLowerCase()} keyframe pass`,
    } = options

    if (!Array.isArray(variants) || variants.length === 0) {
      setFormError('No queueable shots. Build a plan first.')
      return 0
    }

    const existingKeys = getExistingYoloStageKeys('storyboard')
    const activeStoryboardKeys = new Set(
      generationQueue
        .filter((job) => (
          job?.yolo?.stage === 'storyboard' &&
          NON_TERMINAL_JOB_STATUSES.includes(job.status) &&
          job?.yolo?.key
        ))
        .map((job) => job.yolo.key)
    )
    const variantsToQueue = variants.filter((variant) => {
      if (!variant?.key) return false
      if (activeStoryboardKeys.has(variant.key)) return false
      if (!allowExistingDoneKeys && existingKeys.has(variant.key)) return false
      return true
    })

    if (variantsToQueue.length === 0) {
      setFormError(
        allowExistingDoneKeys
          ? 'Selected shot is already queued/running. Wait for it to finish, then try again.'
          : 'All selected keyframe variants are already in this queue/run.'
      )
      return 0
    }

    if (!skipConfirm) {
      const confirmed = await confirmLargeQueueBatch(variantsToQueue.length, 'keyframe')
      if (!confirmed) {
        setFormError('Queue cancelled')
        return 0
      }
    }

    const extractNumericId = (value, fallback = 1) => {
      const match = String(value || '').match(/\d+/)
      const parsed = match ? Number(match[0]) : fallback
      return Number.isFinite(parsed) ? parsed : fallback
    }
    const usesModelProductStoryboardWorkflow = yoloStoryboardWorkflowId === 'image-edit-model-product'
    const storyboardInputAsset = usesModelProductStoryboardWorkflow
      ? (yoloAdModelAsset || yoloAdProductAsset || null)
      : null
    const jobs = variantsToQueue.map((variant, index) => {
      const sceneNum = extractNumericId(variant.sceneId, index + 1)
      const shotNum = extractNumericId(variant.shotId, 1)
      const angleNum = extractNumericId(variant.angle, 1)
      const takeNum = extractNumericId(variant.take, 1)
      // Keep consistency behavior, but ensure each take gets a distinct seed.
      const strictSeed = Number(seed) + (sceneNum * 1000) + (shotNum * 10) + takeNum
      const mediumSeed = Number(seed) + (sceneNum * 100000) + (shotNum * 1000) + (angleNum * 100) + (takeNum * 10)
      const softSeed = Number(seed) + index + 1
      const storyboardSeed = (
        yoloAdConsistency === 'strict'
          ? strictSeed
          : yoloAdConsistency === 'medium'
            ? mediumSeed
            : softSeed
      )
      return createQueuedJob({
        category: 'image',
        workflowId: yoloStoryboardWorkflowId,
        workflowLabel: `${DIRECTOR_MODE_BETA_LABEL} ${yoloModeLabel} Keyframe (${yoloStoryboardWorkflowId})`,
        needsImage: usesModelProductStoryboardWorkflow,
        prompt: variant.storyboardPrompt || variant.prompt,
        seed: storyboardSeed,
        inputAssetId: storyboardInputAsset?.id || null,
        inputAssetName: storyboardInputAsset?.name || '',
        inputFromTimelineFrame: false,
        referenceAssetId1: !isYoloMusicMode ? (yoloAdProductAsset?.id || null) : null,
        referenceAssetId2: !isYoloMusicMode ? (yoloAdModelAsset?.id || null) : null,
        directorLabel: yoloQueueNameLabel,
        yolo: {
          mode: yoloModeKey,
          stage: 'storyboard',
          key: variant.key,
          sceneId: variant.sceneId,
          shotId: variant.shotId,
          angle: variant.angle,
          take: variant.take,
          durationSeconds: variant.durationSeconds,
          profile: isYoloMusicMode ? yoloMusicQualityProfile : yoloNormalizedAdStoryboardTier,
          profileRuntime: !isYoloMusicMode ? yoloStoryboardProfileRuntime : null,
          referenceConsistency: !isYoloMusicMode ? yoloAdConsistency : null,
        },
      })
    })

    setGenerationQueue(prev => [...prev, ...jobs])
    setFormError(null)
    addComfyLog('status', `${sourceLabel} queued: ${jobs.length} job${jobs.length === 1 ? '' : 's'}`)
    return jobs.length
  }, [
    addComfyLog,
    confirmLargeQueueBatch,
    createQueuedJob,
    generationQueue,
    getExistingYoloStageKeys,
    isYoloMusicMode,
    seed,
    yoloAdConsistency,
    yoloAdModelAsset,
    yoloAdModelAsset?.id,
    yoloMusicQualityProfile,
    yoloNormalizedAdStoryboardTier,
    yoloAdProductAsset,
    yoloAdProductAsset?.id,
    yoloModeKey,
    yoloModeLabel,
    yoloStoryboardProfileRuntime,
    yoloStoryboardWorkflowId,
    yoloQueueNameLabel,
  ])

  const handleQueueYoloStoryboards = useCallback(async () => {
    if (!isConnected) return
    if (
      !isYoloMusicMode &&
      ['image-edit-model-product', 'seedream-5-lite-image-edit'].includes(String(yoloStoryboardWorkflowId || '').trim()) &&
      !yoloAdModelAsset &&
      !yoloAdProductAsset
    ) {
      setFormError('Selected keyframe workflow needs at least a model or product reference image.')
      return
    }
    if (
      !isYoloMusicMode &&
      yoloAdHasReferenceAnchors &&
      !yoloStoryboardSupportsReferenceAnchors
    ) {
      setFormError(`Product/model references are not supported by ${getWorkflowDisplayLabel(yoloStoryboardWorkflowId)} keyframes.`)
      return
    }
    const depsOk = await validateDependenciesForQueue(
      [yoloStoryboardWorkflowId],
      `${DIRECTOR_MODE_BETA_LABEL} ${yoloModeLabel.toLowerCase()} keyframe pass`
    )
    if (!depsOk) return

    const planToUse = yoloActivePlan.length > 0 ? yoloActivePlan : buildActiveYoloPlan()
    if (!planToUse) return

    const variants = flattenYoloPlanVariants(planToUse)
    await queueYoloStoryboardVariants(variants, {
      allowExistingDoneKeys: false,
      skipConfirm: false,
      sourceLabel: `${DIRECTOR_MODE_BETA_LABEL} ${yoloModeLabel.toLowerCase()} keyframe pass`,
    })
  }, [
    buildActiveYoloPlan,
    isConnected,
    isYoloMusicMode,
    queueYoloStoryboardVariants,
    validateDependenciesForQueue,
    yoloActivePlan,
    yoloAdModelAsset,
    yoloAdHasReferenceAnchors,
    yoloAdProductAsset,
    yoloStoryboardSupportsReferenceAnchors,
    yoloStoryboardWorkflowId,
    yoloModeLabel,
  ])

  const handleQueueYoloShotStoryboard = useCallback(async (sceneId, shotId) => {
    if (!isConnected) return
    if (
      !isYoloMusicMode &&
      yoloAdHasReferenceAnchors &&
      !yoloStoryboardSupportsReferenceAnchors
    ) {
      setFormError(`Product/model references are not supported by ${getWorkflowDisplayLabel(yoloStoryboardWorkflowId)} keyframes.`)
      return
    }
    if (
      !isYoloMusicMode &&
      ['image-edit-model-product', 'seedream-5-lite-image-edit'].includes(String(yoloStoryboardWorkflowId || '').trim()) &&
      !yoloAdModelAsset &&
      !yoloAdProductAsset
    ) {
      setFormError('Selected keyframe workflow needs at least a model or product reference image.')
      return
    }
    const depsOk = await validateDependenciesForQueue(
      [yoloStoryboardWorkflowId],
      `keyframe re-render for ${sceneId} ${shotId}`
    )
    if (!depsOk) return

    const planToUse = yoloActivePlan.length > 0 ? yoloActivePlan : buildActiveYoloPlan()
    if (!planToUse) return

    const variants = flattenYoloPlanVariants(planToUse)
      .filter((variant) => variant.sceneId === sceneId && variant.shotId === shotId)
    if (variants.length === 0) {
      setFormError(`No keyframe variants found for ${sceneId} ${shotId}.`)
      return
    }

    await queueYoloStoryboardVariants(variants, {
      allowExistingDoneKeys: true,
      skipConfirm: true,
      sourceLabel: `Queued keyframe re-render for ${sceneId} ${shotId}`,
    })
  }, [
    buildActiveYoloPlan,
    isConnected,
    isYoloMusicMode,
    queueYoloStoryboardVariants,
    validateDependenciesForQueue,
    yoloActivePlan,
    yoloAdHasReferenceAnchors,
    yoloAdModelAsset,
    yoloAdProductAsset,
    yoloStoryboardSupportsReferenceAnchors,
    yoloStoryboardWorkflowId,
  ])

  const queueYoloVideoVariants = useCallback(async (variants, options = {}) => {
    const {
      allowExistingDoneKeys = false,
      skipConfirm = false,
      workflowId = yoloDefaultVideoWorkflowId,
      suppressEmptyError = false,
      sourceLabel = `${DIRECTOR_MODE_BETA_LABEL} ${yoloModeLabel.toLowerCase()} video pass`,
    } = options

    if (!Array.isArray(variants) || variants.length === 0) {
      if (!suppressEmptyError) setFormError('No queueable shots. Build a plan first.')
      return 0
    }

    const buildVideoVariantKey = (variantKey) => `${String(variantKey || '')}::${workflowId}`
    const existingKeys = getExistingYoloStageKeys('video')
    const activeVideoKeys = new Set(
      generationQueue
        .filter((job) => (
          job?.yolo?.stage === 'video' &&
          NON_TERMINAL_JOB_STATUSES.includes(job.status) &&
          job?.yolo?.key
        ))
        .map((job) => job.yolo.key)
    )
    const variantsToQueue = variants.filter((variant) => {
      if (!variant?.key) return false
      const variantScopedKey = buildVideoVariantKey(variant.key)
      if (activeVideoKeys.has(variantScopedKey) || activeVideoKeys.has(variant.key)) return false
      if (!allowExistingDoneKeys && (existingKeys.has(variantScopedKey) || existingKeys.has(variant.key))) return false
      return true
    })

    const jobs = []
    let missing = 0
    let seedOffset = 0
    for (const variant of variantsToQueue) {
      const storyboardAsset = yoloStoryboardAssetMap.get(variant.key)
      if (!storyboardAsset) {
        missing += 1
        continue
      }
      seedOffset += 1
      const videoDuration = VIDEO_DURATION_PRESETS.reduce((closest, candidate) => (
        Math.abs(candidate - variant.durationSeconds) < Math.abs(closest - variant.durationSeconds) ? candidate : closest
      ), VIDEO_DURATION_PRESETS[0])
      const variantScopedKey = buildVideoVariantKey(variant.key)
      jobs.push(createQueuedJob({
        category: 'video',
        workflowId,
        workflowLabel: `${DIRECTOR_MODE_BETA_LABEL} ${yoloModeLabel} Video (${getWorkflowDisplayLabel(workflowId)})`,
        needsImage: true,
        inputAssetId: storyboardAsset.id,
        inputAssetName: storyboardAsset.name || variant.key,
        inputFromTimelineFrame: false,
        prompt: variant.videoPrompt || variant.prompt,
        duration: videoDuration,
        seed: Number(seed) + seedOffset,
        referenceAssetId1: null,
        referenceAssetId2: null,
        directorLabel: yoloQueueNameLabel,
        yolo: {
          mode: yoloModeKey,
          stage: 'video',
          key: variantScopedKey,
          variantKey: variant.key,
          workflowId,
          sceneId: variant.sceneId,
          shotId: variant.shotId,
          angle: variant.angle,
          take: variant.take,
          durationSeconds: variant.durationSeconds,
          profile: isYoloMusicMode ? yoloMusicQualityProfile : yoloNormalizedAdVideoTier,
          profileRuntime: !isYoloMusicMode ? yoloVideoProfileRuntime : null,
        },
      }))
    }

    if (jobs.length === 0) {
      if (!suppressEmptyError) {
        setFormError(
          variantsToQueue.length === 0
            ? (
              allowExistingDoneKeys
                ? 'Selected shot video is already queued/running. Wait for it to finish, then try again.'
                : 'All selected video variants are already in this queue/run.'
            )
            : 'No keyframe images found yet. Queue or re-render keyframes first, then queue video.'
        )
      }
      return 0
    }

    if (!skipConfirm) {
      const confirmed = await confirmLargeQueueBatch(jobs.length, 'video')
      if (!confirmed) {
        setFormError('Queue cancelled')
        return 0
      }
    }

    setGenerationQueue(prev => [...prev, ...jobs])
    setFormError(missing > 0 ? `Queued ${jobs.length} video jobs (${missing} variants still missing keyframe images)` : null)
    addComfyLog('status', `${sourceLabel} queued: ${jobs.length} job${jobs.length === 1 ? '' : 's'}${missing > 0 ? ` (${missing} missing)` : ''}`)
    return jobs.length
  }, [
    addComfyLog,
    confirmLargeQueueBatch,
    createQueuedJob,
    generationQueue,
    getExistingYoloStageKeys,
    isYoloMusicMode,
    seed,
    yoloDefaultVideoWorkflowId,
    yoloMusicQualityProfile,
    yoloNormalizedAdVideoTier,
    yoloVideoProfileRuntime,
    yoloModeKey,
    yoloModeLabel,
    yoloQueueNameLabel,
    yoloStoryboardAssetMap,
  ])

  const handleQueueYoloVideos = useCallback(async () => {
    if (!isConnected) return
    const planToUse = yoloActivePlan.length > 0 ? yoloActivePlan : buildActiveYoloPlan()
    if (!planToUse) return

    const variants = flattenYoloPlanVariants(planToUse)
    if (variants.length === 0) {
      setFormError('No queueable shots. Build a plan first.')
      return
    }

    const targets = yoloSelectedVideoWorkflowIds
    const depsOk = await validateDependenciesForQueue(
      targets,
      `${DIRECTOR_MODE_BETA_LABEL} ${yoloModeLabel.toLowerCase()} video pass`
    )
    if (!depsOk) return

    if (targets.length > 1) {
      const estimatedJobs = variants.length * targets.length
      const confirmed = await confirmLargeQueueBatch(estimatedJobs, 'video')
      if (!confirmed) {
        setFormError('Queue cancelled')
        return
      }
    }

    let totalQueued = 0
    for (const targetWorkflowId of targets) {
      totalQueued += await queueYoloVideoVariants(variants, {
        workflowId: targetWorkflowId,
        allowExistingDoneKeys: false,
        skipConfirm: targets.length > 1,
        suppressEmptyError: targets.length > 1,
        sourceLabel: `${DIRECTOR_MODE_BETA_LABEL} ${yoloModeLabel.toLowerCase()} video pass (${getWorkflowDisplayLabel(targetWorkflowId)})`,
      })
    }
    if (totalQueued === 0) {
      setFormError('No video jobs were queued. If they already completed, use Queue Shot Video for targeted reruns.')
    }
  }, [
    buildActiveYoloPlan,
    confirmLargeQueueBatch,
    isConnected,
    queueYoloVideoVariants,
    validateDependenciesForQueue,
    yoloActivePlan,
    yoloSelectedVideoWorkflowIds,
    yoloModeLabel,
  ])

  const handleCreateStoryboardPdf = useCallback(async () => {
    if (creatingStoryboardPdf) return
    if (!currentProjectHandle) {
      setFormError('Open a project folder first so keyframe PDFs can be saved.')
      addComfyLog('error', 'Keyframe PDF export requires an open project folder.')
      return
    }

    const items = []
    const seenAssetIds = new Set()

    for (let index = 0; index < yoloQueueVariants.length; index += 1) {
      const variant = yoloQueueVariants[index]
      const asset = yoloStoryboardAssetMap.get(variant?.key)
      if (!asset?.url) continue
      if (asset?.id && seenAssetIds.has(asset.id)) continue
      if (asset?.id) seenAssetIds.add(asset.id)
      items.push({
        assetId: asset.id || variant?.key || `storyboard-${index + 1}`,
        url: asset.url,
        prompt: String(asset.prompt || variant?.storyboardPrompt || variant?.prompt || '').trim(),
        sequence: index + 1,
        itemIndex: index,
        sceneId: String(variant?.sceneId || asset?.yolo?.sceneId || ''),
        shotId: String(variant?.shotId || asset?.yolo?.shotId || ''),
        angle: String(variant?.angle || asset?.yolo?.angle || ''),
        take: Number(variant?.take ?? asset?.yolo?.take) || null,
      })
    }

    // If the active plan is empty, still allow exporting from any latest keyframe images.
    if (items.length === 0) {
      const extractNumericOrder = (value) => {
        const match = String(value || '').match(/\d+/)
        const parsed = match ? Number(match[0]) : Number.POSITIVE_INFINITY
        return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
      }
      const fallbackAssets = Array.from(yoloStoryboardAssetMap.values()).sort((a, b) => {
        const sceneDiff = extractNumericOrder(a?.yolo?.sceneId) - extractNumericOrder(b?.yolo?.sceneId)
        if (sceneDiff !== 0) return sceneDiff
        const shotDiff = extractNumericOrder(a?.yolo?.shotId) - extractNumericOrder(b?.yolo?.shotId)
        if (shotDiff !== 0) return shotDiff
        const angleDiff = extractNumericOrder(a?.yolo?.angle) - extractNumericOrder(b?.yolo?.angle)
        if (angleDiff !== 0) return angleDiff
        const takeDiff = (Number(a?.yolo?.take) || 0) - (Number(b?.yolo?.take) || 0)
        if (takeDiff !== 0) return takeDiff
        return new Date(a?.createdAt || 0).getTime() - new Date(b?.createdAt || 0).getTime()
      })
      for (let index = 0; index < fallbackAssets.length; index += 1) {
        const asset = fallbackAssets[index]
        if (!asset?.url) continue
        if (asset?.id && seenAssetIds.has(asset.id)) continue
        if (asset?.id) seenAssetIds.add(asset.id)
        items.push({
          assetId: asset.id || `storyboard-fallback-${index + 1}`,
          url: asset.url,
          prompt: String(asset.prompt || '').trim(),
          sequence: index + 1,
          itemIndex: index,
          sceneId: String(asset?.yolo?.sceneId || ''),
          shotId: String(asset?.yolo?.shotId || ''),
          angle: String(asset?.yolo?.angle || ''),
          take: Number(asset?.yolo?.take) || null,
        })
      }
    }

    if (items.length === 0) {
      setFormError('No keyframe images found yet. Queue or re-render keyframes first, then create the PDF.')
      addComfyLog('error', 'Keyframe PDF export skipped: no keyframe images available.')
      return
    }

    setCreatingStoryboardPdf(true)
    setFormError(null)
    addComfyLog('status', `Creating keyframe PDF from ${items.length} frame${items.length === 1 ? '' : 's'}...`)
    try {
      const exported = await exportStoryboardPdfBatch({
        id: `manual_keyframe_${Date.now()}`,
        createdAt: Date.now(),
        modeKey: yoloModeKey,
        modeLabel: yoloModeLabel,
        directorLabel: yoloQueueNameLabel,
        items,
      })

      if (!exported) {
        throw new Error('Keyframe PDF export did not return a file.')
      }
      addComfyLog('ok', `Keyframe PDF saved: ${exported.fileName}`)
      openStoryboardPdfPreview(exported.url)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Keyframe PDF export failed')
      setFormError(`Keyframe PDF export failed: ${message}`)
      addComfyLog('error', `Keyframe PDF export failed: ${message}`)
    } finally {
      setCreatingStoryboardPdf(false)
    }
  }, [
    addComfyLog,
    creatingStoryboardPdf,
    currentProjectHandle,
    exportStoryboardPdfBatch,
    openStoryboardPdfPreview,
    yoloModeKey,
    yoloModeLabel,
    yoloQueueNameLabel,
    yoloQueueVariants,
    yoloStoryboardAssetMap,
  ])

  const handleQueueYoloShotVideo = useCallback(async (sceneId, shotId) => {
    if (!isConnected) return
    const depsOk = await validateDependenciesForQueue(
      yoloSelectedVideoWorkflowIds,
      `video re-render for ${sceneId} ${shotId}`
    )
    if (!depsOk) return

    const planToUse = yoloActivePlan.length > 0 ? yoloActivePlan : buildActiveYoloPlan()
    if (!planToUse) return

    const variants = flattenYoloPlanVariants(planToUse)
      .filter((variant) => variant.sceneId === sceneId && variant.shotId === shotId)
    if (variants.length === 0) {
      setFormError(`No video variants found for ${sceneId} ${shotId}.`)
      return
    }

    let totalQueued = 0
    for (const targetWorkflowId of yoloSelectedVideoWorkflowIds) {
      totalQueued += await queueYoloVideoVariants(variants, {
        workflowId: targetWorkflowId,
        allowExistingDoneKeys: true,
        skipConfirm: true,
        suppressEmptyError: yoloSelectedVideoWorkflowIds.length > 1,
        sourceLabel: `Queued video re-render for ${sceneId} ${shotId} (${getWorkflowDisplayLabel(targetWorkflowId)})`,
      })
    }
    if (totalQueued === 0) {
      setFormError(`No video jobs queued for ${sceneId} ${shotId}. Check if target workflows are already running.`)
    }
  }, [
    buildActiveYoloPlan,
    isConnected,
    queueYoloVideoVariants,
    validateDependenciesForQueue,
    yoloActivePlan,
    yoloSelectedVideoWorkflowIds,
  ])

  const handleGenerate = () => {
    if (!isConnected) return
    if (generationMode === 'yolo') {
      void handleQueueYoloStoryboards()
      return
    }
    if (dependencyCheckInProgress) {
      setFormError('Checking workflow dependencies. Please wait a moment and try again.')
      return
    }
    if (hasBlockingDependencies) {
      setFormError('Missing required workflow dependencies. Install the missing items listed below and re-check.')
      return
    }
    const usingTimelineFrame = !!frameForAI?.file && (
      workflowId === 'wan22-i2v' || workflowId === 'kling-o3-i2v' || workflowId === 'grok-video-i2v' || workflowId === 'vidu-q2-i2v'
    )
    if (currentWorkflow?.needsImage && !selectedAsset && !usingTimelineFrame) {
      setFormError('Please select an input asset or use a timeline frame first')
      return
    }

    setFormError(null)

    const job = createQueuedJob({
      inputAssetId: usingTimelineFrame ? null : (selectedAsset?.id || null),
      inputAssetName: usingTimelineFrame ? 'Timeline frame' : (selectedAsset?.name || ''),
      inputFromTimelineFrame: usingTimelineFrame,
      referenceAssetId1: workflowId === 'image-edit' ? referenceAssetId1 : null,
      referenceAssetId2: workflowId === 'image-edit' ? referenceAssetId2 : null,
    })

    enqueueJob(job)
  }

  // Poll for result
  const pollForResult = async (promptId, wfId, onProgress, expectedOutputPrefix = '') => {
    const maxPolls = 600 // 10 minutes at 1s interval
    let consecutivePollErrors = 0
    const maxConsecutivePollErrors = 15

    // Helper: extract filename from various ComfyUI API formats (old dict-based and new SavedResult)
    const getFilename = (item) => item?.filename || item?.file || item?.name
    const getSubfolder = (item) => item?.subfolder || item?.sub_folder || ''
    const getOutputType = (item) => item?.type || item?.folder_type || 'output'

    // Helper: check if a filename looks like a video file
    const isVideoFilename = (fn) => typeof fn === 'string' && /\.(mp4|webm|gif|mov|avi|mkv)$/i.test(fn)
    // Helper: check if a filename looks like an image file
    const isImageFilename = (fn) => typeof fn === 'string' && /\.(png|jpg|jpeg|webp|bmp|tiff)$/i.test(fn)
    // Helper: check if a filename looks like an audio file
    const isAudioFilename = (fn) => typeof fn === 'string' && /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(fn)

    const normalizedExpectedPrefix = String(expectedOutputPrefix || '')
      .trim()
      .split('/')
      .pop()
      .toLowerCase()
    const matchesExpectedPrefix = (filename) => {
      if (!normalizedExpectedPrefix) return true
      return String(filename || '').toLowerCase().startsWith(normalizedExpectedPrefix)
    }

    // Helper: try to extract a media result from a single output item
    const extractFromItem = (item) => {
      const fn = getFilename(item)
      if (!fn) return null
      return { filename: fn, subfolder: getSubfolder(item), outputType: getOutputType(item) }
    }
    const isInputOutputType = (info) => String(info?.outputType || '').toLowerCase() === 'input'
    const scoreOutput = (info) => {
      const outputType = String(info?.outputType || '').toLowerCase()
      const subfolder = String(info?.subfolder || '').toLowerCase()
      let score = 0
      if (outputType === 'output') score += 100
      if (outputType === 'temp') score -= 50
      if (subfolder.includes('video')) score += 10
      return score
    }
    const pickBestFromItems = (items, predicate) => {
      if (!Array.isArray(items) || items.length === 0) return null
      const candidates = items
        .map(extractFromItem)
        .filter((info) => info && (!predicate || predicate(info)))
      if (candidates.length === 0) return null
      candidates.sort((a, b) => scoreOutput(b) - scoreOutput(a))
      return candidates[0]
    }

    for (let i = 0; i < maxPolls; i++) {
      await new Promise(r => setTimeout(r, 1000))
      onProgress(Math.min(90, (i / maxPolls) * 90))

      try {
        const history = await comfyui.getHistory(promptId)
        consecutivePollErrors = 0
        // ComfyUI may return { [promptId]: { outputs } } or (for /history/id) { outputs } at top level
        const outputs = history?.[promptId]?.outputs ?? history?.outputs
        if (!outputs || typeof outputs !== 'object') continue

        // ── VIDEO detection: scan ALL nodes, ALL keys ──
        // Check known video keys first (videos, gifs), then any array key with video-like filenames
        for (const nodeId of Object.keys(outputs)) {
          const nodeOut = outputs[nodeId]
          if (!nodeOut || typeof nodeOut !== 'object') continue

          // Check known video array keys
          for (const key of ['videos', 'gifs', 'video']) {
            const items = nodeOut[key]
            if (Array.isArray(items) && items.length > 0) {
              const info = pickBestFromItems(items, (entry) => (
                isVideoFilename(entry.filename) && matchesExpectedPrefix(entry.filename) && !isInputOutputType(entry)
              ))
              if (info) {
                console.log(`[pollForResult] Found video in node ${nodeId}.${key}:`, info)
                return { type: 'video', ...info }
              }
            }
          }

          // Check ANY array-valued key for items with video-like filenames
          for (const key of Object.keys(nodeOut)) {
            if (['videos', 'gifs', 'video'].includes(key)) continue // already checked
            const val = nodeOut[key]
            if (Array.isArray(val) && val.length > 0) {
              const info = pickBestFromItems(val, (entry) => (
                isVideoFilename(entry.filename) && matchesExpectedPrefix(entry.filename) && !isInputOutputType(entry)
              ))
              if (info && isVideoFilename(info.filename)) {
                console.log(`[pollForResult] Found video in node ${nodeId}.${key} (by extension):`, info)
                return { type: 'video', ...info }
              }
            }
          }
        }

        // ── IMAGE detection: scan ALL nodes, ALL keys ──
        const images = []
        for (const nodeId of Object.keys(outputs)) {
          const nodeOut = outputs[nodeId]
          if (!nodeOut || typeof nodeOut !== 'object') continue

          // Check known image key
          if (Array.isArray(nodeOut.images)) {
            for (const img of nodeOut.images) {
              const info = extractFromItem(img)
              if (
                info &&
                isImageFilename(info.filename) &&
                matchesExpectedPrefix(info.filename) &&
                !isInputOutputType(info)
              ) {
                images.push({ type: 'image', ...info })
              }
            }
          }

          // Check any other array key with image-like filenames
          for (const key of Object.keys(nodeOut)) {
            if (key === 'images') continue
            const val = nodeOut[key]
            if (Array.isArray(val) && val.length > 0) {
              for (const item of val) {
                const info = extractFromItem(item)
                if (info && isImageFilename(info.filename) && matchesExpectedPrefix(info.filename) && !isInputOutputType(info)) {
                  images.push({ type: 'image', ...info })
                }
              }
            }
          }
        }
        if (images.length > 0) {
          console.log(`[pollForResult] Found ${images.length} image(s):`, images)
          return { type: 'images', items: images }
        }

        // ── AUDIO detection: scan ALL nodes, ALL keys ──
        for (const nodeId of Object.keys(outputs)) {
          const nodeOut = outputs[nodeId]
          if (!nodeOut || typeof nodeOut !== 'object') continue

          // Check known audio key
          if (nodeOut.audio) {
            const aud = Array.isArray(nodeOut.audio) ? nodeOut.audio[0] : nodeOut.audio
            const info = extractFromItem(aud)
            if (info && matchesExpectedPrefix(info.filename) && !isInputOutputType(info)) {
              console.log(`[pollForResult] Found audio in node ${nodeId}:`, info)
              return { type: 'audio', ...info }
            }
          }

          // Check any array key with audio-like filenames
          for (const key of Object.keys(nodeOut)) {
            if (key === 'audio') continue
            const val = nodeOut[key]
            if (Array.isArray(val) && val.length > 0) {
              const info = extractFromItem(val[0])
              if (info && isAudioFilename(info.filename) && matchesExpectedPrefix(info.filename) && !isInputOutputType(info)) {
                console.log(`[pollForResult] Found audio in node ${nodeId}.${key} (by extension):`, info)
                return { type: 'audio', ...info }
              }
            }
          }
        }

        // Check status for completion - if completed but nothing found, log and keep trying briefly
        const status = history?.[promptId]?.status ?? history?.status
        if (status?.completed || status?.status_str === 'success') {
          // Log the full outputs for debugging
          console.warn('[pollForResult] Generation completed but no output detected. Full outputs:', JSON.stringify(outputs, null, 2))
          console.warn('[pollForResult] Output node keys:', Object.keys(outputs))
          for (const nodeId of Object.keys(outputs)) {
            console.warn(`[pollForResult] Node ${nodeId} keys:`, Object.keys(outputs[nodeId] || {}))
          }
          // Give it a few more tries in case outputs are still being written
          if (i < maxPolls - 5) {
            onProgress(92)
            await new Promise(r => setTimeout(r, 2000))
            // Re-fetch and try once more
            const retryHistory = await comfyui.getHistory(promptId)
            const retryOutputs = retryHistory?.[promptId]?.outputs ?? retryHistory?.outputs
            if (retryOutputs && typeof retryOutputs === 'object') {
              // One final comprehensive scan - look for ANY item with a filename in ANY array
              for (const nodeId of Object.keys(retryOutputs)) {
                const nodeOut = retryOutputs[nodeId]
                if (!nodeOut || typeof nodeOut !== 'object') continue
                for (const key of Object.keys(nodeOut)) {
                  const val = nodeOut[key]
                  if (Array.isArray(val) && val.length > 0) {
                    const info = pickBestFromItems(val, (entry) => matchesExpectedPrefix(entry.filename) && !isInputOutputType(entry))
                    if (info) {
                      console.log(`[pollForResult] Retry found result in node ${nodeId}.${key}:`, info)
                      // Determine type by extension
                      if (isVideoFilename(info.filename)) return { type: 'video', ...info }
                      if (isAudioFilename(info.filename)) return { type: 'audio', ...info }
                      if (isImageFilename(info.filename)) return { type: 'images', items: [{ type: 'image', ...info }] }
                      // Unknown extension - assume video for video workflows
                      if (['wan22-i2v', 'kling-o3-i2v', 'grok-video-i2v', 'vidu-q2-i2v'].includes(wfId)) return { type: 'video', ...info }
                      return { type: 'images', items: [{ type: 'image', ...info }] }
                    }
                  }
                }
              }
              console.error('[pollForResult] Retry also found nothing. Outputs:', JSON.stringify(retryOutputs, null, 2))
            }
            break // exit loop
          }
          break
        }

      } catch (err) {
        consecutivePollErrors += 1
        console.warn(`Poll error (${consecutivePollErrors}/${maxConsecutivePollErrors}):`, err)
        if (consecutivePollErrors >= maxConsecutivePollErrors) {
          throw new Error('Lost connection to ComfyUI while waiting for generation result')
        }
      }
    }
    return null
  }

  // Save generation result to project assets
  const saveGenerationResult = async (result, wfId, job) => {
    if (!currentProjectHandle) return { didImportAny: false, importedAssets: [] }
    let didImportAny = false
    const importedAssets = []

    const markImportedSignature = (type, filename, subfolder = '', outputType = 'output') => {
      if (!filename) return false
      const signature = `${type}:${filename}|${subfolder}|${outputType}`
      if (importedMediaSignaturesRef.current.has(signature)) return true
      importedMediaSignaturesRef.current.add(signature)
      return false
    }

    const jobPrompt = job?.prompt || ''
    const jobTags = job?.musicTags || ''
    const autoName = generateName(jobPrompt || jobTags || wfId)
    const directorMeta = job?.yolo && typeof job.yolo === 'object' ? { ...job.yolo } : null
    const directorModeName = directorMeta?.mode === 'music' ? 'music' : 'ad'
    const sceneNumber = String(directorMeta?.sceneId || '').match(/\d+/)?.[0] || ''
    const shotNumber = String(directorMeta?.shotId || '').match(/\d+/)?.[0] || ''
    const sceneToken = sceneNumber
      ? `s${sceneNumber.padStart(2, '0')}`
      : slugifyNameToken(directorMeta?.sceneId, { fallback: 'scene', maxLength: 12 })
    const shotToken = shotNumber
      ? `sh${shotNumber.padStart(2, '0')}`
      : slugifyNameToken(directorMeta?.shotId, { fallback: 'shot', maxLength: 12 })
    const angleToken = slugifyNameToken(directorMeta?.angle, { fallback: 'angle', maxLength: 20 })
    const takeToken = `t${Math.max(1, Number(directorMeta?.take) || 1)}`
    const stageToken = slugifyNameToken(directorMeta?.stage, { fallback: 'pass', maxLength: 14 })
    const labelToken = slugifyNameToken(
      stripFileExtension(job?.directorLabel || ''),
      { fallback: '', maxLength: 28 }
    )
    const directorNameToken = [labelToken, stageToken, sceneToken, shotToken, angleToken, takeToken]
      .filter(Boolean)
      .join('_')
    const resolvedName = directorMeta
      ? `director_${directorModeName}_${directorNameToken}`
      : autoName
    const jobDuration = job?.duration
    const jobFps = job?.fps
    const jobResolution = job?.resolution
    const jobSeed = job?.seed

    if (result.type === 'video') {
      if (markImportedSignature('video', result.filename, result.subfolder, result.outputType)) {
        addComfyLog('status', `Skipped duplicate video import: ${result.filename}`)
        return { didImportAny: false, importedAssets }
      }
      const generatedVideoFolderId = ensureAssetFolderPath(GENERATED_ASSET_FOLDERS.video)
      try {
        const videoFile = await comfyui.downloadVideo(result.filename, result.subfolder, result.outputType)
        const assetInfo = await importAsset(currentProjectHandle, videoFile, 'video')
        const blobUrl = URL.createObjectURL(videoFile)
        const newAsset = addAsset({
          ...assetInfo,
          name: resolvedName,
          type: 'video',
          url: blobUrl,
          prompt: jobPrompt,
          isImported: true,
          yolo: directorMeta || undefined,
          folderId: generatedVideoFolderId,
          settings: {
            duration: jobDuration,
            fps: jobFps,
            resolution: jobResolution ? `${jobResolution.width}x${jobResolution.height}` : undefined,
            seed: jobSeed
          }
        })
        if (newAsset) importedAssets.push(newAsset)
        didImportAny = true
        if (isElectron() && currentProjectHandle && newAsset?.absolutePath) {
          enqueuePlaybackTranscode(currentProjectHandle, newAsset.id, newAsset.absolutePath).catch(() => {})
        }
      } catch (err) {
        console.error('Failed to save video:', err)
        // Fallback: use ComfyUI URL
        const url = comfyui.getMediaUrl(result.filename, result.subfolder, result.outputType)
        const fallbackAsset = addAsset({
          name: resolvedName,
          type: 'video',
          url,
          prompt: jobPrompt,
          yolo: directorMeta || undefined,
          folderId: generatedVideoFolderId,
          settings: { duration: jobDuration, fps: jobFps, seed: jobSeed }
        })
        if (fallbackAsset) importedAssets.push(fallbackAsset)
        didImportAny = true
      }
    } else if (result.type === 'images') {
      let generatedImageFolderId = null
      for (const img of result.items) {
        if (markImportedSignature('image', img.filename, img.subfolder, img.outputType)) continue
        if (!generatedImageFolderId) {
          generatedImageFolderId = ensureAssetFolderPath(GENERATED_ASSET_FOLDERS.image)
        }
        try {
          const imageFile = await comfyui.downloadImage(img.filename, img.subfolder, img.outputType)
          const assetInfo = await importAsset(currentProjectHandle, imageFile, 'images')
          const blobUrl = URL.createObjectURL(imageFile)
          const newAsset = addAsset({
            ...assetInfo,
            name: `${resolvedName}_${img.filename}`,
            type: 'image',
            url: blobUrl,
            prompt: jobPrompt,
            isImported: true,
            yolo: directorMeta || undefined,
            folderId: generatedImageFolderId,
          })
          if (newAsset) importedAssets.push(newAsset)
          didImportAny = true
        } catch (err) {
          console.warn('Failed to save image:', err)
          const url = comfyui.getMediaUrl(img.filename, img.subfolder, img.outputType)
          const fallbackAsset = addAsset({
            name: `${resolvedName}_${img.filename}`,
            type: 'image',
            url,
            prompt: jobPrompt,
            yolo: directorMeta || undefined,
            folderId: generatedImageFolderId,
          })
          if (fallbackAsset) importedAssets.push(fallbackAsset)
          didImportAny = true
        }
      }
    } else if (result.type === 'audio') {
      if (markImportedSignature('audio', result.filename, result.subfolder, result.outputType)) {
        addComfyLog('status', `Skipped duplicate audio import: ${result.filename}`)
        return { didImportAny: false, importedAssets }
      }
      const generatedAudioFolderId = ensureAssetFolderPath(GENERATED_ASSET_FOLDERS.audio)
      try {
        const url = comfyui.getMediaUrl(result.filename, result.subfolder, result.outputType)
        const resp = await fetch(url)
        const blob = await resp.blob()
        const file = new File([blob], result.filename, { type: 'audio/mpeg' })
        const assetInfo = await importAsset(currentProjectHandle, file, 'audio')
        const blobUrl = URL.createObjectURL(file)
        const newAsset = addAsset({
          ...assetInfo,
          name: autoName,
          type: 'audio',
          url: blobUrl,
          prompt: jobTags,
          isImported: true,
          folderId: generatedAudioFolderId,
          settings: { duration: job?.musicDuration, bpm: job?.bpm, keyscale: job?.keyscale }
        })
        if (newAsset) importedAssets.push(newAsset)
        didImportAny = true
      } catch (err) {
        console.warn('Failed to save audio:', err)
        const url = comfyui.getMediaUrl(result.filename, result.subfolder, result.outputType)
        const fallbackAsset = addAsset({
          name: autoName,
          type: 'audio',
          url,
          prompt: jobTags,
          folderId: generatedAudioFolderId,
          settings: { duration: job?.musicDuration, bpm: job?.bpm },
        })
        if (fallbackAsset) importedAssets.push(fallbackAsset)
        didImportAny = true
      }
    }
    return { didImportAny, importedAssets }
  }

  const runJob = useCallback(async (job) => {
    updateJob(job.id, { status: 'uploading', progress: 5, error: null })
    let importedAssets = []

    try {
      let uploadedFilename = null
      let referenceFilenames = []
      const outputToken = String(job.id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_')
      const outputPrefix = (
        job.workflowId === 'wan22-i2v' || job.workflowId === 'kling-o3-i2v' || job.workflowId === 'grok-video-i2v' || job.workflowId === 'vidu-q2-i2v'
          ? `video/director_${outputToken}`
          : (
            job.workflowId === 'image-edit' ||
            job.workflowId === 'image-edit-model-product' ||
            job.workflowId === 'seedream-5-lite-image-edit' ||
            job.workflowId === 'z-image-turbo' ||
            job.workflowId === 'nano-banana-2' ||
            job.workflowId === 'grok-text-to-image' ||
            job.workflowId === 'nano-banana-pro'
          )
            ? `image/comfystudio_${outputToken}`
            : ''
      )
      // Upload image if needed
      if (job.needsImage) {
        let fileToUpload = null
        if (job.inputFromTimelineFrame) {
          const frame = useFrameForAIStore.getState().frame
          fileToUpload = frame?.file
          if (!fileToUpload) throw new Error('Timeline frame not available')
        } else {
          const inputAsset = assets.find(a => a.id === job.inputAssetId)
          if (!inputAsset) {
            throw new Error('Input asset not found')
          }
          if (inputAsset.type === 'video') {
            fileToUpload = await extractFrameAsFile(inputAsset.url, job.frameTime || 0, `frame_${Date.now()}.png`)
          } else if (inputAsset.type === 'image') {
            const resp = await fetch(inputAsset.url)
            const blob = await resp.blob()
            fileToUpload = new File([blob], inputAsset.name || `input_${Date.now()}.png`, { type: blob.type })
          }
          if (!fileToUpload) throw new Error('Unsupported input asset')
        }

        const uploadResult = await comfyui.uploadFile(fileToUpload)
        uploadedFilename = uploadResult?.name || fileToUpload.name
      }

      // Upload optional reference images for workflows that support them
      const supportsReferenceImages = (
        job.workflowId === 'image-edit' ||
        job.workflowId === 'image-edit-model-product' ||
        job.workflowId === 'seedream-5-lite-image-edit' ||
        job.workflowId === 'nano-banana-2' ||
        job.workflowId === 'nano-banana-pro'
      )
      if (supportsReferenceImages && (job.referenceAssetId1 || job.referenceAssetId2)) {
        for (const refId of [job.referenceAssetId1, job.referenceAssetId2]) {
          if (!refId) {
            referenceFilenames.push(null)
            continue
          }
          const refAsset = assets.find(a => a.id === refId)
          if (!refAsset || refAsset.type !== 'image') {
            referenceFilenames.push(null)
            continue
          }
          try {
            const resp = await fetch(refAsset.url)
            const blob = await resp.blob()
            const file = new File([blob], refAsset.name || `ref_${Date.now()}.png`, { type: blob.type })
            const uploadResult = await comfyui.uploadFile(file)
            referenceFilenames.push(uploadResult?.name || file.name)
          } catch (_) {
            referenceFilenames.push(null)
          }
        }
      }

      // Load workflow JSON
      updateJob(job.id, { status: 'configuring', progress: 20 })
      let workflowJson = null
      const workflowPath = BUILTIN_WORKFLOW_PATHS[job.workflowId]
      if (!workflowPath) throw new Error('Unknown workflow: ' + job.workflowId)

      const resp = await fetch(workflowPath)
      if (!resp.ok) throw new Error(`Failed to load workflow file: ${workflowPath} (${resp.status})`)
      const workflowText = await resp.text()
      try {
        workflowJson = JSON.parse(workflowText)
      } catch {
        const snippet = workflowText.trim().slice(0, 120)
        throw new Error(
          `Workflow file is not valid JSON: ${workflowPath}. Response starts with: ${snippet || '(empty response)'}`
        )
      }

      // Modify workflow based on type
      updateJob(job.id, { status: 'configuring', progress: 30 })
      const {
        modifyWAN22Workflow,
        modifyMultipleAnglesWorkflow,
        modifyQwenImageEdit2509Workflow,
        modifyZImageTurboWorkflow,
        modifyNanoBanana2Workflow,
        modifyGrokTextToImageWorkflow,
        modifySeedream5LiteImageEditWorkflow,
        modifyGrokVideoI2VWorkflow,
        modifyViduQ2I2VWorkflow,
        modifyKlingO3I2VWorkflow,
        modifyMusicWorkflow
      } = await import('../services/comfyui')

      let modifiedWorkflow = null
      switch (job.workflowId) {
        case 'wan22-i2v':
          modifiedWorkflow = modifyWAN22Workflow(workflowJson, {
            prompt: job.prompt,
            negativePrompt: job.negativePrompt,
            inputImage: uploadedFilename,
            width: job.resolution?.width,
            height: job.resolution?.height,
            frames: Math.round(job.duration * job.fps) + 1,
            fps: job.fps,
            seed: job.seed,
            filenamePrefix: outputPrefix || 'video/ComfyStudio_wan',
            qualityPreset: job.wanQualityPreset || 'face-lock',
          })
          break
        case 'kling-o3-i2v':
          modifiedWorkflow = modifyKlingO3I2VWorkflow(workflowJson, {
            prompt: job.prompt,
            inputImage: uploadedFilename,
            width: job.resolution?.width,
            height: job.resolution?.height,
            duration: job.duration,
            frames: Math.round(job.duration * job.fps) + 1,
            fps: job.fps,
            seed: job.seed,
            generateAudio: false,
            filenamePrefix: outputPrefix || 'video/kling_o3_i2v',
          })
          break
        case 'grok-video-i2v':
          modifiedWorkflow = modifyGrokVideoI2VWorkflow(workflowJson, {
            prompt: job.prompt,
            inputImage: uploadedFilename,
            width: job.resolution?.width,
            height: job.resolution?.height,
            duration: job.duration,
            seed: job.seed,
            filenamePrefix: outputPrefix || 'video/grok_video_i2v',
          })
          break
        case 'vidu-q2-i2v':
          modifiedWorkflow = modifyViduQ2I2VWorkflow(workflowJson, {
            prompt: job.prompt,
            inputImage: uploadedFilename,
            width: job.resolution?.width,
            height: job.resolution?.height,
            duration: job.duration,
            seed: job.seed,
            filenamePrefix: outputPrefix || 'video/vidu_q2_i2v',
          })
          break
        case 'multi-angles':
        case 'multi-angles-scene':
          modifiedWorkflow = modifyMultipleAnglesWorkflow(workflowJson, {
            inputImage: uploadedFilename,
            seed: job.seed,
          })
          break
        case 'image-edit':
        case 'image-edit-model-product':
          modifiedWorkflow = modifyQwenImageEdit2509Workflow(workflowJson, {
            prompt: job.prompt,
            inputImage: uploadedFilename,
            seed: job.seed,
            referenceImages: referenceFilenames,
            filenamePrefix: outputPrefix || 'image/ComfyStudio_edit',
          })
          break
        case 'z-image-turbo':
          modifiedWorkflow = modifyZImageTurboWorkflow(workflowJson, {
            prompt: job.prompt,
            seed: job.seed,
            filenamePrefix: outputPrefix || 'image/z_image_turbo',
          })
          break
        case 'nano-banana-2':
        case 'nano-banana-pro': // legacy id support
          modifiedWorkflow = modifyNanoBanana2Workflow(workflowJson, {
            prompt: job.prompt,
            seed: job.seed,
            aspectRatio: (
              job.resolution?.width && job.resolution?.height
                ? (job.resolution.width >= job.resolution.height ? '16:9' : '9:16')
                : '16:9'
            ),
            referenceImages: referenceFilenames,
            filenamePrefix: outputPrefix || 'image/nano_banana_2',
          })
          break
        case 'grok-text-to-image':
          modifiedWorkflow = modifyGrokTextToImageWorkflow(workflowJson, {
            prompt: job.prompt,
            seed: job.seed,
            width: job.resolution?.width,
            height: job.resolution?.height,
            filenamePrefix: outputPrefix || 'image/grok_text_to_image',
          })
          break
        case 'seedream-5-lite-image-edit':
          modifiedWorkflow = modifySeedream5LiteImageEditWorkflow(workflowJson, {
            prompt: job.prompt,
            seed: job.seed,
            inputImage: uploadedFilename,
            width: job.resolution?.width,
            height: job.resolution?.height,
            referenceImages: referenceFilenames,
            filenamePrefix: outputPrefix || 'image/seedream_5_lite',
          })
          break
        case 'music-gen':
          modifiedWorkflow = modifyMusicWorkflow(workflowJson, {
            tags: job.musicTags,
            lyrics: job.lyrics,
            duration: job.musicDuration,
            bpm: job.bpm,
            seed: job.seed,
            keyscale: job.keyscale,
          })
          break
        default:
          throw new Error('Unhandled workflow: ' + job.workflowId)
      }

      // Queue the prompt
      updateJob(job.id, { status: 'queuing', progress: 40 })
      const promptId = await comfyui.queuePrompt(modifiedWorkflow)
      if (!promptId) throw new Error('Failed to queue prompt')

      updateJob(job.id, { status: 'running', progress: 45, promptId })

      // Poll for completion
      const result = await pollForResult(promptId, job.workflowId, (p) => {
        updateJob(job.id, (prev) => ({
          ...prev,
          progress: Math.max(prev.progress || 0, p)
        }))
      }, outputPrefix)

      // Save result to assets
      if (result) {
        updateJob(job.id, { status: 'saving', progress: 95 })
        const saveResult = await saveGenerationResult(result, job.workflowId, job)
        importedAssets = saveResult?.importedAssets || []
        if (!saveResult?.didImportAny) {
          throw new Error('Generation returned a stale/duplicate output; job was not imported. Queue paused for safety.')
        }
        updateJob(job.id, { status: 'done', progress: 100 })
      } else {
        const msg = 'Generation finished but the output could not be detected'
        addComfyLog('error', msg)
        updateJob(job.id, {
          status: 'error',
          error: msg,
          progress: 0
        })
      }
    } catch (err) {
      const msg = err?.message || 'Generation failed'
      addComfyLog('error', msg)
      updateJob(job.id, {
        status: 'error',
        error: msg,
        progress: 0
      })
    } finally {
      await finalizeStoryboardPdfBatchForJob(job, importedAssets)
    }
  }, [assets, updateJob, saveGenerationResult, pollForResult, addComfyLog, finalizeStoryboardPdfBatchForJob])

  const processQueue = useCallback(async () => {
    if (processingRef.current) return
    if (queuePausedRef.current) return
    const nextJob = queueRef.current.find((job) => (
      job.status === 'queued' && !startedJobIdsRef.current.has(job.id)
    ))
    if (!nextJob) return

    startedJobIdsRef.current.add(nextJob.id)
    processingRef.current = true
    setActiveJobId(nextJob.id)

    const jobStartTime = Date.now()
    await runJob(nextJob)
    const jobElapsed = Date.now() - jobStartTime

    processingRef.current = false
    setActiveJobId(null)

    const finishedJob = queueRef.current.find(j => j.id === nextJob.id)
    if (!finishedJob || finishedJob.status === 'queued') {
      const desyncMsg = 'Queue state desynced; blocked repeated execution for this job.'
      addComfyLog('error', `${desyncMsg} (${String(nextJob.id).slice(0, 12)}…)`)
      updateJob(nextJob.id, {
        status: 'error',
        error: desyncMsg,
        progress: 0,
      })
    }
    const didFail = finishedJob?.status === 'error' || finishedJob?.status === 'queued'

    if (didFail && jobElapsed < RAPID_FAIL_THRESHOLD_MS) {
      consecutiveRapidFailsRef.current += 1
    } else {
      consecutiveRapidFailsRef.current = 0
    }

    if (consecutiveRapidFailsRef.current >= MAX_CONSECUTIVE_RAPID_FAILS) {
      queuePausedRef.current = true
      consecutiveRapidFailsRef.current = 0
      const remaining = queueRef.current.filter(j => j.status === 'queued').length
      addComfyLog('error', `Queue auto-paused: ${MAX_CONSECUTIVE_RAPID_FAILS} jobs failed rapidly in a row (${remaining} jobs still queued). Check ComfyUI, then use Clear Queue or resume.`)
      setGenerationQueue(prev => prev.map(j =>
        j.status === 'queued' ? { ...j, status: 'paused' } : j
      ))
      return
    }

    const remaining = queueRef.current.find(j => j.status === 'queued')
    if (!remaining) return

    const timeSinceFinish = Date.now() - jobStartTime
    const delay = Math.max(MIN_JOB_INTERVAL_MS - timeSinceFinish, 0)
    setTimeout(() => {
      processQueue()
    }, delay)
  }, [runJob, addComfyLog, updateJob])

  useEffect(() => {
    processQueue()
  }, [generationQueue, processQueue])

  const randomizeSeed = () => setSeed(Math.floor(Math.random() * 1000000000))

  // Determine if input column should show
  const showInputColumn = generationMode === 'single' && currentWorkflow?.needsImage

  // ============================================
  // Render
  // ============================================
  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-sf-dark-950">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-sf-dark-700">
        <div className="flex items-center gap-3">
          <Sparkles className="w-4 h-4 text-sf-accent" />
          <span className="text-sm font-semibold text-sf-text-primary">Generate</span>

          <div className="flex items-center gap-1 ml-4 p-1 rounded-lg bg-sf-dark-800 border border-sf-dark-700">
            <button
              onClick={() => setGenerationMode('single')}
              className={`px-3 py-1 rounded text-xs transition-colors ${generationMode === 'single' ? 'bg-sf-accent text-white' : 'text-sf-text-muted hover:text-sf-text-primary'}`}
            >
              Single
            </button>
            <button
              onClick={() => setGenerationMode('yolo')}
              className={`px-3 py-1 rounded text-xs transition-colors ${generationMode === 'yolo' ? 'bg-sf-accent text-white' : 'text-sf-text-muted hover:text-sf-text-primary'}`}
            >
              {DIRECTOR_MODE_BETA_LABEL}
            </button>
          </div>

          {/* Category tabs */}
          {generationMode === 'single' && (
            <div className="flex items-center gap-1 ml-2">
              {Object.entries(WORKFLOWS).map(([cat, workflows]) => {
                const Icon = CATEGORY_ICONS[cat]
                const isActive = category === cat
                return (
                  <button key={cat} onClick={() => setCategory(cat)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${isActive ? 'bg-sf-accent text-white' : 'bg-sf-dark-800 text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-700'}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    <span className="text-[9px] opacity-70">({workflows.length})</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-2">
          {activeCount > 0 && <span className="text-[10px] text-sf-text-muted">Running: {activeCount}</span>}
          {queuedCount > 0 && <span className="text-[10px] text-sf-text-muted">Queued: {queuedCount}</span>}
          {queueCount > 0 && <span className="text-[10px] text-sf-text-muted">ComfyUI Queue: {queueCount}</span>}
          <div className={`w-2 h-2 rounded-full ${isConnected ? (wsConnected ? 'bg-green-500' : 'bg-yellow-500') : 'bg-red-500'}`} title={isConnected ? (wsConnected ? 'Connected (WebSocket)' : 'Connected (HTTP)') : 'Disconnected'} />
          <span className="text-[10px] text-sf-text-muted">{isConnected ? 'ComfyUI' : 'Offline'}</span>
        </div>
      </div>

      {/* Main 3-column layout */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left: Input browser (conditional) */}
        {showInputColumn && (
          <div className="w-72 flex-shrink-0 border-r border-sf-dark-700 bg-sf-dark-900">
            <AssetInputBrowser
              selectedAsset={selectedAsset}
              onSelectAsset={(asset) => {
                setSelectedAsset(asset)
                setSelectedAssetId(asset?.id || null)
              }}
              filterType={currentWorkflow?.needsImage ? 'image' : null}
              frameTime={frameTime}
              onFrameTimeChange={setFrameTime}
            />
          </div>
        )}

        {/* Center: Settings - extra left padding in yolo mode when sidebar visible to center content with header tabs */}
        <div className={`flex-1 min-w-0 overflow-auto p-4 ${generationMode === 'yolo' && !rightSidebarCollapsed ? 'pl-40' : ''}`}>
          <div className={`mx-auto space-y-4 ${generationMode === 'yolo' ? 'max-w-6xl' : 'max-w-2xl'}`}>
            {/* Timeline frame from editor (Extend with AI / Starting keyframe for AI) */}
            {frameForAI && generationMode === 'single' && (
              <div className="p-3 rounded-lg border border-sf-accent/40 bg-sf-accent/5">
                <div className="flex items-start gap-3">
                  <div className="w-24 h-14 flex-shrink-0 rounded overflow-hidden bg-sf-dark-800 border border-sf-dark-600">
                    <img src={frameForAI.blobUrl} alt="Timeline frame" className="w-full h-full object-contain" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-sf-text-primary">
                      {frameForAI.mode === 'extend' ? 'Extend with AI' : 'Starting keyframe for AI'}
                    </div>
                    <div className="text-[10px] text-sf-text-muted mt-0.5">
                      Frame from timeline at playhead. Choose a video workflow (WAN 2.2 or Kling O3 Omni) below, then enter prompt and generate.
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        type="button"
                        onClick={clearFrameForAI}
                        className="px-2 py-1 rounded text-[10px] bg-sf-dark-700 hover:bg-sf-dark-600 text-sf-text-muted hover:text-sf-text-primary transition-colors"
                      >
                        Clear timeline frame
                      </button>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {generationMode === 'single' && (
              <>
                {/* Workflow selector */}
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Workflow</label>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {['lite', 'standard', 'pro', 'cloud'].map((tierId) => {
                        const tierMeta = HARDWARE_TIERS[tierId]
                        if (!tierMeta) return null
                        return (
                          <span key={tierId} className={`px-1.5 py-0.5 rounded border text-[9px] ${tierMeta.badgeClass}`}>
                            {tierMeta.shortLabel}
                          </span>
                        )
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => { void handleOpenCurrentWorkflowInComfyUi() }}
                      className="px-2 py-1 rounded border border-sf-dark-500 bg-sf-dark-800 text-[10px] text-sf-text-secondary hover:text-sf-text-primary hover:border-sf-dark-400 transition-colors"
                      title="Switch to ComfyUI tab and copy workflow JSON"
                    >
                      Open in ComfyUI
                    </button>
                  </div>
                  <div className="mt-1 text-[9px] text-sf-text-muted">
                    <span
                      className="underline decoration-dotted cursor-help"
                      title="Quick guide: Lite is usually 6-8GB VRAM, Standard is usually 12-16GB, Pro is usually 24GB+, and Cloud uses partner credits."
                    >
                      Not sure your VRAM?
                    </span>{' '}
                    6-8GB = Lite, 12-16GB = Standard, 24GB+ = Pro, Cloud = credits.
                  </div>
                  {openWorkflowHint && (
                    <div className="mt-1 text-[9px] text-green-400">{openWorkflowHint}</div>
                  )}
                  <div className="flex gap-2 mt-1">
                    {(WORKFLOWS[category] || []).map((wf) => {
                      const isActiveWorkflow = workflowId === wf.id
                      const tierMeta = getWorkflowTierMeta(wf.id)
                      const runtimeLabel = formatWorkflowHardwareRuntime(wf.id)
                      return (
                        <button
                          key={wf.id}
                          onClick={() => setWorkflowId(wf.id)}
                          className={`flex-1 px-3 py-2 rounded-lg border text-xs transition-colors ${
                            isActiveWorkflow
                              ? 'bg-sf-accent/20 border-sf-accent text-sf-accent'
                              : 'bg-sf-dark-800 border-sf-dark-600 text-sf-text-muted hover:border-sf-dark-500'
                          }`}
                        >
                          <div className="font-medium">{wf.label}</div>
                          <div className="text-[9px] opacity-70 mt-0.5">{wf.description}</div>
                          <div className="mt-1 flex items-center justify-between gap-1">
                            <span className={`px-1.5 py-0.5 rounded border text-[9px] ${tierMeta?.badgeClass || 'border-sf-dark-600 bg-sf-dark-700 text-sf-text-muted'}`}>
                              {tierMeta?.shortLabel || 'Unknown'}
                            </span>
                            <span className="text-[9px] opacity-70 whitespace-nowrap">{runtimeLabel}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Workflow-specific settings */}
                {category === 'video' && (
                  <>
                {/* Prompt */}
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Prompt</label>
                  <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
                    className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-none"
                    placeholder="Describe the video you want to generate..."
                  />
                </div>
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Negative Prompt</label>
                  <textarea value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)} rows={2}
                    className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-none"
                    placeholder="What to avoid..."
                  />
                </div>
                {/* Cinematography tags */}
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider mb-1 block">Cinematography Tags</label>
                  <CinematographyTags selectedTags={selectedTags}
                    onAddTag={t => setSelectedTags(prev => [...prev, t])}
                    onRemoveTag={t => setSelectedTags(prev => prev.filter(x => x !== t))}
                  />
                </div>
                {workflowId === 'wan22-i2v' && (
                  <div className="p-2 rounded-lg bg-sf-dark-800/60 border border-sf-dark-700">
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">WAN 2.2 Quality Preset</label>
                    <select
                      value={wanQualityPreset}
                      onChange={(e) => setWanQualityPreset(e.target.value)}
                      className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                    >
                      <option value="face-lock">Face Lock (recommended for character consistency)</option>
                      <option value="balanced">Balanced (default WAN behavior)</option>
                    </select>
                    <p className="mt-1 text-[9px] text-sf-text-muted">
                      Face Lock increases sampler quality and adds identity-preserving prompt guards. Use Balanced for faster, looser motion.
                    </p>
                  </div>
                )}
                {/* Duration / Resolution / FPS / Seed */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Duration</label>
                    <div className="flex gap-1 mt-1">
                      {[2, 3, 5, 8].map(d => (
                        <button key={d} onClick={() => setDuration(d)}
                          className={`flex-1 py-1 rounded text-xs ${duration === d ? 'bg-sf-accent text-white' : 'bg-sf-dark-800 text-sf-text-muted hover:bg-sf-dark-700'}`}
                        >{d}s</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Resolution</label>
                    <select value={`${resolution.width}x${resolution.height}`}
                      onChange={e => { const [w, h] = e.target.value.split('x').map(Number); setResolution({ width: w, height: h }) }}
                      className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                    >
                      <optgroup label="16:9 Landscape">
                        <option value="1920x1080">1920x1080</option>
                        <option value="1280x720">1280x720</option>
                        <option value="960x540">960x540</option>
                        <option value="1024x576">1024x576</option>
                        <option value="768x512">768x512</option>
                      </optgroup>
                      <optgroup label="9:16 Portrait">
                        <option value="1080x1920">1080x1920</option>
                        <option value="720x1280">720x1280</option>
                        <option value="540x960">540x960</option>
                        <option value="576x1024">576x1024</option>
                        <option value="512x768">512x768</option>
                      </optgroup>
                    </select>
                    {aspectRatioWarning && (
                      <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-[10px] text-yellow-400">
                        <div className="font-medium mb-1">⚠ Aspect Ratio Mismatch</div>
                        <div className="text-[9px] opacity-90">
                          Input: <strong>{aspectRatioWarning.inputResolution}</strong> ({aspectRatioWarning.inputLabel})
                          <br />
                          Output: <strong>{aspectRatioWarning.outputResolution}</strong> ({aspectRatioWarning.outputLabel})
                          <br />
                          <span className="mt-1 block">
                            The input image will be resized/stretched to match the output resolution, which may cause distortion or cropping.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">FPS</label>
                    <select value={fps} onChange={e => setFps(Number(e.target.value))}
                      className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                    >
                      <option value={24}>24 fps</option>
                      <option value={30}>30 fps</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Seed</label>
                    <div className="flex gap-1 mt-1">
                      <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))}
                        className="flex-1 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                      />
                      <button onClick={randomizeSeed} className="p-1 bg-sf-dark-700 hover:bg-sf-dark-600 rounded" title="Randomize">
                        <RefreshCw className="w-3 h-3 text-sf-text-muted" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {category === 'image' && (
              <>
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Prompt</label>
                  <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
                    className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-none"
                    placeholder={
                      workflowId === 'image-edit' || workflowId === 'seedream-5-lite-image-edit'
                        ? 'Describe the edit (e.g. remove person on left or change color of car)'
                        : (workflowId === 'z-image-turbo' || workflowId === 'nano-banana-2' || workflowId === 'grok-text-to-image' || workflowId === 'nano-banana-pro')
                          ? 'Describe the image you want to generate...'
                          : 'Camera angle prompts are preset for this workflow'
                    }
                  />
                </div>
                {workflowId === 'image-edit' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Steps</label>
                        <input type="number" value={editSteps} onChange={e => setEditSteps(Number(e.target.value))} min={1} max={100}
                          className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">CFG Scale</label>
                        <input type="number" value={editCfg} onChange={e => setEditCfg(Number(e.target.value))} min={1} max={20} step={0.5}
                          className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Reference images (optional)</label>
                      <p className="text-[9px] text-sf-text-muted mt-0.5 mb-1">Qwen can use 1–2 reference images for style or subject. Annotate the same image with circles and labels (e.g. &quot;remove this&quot;) then use as ref.</p>
                      {assets.filter(a => a.type === 'image').length === 0 && !annotationModalOpen && (
                        <p className="text-[9px] text-sf-text-muted mb-1.5">Add images in the <strong>Assets</strong> panel, or use <strong>Annotate image…</strong> to mark up your input.</p>
                      )}
                      <div className="flex items-center gap-2 mb-1.5">
                        <button
                          type="button"
                          onClick={openAnnotationModal}
                          disabled={annotationPreparing}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sf-dark-700 hover:bg-sf-dark-600 text-sf-text-secondary text-xs"
                        >
                          {annotationPreparing ? <Loader2 className="w-3 h-3 animate-spin" /> : <PenLine className="w-3 h-3" />}
                          {annotationPreparing ? 'Preparing frame…' : 'Annotate image…'}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={referenceAssetId1 || ''}
                          onChange={e => setReferenceAssetId1(e.target.value || null)}
                          className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                        >
                          <option value="">None</option>
                          {assets.filter(a => a.type === 'image').map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                        <select
                          value={referenceAssetId2 || ''}
                          onChange={e => setReferenceAssetId2(e.target.value || null)}
                          className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                        >
                          <option value="">None</option>
                          {assets.filter(a => a.type === 'image').map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}
                {(workflowId === 'multi-angles' || workflowId === 'multi-angles-scene') && (
                  <div className="p-3 bg-sf-dark-800/50 rounded-lg">
                    <div className="text-[10px] text-sf-text-muted">This workflow generates <strong className="text-sf-text-primary">8 camera angles</strong> from your input image:</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {['Close-up', 'Wide', '45 Right', '90 Right', 'Aerial', 'Low Angle', '45 Left', '90 Left'].map(a => (
                        <span key={a} className="px-2 py-0.5 bg-sf-dark-700 rounded text-[9px] text-sf-text-secondary">{a}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Seed</label>
                  <div className="flex gap-1 mt-1">
                    <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))}
                      className="flex-1 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                    />
                    <button onClick={randomizeSeed} className="p-1 bg-sf-dark-700 hover:bg-sf-dark-600 rounded">
                      <RefreshCw className="w-3 h-3 text-sf-text-muted" />
                    </button>
                  </div>
                </div>
              </>
            )}

            {category === 'audio' && (
              <>
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Style Tags</label>
                  <textarea value={musicTags} onChange={e => setMusicTags(e.target.value)} rows={2}
                    className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-none"
                    placeholder="cinematic orchestral, epic, dramatic, strings, brass"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Lyrics (optional)</label>
                  <textarea value={lyrics} onChange={e => setLyrics(e.target.value)} rows={4}
                    className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-none"
                    placeholder="Leave empty for instrumental..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Duration</label>
                    <div className="flex gap-1 mt-1">
                      {[15, 30, 60, 120].map(d => (
                        <button key={d} onClick={() => setMusicDuration(d)}
                          className={`flex-1 py-1 rounded text-xs ${musicDuration === d ? 'bg-sf-accent text-white' : 'bg-sf-dark-800 text-sf-text-muted hover:bg-sf-dark-700'}`}
                        >{d}s</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">BPM</label>
                    <input type="number" value={bpm} onChange={e => setBpm(Number(e.target.value))} min={40} max={240}
                      className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Key / Scale</label>
                    <select value={keyscale} onChange={e => setKeyscale(e.target.value)}
                      className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                    >
                      {['C major', 'C minor', 'D major', 'D minor', 'E major', 'E minor', 'F major', 'F minor', 'G major', 'G minor', 'A major', 'A minor', 'B major', 'B minor'].map(k => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Seed</label>
                    <div className="flex gap-1 mt-1">
                      <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))}
                        className="flex-1 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                      />
                      <button onClick={randomizeSeed} className="p-1 bg-sf-dark-700 hover:bg-sf-dark-600 rounded">
                        <RefreshCw className="w-3 h-3 text-sf-text-muted" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
              </>
            )}

            {generationMode === 'yolo' && (
              <>
                <div className="flex items-center gap-1 p-1 rounded-lg bg-sf-dark-800 border border-sf-dark-700">
                  <button
                    type="button"
                    onClick={() => setYoloCreationType('ad')}
                    className={`flex-1 px-3 py-1.5 rounded text-xs transition-colors ${yoloCreationType === 'ad' ? 'bg-sf-accent text-white' : 'text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-700'}`}
                  >
                    Ad Creation
                  </button>
                  <button
                    type="button"
                    onClick={() => setYoloCreationType('music')}
                    className={`flex-1 px-3 py-1.5 rounded text-xs transition-colors ${yoloCreationType === 'music' ? 'bg-sf-accent text-white' : 'text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-700'}`}
                  >
                    Music Video Creation
                  </button>
                </div>

                <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-900/40 p-2">
                  <div
                    role="tablist"
                    aria-label="Director workflow steps"
                    className="flex items-center gap-1 p-1 rounded-lg bg-sf-dark-800 border border-sf-dark-700"
                  >
                    {DIRECTOR_SUBTABS.map((tab) => {
                      const isActive = directorSubTab === tab.id
                      const needsPlan = tab.id === 'scene-shot' || tab.id === 'video-pass'
                      const needsStoryboard = tab.id === 'video-pass' && yoloStoryboardReadyCount === 0
                      const isDisabled = (needsPlan && !yoloCanEditScenes) || needsStoryboard
                      const disabledTitle = !yoloCanEditScenes
                        ? 'Build a plan first to unlock this step'
                        : 'Create at least one keyframe to unlock Videos'
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          disabled={isDisabled}
                          onClick={() => setDirectorSubTab(tab.id)}
                          title={isDisabled ? disabledTitle : ''}
                          className={`flex-1 px-3 py-1.5 rounded text-xs transition-colors ${
                            isDisabled
                              ? 'text-sf-text-muted/60 cursor-not-allowed'
                              : isActive
                                ? 'bg-sf-accent text-white'
                                : 'text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-700'
                          }`}
                        >
                          {tab.label}
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-2 rounded-lg border border-sf-accent/40 bg-gradient-to-r from-sf-accent/20 via-sf-dark-800/90 to-sf-dark-900/90 px-3 py-2.5 text-center ring-1 ring-sf-accent/20 shadow-sm">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-sf-accent/90 font-semibold">
                      Current Step: {yoloSubTabTitle}
                    </div>
                    <div className="mt-1 text-sm md:text-base font-semibold leading-snug text-sf-text-primary">
                      {yoloSubTabHelperText}
                    </div>
                  </div>
                </div>

                {yoloCreationType === 'ad' ? (
                  <>
                    {directorSubTab === 'plan-script' && (
                      <>
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Ad Script</label>
                            <button
                              type="button"
                              onClick={() => { void copyTextToClipboard(DIRECTOR_SCRIPT_TEMPLATE) }}
                              className="px-2 py-1 rounded border border-sf-dark-500 text-[10px] text-sf-text-secondary hover:text-sf-text-primary hover:border-sf-dark-400 transition-colors"
                            >
                              Copy Template
                            </button>
                          </div>
                          <textarea
                            value={yoloScript}
                            onChange={e => setYoloScript(e.target.value)}
                            rows={10}
                            className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-y"
                            placeholder="Paste your director script here. Recommended: Scene 1 + Scene context + Shot 1 + Shot type + Keyframe prompt + Motion prompt + Camera + Duration."
                          />
                          <div className="mt-2 rounded-lg border border-sf-dark-700 bg-sf-dark-800/45 p-3">
                            <button
                              type="button"
                              onClick={() => setDirectorFormatExpanded((prev) => !prev)}
                              className="flex w-full items-center justify-between gap-2 text-left"
                            >
                              <span className="text-[10px] uppercase tracking-wider text-yellow-400">Recommended Director Format</span>
                              {directorFormatExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 text-sf-text-muted" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-sf-text-muted" />
                              )}
                            </button>
                            {directorFormatExpanded && (
                              <>
                                <div className="mt-1 text-[10px] text-sf-text-muted">
                                  Ask your AI to return this exact structure. Director Mode will use explicit shots, prompts, camera notes, and duration when they are present.
                                </div>
                                <textarea
                                  readOnly
                                  value={DIRECTOR_SCRIPT_TEMPLATE}
                                  rows={14}
                                  spellCheck={false}
                                  onFocus={(event) => event.target.select()}
                                  onClick={(event) => event.target.select()}
                                  className="mt-2 w-full resize-y overflow-auto rounded border border-sf-dark-700 bg-sf-dark-900/70 p-2 font-mono text-[10px] leading-5 text-sf-text-secondary focus:outline-none focus:border-sf-accent"
                                />
                              </>
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Style / Brand Notes (optional)</label>
                          <textarea
                            value={yoloStyleNotes}
                            onChange={e => setYoloStyleNotes(e.target.value)}
                            rows={3}
                            className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-y"
                            placeholder="e.g. premium skincare brand, warm daylight, soft contrast, modern typography."
                          />
                        </div>
                      </>
                    )}

                    {directorSubTab === 'setup' && (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
                          <div className="h-full p-3 rounded-lg bg-sf-dark-800/45 border border-sf-dark-700">
                            <div className="text-[10px] text-sf-text-muted uppercase tracking-wider">Structure</div>
                            <p className="mt-1 text-[10px] text-sf-text-muted">
                              Set ad length and shot density first.
                            </p>
                            <div className="mt-2 grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Target Duration (s)</label>
                                <input
                                  type="number"
                                  min={5}
                                  max={300}
                                  value={yoloTargetDuration}
                                  onChange={e => setYoloTargetDuration(Number(e.target.value) || 5)}
                                  className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Shots Per Scene</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={12}
                                  value={yoloShotsPerScene}
                                  onChange={e => setYoloShotsPerScene(Number(e.target.value) || 1)}
                                  className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Angles Per Shot</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={8}
                                  value={yoloAnglesPerShot}
                                  onChange={e => setYoloAnglesPerShot(Number(e.target.value) || 1)}
                                  className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Takes Per Angle</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={4}
                                  value={yoloTakesPerAngle}
                                  onChange={e => setYoloTakesPerAngle(Number(e.target.value) || 1)}
                                  className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                                />
                              </div>
                            </div>
                          </div>

                          <div className="h-full p-3 rounded-lg bg-sf-dark-800/45 border border-sf-dark-700">
                            <div className="text-[10px] text-sf-text-muted uppercase tracking-wider">Quality</div>
                            <p className="mt-1 text-[10px] text-sf-text-muted">
                              Choose speed versus fidelity.
                            </p>
                            <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
                              <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-800/35 px-2 py-1.5">
                                <div className="text-[10px] uppercase tracking-wider text-sf-text-muted">Keyframes (Images)</div>
                                <div className="mt-1 grid grid-cols-2 gap-1 rounded border border-sf-dark-700 bg-sf-dark-900/40 p-0.5">
                                  {yoloAdRuntimeOptions.map((runtimeOption) => {
                                    const isSelected = yoloStoryboardProfileRuntime === runtimeOption.id
                                    return (
                                      <button
                                        key={`storyboard-${runtimeOption.id}`}
                                        type="button"
                                        onClick={() => setYoloAdStoryboardSource(runtimeOption.id)}
                                        className={`rounded px-2 py-1 text-[10px] transition-colors ${
                                          isSelected
                                            ? 'bg-sf-accent text-white'
                                            : 'text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-800'
                                        }`}
                                      >
                                        {runtimeOption.label}
                                      </button>
                                    )
                                  })}
                                </div>
                                {yoloStoryboardUsesCloudTier ? (
                                  <>
                                    <div className="mt-1 text-[10px] text-sf-text-muted uppercase tracking-wider">Cloud Tier</div>
                                    <div className="mt-0.5 grid grid-cols-2 gap-1">
                                      {yoloStoryboardTierOptions.map((tierOption) => {
                                        const isSelectedTier = yoloNormalizedAdStoryboardTier === tierOption.id
                                        return (
                                          <button
                                            key={`storyboard-tier-${tierOption.id}`}
                                            type="button"
                                            onClick={() => setYoloAdStoryboardTier(tierOption.id)}
                                            className={`rounded px-2 py-1 text-[10px] transition-colors ${
                                              isSelectedTier
                                                ? 'bg-sf-accent text-white'
                                                : 'border border-sf-dark-600 text-sf-text-muted hover:text-sf-text-primary hover:border-sf-dark-500'
                                            }`}
                                          >
                                            {tierOption.label}
                                          </button>
                                        )
                                      })}
                                    </div>
                                    <div className="mt-1 text-[10px] text-sf-text-muted">
                                      Workflow: <span className="text-sf-text-secondary">{yoloSelectedAdStageRouting?.imageLabel || getWorkflowDisplayLabel(yoloStoryboardWorkflowId)}</span>
                                    </div>
                                  </>
                                ) : (
                                  <div className="mt-1 text-[10px] text-sf-text-muted">
                                    Local workflow: <span className="text-sf-text-secondary">{yoloSelectedAdStageRouting?.imageLabel || getWorkflowDisplayLabel(yoloStoryboardWorkflowId)}</span>
                                  </div>
                                )}
                              </div>

                              <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-800/35 px-2 py-1.5">
                                <div className="text-[10px] uppercase tracking-wider text-sf-text-muted">Video</div>
                                <div className="mt-1 grid grid-cols-2 gap-1 rounded border border-sf-dark-700 bg-sf-dark-900/40 p-0.5">
                                  {yoloAdRuntimeOptions.map((runtimeOption) => {
                                    const isSelected = yoloVideoProfileRuntime === runtimeOption.id
                                    return (
                                      <button
                                        key={`video-${runtimeOption.id}`}
                                        type="button"
                                        onClick={() => setYoloAdVideoSource(runtimeOption.id)}
                                        className={`rounded px-2 py-1 text-[10px] transition-colors ${
                                          isSelected
                                            ? 'bg-sf-accent text-white'
                                            : 'text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-800'
                                        }`}
                                      >
                                        {runtimeOption.label}
                                      </button>
                                    )
                                  })}
                                </div>
                                {yoloVideoUsesCloudTier ? (
                                  <>
                                    <div className="mt-1 text-[10px] text-sf-text-muted uppercase tracking-wider">Cloud Tier</div>
                                    <div className="mt-0.5 grid grid-cols-2 gap-1">
                                      {yoloVideoTierOptions.map((tierOption) => {
                                        const isSelectedTier = yoloNormalizedAdVideoTier === tierOption.id
                                        return (
                                          <button
                                            key={`video-tier-${tierOption.id}`}
                                            type="button"
                                            onClick={() => setYoloAdVideoTier(tierOption.id)}
                                            className={`rounded px-2 py-1 text-[10px] transition-colors ${
                                              isSelectedTier
                                                ? 'bg-sf-accent text-white'
                                                : 'border border-sf-dark-600 text-sf-text-muted hover:text-sf-text-primary hover:border-sf-dark-500'
                                            }`}
                                          >
                                            {tierOption.label}
                                          </button>
                                        )
                                      })}
                                    </div>
                                    <div className="mt-1 text-[10px] text-sf-text-muted">
                                      Workflow: <span className="text-sf-text-secondary">{yoloSelectedAdStageRouting?.videoLabel || getWorkflowDisplayLabel(yoloDefaultVideoWorkflowId)}</span>
                                    </div>
                                  </>
                                ) : (
                                  <div className="mt-1 text-[10px] text-sf-text-muted">
                                    Local workflow: <span className="text-sf-text-secondary">{yoloSelectedAdStageRouting?.videoLabel || getWorkflowDisplayLabel(yoloDefaultVideoWorkflowId)}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                          </div>
                        </div>

                        <div className="p-3 rounded-lg bg-sf-dark-800/70 border border-sf-dark-700">
                          <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Set References (optional)</label>
                          <p className="mt-1 text-[10px] text-sf-text-muted">
                            Add a product image and/or model image to keep ad identity consistent across keyframe shots.
                          </p>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <select
                              value={yoloAdProductAssetId || ''}
                              onChange={e => setYoloAdProductAssetId(e.target.value || null)}
                              className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                            >
                              <option value="">Product image (none)</option>
                              {assets.filter((asset) => asset.type === 'image').map((asset) => (
                                <option key={asset.id} value={asset.id}>{asset.name}</option>
                              ))}
                            </select>
                            <select
                              value={yoloAdModelAssetId || ''}
                              onChange={e => setYoloAdModelAssetId(e.target.value || null)}
                              className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                            >
                              <option value="">Model image (none)</option>
                              {assets.filter((asset) => asset.type === 'image').map((asset) => (
                                <option key={asset.id} value={asset.id}>{asset.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="mt-2">
                            <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Consistency Strength</label>
                            <select
                              value={yoloAdConsistency}
                              onChange={e => setYoloAdConsistency(e.target.value)}
                              className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                            >
                              {Object.entries(YOLO_AD_REFERENCE_CONSISTENCY_OPTIONS).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                            {yoloAdHasReferenceAnchors && !yoloStoryboardSupportsReferenceAnchors && (
                              <div className="mt-1 text-[10px] text-yellow-400">
                                The selected keyframe workflow does not support product/model anchors.
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {directorSubTab === 'plan-script' && (
                      <>
                        <div>
                          <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Song Title (optional)</label>
                          <input
                            type="text"
                            value={yoloMusicTitle}
                            onChange={e => setYoloMusicTitle(e.target.value)}
                            className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                            placeholder="e.g. Midnight Waves"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Song Lyrics</label>
                          <textarea
                            value={yoloMusicLyrics}
                            onChange={e => setYoloMusicLyrics(e.target.value)}
                            rows={8}
                            className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-y"
                            placeholder="Paste full lyrics. Each line helps create a visual beat sequence."
                          />
                        </div>

                        <div>
                          <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Story Arc (optional)</label>
                          <textarea
                            value={yoloMusicStoryIdea}
                            onChange={e => setYoloMusicStoryIdea(e.target.value)}
                            rows={2}
                            className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-y"
                            placeholder="e.g. starts intimate, builds into kinetic city-night energy, ends in sunrise release."
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Subject / Performer</label>
                            <textarea
                              value={yoloMusicSubject}
                              onChange={e => setYoloMusicSubject(e.target.value)}
                              rows={2}
                              className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary resize-y"
                              placeholder="e.g. female vocalist, silver jacket, short dark hair."
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Scene Palette</label>
                            <textarea
                              value={yoloMusicScenePalette}
                              onChange={e => setYoloMusicScenePalette(e.target.value)}
                              rows={2}
                              className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary resize-y"
                              placeholder="e.g. neon alley, rooftop, tunnel, dawn shoreline."
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Style Notes</label>
                          <textarea
                            value={yoloMusicStyleNotes}
                            onChange={e => setYoloMusicStyleNotes(e.target.value)}
                            rows={2}
                            className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-y"
                            placeholder="e.g. cinematic handheld, high contrast, subtle lens bloom, energetic edits."
                          />
                        </div>
                      </>
                    )}

                    {directorSubTab === 'setup' && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Target Duration (s)</label>
                            <input
                              type="number"
                              min={5}
                              max={300}
                              value={yoloMusicTargetDuration}
                              onChange={e => setYoloMusicTargetDuration(Number(e.target.value) || 5)}
                              className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Shots Per Scene</label>
                            <input
                              type="number"
                              min={1}
                              max={12}
                              value={yoloMusicShotsPerScene}
                              onChange={e => setYoloMusicShotsPerScene(Number(e.target.value) || 1)}
                              className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Angles Per Shot</label>
                            <input
                              type="number"
                              min={1}
                              max={8}
                              value={yoloMusicAnglesPerShot}
                              onChange={e => setYoloMusicAnglesPerShot(Number(e.target.value) || 1)}
                              className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Takes Per Angle</label>
                            <input
                              type="number"
                              min={1}
                              max={4}
                              value={yoloMusicTakesPerAngle}
                              onChange={e => setYoloMusicTakesPerAngle(Number(e.target.value) || 1)}
                              className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Quality Profile</label>
                          <select
                            value={yoloMusicQualityProfile}
                            onChange={e => setYoloMusicQualityProfile(e.target.value)}
                            className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                          >
                            <option value="draft">Draft (fast)</option>
                            <option value="balanced">Balanced</option>
                            <option value="premium">Premium</option>
                          </select>
                        </div>
                      </>
                    )}
                  </>
                )}

                {directorSubTab === 'setup' && (
                  <>
                    {isYoloMusicMode && (
                      <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-800/40 px-2.5 py-2">
                        <div className="text-[10px] text-sf-text-muted">
                          Video pass uses profile default: <span className="text-sf-text-secondary">{yoloSelectedVideoWorkflowLabel}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-sf-text-muted">
                          Video tier: <span className="text-sf-text-secondary">{yoloVideoTargetTierSummary}</span>
                        </div>
                      </div>
                    )}

                    <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-800/50 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] uppercase tracking-wider text-sf-text-muted">{DIRECTOR_MODE_BETA_LABEL} dependencies</div>
                        <button
                          type="button"
                          onClick={() => {
                            void runYoloDependencySnapshotCheck()
                          }}
                          disabled={!isConnected || yoloDependencyPanel.status === 'checking' || yoloDependencyCheckInProgress}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors ${
                            !isConnected || yoloDependencyPanel.status === 'checking' || yoloDependencyCheckInProgress
                              ? 'border-sf-dark-600 text-sf-text-muted cursor-not-allowed'
                              : 'border-sf-dark-500 text-sf-text-secondary hover:text-sf-text-primary hover:border-sf-dark-400'
                          }`}
                        >
                          <RefreshCw className={`w-3 h-3 ${
                            yoloDependencyPanel.status === 'checking' || yoloDependencyCheckInProgress ? 'animate-spin' : ''
                          }`} />
                          Re-check
                        </button>
                      </div>

                      {yoloDependencyPanel.status === 'offline' && (
                        <div className="mt-2 text-[10px] text-yellow-400">ComfyUI is offline. Start ComfyUI to verify dependencies.</div>
                      )}
                      {yoloDependencyPanel.status === 'checking' && (
                        <div className="mt-2 text-[10px] text-yellow-400">Checking storyboard/video workflow dependencies...</div>
                      )}
                      {yoloDependencyPanel.status === 'error' && (
                        <div className="mt-2 text-[10px] text-sf-error">
                          Dependency check failed{yoloDependencyPanel.error ? ` (${yoloDependencyPanel.error})` : ''}.
                        </div>
                      )}

                      <div className="mt-2 space-y-1.5">
                        {yoloDependencyWorkflowIds.map((workflow) => {
                          const result = yoloDependencyPanel.byWorkflow?.[workflow]
                          const isMissing = Boolean(result?.hasPack && result?.hasBlockingIssues)
                          const rowStatus = !result
                            ? (yoloDependencyPanel.status === 'checking' ? 'Checking...' : 'Not checked')
                            : result.status === 'error'
                              ? 'Check failed'
                              : result.status === 'no-pack' || !result.hasPack
                                ? 'No manifest'
                                : isMissing
                                  ? 'Missing required'
                                  : result.status === 'partial'
                                    ? 'Partially verified'
                                    : 'Ready'
                          const rowToneClass = isMissing
                            ? 'text-sf-error'
                            : result?.status === 'partial'
                              ? 'text-yellow-400'
                              : result?.status === 'ready'
                                ? 'text-green-400'
                                : 'text-sf-text-muted'

                          return (
                            <details key={workflow} open={isMissing} className="rounded border border-sf-dark-700 bg-sf-dark-900/50 px-2 py-1">
                              <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-[10px]">
                                <span className="text-sf-text-secondary truncate">{getWorkflowDisplayLabel(workflow)}</span>
                                <span className={rowToneClass}>{rowStatus}</span>
                              </summary>

                              {result && (
                                <div className="mt-1.5 space-y-1 text-[10px]">
                                  {result.missingNodes?.length > 0 && (
                                    <div>
                                      <div className="text-sf-text-muted mb-0.5">Missing nodes</div>
                                      <div className="space-y-0.5">
                                        {result.missingNodes.map((node) => (
                                          <div key={node.classType} className="text-sf-error break-all">{node.classType}</div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {result.missingModels?.length > 0 && (
                                    <div>
                                      <div className="text-sf-text-muted mb-0.5">Missing models</div>
                                      <div className="space-y-0.5">
                                        {result.missingModels.map((model) => (
                                          <div key={`${model.classType}:${model.inputKey}:${model.filename}`} className="text-sf-error break-all">
                                            {model.filename}
                                            {model.targetSubdir ? (
                                              <span className="text-sf-text-muted">{` -> ComfyUI/models/${model.targetSubdir}`}</span>
                                            ) : null}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {result.missingAuth && (
                                    <div className="text-sf-error">Missing Comfy Partner API key in Settings.</div>
                                  )}

                                  {result.hasPriceMetadata && (
                                    <div>
                                      <div className="text-sf-text-muted mb-0.5">Price metadata</div>
                                      {result.estimatedCredits ? (
                                        <div className="text-amber-300">
                                          Estimated per run: {formatCreditsRange(result.estimatedCredits, 1)}
                                        </div>
                                      ) : (
                                        <div className="text-yellow-400">
                                          Price badge found, but numeric credits could not be parsed.
                                        </div>
                                      )}
                                      {result.badgeSummaries?.slice(0, 2).map((entry, idx) => (
                                        <div key={`${entry.classType}:${idx}`} className="text-sf-text-muted break-all">
                                          {entry.classType}: {entry.text}
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {result.unresolvedModels?.length > 0 && result.status !== 'missing' && (
                                    <div className="text-yellow-400">
                                      {result.unresolvedModels.length} model check(s) could not be auto-verified.
                                    </div>
                                  )}
                                </div>
                              )}
                            </details>
                          )
                        })}
                      </div>
                    </div>

                    <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-800/50 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] uppercase tracking-wider text-sf-text-muted">Cloud credits (estimate)</div>
                      </div>

                      <div className="mt-2 text-[10px] text-sf-text-secondary space-y-1.5">
                        {yoloCloudCreditRows.map((row) => {
                          const runCountLabel = `${Math.max(0, Number(row.runCount) || 0)} run${Math.max(0, Number(row.runCount) || 0) === 1 ? '' : 's'}`
                          const lineLabel = `${row.stageLabel} (${row.workflowLabel})`
                          if (!row.isCloud) {
                            return (
                              <div key={row.id} className="flex items-center justify-between gap-2">
                                <span className="truncate">{lineLabel}</span>
                                <span className="text-sf-text-muted">Local (no credits)</span>
                              </div>
                            )
                          }
                          if (row.estimatedCredits) {
                            return (
                              <div key={row.id} className="space-y-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">{lineLabel}</span>
                                  <span className="flex items-center gap-1 text-amber-300 whitespace-nowrap">
                                    <span>
                                      {formatCreditsRange(row.estimatedCredits, 1)} / run
                                      <span className="text-sf-text-muted"> ({formatUsdRangeFromCredits(row.estimatedCredits, 1)} / run)</span>
                                    </span>
                                    {row.hasPriceMetadata && (
                                      <span className="text-yellow-400">(dynamic pricing)</span>
                                    )}
                                  </span>
                                </div>
                                <div className="text-sf-text-muted">
                                  Plan ({runCountLabel}): {formatCreditsRange(row.estimatedCredits, row.runCount)} ({formatUsdRangeFromCredits(row.estimatedCredits, row.runCount)})
                                </div>
                              </div>
                            )
                          }
                          return (
                            <div key={row.id} className="flex items-center justify-between gap-2">
                              <span className="truncate">{lineLabel}</span>
                              <span className="text-yellow-400">
                                {row.hasPriceMetadata ? 'Dynamic pricing (estimate unavailable)' : 'No credit metadata'}
                              </span>
                            </div>
                          )
                        })}

                        {yoloCloudCreditProjection.hasAnyCloudRows ? (
                          <div className="pt-1.5 border-t border-sf-dark-700">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sf-text-muted">Projected cloud total (current plan)</span>
                              <span className="text-amber-300">
                                {yoloCloudCreditProjection.hasKnownCloudEstimates
                                  ? (
                                    yoloCloudCreditProjection.hasUnknownCloudEstimates
                                      ? `${formatCreditsRange({ min: yoloCloudCreditProjection.minTotal, max: yoloCloudCreditProjection.maxTotal }, 1)} (${formatUsdRangeFromCredits({ min: yoloCloudCreditProjection.minTotal, max: yoloCloudCreditProjection.maxTotal }, 1)}) + unknown`
                                      : `${formatCreditsRange({ min: yoloCloudCreditProjection.minTotal, max: yoloCloudCreditProjection.maxTotal }, 1)} (${formatUsdRangeFromCredits({ min: yoloCloudCreditProjection.minTotal, max: yoloCloudCreditProjection.maxTotal }, 1)})`
                                  )
                                  : 'Unknown'}
                              </span>
                            </div>
                            {yoloCloudCreditProjection.hasUnknownCloudEstimates && (
                              <div className="mt-0.5 text-yellow-400">
                                Some selected cloud workflows have unknown credit estimates.
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="pt-1.5 border-t border-sf-dark-700 text-sf-text-muted">
                            No cloud workflows selected.
                          </div>
                        )}
                      </div>

                      <div className="mt-2 text-[9px] text-sf-text-muted">
                        Estimates are derived from workflow node price metadata when available. USD values use 211 credits = $1. Final billing can vary by runtime provider settings.
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setDirectorSubTab('plan-script')}
                      className="w-full px-3 py-2 rounded-lg bg-sf-accent hover:bg-sf-accent-hover text-white text-xs"
                    >
                      Next: Script
                    </button>
                  </>
                )}

                {directorSubTab === 'plan-script' && (
                  <>
                    <div className="grid grid-cols-1 gap-2">
                      <button
                        type="button"
                        onClick={handleBuildActiveYoloPlan}
                        className="px-3 py-2 rounded-lg bg-sf-accent hover:bg-sf-accent-hover text-white text-xs"
                      >
                        Build Plan
                      </button>
                      <div className="text-[10px] text-sf-text-muted">
                        Build plan, then continue through Keyframes and Videos for batch generation.
                      </div>
                    </div>

                  </>
                )}

                {(isYoloStillsStep || isYoloVideoStep) && (
                  yoloCanEditScenes ? (
                  <div className="space-y-3">
                    {yoloDependencyCheckInProgress && (
                      <div className="text-[10px] text-yellow-400">Checking {DIRECTOR_MODE_BETA_LABEL} workflow dependencies...</div>
                    )}

                    <div className="p-3 rounded-lg bg-sf-dark-800/70 border border-sf-dark-700 text-xs text-sf-text-secondary">
                      <div className="font-medium text-sf-text-primary mb-1">{yoloModeLabel} Plan Status</div>
                      <div>Scenes: {yoloSceneCount}</div>
                      <div>Planned variants: {yoloVariants.length}</div>
                      <div>Queue variants: {yoloQueueVariants.length}</div>
                      <div>Keyframes ready: {yoloStoryboardReadyCount} / {yoloQueueVariants.length}</div>
                    </div>
                    <div className="text-[10px] text-yellow-300/90 leading-relaxed">
                      Tip: Scene text is reference-only. Refine the keyframe prompt, motion prompt, camera direction, camera preset, duration, and takes before creating keyframes or videos.
                    </div>

                  <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4">
                    <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-800/40 p-3 h-fit sticky top-2">
                      <div className="text-[10px] text-sf-text-muted uppercase tracking-wider">Scene Navigator</div>
                      <div className="mt-2 space-y-1 max-h-[70vh] overflow-y-auto pr-1">
                        {yoloActivePlan.map((scene) => {
                          const stats = yoloSceneStats.get(scene.id) || { shotCount: 0, variantCount: 0, readyCount: 0 }
                          const isSelected = scene.id === selectedYoloSceneId
                          return (
                            <button
                              key={scene.id}
                              type="button"
                              onClick={() => setSelectedYoloSceneId(scene.id)}
                              className={`w-full text-left rounded border px-2 py-1.5 transition-colors ${
                                isSelected
                                  ? 'border-sf-accent bg-sf-accent/15 text-sf-accent'
                                  : 'border-sf-dark-700 bg-sf-dark-900/70 text-sf-text-secondary hover:border-sf-dark-500'
                              }`}
                            >
                              <div className="text-[11px] font-medium">{scene.id}</div>
                              <div className="mt-0.5 text-[9px] opacity-80">
                                Shots: {stats.shotCount}
                              </div>
                              <div className="text-[9px] opacity-80">
                                Keyframes: {stats.readyCount}/{stats.variantCount}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {selectedYoloScene && (
                        <div key={selectedYoloScene.id} className="p-3 rounded-lg border border-sf-dark-700 bg-sf-dark-800/40 space-y-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="text-xs font-semibold text-sf-text-primary">
                              {selectedYoloScene.id}
                              {selectedYoloSceneIndex >= 0 ? ` (${selectedYoloSceneIndex + 1}/${yoloActivePlan.length})` : ''}
                            </div>
                          </div>

                          <div>
                            <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Scene</label>
                            <div className="mt-1 w-full bg-sf-dark-900 border border-sf-dark-700 rounded px-2 py-1 text-xs text-sf-text-secondary">
                              {selectedYoloScene.contextText || selectedYoloScene.summary || selectedYoloScene.rawText || 'Scene details'}
                            </div>
                          </div>

                          <div className="space-y-2">
                            {(selectedYoloScene.shots || []).map((shot) => {
                              const hasShotStoryboardFrame = yoloQueueVariants.some((variant) => (
                                variant.sceneId === selectedYoloScene.id
                                && variant.shotId === shot.id
                                && yoloStoryboardAssetMap.has(variant.key)
                              ))
                              return (
                              <div key={shot.id} className="rounded border border-sf-dark-700 bg-sf-dark-900/70 p-2 space-y-2">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="text-[11px] text-sf-text-primary">{shot.id}</div>
                                  </div>
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    {isYoloStillsStep && (
                                      <button
                                        type="button"
                                        onClick={() => { void handleQueueYoloShotStoryboard(selectedYoloScene.id, shot.id) }}
                                        disabled={yoloDependencyCheckInProgress}
                                        className={`px-2 py-1 rounded text-[10px] whitespace-nowrap ${
                                          yoloDependencyCheckInProgress
                                            ? 'bg-sf-dark-700 text-sf-text-muted cursor-not-allowed'
                                            : 'bg-sf-accent hover:bg-sf-accent-hover text-white'
                                        }`}
                                      >
                                        Create Keyframe
                                      </button>
                                    )}
                                    {isYoloVideoStep && (
                                      <button
                                        type="button"
                                        onClick={() => { void handleQueueYoloShotVideo(selectedYoloScene.id, shot.id) }}
                                        disabled={yoloDependencyCheckInProgress || !hasShotStoryboardFrame}
                                        title={!hasShotStoryboardFrame ? 'Create this shot keyframe first' : ''}
                                        className={`px-2 py-1 rounded text-[10px] whitespace-nowrap ${
                                          yoloDependencyCheckInProgress || !hasShotStoryboardFrame
                                            ? 'bg-sf-dark-700 text-sf-text-muted cursor-not-allowed'
                                            : 'bg-sf-accent hover:bg-sf-accent-hover text-white'
                                        }`}
                                      >
                                        {yoloSelectedVideoWorkflowIds.length > 1 ? 'Create Shot Video (A/B)' : 'Create Shot Video'}
                                      </button>
                                    )}
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <div>
                                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Keyframe Prompt</label>
                                    <input
                                      type="text"
                                      value={shot.imageBeat || shot.beat || ''}
                                      onChange={e => handleYoloShotImageBeatChange(selectedYoloScene.id, shot.id, e.target.value)}
                                      className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Motion Prompt</label>
                                    <input
                                      type="text"
                                      value={shot.videoBeat || shot.beat || ''}
                                      onChange={e => handleYoloShotVideoBeatChange(selectedYoloScene.id, shot.id, e.target.value)}
                                      className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Camera Direction</label>
                                    <input
                                      type="text"
                                      value={shot.cameraDirection || ''}
                                      onChange={e => handleYoloShotCameraDirectionChange(selectedYoloScene.id, shot.id, e.target.value)}
                                      className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                                      placeholder="e.g. subtle push-in, locked close-up, gentle backward tracking"
                                    />
                                  </div>
                                </div>

                                <div>
                                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Camera Setup Preset</label>
                                  <select
                                    value={shot.cameraPresetId || 'auto'}
                                    onChange={e => handleYoloShotCameraPresetChange(selectedYoloScene.id, shot.id, e.target.value)}
                                    className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                                  >
                                    {YOLO_CAMERA_PRESET_OPTIONS.map((preset) => (
                                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                                    ))}
                                  </select>
                                  <div className="mt-1 text-[10px] text-sf-text-muted">
                                    Active angles: {(shot.angles || []).join(', ')}
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Duration (s)</label>
                                    <input
                                      type="number"
                                      min={2}
                                      max={5}
                                      step={0.5}
                                      value={shot.durationSeconds}
                                      onChange={e => handleYoloShotDurationChange(selectedYoloScene.id, shot.id, e.target.value)}
                                      className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Takes</label>
                                    <input
                                      type="number"
                                      min={1}
                                      max={4}
                                      value={shot.takesPerAngle}
                                      onChange={e => handleYoloShotTakesChange(selectedYoloScene.id, shot.id, e.target.value)}
                                      className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                                    />
                                  </div>
                                </div>
                              </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                    <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-800/50 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-sf-text-muted">
                        {isYoloStillsStep ? 'Batch Create Keyframes (All Scenes & Shots)' : 'Batch Create Videos (All Scenes & Shots)'}
                      </div>
                      <div className="mt-1 text-[10px] text-sf-text-muted">
                        {isYoloStillsStep
                          ? 'These actions run across the full plan, not just the selected shot.'
                          : `Keyframes ready: ${yoloStoryboardReadyCount}/${yoloQueueVariants.length}. Videos use keyframe images.`}
                      </div>
                      <div className={`mt-2 grid grid-cols-1 gap-2 ${isYoloStillsStep ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                        {isYoloStillsStep ? (
                          <>
                            <button
                              type="button"
                              onClick={() => { void handleQueueYoloStoryboards() }}
                              disabled={yoloDependencyCheckInProgress}
                              title={yoloDependencyCheckInProgress ? 'Wait for dependency check to finish' : 'Queues still-image jobs for all shots in this plan'}
                              className={`px-3 py-2 rounded-lg text-xs ${
                                yoloDependencyCheckInProgress
                                  ? 'bg-sf-dark-700 text-sf-text-muted cursor-not-allowed'
                                  : 'bg-sf-accent hover:bg-sf-accent-hover text-white'
                              }`}
                            >
                              Create Keyframes
                            </button>
                            <button
                              type="button"
                              onClick={() => { void handleCreateStoryboardPdf() }}
                              disabled={creatingStoryboardPdf || yoloStoryboardAssetMap.size === 0}
                              className={`px-3 py-2 rounded-lg text-xs inline-flex items-center justify-center gap-1 ${
                                creatingStoryboardPdf || yoloStoryboardAssetMap.size === 0
                                  ? 'bg-sf-dark-700 text-sf-text-muted cursor-not-allowed'
                                  : 'bg-sf-dark-700 hover:bg-sf-dark-600 text-sf-text-secondary'
                              }`}
                              title={yoloStoryboardAssetMap.size === 0 ? 'Generate keyframe images first' : 'Create a PDF from the latest keyframe images'}
                            >
                              {creatingStoryboardPdf && <Loader2 className="w-3 h-3 animate-spin" />}
                              {creatingStoryboardPdf ? 'Creating PDF...' : 'Create Storyboard PDF'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDirectorSubTab('video-pass')}
                              disabled={yoloStoryboardReadyCount === 0}
                              title={yoloStoryboardReadyCount === 0 ? 'Create at least one keyframe first' : 'Continue to Videos step'}
                              className={`px-3 py-2 rounded-lg text-xs ${
                                yoloStoryboardReadyCount === 0
                                  ? 'bg-sf-dark-700 text-sf-text-muted cursor-not-allowed'
                                  : 'bg-sf-accent hover:bg-sf-accent-hover text-white'
                              }`}
                            >
                              Next: Videos
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setDirectorSubTab('scene-shot')}
                              className="px-3 py-2 rounded-lg text-xs bg-sf-dark-700 hover:bg-sf-dark-600 text-sf-text-secondary"
                            >
                              Back: Keyframes
                            </button>
                            <button
                              type="button"
                              onClick={() => { void handleQueueYoloVideos() }}
                              disabled={yoloDependencyCheckInProgress || yoloStoryboardReadyCount === 0}
                              title={yoloDependencyCheckInProgress ? 'Wait for dependency check to finish' : yoloStoryboardReadyCount === 0 ? 'Create keyframes first' : 'Queues video generation jobs for all shots in this plan'}
                              className={`px-3 py-2 rounded-lg text-xs ${
                                yoloDependencyCheckInProgress || yoloStoryboardReadyCount === 0
                                  ? 'bg-sf-dark-700 text-sf-text-muted cursor-not-allowed'
                                  : 'bg-sf-accent hover:bg-sf-accent-hover text-white'
                              }`}
                            >
                              Create Videos
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  ) : (
                    <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-800/40 p-3 text-xs text-sf-text-secondary space-y-2">
                      <div className="font-medium text-sf-text-primary">Build a plan to unlock Keyframes and Videos</div>
                      <div>Go to Step 2 (Script), click Build Plan, then continue into Steps 3 and 4.</div>
                      <button
                        type="button"
                        onClick={() => setDirectorSubTab('plan-script')}
                        className="px-3 py-1.5 rounded bg-sf-dark-700 hover:bg-sf-dark-600 text-sf-text-secondary text-[11px]"
                      >
                        Go to Script
                      </button>
                    </div>
                  )
                )}
              </>
            )}
          </div>
        </div>

        {/* Right: Progress + Generate (collapsible) */}
        <div className={`${rightSidebarCollapsed ? 'w-12' : 'w-80'} flex-shrink-0 min-h-0 border-l border-sf-dark-700 bg-sf-dark-900 flex flex-col overflow-hidden transition-all duration-200`}>
          {rightSidebarCollapsed ? (
            <button
              type="button"
              onClick={() => setRightSidebarCollapsed(false)}
              className="flex flex-col items-center justify-center py-4 px-2 text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-800 transition-colors"
              title="Expand queue panel"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          ) : (
          <>
          <div className="flex-shrink-0 flex items-center justify-between gap-2 p-2 border-b border-sf-dark-700">
            <span className="text-[10px] text-sf-text-muted uppercase tracking-wider truncate">Queue</span>
            <button
              type="button"
              onClick={() => setRightSidebarCollapsed(true)}
              className="p-1 rounded text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-700 transition-colors flex-shrink-0"
              title="Collapse panel"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          <div className="flex-shrink-0 p-4 border-b border-sf-dark-700">
            <button
              onClick={handleGenerate}
              disabled={isGenerateDisabled}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                isGenerateDisabled ? 'bg-sf-dark-700 text-sf-text-muted cursor-not-allowed'
                : 'bg-sf-accent hover:bg-sf-accent-hover text-white'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              {generationMode === 'yolo'
                ? `Queue ${yoloModeLabel} Keyframes`
                : `Queue ${category === 'video' ? 'Video' : category === 'image' ? 'Image' : 'Audio'}`}
            </button>
            <div className="mt-2 flex gap-2">
              {generationQueue.some(j => j.status === 'paused') && (
                <button
                  type="button"
                  onClick={handleResumeQueue}
                  className="flex-1 px-4 py-2 rounded-lg text-xs font-medium transition-colors bg-sf-accent hover:bg-sf-accent-hover text-white"
                >
                  Resume Queue
                </button>
              )}
              <button
                type="button"
                onClick={handleClearGenerationQueue}
                disabled={!hasJobs}
                className={`flex-1 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                  hasJobs
                    ? 'bg-sf-dark-700 hover:bg-sf-dark-600 text-sf-text-secondary'
                    : 'bg-sf-dark-800 text-sf-text-muted cursor-not-allowed'
                }`}
              >
                Clear Queue
              </button>
            </div>

            {generationMode === 'single' && (
              <div className="mt-3 rounded-lg border border-sf-dark-600 bg-sf-dark-800/60 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] uppercase tracking-wider text-sf-text-muted">Workflow Dependencies</div>
                  <button
                    type="button"
                    onClick={() => { void runWorkflowDependencyCheck() }}
                    disabled={!isConnected || dependencyCheckInProgress}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors ${
                      !isConnected || dependencyCheckInProgress
                        ? 'border-sf-dark-600 text-sf-text-muted cursor-not-allowed'
                        : 'border-sf-dark-500 text-sf-text-secondary hover:text-sf-text-primary hover:border-sf-dark-400'
                    }`}
                    title="Re-check required nodes/models"
                  >
                    <RefreshCw className={`w-3 h-3 ${dependencyCheckInProgress ? 'animate-spin' : ''}`} />
                    Re-check
                  </button>
                </div>

                <div className="mt-1 text-[10px] text-sf-text-muted">{currentWorkflow?.label || workflowId}</div>

                {dependencyCheck.status === 'offline' && (
                  <div className="mt-2 text-[10px] text-yellow-400">ComfyUI is offline. Start ComfyUI to run dependency checks.</div>
                )}

                {dependencyCheck.status === 'checking' && (
                  <div className="mt-2 text-[10px] text-yellow-400">Checking installed nodes and models...</div>
                )}

                {dependencyCheck.status === 'error' && (
                  <div className="mt-2 text-[10px] text-sf-error">
                    Could not validate dependencies ({dependencyCheck.error || 'unknown error'}).
                  </div>
                )}

                {dependencyCheck.status === 'no-pack' && (
                  <div className="mt-2 text-[10px] text-sf-text-muted">
                    No dependency manifest yet for this workflow. Queueing remains enabled.
                  </div>
                )}

                {dependencyCheck.status === 'ready' && (
                  <div className="mt-2 text-[10px] text-green-400">Ready. Required dependencies were detected.</div>
                )}

                {dependencyCheck.status === 'partial' && (
                  <div className="mt-2 text-[10px] text-yellow-400">
                    Partially verified. Some model lists were not exposed by ComfyUI, so manual verification may be needed.
                  </div>
                )}

                {dependencyCheck.status === 'missing' && (
                  <div className="mt-2 space-y-2">
                    <div className="text-[10px] text-sf-error">
                      Missing required dependencies. Queueing is blocked until these are installed.
                    </div>

                    {dependencyCheck.missingNodes.length > 0 && (
                      <div className="text-[10px]">
                        <div className="text-sf-text-muted mb-1">Missing nodes:</div>
                        <div className="space-y-1">
                          {dependencyCheck.missingNodes.map((node) => (
                            <div key={node.classType} className="text-sf-error">{node.classType}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    {dependencyCheck.missingModels.length > 0 && (
                      <div className="text-[10px]">
                        <div className="text-sf-text-muted mb-1">Missing models:</div>
                        <div className="space-y-1">
                          {dependencyCheck.missingModels.map((model) => (
                            <div key={`${model.classType}:${model.inputKey}:${model.filename}`} className="text-sf-error break-all">
                              {model.filename}
                              {model.targetSubdir ? (
                                <span className="text-sf-text-muted">{` -> ComfyUI/models/${model.targetSubdir}`}</span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {dependencyCheck.missingAuth && (
                      <div className="text-[10px] text-sf-error">
                        Missing Comfy Partner API key in Settings.
                      </div>
                    )}
                  </div>
                )}

                {dependencyCheck.unresolvedModels.length > 0 && dependencyCheck.status !== 'missing' && (
                  <div className="mt-2 text-[10px] text-yellow-400">
                    {dependencyCheck.unresolvedModels.length} model check(s) could not be auto-verified from ComfyUI metadata.
                  </div>
                )}

                {(dependencyCheck.status === 'missing' || dependencyCheck.status === 'partial') && (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => { void handleCopyDependencyReport() }}
                      className="px-2 py-1 rounded border border-sf-dark-500 text-[10px] text-sf-text-secondary hover:text-sf-text-primary hover:border-sf-dark-400 transition-colors"
                    >
                      Copy report
                    </button>
                    {dependencyCheck.pack?.docsUrl && (
                      <a
                        href={dependencyCheck.pack.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-sf-accent hover:text-sf-accent-hover"
                      >
                        Open node registry
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}

            {!isConnected && (
              <div className="mt-2 text-[10px] text-sf-error text-center">ComfyUI is not running. Start it to generate.</div>
            )}

            {generationMode === 'single' && currentWorkflow?.needsImage && !selectedAsset && !frameForAI && (
              <div className="mt-2 text-[10px] text-yellow-500 text-center">Select an input asset or use a timeline frame (right-click preview → Extend with AI)</div>
            )}
            {generationMode === 'yolo' && yoloQueueVariants.length === 0 && (
              <div className="mt-2 text-[10px] text-yellow-500 text-center">Build a plan first before queueing.</div>
            )}

            {formError && (
              <div className="mt-2 text-[10px] text-sf-error text-center">{formError}</div>
            )}
          </div>

          {/* Queue list */}
          {hasJobs && (
            <div className="p-4 border-b border-sf-dark-700 space-y-3">
              {generationQueue.map((job) => {
                const percent = Math.round(job.progress || 0)
                const isYoloAdStoryboardJob = job?.yolo?.stage === 'storyboard' && job?.yolo?.mode !== 'music'
                const referenceRoleParts = []
                if (job.referenceAssetId1) referenceRoleParts.push(isYoloAdStoryboardJob ? 'Product' : 'Ref 1')
                if (job.referenceAssetId2) referenceRoleParts.push(isYoloAdStoryboardJob ? 'Model' : 'Ref 2')
                const referenceCount = referenceRoleParts.length
                const referenceRoleLabel = referenceRoleParts.join(' + ')
                const referenceNameParts = [job.referenceAssetId1, job.referenceAssetId2]
                  .filter(Boolean)
                  .map((id) => assetNameById.get(id))
                  .filter(Boolean)
                const hasReferenceAnchors = referenceCount > 0
                const consistencyLabel = job?.yolo?.referenceConsistency
                  ? formatReferenceConsistencyLabel(job.yolo.referenceConsistency)
                  : null
                const statusLabel = job.status === 'queued' ? 'Queued'
                  : job.status === 'paused' ? 'Paused'
                  : job.status === 'uploading' ? 'Uploading input'
                  : job.status === 'configuring' ? 'Configuring workflow'
                  : job.status === 'queuing' ? 'Queued in ComfyUI'
                  : job.status === 'running' ? 'Generating'
                  : job.status === 'saving' ? 'Saving to project'
                  : job.status === 'done' ? 'Complete'
                  : job.status === 'error' ? 'Failed'
                  : job.status
                const isStaleOutputError = typeof job.error === 'string'
                  && /stale\/duplicate output|stale output|duplicate output/i.test(job.error)
                const title = `${job.workflowLabel || job.workflowId}${job.prompt ? ` — ${job.prompt}` : ''}`
                return (
                  <div key={job.id} className="bg-sf-dark-800 rounded-lg p-3 border border-sf-dark-700">
                    <div className="flex items-center justify-between text-[10px] text-sf-text-muted mb-1">
                      <span className="text-sf-text-primary truncate" title={title}>
                        {job.workflowLabel || job.workflowId}
                      </span>
                      <span className="tabular-nums">{percent}%</span>
                    </div>
                    <div className="h-1.5 bg-sf-dark-900 rounded-full overflow-hidden">
                      <div className="h-full bg-sf-accent transition-all duration-300" style={{ width: `${percent}%` }} />
                    </div>
                    <div className="mt-1 text-[9px] text-sf-text-muted">
                      {statusLabel}{job.node ? ` · Node ${job.node}` : ''}
                    </div>
                    {hasReferenceAnchors && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span
                          className="px-1.5 py-0.5 rounded border border-sf-accent/30 bg-sf-accent/15 text-[9px] text-sf-accent"
                          title={referenceNameParts.join(' + ')}
                        >
                          {`Anchors: ${referenceRoleLabel}${referenceNameParts.length > 0 ? ` (${referenceNameParts.join(' + ')})` : ''}`}
                        </span>
                        {consistencyLabel && (
                          <span className="px-1.5 py-0.5 rounded border border-sf-dark-600 bg-sf-dark-700 text-[9px] text-sf-text-secondary">
                            Consistency: {consistencyLabel}
                          </span>
                        )}
                      </div>
                    )}
                    {job.error && (
                      <div className="mt-1 space-y-1">
                        {isStaleOutputError && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-yellow-500/30 bg-yellow-500/15 text-[9px] text-yellow-300">
                            Stale output detected
                          </span>
                        )}
                        <div className="text-[9px] text-sf-error">{job.error}</div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Info panel (collapsible) */}
          <div className="p-4">
            <button
              type="button"
              onClick={() => setWorkflowInfoExpanded(prev => !prev)}
              className="w-full flex items-center justify-between gap-2 text-left text-[10px] text-sf-text-muted uppercase tracking-wider mb-2 hover:text-sf-text-primary transition-colors"
            >
              Workflow Info
              {workflowInfoExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            {workflowInfoExpanded && (
            <div className="space-y-2 text-[11px] text-sf-text-secondary">
              {generationMode === 'single' ? (
                <>
                  <div><span className="text-sf-text-muted">Category:</span> {category}</div>
                  <div><span className="text-sf-text-muted">Workflow:</span> {currentWorkflow?.label}</div>
                  <div><span className="text-sf-text-muted">Hardware tier:</span> {currentWorkflowTierMeta?.label || 'Unknown'}</div>
                  <div><span className="text-sf-text-muted">Runtime:</span> {currentWorkflowRuntimeLabel}</div>
                  {currentWorkflowUsesCloud && (
                    <div>
                      <span className="text-sf-text-muted">Cloud estimate / run:</span>{' '}
                      {dependencyCheck.status === 'checking'
                        ? 'Checking pricing...'
                        : dependencyCheck?.estimatedCredits
                          ? (
                            <>
                              {formatCreditsRange(dependencyCheck.estimatedCredits, 1)} ({formatUsdRangeFromCredits(dependencyCheck.estimatedCredits, 1)})
                              {dependencyCheck?.hasPriceMetadata && (
                                <span className="text-yellow-400"> (dynamic pricing)</span>
                              )}
                            </>
                          )
                          : (
                            dependencyCheck?.hasPriceMetadata
                              ? 'Dynamic pricing (estimate unavailable)'
                              : 'No credit metadata'
                          )}
                    </div>
                  )}
                  <div><span className="text-sf-text-muted">Needs input:</span> {currentWorkflow?.needsImage ? 'Yes (image)' : 'No'}</div>
                  {category === 'video' && (
                    <>
                      <div><span className="text-sf-text-muted">Output:</span> {duration}s @ {fps}fps ({getFrameCount()} frames)</div>
                      <div><span className="text-sf-text-muted">Resolution:</span> {resolution.width}x{resolution.height}</div>
                    </>
                  )}
                  {category === 'audio' && (
                    <>
                      <div><span className="text-sf-text-muted">Duration:</span> {musicDuration}s</div>
                      <div><span className="text-sf-text-muted">BPM:</span> {bpm}</div>
                      <div><span className="text-sf-text-muted">Key:</span> {keyscale}</div>
                    </>
                  )}
                  <div><span className="text-sf-text-muted">Seed:</span> {seed}</div>
                </>
              ) : (
                <>
                  <div><span className="text-sf-text-muted">Mode:</span> {DIRECTOR_MODE_BETA_LABEL}</div>
                  <div><span className="text-sf-text-muted">Creation:</span> {yoloModeLabel}</div>
                  {!isYoloMusicMode && (
                    <>
                      <div>
                        <span className="text-sf-text-muted">Keyframe source:</span> {yoloStoryboardProfileRuntimeMeta?.label || yoloStoryboardProfileRuntime}
                      </div>
                      {yoloStoryboardUsesCloudTier ? (
                        <div>
                          <span className="text-sf-text-muted">Keyframe cloud tier:</span> {yoloSelectedStoryboardTierMeta?.label || yoloNormalizedAdStoryboardTier}
                        </div>
                      ) : (
                        <div>
                          <span className="text-sf-text-muted">Keyframe local workflow:</span> {yoloSelectedAdStageRouting?.imageLabel || getWorkflowDisplayLabel(yoloStoryboardWorkflowId)}
                        </div>
                      )}
                      <div>
                        <span className="text-sf-text-muted">Video source:</span> {yoloVideoProfileRuntimeMeta?.label || yoloVideoProfileRuntime}
                      </div>
                      {yoloVideoUsesCloudTier ? (
                        <div>
                          <span className="text-sf-text-muted">Video cloud tier:</span> {yoloSelectedVideoTierMeta?.label || yoloNormalizedAdVideoTier}
                        </div>
                      ) : (
                        <div>
                          <span className="text-sf-text-muted">Video local workflow:</span> {yoloSelectedAdStageRouting?.videoLabel || getWorkflowDisplayLabel(yoloDefaultVideoWorkflowId)}
                        </div>
                      )}
                    </>
                  )}
                  {isYoloMusicMode && (
                    <div><span className="text-sf-text-muted">Profile:</span> {yoloMusicQualityProfile}</div>
                  )}
                  <div><span className="text-sf-text-muted">Keyframe workflow:</span> {yoloStoryboardWorkflowId}</div>
                  <div><span className="text-sf-text-muted">Keyframe runtime:</span> {formatWorkflowHardwareRuntime(yoloStoryboardWorkflowId)}</div>
                  <div><span className="text-sf-text-muted">Video default:</span> {getWorkflowDisplayLabel(yoloDefaultVideoWorkflowId)}</div>
                  <div><span className="text-sf-text-muted">Video runtime:</span> {formatWorkflowHardwareRuntime(yoloDefaultVideoWorkflowId)}</div>
                  <div><span className="text-sf-text-muted">Video queue target:</span> {yoloSelectedVideoWorkflowLabel}</div>
                  <div><span className="text-sf-text-muted">Video target tier:</span> {yoloVideoTargetTierSummary}</div>
                  <div><span className="text-sf-text-muted">Scenes:</span> {yoloSceneCount}</div>
                  <div><span className="text-sf-text-muted">Planned variants:</span> {yoloVariants.length}</div>
                  <div><span className="text-sf-text-muted">Queue variants:</span> {yoloQueueVariants.length}</div>
                  <div><span className="text-sf-text-muted">Keyframes ready:</span> {yoloStoryboardReadyCount}/{yoloQueueVariants.length}</div>
                </>
              )}
            </div>
            )}
          </div>
          </div>
          </>
          )}
        </div>
      </div>

      {/* ComfyUI activity log – always present, expand/collapse for troubleshooting */}
      <div className="flex-shrink-0 border-t border-sf-dark-700 bg-sf-dark-900">
        <button
          type="button"
          onClick={() => setComfyLogExpanded(prev => !prev)}
          className="w-full h-9 flex items-center justify-between gap-2 px-3 text-left text-[11px] text-sf-text-muted hover:bg-sf-dark-800 hover:text-sf-text-primary transition-colors"
          title={comfyLogExpanded ? 'Collapse ComfyUI log' : 'Show ComfyUI activity log'}
        >
          <span className="flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5" />
            ComfyUI log
            {comfyLogLines.length > 0 && (
              <span className="text-[9px] opacity-70">{comfyLogLines.length} lines</span>
            )}
          </span>
          {comfyLogExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
        {comfyLogExpanded && (
          <div className="h-44 overflow-y-auto border-t border-sf-dark-700 bg-black/40 font-mono text-[10px] text-sf-text-secondary">
            {comfyLogLines.length === 0 ? (
              <div className="p-3 text-sf-text-muted">No activity yet. Queue a generation to see ComfyUI events here.</div>
            ) : (
              <div className="p-2 space-y-0.5">
                {comfyLogLines.map((line, i) => (
                  <div key={i} className={`flex gap-2 ${line.type === 'error' ? 'text-sf-error' : ''}`}>
                    <span className="text-sf-text-muted flex-shrink-0">[{line.ts}]</span>
                    <span className="break-all">{line.msg}</span>
                  </div>
                ))}
                <div ref={comfyLogEndRef} />
              </div>
            )}
          </div>
        )}
      </div>

      <ImageAnnotationModal
        isOpen={annotationModalOpen}
        onClose={closeAnnotationModal}
        initialImageUrl={annotationInitialUrl}
        otherImageAssets={assets.filter(a => a.type === 'image')}
        onUseAsRef={handleAnnotationUseAsRef}
      />
      <ConfirmDialog
        isOpen={Boolean(confirmDialog)}
        title={confirmDialog?.title || 'Confirm action'}
        message={confirmDialog?.message || ''}
        confirmLabel={confirmDialog?.confirmLabel || 'Confirm'}
        cancelLabel={confirmDialog?.cancelLabel || 'Cancel'}
        tone={confirmDialog?.tone || 'danger'}
        onConfirm={() => resolveConfirmDialog(true)}
        onCancel={() => resolveConfirmDialog(false)}
      />
    </div>
  )
}

export default GenerateWorkspace
