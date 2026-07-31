// Caption transcription seam — the one entry point for "audio in, cues out".
//
// Two backends implement the same contract:
//   'local'   — whisper.cpp in the main process (no ComfyUI needed)
//   'comfyui' — the Qwen3-ASR workflow, retired from the captions UI
// Whisper is THE caption engine. The ComfyUI backend survives for two callers
// only: the music-video lyric pass (pinned via options.engine until whisper is
// A/B'd on sung vocals) and an undocumented localStorage escape hatch
// ('velorn-caption-engine' = 'comfyui'). Callers (CaptionWorkspace,
// GenerateWorkspace, mcpCaptions) import from here, never from a backend
// directly.

import {
  transcribeWithComfyUI,
  transcribeTimeline,
  formatCaptionCuesAsSrt,
  parseCaptionSubtitles,
} from './captionComfyTranscription'
import {
  transcribeAssetLocally,
  transcribeTimelineLocally,
  getLocalCaptionEngineStatus,
  installLocalCaptionEngine,
  canRemoveLocalCaptionModels,
  removeLocalCaptionModel,
} from './captionLocalTranscription'
import { buildVocabularyHint } from './captionVocabulary'
import { useProjectStore } from '../stores/projectStore'
import { useTimelineStore } from '../stores/timelineStore'

const ENGINE_SETTING_KEY = 'velorn-caption-engine'
const ENGINE_VALUES = ['auto', 'local', 'comfyui']

export function getCaptionEnginePreference() {
  try {
    const value = localStorage.getItem(ENGINE_SETTING_KEY)
    return ENGINE_VALUES.includes(value) ? value : 'auto'
  } catch {
    return 'auto'
  }
}

export function setCaptionEnginePreference(value) {
  if (!ENGINE_VALUES.includes(value)) return
  try {
    localStorage.setItem(ENGINE_SETTING_KEY, value)
  } catch { /* ignore */ }
}

const MODEL_SETTING_KEY = 'velorn-caption-model'
const MODEL_TIER_IDS = ['base', 'small', 'large-v3-turbo']

export function getCaptionModelPreference() {
  try {
    const value = localStorage.getItem(MODEL_SETTING_KEY)
    return MODEL_TIER_IDS.includes(value) ? value : 'base'
  } catch {
    return 'base'
  }
}

export function setCaptionModelPreference(value) {
  if (!MODEL_TIER_IDS.includes(value)) return
  try {
    localStorage.setItem(MODEL_SETTING_KEY, value)
  } catch { /* ignore */ }
}

/**
 * Resolve which backend a transcription will actually use right now.
 * Platforms without a whisper build (macOS until our release CI produces
 * one) fall back to ComfyUI rather than losing captions.
 */
export async function resolveCaptionEngine() {
  if (getCaptionEnginePreference() === 'comfyui') return 'comfyui'
  const status = await getLocalCaptionEngineStatus()
  if (status && status.platformSupported === false) return 'comfyui'
  return 'local'
}

/**
 * Candidate vocabulary strings from the open project, most important first:
 * project name, timeline names, marker labels, on-screen text clips.
 */
export function collectProjectVocabularyParts() {
  const parts = []
  try {
    const project = useProjectStore.getState().currentProject
    if (project?.name) parts.push(project.name)
    for (const timeline of project?.timelines || []) {
      if (timeline?.name) parts.push(timeline.name)
    }
  } catch { /* stores unavailable — the hint is best-effort */ }
  try {
    const state = useTimelineStore.getState()
    for (const marker of Array.isArray(state.markers) ? state.markers : []) {
      if (marker?.label) parts.push(marker.label)
    }
    for (const clip of Array.isArray(state.clips) ? state.clips : []) {
      if (clip?.type === 'text' && clip.text) parts.push(clip.text)
    }
  } catch { /* same */ }
  return parts
}

/**
 * The whisper initial-prompt hint for a transcription: caller vocabulary
 * first (budget priority), then what the project knows about itself. An
 * explicit options.vocabularyHint (including '') skips auto-derivation.
 */
function resolveVocabularyHint(options = {}) {
  if (options.vocabularyHint !== undefined) return options.vocabularyHint
  try {
    return buildVocabularyHint(collectProjectVocabularyParts())
  } catch {
    return ''
  }
}

/** Transcribe a single source asset. Options pass through to the backend. */
export async function transcribeAsset(asset, options = {}) {
  const engine = ENGINE_VALUES.includes(options.engine) && options.engine !== 'auto'
    ? options.engine
    : await resolveCaptionEngine()
  return engine === 'local'
    ? transcribeAssetLocally(asset, {
        modelId: getCaptionModelPreference(),
        ...options,
        vocabularyHint: resolveVocabularyHint(options),
      })
    : transcribeWithComfyUI(asset, options)
}

/** Transcribe the current timeline's program audio. */
export async function transcribeTimelineAudio(options = {}) {
  const engine = ENGINE_VALUES.includes(options.engine) && options.engine !== 'auto'
    ? options.engine
    : await resolveCaptionEngine()
  return engine === 'local'
    ? transcribeTimelineLocally({
        modelId: getCaptionModelPreference(),
        ...options,
        vocabularyHint: resolveVocabularyHint(options),
      })
    : transcribeTimeline(options)
}

// Backend-neutral helpers and the local-engine management surface, re-exported
// so callers keep a single import site.
export {
  formatCaptionCuesAsSrt,
  parseCaptionSubtitles,
  getLocalCaptionEngineStatus,
  installLocalCaptionEngine,
  canRemoveLocalCaptionModels,
  removeLocalCaptionModel,
}
