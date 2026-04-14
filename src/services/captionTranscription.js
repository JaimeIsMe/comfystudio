import { isElectron } from './fileSystem'

export const DEFAULT_CAPTION_MODEL_ID = 'Xenova/whisper-tiny.en'
const CAPTION_SAMPLE_RATE = 16000
const DEFAULT_GAP_BREAK_S = 0.55
const DEFAULT_MAX_WORDS_PER_CUE = 6
const DEFAULT_MAX_CUE_DURATION_S = 2.8
const DEFAULT_MAX_CHARACTERS_PER_CUE = 42

function normalizeWordText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeWordChunks(chunks = []) {
  return (Array.isArray(chunks) ? chunks : [])
    .map((chunk, index) => {
      const [rawStart, rawEnd] = Array.isArray(chunk?.timestamp) ? chunk.timestamp : [null, null]
      const start = Number(rawStart)
      const end = Number(rawEnd)
      const text = normalizeWordText(chunk?.text)
      if (!text || !Number.isFinite(start)) return null
      return {
        id: `word-${index + 1}`,
        text,
        start,
        end: Number.isFinite(end) && end > start ? end : start + 0.28,
      }
    })
    .filter(Boolean)
}

function finalizeCue(words, cues) {
  if (!Array.isArray(words) || words.length === 0) return

  const text = words.map((word) => word.text).join(' ').replace(/\s+([,.;!?])/g, '$1').trim()
  if (!text) return

  const start = words[0].start
  const rawEnd = words[words.length - 1].end
  const end = rawEnd > start ? rawEnd : start + 0.4

  cues.push({
    id: `cue-${cues.length + 1}`,
    start,
    end,
    text,
    words: words.map((word) => ({ ...word })),
  })
}

export function buildCaptionCues(words = []) {
  const normalizedWords = normalizeWordChunks(words)
  if (normalizedWords.length === 0) return []

  const cues = []
  let currentWords = []

  normalizedWords.forEach((word, index) => {
    const previousWord = currentWords[currentWords.length - 1] || null
    const gap = previousWord ? Math.max(0, word.start - previousWord.end) : 0

    if (previousWord && gap >= DEFAULT_GAP_BREAK_S) {
      finalizeCue(currentWords, cues)
      currentWords = []
    }

    currentWords.push(word)

    const currentText = currentWords
      .map((entry) => entry.text)
      .join(' ')
      .replace(/\s+([,.;!?])/g, '$1')
      .trim()

    const currentDuration = currentWords[currentWords.length - 1].end - currentWords[0].start
    const shouldBreakOnPunctuation = /[.!?]$/.test(word.text)
    const shouldBreakOnSize = currentWords.length >= DEFAULT_MAX_WORDS_PER_CUE
      || currentDuration >= DEFAULT_MAX_CUE_DURATION_S
      || currentText.length >= DEFAULT_MAX_CHARACTERS_PER_CUE

    if (shouldBreakOnPunctuation || shouldBreakOnSize || index === normalizedWords.length - 1) {
      finalizeCue(currentWords, cues)
      currentWords = []
    }
  })

  return cues.map((cue, index, list) => {
    const nextCue = list[index + 1]
    const end = nextCue ? Math.min(cue.end, nextCue.start) : cue.end
    return {
      ...cue,
      end: end > cue.start ? end : cue.end,
    }
  })
}

function buildSegmentCues(chunks = []) {
  const rawSegments = (Array.isArray(chunks) ? chunks : [])
    .map((chunk) => {
      const [rawStart, rawEnd] = Array.isArray(chunk?.timestamp) ? chunk.timestamp : [null, null]
      const start = Number(rawStart)
      const end = Number(rawEnd)
      const text = normalizeWordText(chunk?.text)
      if (!text) return null
      return {
        start: Number.isFinite(start) ? start : null,
        end: Number.isFinite(end) && end > start ? end : null,
        text,
      }
    })
    .filter(Boolean)

  if (rawSegments.length === 0) return []

  const cues = []
  for (const segment of rawSegments) {
    const segmentWords = segment.text.split(/\s+/).filter(Boolean)
    if (segmentWords.length === 0) continue

    const segStart = segment.start ?? (cues.length > 0 ? cues[cues.length - 1].end : 0)
    const segEnd = segment.end ?? segStart + Math.max(1, segmentWords.length * 0.3)
    const segDuration = Math.max(0.4, segEnd - segStart)

    let wordIndex = 0
    let currentCueWords = []

    for (let i = 0; i < segmentWords.length; i++) {
      currentCueWords.push(segmentWords[i])

      const currentText = currentCueWords.join(' ')
      const atPunctuation = /[.!?]$/.test(segmentWords[i])
      const atSizeLimit = currentCueWords.length >= DEFAULT_MAX_WORDS_PER_CUE
        || currentText.length >= DEFAULT_MAX_CHARACTERS_PER_CUE
      const isLast = i === segmentWords.length - 1

      if (atPunctuation || atSizeLimit || isLast) {
        const cueStartFraction = wordIndex / segmentWords.length
        const cueEndFraction = (i + 1) / segmentWords.length
        const cueStart = segStart + segDuration * cueStartFraction
        const cueEnd = segStart + segDuration * cueEndFraction

        cues.push({
          id: `cue-${cues.length + 1}`,
          start: Math.round(cueStart * 100) / 100,
          end: Math.round(cueEnd * 100) / 100,
          text: currentText,
          words: [],
        })

        wordIndex = i + 1
        currentCueWords = []
      }
    }
  }

  return cues
}

function getCueWordWeight(cue) {
  const wordCount = String(cue?.text || '').trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, wordCount)
}

function hasCollapsedCueTiming(cues = [], audioDuration = 0) {
  if (!Array.isArray(cues) || cues.length <= 1) return false

  const roundedStarts = new Set(cues.map((cue) => Math.round((Number(cue?.start) || 0) * 100)))
  const roundedEnds = new Set(cues.map((cue) => Math.round((Number(cue?.end) || 0) * 100)))
  const maxEnd = Math.max(...cues.map((cue) => Number(cue?.end) || 0), 0)
  const safeDuration = Number(audioDuration) || 0

  if (roundedStarts.size <= 1 && roundedEnds.size <= 2) return true
  if (safeDuration > 1 && maxEnd < Math.min(1, safeDuration * 0.25)) return true
  return false
}

function distributeCueTimings(cues = [], audioDuration = 0) {
  if (!Array.isArray(cues) || cues.length === 0) return []

  const safeDuration = Math.max(0.4, Number(audioDuration) || 0.4)
  const weights = cues.map(getCueWordWeight)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || cues.length

  let consumedWeight = 0
  return cues.map((cue, index) => {
    const start = safeDuration * (consumedWeight / totalWeight)
    consumedWeight += weights[index]
    const rawEnd = safeDuration * (consumedWeight / totalWeight)
    const minEnd = start + Math.min(0.08, safeDuration / Math.max(cues.length, 1))
    const end = index === cues.length - 1
      ? safeDuration
      : Math.max(minEnd, rawEnd)

    return {
      ...cue,
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
    }
  })
}

function createFallbackCue(text, duration) {
  const safeText = normalizeWordText(text)
  if (!safeText) return []
  const safeDuration = Math.max(0.4, Number(duration) || 2)
  return [{
    id: 'cue-1',
    start: 0,
    end: safeDuration,
    text: safeText,
    words: [],
  }]
}

export async function transcribeAssetToCaptionDraft(asset, {
  signal,
  onProgress,
} = {}) {
  if (!asset) {
    throw new Error('A source video is required to generate captions.')
  }

  if (!isElectron() || !window?.electronAPI?.extractCaptionAudio || !window?.electronAPI?.transcribeCaptionAudio) {
    throw new Error('Local caption transcription currently requires the desktop app.')
  }

  const mediaInput = asset.absolutePath || asset.url || asset.path
  if (!mediaInput) {
    throw new Error('The selected video is missing a local file path.')
  }

  if (signal?.aborted) {
    throw new Error('Caption transcription cancelled.')
  }

  if (typeof onProgress === 'function') {
    onProgress({ stage: 'extract', message: 'Extracting audio for local transcription...' })
  }

  let extraction
  try {
    extraction = await window.electronAPI.extractCaptionAudio({
      mediaInput,
      sampleRate: CAPTION_SAMPLE_RATE,
    })
  } catch (error) {
    const message = String(error?.message || '')
    if (message.includes("No handler registered for")) {
      throw new Error('The Electron app needs a restart to register caption IPC handlers. Close the app and run it again, then retry.')
    }
    throw error
  }

  if (!extraction?.success || !extraction?.outputPath) {
    throw new Error(extraction?.error || 'Could not prepare audio for caption transcription.')
  }

  let unsubscribeProgress = null
  try {
    if (signal?.aborted) throw new Error('Caption transcription cancelled.')

    if (typeof onProgress === 'function' && window.electronAPI.onCaptionProgress) {
      unsubscribeProgress = window.electronAPI.onCaptionProgress((data) => {
        onProgress(data)
      })
    }

    const result = await window.electronAPI.transcribeCaptionAudio({
      wavPath: extraction.outputPath,
    })

    if (!result?.success) {
      throw new Error(result?.error || 'Caption transcription failed in the main process.')
    }

    const timestampMode = result?.timestampMode || 'word'
    let words = []
    let cues = []

    if (timestampMode === 'word') {
      words = normalizeWordChunks(result?.chunks)
      cues = words.length > 0
        ? buildCaptionCues(words)
        : createFallbackCue(result?.text, asset.duration || asset.settings?.duration)
    } else {
      cues = buildSegmentCues(result?.chunks)
      if (cues.length === 0) {
        cues = createFallbackCue(result?.text, asset.duration || asset.settings?.duration)
      }
    }

    const audioDuration = Number(result?.audioDuration)
      || Number(asset.duration)
      || Number(asset.settings?.duration)
      || null

    if (hasCollapsedCueTiming(cues, audioDuration)) {
      cues = distributeCueTimings(cues, audioDuration)
    }

    return {
      modelId: DEFAULT_CAPTION_MODEL_ID,
      transcriptText: normalizeWordText(result?.text || cues.map((cue) => cue.text).join(' ')),
      words,
      cues,
      audioDuration,
    }
  } finally {
    if (typeof unsubscribeProgress === 'function') {
      try { unsubscribeProgress() } catch (_) {}
    }
    try {
      await window.electronAPI.deleteFile(extraction.outputPath)
    } catch (_) {}
  }
}
