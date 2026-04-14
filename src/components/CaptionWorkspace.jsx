import { useEffect, useMemo, useState } from 'react'
import { Film, Loader2, RefreshCw, Sparkles, Type, Wand2, X } from 'lucide-react'
import {
  CAPTION_PRESETS,
  DEFAULT_CAPTION_PRESET_ID,
  getCaptionPresetById,
} from '../config/captionPresets'
import { isElectron, writeGeneratedOverlayToProject } from '../services/fileSystem'
import {
  buildCaptionAssetName,
  ensureCaptionsFolder,
  loadCaptionSidecar,
  saveCaptionSidecar,
} from '../services/captionProject'
import { transcribeWithComfyUI } from '../services/captionComfyTranscription'
import {
  generateCaptionVideoBlob,
  renderCaptionPresetPreviewDataUrl,
} from '../utils/captionRenderer'

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
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

const VALID_VERTICAL_PLACEMENTS = new Set(CUE_VERTICAL_OPTIONS.map((option) => option.id))
const VALID_HORIZONTAL_PLACEMENTS = new Set(CUE_HORIZONTAL_OPTIONS.map((option) => option.id))
const VALID_MOTION_PROFILES = new Set(CUE_MOTION_OPTIONS.map((option) => option.id))

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

function createEmptyDraft(asset) {
  return {
    modelId: null,
    transcriptText: '',
    words: [],
    cues: [],
    audioDuration: Number(asset?.duration) || Number(asset?.settings?.duration) || null,
  }
}

function CaptionWorkspace({
  isOpen,
  asset,
  currentProjectHandle,
  timelineSize,
  folders,
  addFolder,
  addAsset,
  updateAsset,
  onPlaceOnTimeline,
  onClose,
}) {
  const [selectedPresetId, setSelectedPresetId] = useState(DEFAULT_CAPTION_PRESET_ID)
  const [draft, setDraft] = useState(() => createEmptyDraft(asset))
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [placeOnTimeline, setPlaceOnTimeline] = useState(true)
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState('')

  const [globalVertical, setGlobalVertical] = useState('auto')
  const [globalHorizontal, setGlobalHorizontal] = useState('auto')
  const [globalMotion, setGlobalMotion] = useState('auto')
  const [globalSize, setGlobalSize] = useState('normal')

  const [subtitleColor, setSubtitleColor] = useState('#FFFFFF')
  const [subtitlePosition, setSubtitlePosition] = useState('action-safe')
  const [subtitleTextStyle, setSubtitleTextStyle] = useState('background')
  const [subtitleSize, setSubtitleSize] = useState('medium')

  const GLOBAL_SIZE_OPTIONS = useMemo(() => [
    { id: 'small', label: 'Small' },
    { id: 'normal', label: 'Normal' },
    { id: 'large', label: 'Large' },
  ], [])

  const SUBTITLE_COLOR_OPTIONS = useMemo(() => [
    { id: '#FFFFFF', label: 'White', swatch: '#FFFFFF' },
    { id: '#FBBF24', label: 'Yellow', swatch: '#FBBF24' },
    { id: '#22D3EE', label: 'Cyan', swatch: '#22D3EE' },
    { id: '#4ADE80', label: 'Green', swatch: '#4ADE80' },
    { id: '#D1D5DB', label: 'Gray', swatch: '#D1D5DB' },
    { id: '#FB923C', label: 'Orange', swatch: '#FB923C' },
  ], [])

  const SUBTITLE_POSITION_OPTIONS = useMemo(() => [
    { id: 'action-safe', label: 'Action Safe' },
    { id: 'title-safe', label: 'Title Safe' },
    { id: 'center', label: 'Center' },
  ], [])

  const SUBTITLE_TEXT_STYLE_OPTIONS = useMemo(() => [
    { id: 'background', label: 'Background' },
    { id: 'outline', label: 'Outline' },
    { id: 'shadow', label: 'Shadow' },
    { id: 'plain', label: 'Plain' },
  ], [])

  const SUBTITLE_SIZE_OPTIONS = useMemo(() => [
    { id: 'small', label: 'Small' },
    { id: 'medium', label: 'Medium' },
    { id: 'large', label: 'Large' },
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

  const renderSettings = useMemo(() => ({
    width: Math.max(320, Math.round(Number(timelineSize?.width) || 1920)),
    height: Math.max(180, Math.round(Number(timelineSize?.height) || 1080)),
    fps: Math.max(12, Math.round(Number(timelineSize?.fps) || Number(asset?.fps) || 24)),
  }), [asset?.fps, timelineSize])

  useEffect(() => {
    if (!isOpen || !asset) return

    let cancelled = false
    setError('')
    setStatusMessage('Transcribe audio locally to begin.')
    setPlaceOnTimeline(true)
    setSelectedPresetId(asset?.settings?.lastCaptionPresetId || DEFAULT_CAPTION_PRESET_ID)
    setDraft(createEmptyDraft(asset))

    const transcriptPath = asset?.settings?.captionTranscriptPath
    if (!currentProjectHandle || !transcriptPath) return undefined

    ;(async () => {
      try {
        const existingDraft = await loadCaptionSidecar(currentProjectHandle, transcriptPath)
        if (!existingDraft || cancelled) return

        setDraft({
          modelId: existingDraft.modelId || null,
          transcriptText: String(existingDraft.transcriptText || ''),
          words: Array.isArray(existingDraft.words) ? existingDraft.words : [],
          cues: normalizeCueOrder(existingDraft.cues, existingDraft.audioDuration || asset?.duration),
          audioDuration: existingDraft.audioDuration || Number(asset?.duration) || null,
        })
        setSelectedPresetId(existingDraft.presetId || asset?.settings?.lastCaptionPresetId || DEFAULT_CAPTION_PRESET_ID)
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
  }, [asset, currentProjectHandle, isOpen])

  if (!isOpen || !asset) return null

  const busy = isTranscribing || isGenerating
  const cueDuration = getDraftDuration(draft, asset)
  const canTranscribe = asset.type === 'video' && asset.hasAudio !== false && !busy
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

  const handleTranscribe = async () => {
    setError('')
    setIsTranscribing(true)
    try {
      setStatusMessage('Connecting to ComfyUI for Qwen3-ASR transcription...')
      const nextDraft = await transcribeWithComfyUI(asset, {
        onProgress: (progress) => {
          setStatusMessage(progress?.message || 'Transcribing with Qwen3-ASR...')
        },
      })

      setDraft({
        ...nextDraft,
        cues: normalizeCueOrder(nextDraft.cues, nextDraft.audioDuration || asset?.duration),
      })

      setStatusMessage(`Transcribed ${nextDraft.cues.length} caption cues via Qwen3-ASR (ComfyUI).`)
    } catch (transcriptionError) {
      setError(transcriptionError?.message || 'Could not transcribe this video. Make sure ComfyUI is running with the Subtitle (QwenASR) node installed.')
    } finally {
      setIsTranscribing(false)
    }
  }

  const handleGenerate = async () => {
    if (!canGenerate) return
    if (!currentProjectHandle || typeof currentProjectHandle !== 'string') {
      setError('Open a desktop project before generating captions.')
      return
    }

    setError('')
    setIsGenerating(true)

    try {
      const normalizedCues = normalizeCueOrder(draft.cues, cueDuration)
      const timestamp = new Date().toISOString()
      const sidecarPayload = {
        version: 1,
        sourceAssetId: asset.id,
        sourceAssetName: asset.name,
        sourceAssetPath: asset.path || null,
        presetId: selectedPreset.id,
        modelId: draft.modelId,
        transcriptText: cuesToTranscript(normalizedCues),
        words: draft.words,
        cues: normalizedCues,
        audioDuration: draft.audioDuration || cueDuration,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      setStatusMessage('Saving editable caption draft...')
      const sidecar = await saveCaptionSidecar(currentProjectHandle, asset, sidecarPayload)

      if (typeof updateAsset === 'function') {
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
          verticalPlacement: globalVertical,
          horizontalPlacement: globalHorizontal,
          motionProfile: globalMotion,
          sizeProfile: globalSize,
          subtitleColor,
          subtitlePosition,
          subtitleTextStyle,
          subtitleSize,
        },
      }))
      const overlayBlob = await generateCaptionVideoBlob({
        preset: selectedPreset,
        cues: renderCues,
        width: renderSettings.width,
        height: renderSettings.height,
        duration: cueDuration,
        fps: renderSettings.fps,
      })

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
        sourceAssetId: asset.id,
        captionPresetId: selectedPreset.id,
        captionTranscriptPath: sidecar.path,
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

      if (typeof updateAsset === 'function' && createdAsset?.id) {
        updateAsset(asset.id, {
          settings: {
            ...(asset.settings || {}),
            captionTranscriptPath: sidecar.path,
            lastCaptionPresetId: selectedPreset.id,
            lastCaptionAssetId: createdAsset.id,
            lastCaptionUpdatedAt: timestamp,
          },
        })
      }

      if (placeOnTimeline && typeof onPlaceOnTimeline === 'function' && createdAsset) {
        await onPlaceOnTimeline(createdAsset, asset)
      }

      setStatusMessage('Caption overlay added to assets.')
      onClose?.()
    } catch (generationError) {
      setError(generationError?.message || 'Could not generate animated captions.')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-7xl max-h-[92vh] overflow-hidden rounded-2xl border border-sf-dark-700 bg-sf-dark-950 shadow-[0_30px_60px_rgba(0,0,0,0.35)]">
        <div className="flex items-center justify-between border-b border-sf-dark-700 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-sf-text-primary">
              <Type className="w-4 h-4 text-sf-accent" />
              Add Captions
            </div>
            <div className="text-xs text-sf-text-muted mt-1">
              {asset.name} · local-first transcription and animated overlay export
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

        <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_1fr] gap-0 max-h-[calc(92vh-72px)]">
          <div className="border-r border-sf-dark-700 p-5 overflow-y-auto space-y-5">
            <section className="rounded-2xl border border-sf-dark-700 bg-sf-dark-900/60 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-sf-text-primary">
                    <Film className="w-4 h-4 text-sf-blue" />
                    Source Video
                  </div>
                  <div className="text-xs text-sf-text-muted mt-1">
                    Select a preset, edit the cues, then save a transparent caption overlay.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleTranscribe}
                  disabled={!canTranscribe}
                  className="inline-flex items-center gap-2 rounded-lg bg-sf-accent px-3 py-2 text-xs font-medium text-white hover:bg-sf-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isTranscribing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Wand2 className="w-4 h-4" />
                  )}
                  {draft.cues.length > 0 ? 'Re-transcribe' : 'Transcribe audio'}
                </button>
              </div>
              <div className="aspect-video rounded-xl overflow-hidden bg-black border border-sf-dark-700">
                {asset.url ? (
                  <video
                    src={asset.url}
                    controls
                    className="w-full h-full object-contain bg-black"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-sm text-sf-text-muted">
                    Preview unavailable for this asset.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-sf-dark-700 bg-sf-dark-900/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-sf-text-primary mb-3">
                <Sparkles className="w-4 h-4 text-sf-accent" />
                Style Presets
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-h-[320px] overflow-y-auto pr-1">
                {CAPTION_PRESETS.map((preset) => {
                  const selected = preset.id === selectedPresetId
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setSelectedPresetId(preset.id)}
                      className={`rounded-2xl border overflow-hidden text-left transition-colors ${
                        selected
                          ? 'border-sf-accent bg-sf-dark-800'
                          : 'border-sf-dark-700 bg-sf-dark-900 hover:border-sf-dark-500'
                      }`}
                    >
                      <div className="aspect-[16/9] bg-sf-dark-950">
                        {previewUrls[preset.id] ? (
                          <img
                            src={previewUrls[preset.id]}
                            alt={preset.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-sf-text-muted">
                            {preset.name}
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="text-sm font-medium text-sf-text-primary">{preset.name}</div>
                        <div className="text-xs text-sf-text-muted mt-1">{preset.description}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          </div>

          <div className="flex flex-col max-h-[calc(92vh-72px)]">
          <div className="p-5 overflow-y-auto flex-1 space-y-5">
            <section className="rounded-2xl border border-sf-dark-700 bg-sf-dark-900/60 p-4 space-y-3">
              <div>
                <div className="text-sm font-medium text-sf-text-primary">Global Style</div>
                <div className="text-xs text-sf-text-muted mt-1">
                  {selectedPreset?.traditional
                    ? 'Configure subtitle appearance for all cues.'
                    : 'Set defaults for all cues. Per-cue overrides take priority.'}
                </div>
              </div>

              {selectedPreset?.traditional ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">
                      Text Color
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {SUBTITLE_COLOR_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setSubtitleColor(option.id)}
                          className={`w-7 h-7 rounded-full border-2 transition-colors ${
                            subtitleColor === option.id
                              ? 'border-sf-accent scale-110'
                              : 'border-sf-dark-600 hover:border-sf-dark-400'
                          }`}
                          style={{ backgroundColor: option.swatch }}
                          title={option.label}
                        />
                      ))}
                    </div>
                  </div>
                  <CueOverrideChips
                    label="Position"
                    value={subtitlePosition}
                    options={SUBTITLE_POSITION_OPTIONS}
                    onChange={setSubtitlePosition}
                  />
                  <CueOverrideChips
                    label="Text Style"
                    value={subtitleTextStyle}
                    options={SUBTITLE_TEXT_STYLE_OPTIONS}
                    onChange={setSubtitleTextStyle}
                  />
                  <CueOverrideChips
                    label="Size"
                    value={subtitleSize}
                    options={SUBTITLE_SIZE_OPTIONS}
                    onChange={setSubtitleSize}
                  />
                </div>
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
                  <CueOverrideChips
                    label="Size"
                    value={globalSize}
                    options={GLOBAL_SIZE_OPTIONS}
                    onChange={setGlobalSize}
                  />
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-sf-dark-700 bg-sf-dark-900/60 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="text-sm font-medium text-sf-text-primary">Caption Cues</div>
                  <div className="text-xs text-sf-text-muted mt-1">
                    Adjust the transcribed text and timing before rendering.
                  </div>
                </div>
                <div className="text-[11px] text-sf-text-muted">
                  {draft.cues.length} cues · {cueDuration.toFixed(2)}s
                </div>
              </div>

              {draft.cues.length === 0 ? (
                <div className="rounded-xl border border-dashed border-sf-dark-600 bg-sf-dark-950/70 px-4 py-8 text-center">
                  <div className="text-sm text-sf-text-primary">No caption cues yet.</div>
                  <div className="text-xs text-sf-text-muted mt-2">
                    Run local transcription to generate editable caption phrases from the video audio.
                  </div>
                </div>
              ) : (
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {draft.cues.map((cue) => (
                    <div
                      key={cue.id}
                      className="rounded-xl border border-sf-dark-700 bg-sf-dark-950/70 p-3 space-y-3"
                    >
                      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                        <label className="text-[11px] text-sf-text-muted">
                          Start
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={cue.start}
                            onChange={(e) => updateCue(cue.id, 'start', e.target.value)}
                            className="mt-1 w-full rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                          />
                        </label>
                        <label className="text-[11px] text-sf-text-muted">
                          End
                          <input
                            type="number"
                            step="0.01"
                            min={cue.start + 0.1}
                            value={cue.end}
                            onChange={(e) => updateCue(cue.id, 'end', e.target.value)}
                            className="mt-1 w-full rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => removeCue(cue.id)}
                          className="mt-5 rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-2.5 py-1.5 text-[11px] text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-800"
                        >
                          Remove
                        </button>
                      </div>
                      <textarea
                        value={cue.text}
                        onChange={(e) => updateCue(cue.id, 'text', e.target.value)}
                        className="w-full h-20 rounded-xl border border-sf-dark-600 bg-sf-dark-900 px-3 py-2 text-sm text-sf-text-primary resize-none focus:outline-none focus:border-sf-accent"
                      />
                      <div className="grid grid-cols-1 gap-2">
                        <CueOverrideChips
                          label="Vertical"
                          value={cue.override?.verticalPlacement || 'auto'}
                          options={CUE_VERTICAL_OPTIONS}
                          onChange={(nextValue) => updateCueOverride(cue.id, 'verticalPlacement', nextValue)}
                        />
                        <CueOverrideChips
                          label="Horizontal"
                          value={cue.override?.horizontalPlacement || 'auto'}
                          options={CUE_HORIZONTAL_OPTIONS}
                          onChange={(nextValue) => updateCueOverride(cue.id, 'horizontalPlacement', nextValue)}
                        />
                        <CueOverrideChips
                          label="Motion"
                          value={cue.override?.motionProfile || 'auto'}
                          options={CUE_MOTION_OPTIONS}
                          onChange={(nextValue) => updateCueOverride(cue.id, 'motionProfile', nextValue)}
                        />
                      </div>
                      <div className="text-[11px] text-sf-text-muted">
                        {formatSeconds(cue.start)} → {formatSeconds(cue.end)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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

          <div className="flex-shrink-0 border-t border-sf-dark-700 px-5 py-4 flex items-center justify-between gap-3">
            {(statusMessage || error) ? (
              <div className="flex items-center gap-2 text-xs min-w-0 flex-1 overflow-hidden">
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 flex-shrink-0 text-sf-accent animate-spin" />
                ) : error ? (
                  <X className="w-3.5 h-3.5 flex-shrink-0 text-sf-error" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 flex-shrink-0 text-sf-success" />
                )}
                <span className={`truncate ${error ? 'text-sf-error' : 'text-sf-text-muted'}`}>
                  {error || statusMessage}
                </span>
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
                className="inline-flex items-center gap-2 rounded-xl bg-sf-accent px-4 py-2 text-sm font-medium text-white hover:bg-sf-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                Generate 1 video with captions
              </button>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CaptionWorkspace
