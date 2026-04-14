import { getSupportedMogMimeType } from './mogRenderer'

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }
function lerp(a, b, t) { return a + (b - a) * t }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }
function easeOutBack(t, overshoot = 1.7) {
  const c = overshoot
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}
function easeInCubic(t) { return t * t * t }

// ---------------------------------------------------------------------------
// Kinetic caption style
// ---------------------------------------------------------------------------

export const KINETIC_CAPTION_STYLES = [
  {
    id: 'kinetic-classic',
    name: 'Classic',
    description: 'White text with lime green keyword highlights.',
    sampleText: 'watch on mute?',
    renderer: 'kinetic',
    textColor: '#F8FAFC',
    keyWordColor: '#A3E635',
    baseGlowColor: 'rgba(255, 255, 255, 0.18)',
    glowColor: 'rgba(163, 230, 53, 0.42)',
    fontFamily: 'Inter',
    fontWeight: '800',
  },
  {
    id: 'kinetic-sunset',
    name: 'Sunset',
    description: 'White text with warm coral-orange emphasis.',
    sampleText: 'the actual hook.',
    renderer: 'kinetic',
    textColor: '#FFF1EB',
    keyWordColor: '#FB923C',
    baseGlowColor: 'rgba(251, 191, 36, 0.18)',
    glowColor: 'rgba(251, 146, 60, 0.4)',
    fontFamily: 'Inter',
    fontWeight: '800',
  },
  {
    id: 'kinetic-electric',
    name: 'Electric',
    description: 'White text with bright cyan keyword glow.',
    sampleText: 'captions instantly.',
    renderer: 'kinetic',
    textColor: '#E0F7FF',
    keyWordColor: '#22D3EE',
    baseGlowColor: 'rgba(56, 189, 248, 0.18)',
    glowColor: 'rgba(34, 211, 238, 0.4)',
    fontFamily: 'Inter',
    fontWeight: '800',
  },
  {
    id: 'kinetic-violet',
    name: 'Violet',
    description: 'White text with vivid purple keyword pops.',
    sampleText: 'try this now!',
    renderer: 'kinetic',
    textColor: '#F3E8FF',
    keyWordColor: '#A78BFA',
    baseGlowColor: 'rgba(192, 132, 252, 0.18)',
    glowColor: 'rgba(167, 139, 250, 0.42)',
    fontFamily: 'Inter',
    fontWeight: '800',
  },
  {
    id: 'kinetic-mono',
    name: 'Monochrome',
    description: 'Pure white with brighter intensity on keywords.',
    sampleText: 'just the words.',
    renderer: 'kinetic',
    textColor: '#D1D5DB',
    keyWordColor: '#FFFFFF',
    baseGlowColor: 'rgba(209, 213, 219, 0.16)',
    glowColor: 'rgba(255, 255, 255, 0.45)',
    fontFamily: 'Inter',
    fontWeight: '800',
  },
  {
    id: 'kinetic-traditional',
    name: 'Traditional Subtitles',
    description: 'Clean bottom-center subtitles with no animation effects.',
    sampleText: 'Simple readable subtitles.',
    renderer: 'kinetic',
    traditional: true,
    textColor: '#FFFFFF',
    keyWordColor: '#FFFFFF',
    baseGlowColor: 'rgba(0, 0, 0, 0.7)',
    glowColor: 'rgba(0, 0, 0, 0.7)',
    fontFamily: 'Inter',
    fontWeight: '600',
    subtitleColor: '#FFFFFF',
    subtitlePosition: 'action-safe',
    subtitleTextStyle: 'background',
  },
]

export const DEFAULT_KINETIC_STYLE_ID = KINETIC_CAPTION_STYLES[0].id

export function getKineticStyleById(id) {
  return KINETIC_CAPTION_STYLES.find((s) => s.id === id) || KINETIC_CAPTION_STYLES[0]
}

const KINETIC_MOTION_PROFILES = {
  tamed: {
    enterDuration: 0.2,
    exitDuration: 0.22,
    startScale: 0.74,
    overshoot: 0.6,
    blurStart: 4,
    positionVarietyMultiplier: 0.4,
    entranceSpreadMultiplier: 0.82,
  },
  excited: {
    enterDuration: 0.14,
    exitDuration: 0.18,
    startScale: 0.5,
    overshoot: 1.7,
    blurStart: 8,
    positionVarietyMultiplier: 1,
    entranceSpreadMultiplier: 1,
  },
  frenetic: {
    enterDuration: 0.1,
    exitDuration: 0.14,
    startScale: 0.38,
    overshoot: 2.35,
    blurStart: 12,
    positionVarietyMultiplier: 1.45,
    entranceSpreadMultiplier: 0.72,
  },
}

const SIZE_PROFILE_MULTIPLIERS = {
  small: 0.65,
  normal: 1,
  large: 1.25,
}

function resolveFieldWithFallback(perCue, global, fallback) {
  if (perCue && perCue !== 'auto') return perCue
  if (global && global !== 'auto') return global
  return fallback
}

function resolveKineticBehavior(style, microCue) {
  const override = microCue?.override && typeof microCue.override === 'object'
    ? microCue.override
    : {}
  const global = microCue?.globalOverrides && typeof microCue.globalOverrides === 'object'
    ? microCue.globalOverrides
    : {}

  const motionProfileId = resolveFieldWithFallback(
    override.motionProfile,
    global.motionProfile,
    style?.defaultMotionProfile || 'excited'
  )

  const sizeProfile = resolveFieldWithFallback(
    override.sizeProfile,
    global.sizeProfile,
    'normal'
  )

  return {
    verticalPlacement: resolveFieldWithFallback(override.verticalPlacement, global.verticalPlacement, 'auto'),
    horizontalPlacement: resolveFieldWithFallback(override.horizontalPlacement, global.horizontalPlacement, 'auto'),
    motionProfileId,
    motionProfile: KINETIC_MOTION_PROFILES[motionProfileId] || KINETIC_MOTION_PROFILES.excited,
    sizeMultiplier: SIZE_PROFILE_MULTIPLIERS[sizeProfile] || 1,
  }
}

// ---------------------------------------------------------------------------
// Split ASR cues into micro-cues (1-3 words each) for snappy display
// ---------------------------------------------------------------------------

const MAX_MICRO_CUE_WORDS = 3
const SINGLE_WORD_CHANCE_EVERY = 3
const SENTENCE_END_RE = /[.!?]$/

function isSentenceEnder(word) {
  return SENTENCE_END_RE.test(String(word || '').trim())
}

function splitCuesIntoMicroCues(cues) {
  const microCues = []

  for (const cue of cues) {
    const words = String(cue?.text || '').trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) continue

    const cueStart = Number(cue?.start) || 0
    const cueEnd = Number(cue?.end) || cueStart + 1
    const cueDuration = Math.max(0.2, cueEnd - cueStart)

    const totalChars = words.reduce((sum, w) => sum + w.length, 0) || 1
    let charCursor = 0
    let wordIndex = 0

    while (wordIndex < words.length) {
      const microIndex = microCues.length
      const remaining = words.length - wordIndex

      let take = Math.min(MAX_MICRO_CUE_WORDS, remaining)

      if (remaining > 1 && take > 1 && microIndex % SINGLE_WORD_CHANCE_EVERY === 0) {
        take = 1
      }
      if (remaining === MAX_MICRO_CUE_WORDS + 1) {
        take = 2
      }

      for (let t = 1; t < take; t++) {
        if (isSentenceEnder(words[wordIndex + t - 1])) {
          take = t
          break
        }
      }

      if (take > 1 && isSentenceEnder(words[wordIndex + take - 1]) && remaining > take) {
        const preTake = take - 1
        if (preTake >= 1) {
          const preWords = words.slice(wordIndex, wordIndex + preTake)
          const preText = preWords.join(' ')
          const preStartChars = charCursor
          const preEndChars = charCursor + preWords.reduce((sum, w) => sum + w.length, 0)

          microCues.push({
            id: `${cue.id || 'cue'}-m${microCues.length}`,
            start: Math.round((cueStart + cueDuration * (preStartChars / totalChars)) * 100) / 100,
            end: Math.round((cueStart + cueDuration * (preEndChars / totalChars)) * 100) / 100,
            text: preText,
            wordCount: preWords.length,
            parentCueText: cue.text,
            isSentenceEnd: false,
            override: cue.override || null,
            globalOverrides: cue.globalOverrides || null,
          })

          charCursor = preEndChars
          wordIndex += preTake
          take = 1
        }
      }

      const microWords = words.slice(wordIndex, wordIndex + take)
      const microText = microWords.join(' ')
      const lastWord = microWords[microWords.length - 1] || ''
      const sentenceEnd = isSentenceEnder(lastWord)

      const startChars = charCursor
      const endChars = charCursor + microWords.reduce((sum, w) => sum + w.length, 0)
      const startFraction = startChars / totalChars
      const endFraction = endChars / totalChars

      microCues.push({
        id: `${cue.id || 'cue'}-m${microCues.length}`,
        start: Math.round((cueStart + cueDuration * startFraction) * 100) / 100,
        end: Math.round((cueStart + cueDuration * endFraction) * 100) / 100,
        text: microText,
        wordCount: microWords.length,
        parentCueText: cue.text,
        isSentenceEnd: sentenceEnd,
        override: cue.override || null,
        globalOverrides: cue.globalOverrides || null,
      })

      charCursor = endChars
      wordIndex += take
    }
  }

  for (let i = 0; i < microCues.length; i++) {
    const mc = microCues[i]
    const minDuration = mc.isSentenceEnd ? 0.45 : 0.35
    if (mc.end - mc.start < minDuration) {
      mc.end = mc.start + minDuration
    }
    const next = microCues[i + 1]
    if (next && mc.end > next.start) {
      mc.end = next.start
      if (mc.end - mc.start < 0.15) mc.end = mc.start + 0.15
    }
  }

  return microCues
}

// ---------------------------------------------------------------------------
// Key word / highlight detection
// ---------------------------------------------------------------------------

const NUMBER_RE = /\d|%/

function isMicroCueHighlighted(microCue) {
  if (microCue.isSentenceEnd) return true

  if (microCue.wordCount === 1) {
    const word = microCue.text.trim()
    if (NUMBER_RE.test(word)) return true
    if (/[!?]$/.test(word)) return true
    if (/[!?]$/.test(String(microCue.parentCueText || '').trim())) {
      const parentWords = String(microCue.parentCueText || '').trim().split(/\s+/)
      if (parentWords[parentWords.length - 1] === word) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Font sizing -- much bigger now since micro-cues are 1-3 words
// ---------------------------------------------------------------------------

function computeFontSize(wordCount, canvasWidth, canvasHeight) {
  const shortEdge = Math.min(canvasWidth, canvasHeight)
  let ratio
  if (wordCount <= 1) ratio = 0.28
  else if (wordCount <= 2) ratio = 0.18
  else ratio = 0.13

  const raw = shortEdge * ratio
  return clamp(Math.round(raw), 36, Math.round(canvasWidth * 0.35))
}

// ---------------------------------------------------------------------------
// Layout: position words centered in frame
// ---------------------------------------------------------------------------

function setFont(ctx, size, family, weight) {
  ctx.font = `${weight} ${Math.round(size)}px "${family}", "Helvetica Neue", Arial, sans-serif`
}

function layoutMicroCue(ctx, microCue, fontSize, style, canvasWidth, canvasHeight) {
  setFont(ctx, fontSize, style.fontFamily, style.fontWeight)
  const words = microCue.text.split(/\s+/).filter(Boolean)
  const wordGap = fontSize * 0.3

  const wordMeasures = words.map((w) => ({ text: w, width: ctx.measureText(w).width }))
  const totalWidth = wordMeasures.reduce((sum, w, i) => sum + w.width + (i > 0 ? wordGap : 0), 0)

  const lineHeight = fontSize * 1.15
  const maxLineWidth = canvasWidth * 0.85

  if (totalWidth <= maxLineWidth || words.length <= 1) {
    let cursorX = (canvasWidth - totalWidth) / 2
    const y = canvasHeight / 2 + fontSize * 0.3
    return wordMeasures.map((wm, i) => {
      const entry = { text: wm.text, x: cursorX, y, measuredWidth: wm.width, fontSize, index: i }
      cursorX += wm.width + wordGap
      return entry
    })
  }

  const mid = Math.ceil(words.length / 2)
  const lines = [wordMeasures.slice(0, mid), wordMeasures.slice(mid)]
  const totalHeight = lines.length * lineHeight
  const startY = (canvasHeight - totalHeight) / 2 + fontSize * 0.85

  const positioned = []
  lines.forEach((line, lineIdx) => {
    const lineWidth = line.reduce((sum, w, i) => sum + w.width + (i > 0 ? wordGap : 0), 0)
    let cursorX = (canvasWidth - lineWidth) / 2
    const y = startY + lineIdx * lineHeight
    line.forEach((wm) => {
      positioned.push({ text: wm.text, x: cursorX, y, measuredWidth: wm.width, fontSize, index: positioned.length })
      cursorX += wm.width + wordGap
    })
  })

  return positioned
}

// ---------------------------------------------------------------------------
// Per-word animation
// ---------------------------------------------------------------------------

function getWordAnimState(time, enterTime, cueEnd, motionProfile) {
  const age = time - enterTime
  if (age < 0) return { visible: false }

  const timeUntilEnd = cueEnd - time
  let opacity = 1
  let scale = 1
  let blur = 0
  const enterDuration = motionProfile?.enterDuration ?? 0.14
  const exitDuration = motionProfile?.exitDuration ?? 0.18
  const startScale = motionProfile?.startScale ?? 0.5
  const overshoot = motionProfile?.overshoot ?? 1.7
  const blurStart = motionProfile?.blurStart ?? 8

  if (age < enterDuration) {
    const t = clamp(age / enterDuration, 0, 1)
    scale = lerp(startScale, 1.0, easeOutBack(t, overshoot))
    opacity = clamp(t * 3, 0, 1)
    blur = lerp(blurStart, 0, easeOutCubic(t))
  }

  if (timeUntilEnd < exitDuration && timeUntilEnd >= 0) {
    const t = clamp(1 - timeUntilEnd / exitDuration, 0, 1)
    opacity *= 1 - easeInCubic(t)
    scale *= lerp(1, 0.88, easeInCubic(t))
  }

  return { visible: true, opacity, scale, blur }
}

// ---------------------------------------------------------------------------
// Draw word with glow
// ---------------------------------------------------------------------------

function drawWord(ctx, word, anim, color, glowColor, style) {
  if (!anim.visible || anim.opacity <= 0.01) return

  ctx.save()
  ctx.globalAlpha = anim.opacity

  const cx = word.x + word.measuredWidth / 2
  const cy = word.y - word.fontSize * 0.35

  ctx.translate(cx, cy)
  ctx.scale(anim.scale, anim.scale)
  ctx.translate(-cx, -cy)

  setFont(ctx, word.fontSize, style.fontFamily, style.fontWeight)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  if (anim.blur > 0.5) {
    ctx.filter = `blur(${anim.blur.toFixed(1)}px)`
  }

  ctx.shadowColor = glowColor
  ctx.shadowBlur = 28
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.fillStyle = color
  ctx.fillText(word.text, word.x, word.y)

  ctx.shadowBlur = 0
  ctx.filter = 'none'
  ctx.fillStyle = color
  ctx.fillText(word.text, word.x, word.y)

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Position variety -- subtle per-micro-cue offsets so text floats around
// ---------------------------------------------------------------------------

function getPositionOffset(microCueIndex, microCue, width, height, positioned, behavior) {
  const isHighlighted = isMicroCueHighlighted(microCue)
  const motionProfile = behavior?.motionProfile || KINETIC_MOTION_PROFILES.excited
  const variety = motionProfile.positionVarietyMultiplier ?? 1

  const horizontalPlacement = behavior?.horizontalPlacement || 'auto'
  const verticalPlacement = behavior?.verticalPlacement || 'auto'

  const bounds = Array.isArray(positioned) && positioned.length > 0
    ? positioned.reduce((acc, word) => ({
        minX: Math.min(acc.minX, word.x),
        maxX: Math.max(acc.maxX, word.x + word.measuredWidth),
        minY: Math.min(acc.minY, word.y - word.fontSize),
        maxY: Math.max(acc.maxY, word.y + word.fontSize * 0.2),
      }), {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      })
    : null

  const currentCenterX = bounds ? (bounds.minX + bounds.maxX) / 2 : width / 2
  const currentCenterY = bounds ? (bounds.minY + bounds.maxY) / 2 : height / 2

  let anchorX = width / 2
  if (horizontalPlacement === 'left') anchorX = width * 0.32
  if (horizontalPlacement === 'right') anchorX = width * 0.68

  let anchorY = height / 2
  if (verticalPlacement === 'top') anchorY = height * 0.28
  if (verticalPlacement === 'bottom') anchorY = height * 0.72

  let dx = anchorX - currentCenterX
  let dy = anchorY - currentCenterY

  const shouldPinCenterPunch = isHighlighted
    && microCue.wordCount === 1
    && (horizontalPlacement === 'auto' || horizontalPlacement === 'center')
    && (verticalPlacement === 'auto' || verticalPlacement === 'middle')

  if (shouldPinCenterPunch) {
    return { dx, dy }
  }

  if (microCue.isSentenceEnd && verticalPlacement === 'auto') {
    dy += -height * 0.08
  }

  const idx = microCueIndex
  let driftX = 0
  let driftY = 0

  if (idx % 5 === 0) {
    driftX = -width * 0.12
    driftY = height * 0.04
  } else if (idx % 2 === 1) {
    driftX = -width * 0.07
    driftY = height * 0.05
  } else {
    driftX = width * 0.07
    driftY = -height * 0.03
  }

  if (idx % 7 === 3) {
    driftX *= 1.4
    driftY *= -0.8
  }

  dx += driftX * variety
  dy += driftY * variety

  return { dx, dy }
}

// ---------------------------------------------------------------------------
// Public: render one kinetic caption frame
// ---------------------------------------------------------------------------

let microCueCache = null
let microCueCacheKey = null

function getMicroCues(cues) {
  const key = (Array.isArray(cues) ? cues : [])
    .map((c) => `${c.id}|${c.start}|${c.end}|${c.text}|${JSON.stringify(c.override || {})}`)
    .join(',')
  if (microCueCacheKey === key && microCueCache) return microCueCache
  microCueCache = splitCuesIntoMicroCues(cues)
  microCueCacheKey = key
  return microCueCache
}

function renderTraditionalSubtitle(ctx, width, height, style, cues, time) {
  const safeCues = Array.isArray(cues) ? cues : []
  const activeCue = safeCues.find((cue) => {
    const s = Number(cue?.start) || 0
    const e = Number(cue?.end) || 0
    return time >= s && time < e
  })
  if (!activeCue) return

  const text = String(activeCue.text || '').trim()
  if (!text) return

  const g = activeCue.globalOverrides && typeof activeCue.globalOverrides === 'object'
    ? activeCue.globalOverrides
    : {}

  const textColor = g.subtitleColor || style.subtitleColor || style.textColor || '#FFFFFF'
  const position = g.subtitlePosition || style.subtitlePosition || 'action-safe'
  const textStyle = g.subtitleTextStyle || style.subtitleTextStyle || 'background'
  const sizeId = g.subtitleSize || 'medium'
  const sizeMultiplier = sizeId === 'small' ? 0.7 : sizeId === 'large' ? 1.35 : 1

  const fontSize = clamp(Math.round(Math.min(width, height) * 0.045 * sizeMultiplier), 16, 96)
  const lineHeight = fontSize * 1.3
  const padding = fontSize * 0.6
  const maxWidth = width * 0.88

  setFont(ctx, fontSize, style.fontFamily, style.fontWeight)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'

  const rawWords = text.split(/\s+/).filter(Boolean)
  const lines = []
  let currentLine = rawWords[0] || ''
  for (let i = 1; i < rawWords.length; i++) {
    const candidate = currentLine + ' ' + rawWords[i]
    if (ctx.measureText(candidate).width <= maxWidth) {
      currentLine = candidate
    } else {
      lines.push(currentLine)
      currentLine = rawWords[i]
    }
  }
  if (currentLine) lines.push(currentLine)

  const blockHeight = lines.length * lineHeight + padding * 2

  let blockY
  if (position === 'title-safe') {
    blockY = height - blockHeight - height * 0.15
  } else if (position === 'center') {
    blockY = (height - blockHeight) / 2
  } else {
    blockY = height - blockHeight - height * 0.06
  }

  const centerX = width / 2

  ctx.save()

  const cueAge = time - (Number(activeCue.start) || 0)
  const cueRemaining = (Number(activeCue.end) || 0) - time
  let opacity = 1
  if (cueAge < 0.15) opacity = clamp(cueAge / 0.15, 0, 1)
  if (cueRemaining < 0.15) opacity = clamp(cueRemaining / 0.15, 0, 1)
  ctx.globalAlpha = opacity

  if (textStyle === 'background') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
    const boxWidth = Math.min(maxWidth + padding * 2, width * 0.92)
    const boxX = centerX - boxWidth / 2
    const radius = Math.round(fontSize * 0.3)
    ctx.beginPath()
    ctx.moveTo(boxX + radius, blockY)
    ctx.lineTo(boxX + boxWidth - radius, blockY)
    ctx.quadraticCurveTo(boxX + boxWidth, blockY, boxX + boxWidth, blockY + radius)
    ctx.lineTo(boxX + boxWidth, blockY + blockHeight - radius)
    ctx.quadraticCurveTo(boxX + boxWidth, blockY + blockHeight, boxX + boxWidth - radius, blockY + blockHeight)
    ctx.lineTo(boxX + radius, blockY + blockHeight)
    ctx.quadraticCurveTo(boxX, blockY + blockHeight, boxX, blockY + blockHeight - radius)
    ctx.lineTo(boxX, blockY + radius)
    ctx.quadraticCurveTo(boxX, blockY, boxX + radius, blockY)
    ctx.closePath()
    ctx.fill()
  }

  setFont(ctx, fontSize, style.fontFamily, style.fontWeight)
  ctx.fillStyle = textColor

  if (textStyle === 'outline') {
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.08))
    ctx.lineJoin = 'round'
    lines.forEach((line, index) => {
      const y = blockY + padding + (index + 0.75) * lineHeight
      ctx.strokeText(line, centerX, y)
    })
  }

  if (textStyle === 'shadow') {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
    ctx.shadowBlur = Math.round(fontSize * 0.25)
    ctx.shadowOffsetX = Math.round(fontSize * 0.06)
    ctx.shadowOffsetY = Math.round(fontSize * 0.06)
  }

  lines.forEach((line, index) => {
    const y = blockY + padding + (index + 0.75) * lineHeight
    ctx.fillText(line, centerX, y)
  })

  ctx.restore()
}

export function renderKineticCaptionFrame({ ctx, width, height, style, cues, time = 0 }) {
  if (!ctx || !width || !height) return
  ctx.clearRect(0, 0, width, height)

  const resolvedStyle = typeof style === 'string' ? getKineticStyleById(style) : (style || KINETIC_CAPTION_STYLES[0])

  if (resolvedStyle.traditional) {
    renderTraditionalSubtitle(ctx, width, height, resolvedStyle, cues, time)
    return
  }

  const microCues = getMicroCues(cues)

  const activeIndex = microCues.findIndex((mc) => time >= mc.start && time < mc.end)
  if (activeIndex < 0) return
  const active = microCues[activeIndex]
  const behavior = resolveKineticBehavior(resolvedStyle, active)
  const motionProfile = behavior.motionProfile

  const isHighlighted = isMicroCueHighlighted(active)
  const textColor = isHighlighted ? resolvedStyle.keyWordColor : resolvedStyle.textColor
  const glowColor = isHighlighted
    ? resolvedStyle.glowColor
    : (resolvedStyle.baseGlowColor || 'rgba(255,255,255,0.2)')

  const baseFontSize = computeFontSize(active.wordCount, width, height)
  const fontSize = Math.round(baseFontSize * (behavior.sizeMultiplier || 1))
  const positioned = layoutMicroCue(ctx, active, fontSize, resolvedStyle, width, height)

  const { dx, dy } = getPositionOffset(activeIndex, active, width, height, positioned, behavior)
  if (dx !== 0 || dy !== 0) {
    for (const word of positioned) {
      word.x += dx
      word.y += dy
    }
  }

  const mcDuration = active.end - active.start
  const wordCount = positioned.length
  const entranceSpread = Math.min(0.6, wordCount * 0.06) * mcDuration * (motionProfile.entranceSpreadMultiplier ?? 1)

  for (let i = 0; i < positioned.length; i++) {
    const wordEnter = active.start + (entranceSpread * (i / Math.max(1, wordCount)))
    const anim = getWordAnimState(time, wordEnter, active.end, motionProfile)
    drawWord(ctx, positioned[i], anim, textColor, glowColor, resolvedStyle)
  }
}

// ---------------------------------------------------------------------------
// Public: preview for preset card
// ---------------------------------------------------------------------------

export function renderKineticPreviewDataUrl(styleOrId, width = 240, height = 140) {
  if (typeof document === 'undefined') return null

  const style = typeof styleOrId === 'string' ? getKineticStyleById(styleOrId) : (styleOrId || KINETIC_CAPTION_STYLES[0])
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#060B16')
  gradient.addColorStop(1, '#111827')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  const previewCues = [
    { id: 'p1', start: 0, end: 1.5, text: style.sampleText || 'watch on mute?' },
  ]

  renderKineticCaptionFrame({ ctx, width, height, style, cues: previewCues, time: 0.6 })
  return canvas.toDataURL('image/png')
}

// ---------------------------------------------------------------------------
// Public: record transparent WebM
// ---------------------------------------------------------------------------

export async function generateKineticCaptionVideoBlob({ style, cues, width, height, duration, fps }) {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Kinetic caption export requires MediaRecorder support.')
  }

  const resolvedStyle = typeof style === 'string' ? getKineticStyleById(style) : (style || KINETIC_CAPTION_STYLES[0])
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context unavailable.')

  const safeDuration = Math.max(0.4, Number(duration) || Math.max(...(Array.isArray(cues) ? cues.map((c) => Number(c?.end) || 0) : [0]), 0.4))
  const safeFps = Math.max(1, Math.round(Number(fps) || 24))
  const stream = canvas.captureStream(safeFps)
  const mimeType = getSupportedMogMimeType()

  let recorder
  try {
    recorder = mimeType
      ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
      : new MediaRecorder(stream)
  } catch (_) {
    throw new Error('Could not initialize kinetic caption recorder.')
  }

  return await new Promise((resolve, reject) => {
    const chunks = []
    const totalFrames = Math.max(1, Math.round(safeDuration * safeFps))
    const frameIntervalMs = Math.max(1, Math.round(1000 / safeFps))
    let frame = 0
    let timer = null
    let stopped = false

    const cleanup = () => {
      if (timer) clearInterval(timer)
      stream.getTracks().forEach((track) => track.stop())
    }

    const drawFrame = () => {
      renderKineticCaptionFrame({
        ctx, width, height,
        style: resolvedStyle,
        cues,
        time: frame / safeFps,
      })
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }
    recorder.onerror = () => {
      if (stopped) return; stopped = true; cleanup()
      reject(new Error('Failed while recording kinetic captions.'))
    }
    recorder.onstop = () => {
      if (stopped) return; stopped = true; cleanup()
      const blob = new Blob(chunks, { type: mimeType || 'video/webm' })
      if (blob.size <= 0) { reject(new Error('Kinetic caption output is empty.')); return }
      resolve(blob)
    }

    drawFrame()
    recorder.start()
    if (totalFrames <= 1) { recorder.stop(); return }

    timer = setInterval(() => {
      frame += 1
      drawFrame()
      if (frame >= totalFrames - 1) { clearInterval(timer); timer = null; recorder.stop() }
    }, frameIntervalMs)
  })
}
