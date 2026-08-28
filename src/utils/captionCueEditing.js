const DEFAULT_MIN_SPLIT_DURATION = 0.2
const DEFAULT_NEW_CUE_DURATION = 1.5
const DEFAULT_MIN_NEW_CUE_DURATION = 0.4
const TIME_EPSILON = 0.001
const NUMBER_EPSILON = 1e-9

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string' && !value.trim()) return fallback
  if (typeof value !== 'number' && typeof value !== 'string') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function roundTime(value) {
  return Math.round(Number(value) * 1000) / 1000
}

function cueIds(cues) {
  return new Set((Array.isArray(cues) ? cues : []).map((cue) => String(cue?.id || '')).filter(Boolean))
}

export function createCaptionCueId(cues = [], idFactory = null) {
  const existing = cueIds(cues)
  let root = ''

  if (typeof idFactory === 'function') {
    root = String(idFactory() || '').trim()
  } else if (typeof globalThis.crypto?.randomUUID === 'function') {
    root = `cue-${globalThis.crypto.randomUUID()}`
  } else {
    root = `cue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  if (!root) root = `cue-${Date.now().toString(36)}`
  let candidate = root
  let suffix = 2
  while (existing.has(candidate)) {
    candidate = `${root}-${suffix}`
    suffix += 1
  }
  return candidate
}

export function buildCaptionTranscript(cues = []) {
  return (Array.isArray(cues) ? cues : [])
    .map((cue) => String(cue?.text || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function resolveCaptionMediaDuration(...values) {
  const durations = values
    .map((value) => finiteNumber(value))
    .filter((value) => value !== null && value > 0)
  return durations.length ? Math.max(...durations) : null
}

function partitionCueWords(words, leftText) {
  if (!Array.isArray(words) || words.length === 0) return [[], []]
  const leftWordCount = String(leftText || '').trim().split(/\s+/).filter(Boolean).length
  const splitIndex = Math.max(0, Math.min(words.length, leftWordCount))
  return [
    words.slice(0, splitIndex).map((word) => ({ ...word })),
    words.slice(splitIndex).map((word) => ({ ...word })),
  ]
}

export function splitCaptionCueAtCaret(cues = [], cueId, caretOffset, {
  minDuration = DEFAULT_MIN_SPLIT_DURATION,
  idFactory = null,
} = {}) {
  const sourceCues = Array.isArray(cues) ? cues : []
  const cueIndex = sourceCues.findIndex((cue) => cue?.id === cueId)
  if (cueIndex < 0) throw new Error('Select a caption cue to split.')

  const cue = sourceCues[cueIndex]
  const text = String(cue?.text || '')
  const splitIndex = Math.max(0, Math.min(
    text.length,
    Math.round(finiteNumber(caretOffset, text.length / 2))
  ))

  const leftText = text.slice(0, splitIndex).trim()
  const rightText = text.slice(splitIndex).trim()
  if (!leftText || !rightText) {
    throw new Error('Place the text cursor inside the caption so there is text on both sides.')
  }

  const start = finiteNumber(cue?.start, 0)
  const end = finiteNumber(cue?.end, start)
  const safeMinimum = Math.max(0.01, finiteNumber(minDuration, DEFAULT_MIN_SPLIT_DURATION))
  const duration = end - start
  if (duration + NUMBER_EPSILON < safeMinimum * 2) {
    throw new Error(`This caption is too short to split. It needs at least ${(safeMinimum * 2).toFixed(1)} seconds.`)
  }

  const textLength = leftText.length + rightText.length
  const ratio = textLength > 0 ? leftText.length / textLength : 0.5
  const rawSplitTime = start + duration * ratio
  const roundedSplitTime = roundTime(Math.max(start + safeMinimum, Math.min(end - safeMinimum, rawSplitTime)))
  const splitTime = Math.max(start + safeMinimum, Math.min(end - safeMinimum, roundedSplitTime))
  const [leftWords, rightWords] = partitionCueWords(cue?.words, leftText)
  const rightId = createCaptionCueId(sourceCues, idFactory)

  const leftCue = {
    ...cue,
    text: leftText,
    end: splitTime,
    ...(Array.isArray(cue?.words) ? { words: leftWords } : {}),
    ...(cue?.override ? { override: { ...cue.override } } : {}),
  }
  const rightCue = {
    ...cue,
    id: rightId,
    start: splitTime,
    end,
    text: rightText,
    ...(Array.isArray(cue?.words) ? { words: rightWords } : {}),
    ...(cue?.override ? { override: { ...cue.override } } : {}),
  }

  return {
    cues: [
      ...sourceCues.slice(0, cueIndex),
      leftCue,
      rightCue,
      ...sourceCues.slice(cueIndex + 1),
    ],
    cue: rightCue,
    leftCue,
    rightCue,
    index: cueIndex + 1,
    splitIndex,
    splitTime,
  }
}

export function addCaptionCue(cues = [], {
  atTime = null,
  audioDuration = null,
  defaultDuration = DEFAULT_NEW_CUE_DURATION,
  minDuration = DEFAULT_MIN_NEW_CUE_DURATION,
  idFactory = null,
} = {}) {
  const sourceCues = (Array.isArray(cues) ? cues : [])
    .map((cue) => ({ ...cue }))
    .sort((a, b) => (finiteNumber(a?.start, 0) - finiteNumber(b?.start, 0)))
  const safeMinimum = Math.max(0.01, finiteNumber(minDuration, DEFAULT_MIN_NEW_CUE_DURATION))
  const safeDefault = Math.max(safeMinimum, finiteNumber(defaultDuration, DEFAULT_NEW_CUE_DURATION))
  const knownDuration = finiteNumber(audioDuration)
  const hasKnownDuration = knownDuration !== null && knownDuration > 0
  const requestedTime = finiteNumber(atTime)
  if (requestedTime === null || requestedTime < 0) {
    throw new Error('Move the preview playhead to where this caption should begin.')
  }

  const start = roundTime(requestedTime)
  if (hasKnownDuration && start >= knownDuration - NUMBER_EPSILON) {
    throw new Error('Move the preview playhead earlier so the caption fits before the media ends.')
  }

  const coveringCue = sourceCues.find((cue) => {
    const cueStart = finiteNumber(cue?.start)
    const cueEnd = finiteNumber(cue?.end)
    return cueStart !== null
      && cueEnd !== null
      && cueEnd > cueStart
      && start >= cueStart - NUMBER_EPSILON
      && start < cueEnd - NUMBER_EPSILON
  })
  if (coveringCue) {
    throw new Error('A caption already covers this playhead position. Move to an empty gap or split that caption instead.')
  }

  const insertionIndex = sourceCues.findIndex((cue) => finiteNumber(cue?.start, Infinity) >= start)
  const safeInsertionIndex = insertionIndex < 0 ? sourceCues.length : insertionIndex
  const nextCueStart = safeInsertionIndex < sourceCues.length
    ? finiteNumber(sourceCues[safeInsertionIndex]?.start)
    : null
  const availableEnd = Math.min(
    start + safeDefault,
    nextCueStart === null ? Infinity : nextCueStart,
    hasKnownDuration ? knownDuration : Infinity
  )
  if (!Number.isFinite(availableEnd) || availableEnd - start + NUMBER_EPSILON < safeMinimum) {
    throw new Error('There is not enough room after the playhead for a caption. Move it earlier or shorten the next cue.')
  }

  const cue = {
    id: createCaptionCueId(sourceCues, idFactory),
    start,
    end: availableEnd,
    text: '',
    words: [],
    override: {},
  }
  const nextCues = [...sourceCues]
  nextCues.splice(safeInsertionIndex, 0, cue)
  return { cues: nextCues, cue, index: safeInsertionIndex }
}

export function retimeCaptionCue(cues = [], cueId, {
  start = null,
  duration = null,
  minDuration = 0.1,
  maxEnd = null,
} = {}) {
  const sourceCues = Array.isArray(cues) ? cues : []
  const cueIndex = sourceCues.findIndex((cue) => cue?.id === cueId)
  if (cueIndex < 0) throw new Error('Select a caption cue to adjust.')

  const cue = sourceCues[cueIndex]
  const currentStart = finiteNumber(cue?.start, 0)
  const currentEnd = finiteNumber(cue?.end, currentStart)
  const safeMinimum = Math.max(0.01, finiteNumber(minDuration, 0.1))
  const currentDuration = Math.max(safeMinimum, currentEnd - currentStart)
  const nextStart = start === null || start === undefined
    ? currentStart
    : finiteNumber(start)
  const nextDuration = duration === null || duration === undefined
    ? currentDuration
    : finiteNumber(duration)

  if (nextStart === null || nextStart < 0) {
    throw new Error('Caption start time must be zero or later.')
  }
  if (nextDuration === null || nextDuration + NUMBER_EPSILON < safeMinimum) {
    throw new Error(`Caption duration must be at least ${safeMinimum.toFixed(1)} seconds.`)
  }

  const roundedStart = roundTime(nextStart)
  const roundedEnd = Math.max(
    roundedStart + safeMinimum,
    roundTime(roundedStart + nextDuration)
  )
  const knownMaxEnd = finiteNumber(maxEnd)
  if (knownMaxEnd !== null && knownMaxEnd > 0 && roundedEnd > knownMaxEnd + NUMBER_EPSILON) {
    throw new Error('This caption would end after the media. Move it earlier or shorten its duration.')
  }
  const nextCue = {
    ...cue,
    start: roundedStart,
    end: roundedEnd,
  }
  return {
    cues: [
      ...sourceCues.slice(0, cueIndex),
      nextCue,
      ...sourceCues.slice(cueIndex + 1),
    ],
    cue: nextCue,
    index: cueIndex,
  }
}

export function validateCaptionCues(cues = []) {
  const sourceCues = Array.isArray(cues) ? cues : []
  const errors = []
  const ordered = sourceCues
    .map((cue, index) => ({ cue, index }))
    .sort((a, b) => finiteNumber(a.cue?.start, 0) - finiteNumber(b.cue?.start, 0))

  for (const { cue, index } of ordered) {
    const label = `Cue ${index + 1}`
    const start = finiteNumber(cue?.start)
    const end = finiteNumber(cue?.end)
    if (!String(cue?.text || '').trim()) {
      errors.push({ code: 'blank', cueId: cue?.id || null, index, message: `${label} is blank.` })
    }
    if (start === null || end === null || start < 0 || end <= start) {
      errors.push({ code: 'timing', cueId: cue?.id || null, index, message: `${label} needs a valid start and end time.` })
    }
  }

  for (let currentIndex = 1; currentIndex < ordered.length; currentIndex += 1) {
    const current = ordered[currentIndex]
    const currentStart = finiteNumber(current.cue?.start)
    const currentEnd = finiteNumber(current.cue?.end)
    if (currentStart === null || currentEnd === null || currentStart < 0 || currentEnd <= currentStart) continue
    for (let previousIndex = 0; previousIndex < currentIndex; previousIndex += 1) {
      const previous = ordered[previousIndex]
      const previousStart = finiteNumber(previous.cue?.start)
      const previousEnd = finiteNumber(previous.cue?.end)
      if (
        previousStart !== null
        && previousEnd !== null
        && previousStart >= 0
        && previousEnd > previousStart
        && currentStart < previousEnd - TIME_EPSILON
      ) {
        errors.push({
          code: 'overlap',
          cueId: current.cue?.id || null,
          cueIds: [previous.cue?.id, current.cue?.id].filter(Boolean),
          index: current.index,
          message: `Cue ${previous.index + 1} overlaps Cue ${current.index + 1}. Adjust their end and start times.`,
        })
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

export const CAPTION_CUE_EDITING_DEFAULTS = Object.freeze({
  minSplitDuration: DEFAULT_MIN_SPLIT_DURATION,
  defaultNewCueDuration: DEFAULT_NEW_CUE_DURATION,
  minNewCueDuration: DEFAULT_MIN_NEW_CUE_DURATION,
})
