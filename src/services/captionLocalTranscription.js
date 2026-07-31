// Local caption transcription (whisper.cpp in the Electron main process).
//
// This backend mirrors captionComfyTranscription's return contract exactly:
// { modelId, transcriptText, words, asrLanguage, cues, audioDuration, source }.
// Whisper returns word-granular segments (-ml 1); sentence-level cues are
// grouped here, renderer-side, so the rules stay pure and testable.

import { mixTimelineAudioToWav } from './timelineAudioMix'

// Common picker names → whisper language codes. Anything unrecognized falls
// back to autodetect, and 2–3 letter codes pass through untouched.
const LANGUAGE_NAME_TO_CODE = {
  auto: 'auto',
  english: 'en',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  dutch: 'nl',
  russian: 'ru',
  japanese: 'ja',
  korean: 'ko',
  chinese: 'zh',
  mandarin: 'zh',
  cantonese: 'yue',
  arabic: 'ar',
  hindi: 'hi',
  turkish: 'tr',
  polish: 'pl',
  ukrainian: 'uk',
  vietnamese: 'vi',
  thai: 'th',
  indonesian: 'id',
}

export function mapLanguageToWhisper(language) {
  const raw = String(language || '').trim().toLowerCase()
  if (!raw) return 'auto'
  if (LANGUAGE_NAME_TO_CODE[raw]) return LANGUAGE_NAME_TO_CODE[raw]
  if (/^[a-z]{2,3}$/.test(raw)) return raw
  return 'auto'
}

function round2(value) {
  return Math.round(value * 100) / 100
}

/**
 * Group word-level timings into subtitle-style cues.
 *
 * Break rules, in priority order: sentence-ending punctuation, a silence gap,
 * the character budget of a readable subtitle line, and a hard cue-duration
 * cap. Pure function — exercised directly by tests.
 */
export function groupWordsIntoCues(words, {
  maxChars = 42,
  maxGapSeconds = 0.8,
  maxCueSeconds = 7,
} = {}) {
  const cues = []
  let current = null

  const flush = () => {
    if (!current || current.words.length === 0) return
    const text = current.words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim()
    if (text) {
      cues.push({
        id: `cue-${cues.length + 1}`,
        start: round2(current.start),
        end: round2(Math.max(current.end, current.start + 0.4)),
        text,
        words: [],
      })
    }
    current = null
  }

  for (const word of Array.isArray(words) ? words : []) {
    const text = String(word?.text || '').trim()
    const start = Number(word?.start)
    const end = Number(word?.end)
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue

    if (current) {
      const gap = start - current.end
      const nextLength = current.chars + 1 + text.length
      const nextDuration = end - current.start
      if (gap >= maxGapSeconds || nextLength > maxChars || nextDuration > maxCueSeconds) {
        flush()
      }
    }

    if (!current) {
      current = { start, end, chars: text.length, words: [{ ...word, text }] }
    } else {
      current.words.push({ ...word, text })
      current.chars += 1 + text.length
      current.end = Math.max(current.end, end)
    }

    if (/[.!?…]["')\]]?$/.test(text)) {
      flush()
    }
  }
  flush()

  return cues
}

export async function getLocalCaptionEngineStatus() {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.whisperEngineStatus) {
    return { success: false, available: false, platformSupported: false, reason: 'not-electron' }
  }
  try {
    const status = await api.whisperEngineStatus()
    return status || { success: false, available: false, platformSupported: false }
  } catch (err) {
    return { success: false, available: false, platformSupported: false, reason: String(err?.message || err) }
  }
}

export async function isLocalCaptionEngineAvailable() {
  const status = await getLocalCaptionEngineStatus()
  return Boolean(status?.available)
}

/**
 * Download the whisper binary + chosen model into the app's user-data dir.
 * onProgress receives { phase, message, percent, receivedBytes, totalBytes }.
 */
export async function installLocalCaptionEngine({ modelId = 'base', onProgress } = {}) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.whisperEngineInstall) {
    throw new Error('The local caption engine requires the Velorn desktop app.')
  }
  let unsubscribe = null
  if (typeof onProgress === 'function' && api.onCaptionEngineProgress) {
    unsubscribe = api.onCaptionEngineProgress(onProgress)
  }
  try {
    const result = await api.whisperEngineInstall({ modelId })
    if (!result?.success) {
      throw new Error(result?.error || 'Caption engine install failed.')
    }
    return result
  } finally {
    if (typeof unsubscribe === 'function') unsubscribe()
  }
}

function buildTranscriptionResult({ words, language, audioDuration, modelId, source }) {
  const cues = groupWordsIntoCues(words)
  if (cues.length === 0) {
    throw new Error('No speech was detected in the audio.')
  }
  const transcriptText = words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim()
  return {
    modelId: `whisper.cpp/${modelId}`,
    transcriptText,
    words,
    asrLanguage: language || '',
    cues,
    audioDuration: audioDuration || Math.max(...cues.map((cue) => cue.end), 0) || null,
    source,
  }
}

async function runLocalTranscription({
  inputPath,
  mediaData,
  mediaName,
  alreadyNormalized = false,
  language = 'Auto',
  modelId,
  onProgress,
  progressBase = 0,
  audioDuration = null,
  source,
}) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.whisperTranscribe) {
    throw new Error('The local caption engine requires the Velorn desktop app.')
  }

  const report = (message, progress) => {
    if (typeof onProgress === 'function') {
      onProgress({ stage: 'transcribe', message, progress })
    }
  }

  let unsubscribe = null
  if (api.onCaptionEngineProgress) {
    unsubscribe = api.onCaptionEngineProgress((update) => {
      if (!update) return
      if (update.phase === 'prepare') {
        report('Extracting audio…', progressBase)
      } else if (update.phase === 'transcribe' && Number.isFinite(Number(update.percent))) {
        const pct = Number(update.percent)
        report(`Transcribing locally… (${pct}%)`, progressBase + ((100 - progressBase) * pct) / 100)
      }
    })
  }

  try {
    report('Transcribing locally…', progressBase)
    const result = await api.whisperTranscribe({
      inputPath,
      mediaData,
      mediaName,
      alreadyNormalized,
      language: mapLanguageToWhisper(language),
      modelId,
    })
    if (!result?.success) {
      throw new Error(result?.error || 'Local transcription failed.')
    }
    const words = (Array.isArray(result.words) ? result.words : [])
      .map((w) => ({
        start: Number(w?.start) || 0,
        end: Number(w?.end) || 0,
        text: String(w?.text || '').trim(),
      }))
      .filter((w) => w.text)
    return buildTranscriptionResult({
      words,
      language: result.language,
      audioDuration,
      modelId: result.modelId || modelId || 'base',
      source,
    })
  } finally {
    if (typeof unsubscribe === 'function') unsubscribe()
  }
}

/** Transcribe a single asset (video or audio) with the local engine. */
export async function transcribeAssetLocally(asset, { onProgress, language = 'Auto', modelId } = {}) {
  if (!asset) {
    throw new Error('A source audio or video asset is required to generate captions.')
  }

  let inputPath = null
  let mediaData = null
  let mediaName = null

  if (asset.absolutePath) {
    inputPath = asset.absolutePath
  } else if (asset.url) {
    // Blob/object URLs (not-yet-saved assets): pull the bytes and hand them to
    // the main process, which writes a temp file for FFmpeg.
    const response = await fetch(asset.url)
    if (!response.ok) {
      throw new Error('Could not read the source media for transcription.')
    }
    const buffer = await response.arrayBuffer()
    mediaData = new Uint8Array(buffer)
    mediaName = String(asset.name || 'caption-source.bin')
  } else {
    throw new Error('The source asset has no readable media path.')
  }

  const audioDuration = Number(asset.duration)
    || Number(asset.settings?.duration)
    || null

  return runLocalTranscription({
    inputPath,
    mediaData,
    mediaName,
    language,
    modelId,
    onProgress,
    audioDuration,
    source: 'local',
  })
}

/**
 * Transcribe the current timeline's program audio with the local engine.
 * Reuses the same pre-mixed WAV pipeline as the ComfyUI path, so cue timings
 * come back in timeline time. Unlike that path, word timings survive here.
 */
export async function transcribeTimelineLocally({ onProgress, modelId } = {}) {
  const report = (stage, message, progress) => {
    if (typeof onProgress === 'function') onProgress({ stage, message, progress })
  }

  report('mix', 'Mixing timeline audio…', 2)
  const mix = await mixTimelineAudioToWav({
    onProgress: (status, pct) => report('mix', status, Math.round((pct || 0) * 0.4)),
  })

  const wavBuffer = await mix.blob.arrayBuffer()

  return runLocalTranscription({
    mediaData: new Uint8Array(wavBuffer),
    mediaName: 'timeline.wav',
    alreadyNormalized: true,
    modelId,
    onProgress,
    progressBase: 40,
    audioDuration: mix.duration,
    source: 'local-timeline',
  })
}
