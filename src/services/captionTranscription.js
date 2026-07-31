// Caption transcription seam — the one entry point for "audio in, cues out".
//
// Two backends implement the same contract:
//   'local'   — whisper.cpp in the main process (no ComfyUI needed)
//   'comfyui' — the original Qwen3-ASR workflow
// 'auto' prefers the local engine when it's installed and falls back to
// ComfyUI otherwise, which keeps behavior identical for existing users until
// they install the local engine. Callers (CaptionWorkspace, GenerateWorkspace,
// mcpCaptions) import from here, never from a backend directly.

import {
  transcribeWithComfyUI,
  transcribeTimeline,
  formatCaptionCuesAsSrt,
  parseCaptionSubtitles,
} from './captionComfyTranscription'
import {
  isLocalCaptionEngineAvailable,
  transcribeAssetLocally,
  transcribeTimelineLocally,
  getLocalCaptionEngineStatus,
  installLocalCaptionEngine,
} from './captionLocalTranscription'

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

/** Resolve which backend a transcription will actually use right now. */
export async function resolveCaptionEngine() {
  const preference = getCaptionEnginePreference()
  if (preference === 'local' || preference === 'comfyui') return preference
  return (await isLocalCaptionEngineAvailable()) ? 'local' : 'comfyui'
}

/** Transcribe a single source asset. Options pass through to the backend. */
export async function transcribeAsset(asset, options = {}) {
  const engine = ENGINE_VALUES.includes(options.engine) && options.engine !== 'auto'
    ? options.engine
    : await resolveCaptionEngine()
  return engine === 'local'
    ? transcribeAssetLocally(asset, options)
    : transcribeWithComfyUI(asset, options)
}

/** Transcribe the current timeline's program audio. */
export async function transcribeTimelineAudio(options = {}) {
  const engine = ENGINE_VALUES.includes(options.engine) && options.engine !== 'auto'
    ? options.engine
    : await resolveCaptionEngine()
  return engine === 'local'
    ? transcribeTimelineLocally(options)
    : transcribeTimeline(options)
}

// Backend-neutral helpers and the local-engine management surface, re-exported
// so callers keep a single import site.
export {
  formatCaptionCuesAsSrt,
  parseCaptionSubtitles,
  getLocalCaptionEngineStatus,
  installLocalCaptionEngine,
}
