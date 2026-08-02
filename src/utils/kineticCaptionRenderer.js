import { getSupportedMogMimeType } from './mogRenderer'

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }
function lerp(a, b, t) { return a + (b - a) * t }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }
function easeOutBack(t, overshoot = 1.7) {
  const c = overshoot
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}
function easeInCubic(t) { return t * t * t }

function normalizePercent(value, fallback, min = 0, max = 100) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? clamp(numeric, min, max) : fallback
}

function parseHexColor(value) {
  const raw = String(value || '').trim()
  if (!raw.startsWith('#')) return null
  const hex = raw.slice(1)
  const normalized = hex.length === 3
    ? hex.split('').map((c) => c + c).join('')
    : hex.padEnd(6, '0').slice(0, 6)
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  }
}

function colorWithOpacity(value, opacityPercent = 100, fallback = 'rgba(0, 0, 0, 1)') {
  const parsed = parseHexColor(value)
  const alpha = normalizePercent(opacityPercent, 100) / 100
  if (parsed) return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`
  const raw = String(value || '').trim()
  return raw || fallback
}

// ---------------------------------------------------------------------------
// Kinetic caption style
// ---------------------------------------------------------------------------

// The default accent (color applied to the word currently being spoken).
// Users can override this per caption via the color picker in the UI,
// so it's exposed as a shared constant rather than baked into five
// near-identical presets.
export const DEFAULT_KINETIC_ACCENT_COLOR = '#A3E635' // lime

export function accentGlowColor(accentHex) {
  // Produce a semi-transparent glow in the same hue as the accent so the
  // active word lights up without needing a separate glow color setting.
  const hex = String(accentHex || DEFAULT_KINETIC_ACCENT_COLOR).replace('#', '')
  const normalized = hex.length === 3
    ? hex.split('').map((c) => c + c).join('')
    : hex.padEnd(6, '0').slice(0, 6)
  const r = parseInt(normalized.slice(0, 2), 16) || 0
  const g = parseInt(normalized.slice(2, 4), 16) || 0
  const b = parseInt(normalized.slice(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, 0.42)`
}

export const KINETIC_CAPTION_STYLES = [
  {
    id: 'kinetic-pop',
    name: 'Kinetic',
    description: 'Big bold words that pop in and light up as they are spoken.',
    sampleText: 'this is your moment',
    renderer: 'kinetic',
    textColor: '#F8FAFC',
    keyWordColor: DEFAULT_KINETIC_ACCENT_COLOR,
    baseGlowColor: 'rgba(255, 255, 255, 0.18)',
    glowColor: accentGlowColor(DEFAULT_KINETIC_ACCENT_COLOR),
    fontFamily: 'Inter',
    fontWeight: '800',
    accentCustomizable: true,
    textColorCustomizable: true,
    defaultTextStyle: 'shadow',
  },
  {
    id: 'kinetic-traditional',
    name: 'Subtitles',
    description: 'Clean bottom-center subtitles with a dark pill. No animation.',
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
    defaultTextStyle: 'background',
  },
  {
    id: 'kinetic-neon',
    name: 'Neon',
    description: 'Electric colors with an intense glow. Pair with Frenetic motion.',
    sampleText: 'feel the energy',
    renderer: 'kinetic',
    textColor: '#E0F2FE',
    keyWordColor: '#22D3EE',
    baseGlowColor: 'rgba(34, 211, 238, 0.15)',
    glowColor: 'rgba(34, 211, 238, 0.55)',
    fontFamily: 'Inter',
    fontWeight: '800',
    accentCustomizable: true,
    textColorCustomizable: true,
    defaultMotionProfile: 'frenetic',
    defaultTextStyle: 'plain',
  },
  {
    id: 'kinetic-bold-dark',
    name: 'Bold Dark',
    description: 'High-contrast white on a dark scrim. Readable over any background.',
    sampleText: 'bold statement',
    renderer: 'kinetic',
    textColor: '#FFFFFF',
    keyWordColor: '#FACC15',
    baseGlowColor: 'rgba(255, 255, 255, 0.12)',
    glowColor: 'rgba(250, 204, 21, 0.5)',
    fontFamily: 'Inter',
    fontWeight: '800',
    accentCustomizable: true,
    textColorCustomizable: true,
    defaultMotionProfile: 'tamed',
    defaultTextStyle: 'background',
    bgScrim: 'rgba(0, 0, 0, 0.62)',
  },
  {
    id: 'kinetic-punch',
    name: 'Punch',
    description: 'One word at a time, slamming into the same spot. Fast and relentless.',
    sampleText: 'one word at a time',
    renderer: 'kinetic',
    textColor: '#FFFFFF',
    keyWordColor: '#A3E635',
    baseGlowColor: 'rgba(255, 255, 255, 0.3)',
    glowColor: accentGlowColor('#A3E635'),
    fontFamily: 'Inter',
    fontWeight: '800',
    accentCustomizable: true,
    textColorCustomizable: true,
    defaultMotionProfile: 'frenetic',
    defaultTextStyle: 'shadow',
    singleWord: true,
    pinPlacement: true,
  },
]

export const DEFAULT_KINETIC_STYLE_ID = KINETIC_CAPTION_STYLES[0].id

// Legacy IDs (kinetic-classic/sunset/electric/violet/mono) were consolidated
// into the single `kinetic-pop` preset with a customisable accent color.
// Map them through so projects saved before the cleanup keep opening.
const LEGACY_KINETIC_ID_MAP = {
  'kinetic-classic': 'kinetic-pop',
  'kinetic-sunset': 'kinetic-pop',
  'kinetic-electric': 'kinetic-pop',
  'kinetic-violet': 'kinetic-pop',
  'kinetic-mono': 'kinetic-pop',
  // 'Clean' was folded into 'Subtitles' (Position: Center + Text Style: Shadow).
  'kinetic-clean': 'kinetic-traditional',
}

export function getKineticStyleById(id) {
  const resolved = LEGACY_KINETIC_ID_MAP[id] || id
  return KINETIC_CAPTION_STYLES.find((s) => s.id === resolved) || KINETIC_CAPTION_STYLES[0]
}

export function buildKineticStyleWithAccent(styleOrId, accentColor) {
  const base = typeof styleOrId === 'string' ? getKineticStyleById(styleOrId) : (styleOrId || KINETIC_CAPTION_STYLES[0])
  if (!accentColor || base.traditional) return base
  return {
    ...base,
    keyWordColor: accentColor,
    glowColor: accentGlowColor(accentColor),
  }
}

export function buildKineticStyleWithColors(styleOrId, accentColor, textColor) {
  const base = typeof styleOrId === 'string' ? getKineticStyleById(styleOrId) : (styleOrId || KINETIC_CAPTION_STYLES[0])
  const result = { ...base }
  if (accentColor && !base.traditional) {
    result.keyWordColor = accentColor
    result.glowColor = accentGlowColor(accentColor)
  }
  if (textColor && base.textColorCustomizable && !base.traditional) {
    result.textColor = textColor
    result.baseGlowColor = accentGlowColor(textColor).replace('0.42', '0.18')
  }
  return result
}

const KINETIC_MOTION_PROFILES = {
  tamed: {
    enterDuration: 0.2,
    exitDuration: 0.22,
    startScale: 0.74,
    overshoot: 0.6,
    blurStart: 4,
    // Tamed holds its position: words stay on their anchor line, no wandering.
    positionVarietyMultiplier: 0,
    entranceSpreadMultiplier: 0.82,
  },
  excited: {
    enterDuration: 0.14,
    exitDuration: 0.18,
    startScale: 0.5,
    overshoot: 1.7,
    blurStart: 8,
    // Excited: noticeable but contained movement around the anchor.
    positionVarietyMultiplier: 0.5,
    entranceSpreadMultiplier: 1,
  },
  frenetic: {
    enterDuration: 0.1,
    exitDuration: 0.14,
    startScale: 0.38,
    overshoot: 2.35,
    blurStart: 12,
    // Frenetic: words land all over the frame.
    positionVarietyMultiplier: 1.6,
    entranceSpreadMultiplier: 0.72,
  },
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

  // Size: a continuous multiplier on the computed font size (1 = default).
  const perCueSize = Number(override.sizeScale)
  const globalSize = Number(global.sizeScale)
  const sizeMultiplier = Number.isFinite(perCueSize)
    ? clamp(perCueSize, 0.3, 2)
    : (Number.isFinite(globalSize) ? clamp(globalSize, 0.3, 2) : 1)

  // Vertical nudge: a continuous fraction of frame height (negative = up,
  // positive = down) layered on top of the Top/Middle/Bottom anchor. Per-cue
  // wins over the global slider.
  const perCueOffset = Number(override.verticalOffset)
  const globalOffset = Number(global.verticalOffset)
  const verticalOffset = Number.isFinite(perCueOffset)
    ? clamp(perCueOffset, -0.45, 0.45)
    : (Number.isFinite(globalOffset) ? clamp(globalOffset, -0.45, 0.45) : 0)

  const textStyle = resolveFieldWithFallback(
    override.textStyle,
    global.textStyle,
    style?.defaultTextStyle || 'plain'
  )

  const styleControls = {
    fontFamily: resolveFieldWithFallback(override.fontFamily, global.fontFamily, style?.fontFamily || 'Inter'),
    backgroundColor: resolveFieldWithFallback(override.backgroundColor, global.backgroundColor, '#000000'),
    backgroundOpacity: normalizePercent(override.backgroundOpacity ?? global.backgroundOpacity, 65),
    backgroundPadding: normalizePercent(override.backgroundPadding ?? global.backgroundPadding, 45, 10, 90),
    backgroundRadius: normalizePercent(override.backgroundRadius ?? global.backgroundRadius, 25, 0, 80),
    outlineColor: resolveFieldWithFallback(override.outlineColor, global.outlineColor, '#000000'),
    outlineThickness: normalizePercent(override.outlineThickness ?? global.outlineThickness, 9, 0, 22),
    shadowColor: resolveFieldWithFallback(override.shadowColor, global.shadowColor, '#000000'),
    shadowOpacity: normalizePercent(override.shadowOpacity ?? global.shadowOpacity, 75),
    shadowBlur: normalizePercent(override.shadowBlur ?? global.shadowBlur, 18, 0, 60),
    shadowDistance: normalizePercent(override.shadowDistance ?? global.shadowDistance, 5, 0, 30),
  }

  return {
    verticalPlacement: resolveFieldWithFallback(override.verticalPlacement, global.verticalPlacement, 'auto'),
    horizontalPlacement: resolveFieldWithFallback(override.horizontalPlacement, global.horizontalPlacement, 'auto'),
    motionProfileId,
    motionProfile: KINETIC_MOTION_PROFILES[motionProfileId] || KINETIC_MOTION_PROFILES.excited,
    sizeMultiplier,
    verticalOffset,
    textStyle,
    styleControls,
    pinPlacement: !!style?.pinPlacement,
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

function splitCuesIntoMicroCues(cues, wordsPerCue = 0) {
  const microCues = []
  // wordsPerCue forces a fixed group size (1 = the "Punch" one-word-at-a-time
  // preset). 0/unset keeps the default adaptive 1-3 word grouping.
  const maxWords = wordsPerCue && wordsPerCue >= 1
    ? Math.min(wordsPerCue, MAX_MICRO_CUE_WORDS)
    : MAX_MICRO_CUE_WORDS

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

      let take = Math.min(maxWords, remaining)

      if (maxWords > 1 && remaining > 1 && take > 1 && microIndex % SINGLE_WORD_CHANCE_EVERY === 0) {
        take = 1
      }
      if (maxWords > 1 && remaining === MAX_MICRO_CUE_WORDS + 1) {
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
  if (wordCount <= 1) ratio = 0.24
  else if (wordCount <= 2) ratio = 0.15
  else ratio = 0.115

  const raw = shortEdge * ratio
  return clamp(Math.round(raw), 22, Math.round(canvasWidth * 0.4))
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

function drawWord(ctx, word, anim, color, glowColor, style, textStyle = 'plain', styleControls = {}) {
  if (!anim.visible || anim.opacity <= 0.01) return

  ctx.save()
  ctx.globalAlpha = anim.opacity

  const cx = word.x + word.measuredWidth / 2
  const cy = word.y - word.fontSize * 0.35

  // Active-word bump: the word currently being spoken gets a subtle +6% scale
  // on top of the entrance animation's current scale, which keeps the viewer's
  // eye locked to the moving target without stealing attention from the text.
  const activeBoost = anim.isActive ? 1.06 : 1
  const effectiveScale = anim.scale * activeBoost

  ctx.translate(cx, cy)
  ctx.scale(effectiveScale, effectiveScale)
  ctx.translate(-cx, -cy)

  setFont(ctx, word.fontSize, style.fontFamily, style.fontWeight)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  if (anim.blur > 0.5) {
    ctx.filter = `blur(${anim.blur.toFixed(1)}px)`
  }

  const fs = word.fontSize

  // Legibility treatment (applies to every word). 'background' is handled at the
  // group level (a scrim behind the whole phrase), so here it behaves like plain.
  if (textStyle === 'outline') {
    ctx.lineJoin = 'round'
    const outlineThickness = normalizePercent(styleControls.outlineThickness, 9, 0, 22)
    ctx.lineWidth = Math.max(0, Math.round(fs * outlineThickness / 100))
    ctx.strokeStyle = colorWithOpacity(styleControls.outlineColor || '#000000', 100)
    ctx.strokeText(word.text, word.x, word.y)
  }

  // Shadow/glow pass: the spoken word always lights up in the accent glow (the
  // signature kinetic highlight); otherwise honor the chosen text style.
  if (anim.isActive) {
    ctx.shadowColor = glowColor
    ctx.shadowBlur = 28
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  } else if (textStyle === 'shadow') {
    const shadowBlur = normalizePercent(styleControls.shadowBlur, 18, 0, 60)
    const shadowDistance = normalizePercent(styleControls.shadowDistance, 5, 0, 30)
    const distance = Math.round(fs * shadowDistance / 100)
    ctx.shadowColor = colorWithOpacity(styleControls.shadowColor || '#000000', normalizePercent(styleControls.shadowOpacity, 75))
    ctx.shadowBlur = Math.round(fs * shadowBlur / 100)
    ctx.shadowOffsetX = distance
    ctx.shadowOffsetY = distance
  } else {
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
  }
  ctx.fillStyle = color
  ctx.fillText(word.text, word.x, word.y)

  // Crisp pass on top so the glyph stays sharp over its own glow/shadow.
  ctx.shadowBlur = 0
  ctx.shadowColor = 'transparent'
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

  // Continuous up/down nudge from the slider, layered on the anchor above.
  anchorY += (behavior?.verticalOffset || 0) * height

  let dx = anchorX - currentCenterX
  let dy = anchorY - currentCenterY

  // Punch-style presets land every word on the same anchor (no drift, no
  // sentence-end shift), while still honoring the placement chips + nudge.
  if (behavior?.pinPlacement) {
    return { dx, dy }
  }

  const shouldPinCenterPunch = isHighlighted
    && microCue.wordCount === 1
    && (horizontalPlacement === 'auto' || horizontalPlacement === 'center')
    && (verticalPlacement === 'auto' || verticalPlacement === 'middle')

  if (shouldPinCenterPunch) {
    return { dx, dy }
  }

  if (microCue.isSentenceEnd && verticalPlacement === 'auto') {
    dy += -height * 0.08 * variety
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
// Keep the laid-out word block inside a safe area so drift / nudge / large
// sizes never push text off the frame. Shifts the whole block as a unit
// (rather than clipping individual words, which looked sliced).
// ---------------------------------------------------------------------------

function clampBlockIntoSafeArea(positioned, width, height) {
  if (!Array.isArray(positioned) || positioned.length === 0) return
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const w of positioned) {
    minX = Math.min(minX, w.x)
    maxX = Math.max(maxX, w.x + w.measuredWidth)
    minY = Math.min(minY, w.y - w.fontSize)        // approx cap height above baseline
    maxY = Math.max(maxY, w.y + w.fontSize * 0.22) // approx descender below baseline
  }

  const marginX = width * 0.04
  const marginY = height * 0.05
  const blockW = maxX - minX
  const blockH = maxY - minY

  let shiftX = 0
  if (blockW <= width - marginX * 2) {
    if (minX < marginX) shiftX = marginX - minX
    else if (maxX > width - marginX) shiftX = (width - marginX) - maxX
  } else {
    shiftX = (width - blockW) / 2 - minX // too wide to fit: center horizontally
  }

  let shiftY = 0
  if (blockH <= height - marginY * 2) {
    if (minY < marginY) shiftY = marginY - minY
    else if (maxY > height - marginY) shiftY = (height - marginY) - maxY
  } else {
    shiftY = (height - blockH) / 2 - minY // too tall to fit: center vertically
  }

  if (shiftX !== 0 || shiftY !== 0) {
    for (const w of positioned) { w.x += shiftX; w.y += shiftY }
  }
}

// ---------------------------------------------------------------------------
// Background scrim for Bold Dark preset
// ---------------------------------------------------------------------------

function drawWordGroupBackground(ctx, positioned, scrimColor, opacity, styleControls = {}) {
  if (!positioned.length || !scrimColor || opacity <= 0.01) return
  const fontSize = positioned[0].fontSize
  const pad = fontSize * normalizePercent(styleControls.backgroundPadding, 45, 10, 90) / 100
  const minX = Math.min(...positioned.map((w) => w.x)) - pad
  const maxX = Math.max(...positioned.map((w) => w.x + w.measuredWidth)) + pad
  const minY = Math.min(...positioned.map((w) => w.y)) - fontSize * 0.85 - pad
  const maxY = Math.max(...positioned.map((w) => w.y)) + fontSize * 0.2 + pad
  const radius = fontSize * normalizePercent(styleControls.backgroundRadius, 25, 0, 80) / 100

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.fillStyle = colorWithOpacity(
    styleControls.backgroundColor || scrimColor,
    normalizePercent(styleControls.backgroundOpacity, 65)
  )
  ctx.beginPath()
  ctx.moveTo(minX + radius, minY)
  ctx.lineTo(maxX - radius, minY)
  ctx.quadraticCurveTo(maxX, minY, maxX, minY + radius)
  ctx.lineTo(maxX, maxY - radius)
  ctx.quadraticCurveTo(maxX, maxY, maxX - radius, maxY)
  ctx.lineTo(minX + radius, maxY)
  ctx.quadraticCurveTo(minX, maxY, minX, maxY - radius)
  ctx.lineTo(minX, minY + radius)
  ctx.quadraticCurveTo(minX, minY, minX + radius, minY)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Public: render one kinetic caption frame
// ---------------------------------------------------------------------------

let microCueCache = null
let microCueCacheKey = null

function getMicroCues(cues, wordsPerCue = 0) {
  const key = `wpc:${wordsPerCue}|` + (Array.isArray(cues) ? cues : [])
    .map((c) => `${c.id}|${c.start}|${c.end}|${c.text}|${JSON.stringify(c.override || {})}|${JSON.stringify(c.globalOverrides || {})}`)
    .join(',')
  if (microCueCacheKey === key && microCueCache) return microCueCache
  microCueCache = splitCuesIntoMicroCues(cues, wordsPerCue)
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
  const textStyle = g.textStyle || g.subtitleTextStyle || style.subtitleTextStyle || 'background'
  const fontFamily = g.fontFamily || style.fontFamily || 'Inter'
  const sizeScale = Number(g.sizeScale)
  const sizeMultiplier = Number.isFinite(sizeScale) ? clamp(sizeScale, 0.3, 2) : 1

  const fontSize = clamp(Math.round(Math.min(width, height) * 0.045 * sizeMultiplier), 16, 96)
  const lineHeight = fontSize * 1.3
  const padding = fontSize * normalizePercent(g.backgroundPadding, 60, 10, 90) / 100
  const maxWidth = width * 0.88

  setFont(ctx, fontSize, fontFamily, style.fontWeight)
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

  // Continuous up/down nudge from the slider, then keep the block on-screen.
  const verticalOffset = Number(g.verticalOffset)
  if (Number.isFinite(verticalOffset)) {
    blockY += clamp(verticalOffset, -0.45, 0.45) * height
  }
  const safeMargin = height * 0.04
  blockY = clamp(blockY, safeMargin, Math.max(safeMargin, height - blockHeight - safeMargin))

  const centerX = width / 2

  ctx.save()

  const cueAge = time - (Number(activeCue.start) || 0)
  const cueRemaining = (Number(activeCue.end) || 0) - time
  let opacity = 1
  if (cueAge < 0.15) opacity = clamp(cueAge / 0.15, 0, 1)
  if (cueRemaining < 0.15) opacity = clamp(cueRemaining / 0.15, 0, 1)
  ctx.globalAlpha = opacity

  if (textStyle === 'background') {
    ctx.fillStyle = colorWithOpacity(g.backgroundColor || '#000000', normalizePercent(g.backgroundOpacity, 65))
    const boxWidth = Math.min(maxWidth + padding * 2, width * 0.92)
    const boxX = centerX - boxWidth / 2
    const radius = Math.round(fontSize * normalizePercent(g.backgroundRadius, 30, 0, 80) / 100)
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

  setFont(ctx, fontSize, fontFamily, style.fontWeight)
  ctx.fillStyle = textColor

  if (textStyle === 'outline') {
    ctx.strokeStyle = colorWithOpacity(g.outlineColor || '#000000', 100)
    ctx.lineWidth = Math.max(0, Math.round(fontSize * normalizePercent(g.outlineThickness, 9, 0, 22) / 100))
    ctx.lineJoin = 'round'
    lines.forEach((line, index) => {
      const y = blockY + padding + (index + 0.75) * lineHeight
      ctx.strokeText(line, centerX, y)
    })
  }

  if (textStyle === 'shadow') {
    const shadowDistance = Math.round(fontSize * normalizePercent(g.shadowDistance, 5, 0, 30) / 100)
    ctx.shadowColor = colorWithOpacity(g.shadowColor || '#000000', normalizePercent(g.shadowOpacity, 75))
    ctx.shadowBlur = Math.round(fontSize * normalizePercent(g.shadowBlur, 25, 0, 60) / 100)
    ctx.shadowOffsetX = shadowDistance
    ctx.shadowOffsetY = shadowDistance
  }

  lines.forEach((line, index) => {
    const y = blockY + padding + (index + 0.75) * lineHeight
    ctx.fillText(line, centerX, y)
  })

  ctx.restore()
}

export function renderKineticCaptionFrame({ ctx, width, height, style, cues, time = 0, freeze = false }) {
  if (!ctx || !width || !height) return
  ctx.clearRect(0, 0, width, height)

  const resolvedStyle = typeof style === 'string' ? getKineticStyleById(style) : (style || KINETIC_CAPTION_STYLES[0])

  if (resolvedStyle.traditional) {
    renderTraditionalSubtitle(ctx, width, height, resolvedStyle, cues, time)
    return
  }

  const microCues = getMicroCues(cues, resolvedStyle.singleWord ? 1 : 0)

  const activeIndex = microCues.findIndex((mc) => time >= mc.start && time < mc.end)
  if (activeIndex < 0) return
  const active = microCues[activeIndex]
  const behavior = resolveKineticBehavior(resolvedStyle, active)
  const motionProfile = behavior.motionProfile
  const styleControls = behavior.styleControls || {}
  const renderStyle = {
    ...resolvedStyle,
    fontFamily: styleControls.fontFamily || resolvedStyle.fontFamily,
  }

  const baseTextColor = resolvedStyle.textColor
  const accentTextColor = resolvedStyle.keyWordColor
  const baseGlowColor = resolvedStyle.baseGlowColor || 'rgba(255,255,255,0.2)'
  const accentGlow = resolvedStyle.glowColor || baseGlowColor

  const baseFontSize = computeFontSize(active.wordCount, width, height)
  const fontSize = Math.round(baseFontSize * (behavior.sizeMultiplier || 1))
  const positioned = layoutMicroCue(ctx, active, fontSize, renderStyle, width, height)

  const { dx, dy } = getPositionOffset(activeIndex, active, width, height, positioned, behavior)
  if (dx !== 0 || dy !== 0) {
    for (const word of positioned) {
      word.x += dx
      word.y += dy
    }
  }

  // Pull the whole block back inside the safe area if drift/nudge/size sent it
  // toward an edge, so words read fully instead of getting clipped.
  clampBlockIntoSafeArea(positioned, width, height)

  const mcDuration = active.end - active.start
  const wordCount = positioned.length
  const entranceSpread = Math.min(0.6, wordCount * 0.06) * mcDuration * (motionProfile.entranceSpreadMultiplier ?? 1)

  const safeWordCount = Math.max(1, wordCount)
  const perWord = mcDuration / safeWordCount

  // Clip all drawing to the canvas bounds so glow/drift never bleeds outside the frame
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()

  // A scrim sits behind the phrase when the preset has a baked scrim color or
  // the user picked the 'background' text style.
  const scrimColor = resolvedStyle.bgScrim || (behavior.textStyle === 'background' ? (styleControls.backgroundColor || '#000000') : null)
  if (scrimColor) {
    const cueAge = time - active.start
    const cueRemaining = active.end - time
    const enterD = motionProfile?.enterDuration ?? 0.14
    const exitD = motionProfile?.exitDuration ?? 0.18
    let scrimOpacity = 1
    if (cueAge < enterD) scrimOpacity = clamp(cueAge / enterD, 0, 1)
    if (cueRemaining < exitD && cueRemaining >= 0) scrimOpacity *= clamp(cueRemaining / exitD, 0, 1)
    drawWordGroupBackground(ctx, positioned, scrimColor, scrimOpacity, styleControls)
  }

  for (let i = 0; i < positioned.length; i++) {
    const wordEnter = active.start + (entranceSpread * (i / Math.max(1, wordCount)))
    // freeze = a settled still (full opacity, no entrance/exit) for the preview,
    // so it never lands on a zero-opacity entrance frame at a cue boundary.
    const anim = freeze
      ? { visible: true, opacity: 1, scale: 1, blur: 0 }
      : getWordAnimState(time, wordEnter, active.end, motionProfile)

    const speakStart = active.start + (i * perWord)
    const speakEnd = active.start + ((i + 1) * perWord)
    // In a frozen still, highlight the last word so the accent color still reads.
    const isActiveWord = freeze
      ? (i === positioned.length - 1)
      : (time >= speakStart && time < speakEnd)

    // Single-word presets (Punch) show one word at a time, so every word would
    // be "active" the whole time — keep them in the base color and reserve the
    // accent for genuine emphasis words (numbers, sentence enders). Other
    // presets accent whichever word is currently being spoken.
    const accentOn = resolvedStyle.singleWord ? isMicroCueHighlighted(active) : isActiveWord

    drawWord(
      ctx,
      positioned[i],
      { ...anim, isActive: isActiveWord },
      accentOn ? accentTextColor : baseTextColor,
      accentOn ? accentGlow : baseGlowColor,
      renderStyle,
      behavior.textStyle,
      styleControls,
    )
  }

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Public: preview for preset card
// ---------------------------------------------------------------------------

// A still, readable rendering of the full sample phrase for the preset card —
// the live animation only shows a 1-3 word fragment at any instant, which made
// some cards (e.g. a lone "your") look broken. The last word takes the accent
// color so the card still communicates the highlight behavior.
function drawStaticKineticPreview(ctx, width, height, style, globalOverrides = null) {
  const behavior = resolveKineticBehavior(style, { globalOverrides })
  const styleControls = behavior.styleControls || {}
  const renderStyle = {
    ...style,
    fontFamily: styleControls.fontFamily || style.fontFamily,
  }
  const words = String(style.sampleText || 'Caption style').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return

  const maxLineWidth = width * 0.86
  let fontSize = Math.round(Math.min(width, height) * 0.24)

  const tooWide = () => {
    setFont(ctx, fontSize, renderStyle.fontFamily, renderStyle.fontWeight)
    return words.some((w) => ctx.measureText(w).width > maxLineWidth)
  }
  while (fontSize > 12 && tooWide()) fontSize -= 2
  setFont(ctx, fontSize, renderStyle.fontFamily, renderStyle.fontWeight)

  // Greedy wrap into at most two lines.
  const lines = []
  let current = words[0]
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`
    if (ctx.measureText(candidate).width <= maxLineWidth && lines.length < 1) {
      current = candidate
    } else {
      lines.push(current)
      current = words[i]
    }
  }
  if (current) lines.push(current)

  const gap = fontSize * 0.28
  const lineHeight = fontSize * 1.12
  const totalHeight = lines.length * lineHeight
  const firstBaseline = (height - totalHeight) / 2 + fontSize * 0.82

  if (style.bgScrim || behavior.textStyle === 'background') {
    let minX = Infinity, maxX = -Infinity
    lines.forEach((line) => {
      const w = ctx.measureText(line).width
      minX = Math.min(minX, (width - w) / 2)
      maxX = Math.max(maxX, (width + w) / 2)
    })
    const pad = fontSize * normalizePercent(styleControls.backgroundPadding, 45, 10, 90) / 100
    ctx.fillStyle = colorWithOpacity(
      styleControls.backgroundColor || '#000000',
      normalizePercent(styleControls.backgroundOpacity, 65)
    )
    ctx.fillRect(minX - pad, firstBaseline - fontSize, (maxX - minX) + pad * 2, totalHeight + fontSize * 0.4)
  }

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  lines.forEach((line, li) => {
    const lineWords = line.split(' ')
    const widths = lineWords.map((w) => ctx.measureText(w).width)
    const lineWidth = widths.reduce((a, b) => a + b, 0) + gap * (lineWords.length - 1)
    let x = (width - lineWidth) / 2
    const y = firstBaseline + li * lineHeight
    lineWords.forEach((w, wi) => {
      const isLastOverall = li === lines.length - 1 && wi === lineWords.length - 1
      ctx.save()
      ctx.shadowColor = isLastOverall ? (style.glowColor || 'rgba(255,255,255,0.4)') : (style.baseGlowColor || 'rgba(255,255,255,0.18)')
      ctx.shadowBlur = 16
      ctx.fillStyle = isLastOverall ? (style.keyWordColor || style.textColor) : (style.textColor || '#FFFFFF')
      if (behavior.textStyle === 'outline') {
        ctx.lineJoin = 'round'
        ctx.lineWidth = Math.max(0, Math.round(fontSize * normalizePercent(styleControls.outlineThickness, 9, 0, 22) / 100))
        ctx.strokeStyle = colorWithOpacity(styleControls.outlineColor || '#000000', 100)
        ctx.strokeText(w, x, y)
      } else if (behavior.textStyle === 'shadow' && !isLastOverall) {
        const shadowDistance = Math.round(fontSize * normalizePercent(styleControls.shadowDistance, 5, 0, 30) / 100)
        ctx.shadowColor = colorWithOpacity(styleControls.shadowColor || '#000000', normalizePercent(styleControls.shadowOpacity, 75))
        ctx.shadowBlur = Math.round(fontSize * normalizePercent(styleControls.shadowBlur, 18, 0, 60) / 100)
        ctx.shadowOffsetX = shadowDistance
        ctx.shadowOffsetY = shadowDistance
      }
      ctx.fillText(w, x, y)
      ctx.restore()
      x += widths[wi] + gap
    })
  })
}

export function renderKineticPreviewDataUrl(styleOrId, width = 240, height = 140, globalOverrides = null) {
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

  // Traditional subtitles already render their full text in one frame; animated
  // presets get the static full-phrase rendering instead of a mid-animation grab.
  if (style.traditional) {
    const previewCues = [
      { id: 'p1', start: 0, end: 1.5, text: style.sampleText || 'Simple readable subtitles.', globalOverrides },
    ]
    renderKineticCaptionFrame({ ctx, width, height, style, cues: previewCues, time: 0.6 })
  } else {
    drawStaticKineticPreview(ctx, width, height, style, globalOverrides)
  }

  return canvas.toDataURL('image/png')
}

// ---------------------------------------------------------------------------
// Public: record transparent WebM
// ---------------------------------------------------------------------------

export async function generateKineticCaptionVideoBlob({ style, cues, width, height, duration, fps, onProgress }) {
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

    let lastReportedPercent = -1
    const reportProgress = () => {
      if (typeof onProgress !== 'function') return
      const percent = Math.min(99, Math.floor((frame / totalFrames) * 100))
      if (percent > lastReportedPercent) {
        lastReportedPercent = percent
        onProgress(percent)
      }
    }

    drawFrame()
    recorder.start()
    reportProgress()
    if (totalFrames <= 1) { recorder.stop(); return }

    timer = setInterval(() => {
      frame += 1
      drawFrame()
      reportProgress()
      if (frame >= totalFrames - 1) { clearInterval(timer); timer = null; recorder.stop() }
    }, frameIntervalMs)
  })
}
