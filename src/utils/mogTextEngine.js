import { quoteCssFontFamily } from './fontFamily'

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

function easeInCubic(t) {
  return t * t * t
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function withAlpha(color, alpha = 1) {
  if (typeof color !== 'string') return `rgba(255,255,255,${alpha})`
  const normalized = color.trim()
  if (!normalized.startsWith('#')) return color
  let hex = normalized.slice(1)
  if (hex.length === 3) {
    hex = hex.split('').map((char) => char + char).join('')
  }
  if (hex.length !== 6) return color
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function setFont(ctx, size, family, weight = '700') {
  ctx.font = `${weight} ${Math.round(size)}px ${quoteCssFontFamily(family)}, sans-serif`
}

function measureTextWidth(ctx, text, letterSpacing = 0) {
  const base = ctx.measureText(text).width
  const spacing = Math.max(0, Number(letterSpacing) || 0)
  return base + Math.max(0, text.length - 1) * spacing
}

function balanceTextLines(text, targetLines) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  if (!Number.isFinite(targetLines) || targetLines <= 1 || words.length <= 1) return [words.join(' ')]

  const lines = Array.from({ length: Math.min(targetLines, words.length) }, () => [])
  const totalChars = words.reduce((sum, word) => sum + word.length, 0)
  const targetCharsPerLine = totalChars / lines.length

  let lineIndex = 0
  let currentChars = 0
  words.forEach((word, index) => {
    const remainingWords = words.length - index
    const remainingLines = lines.length - lineIndex
    if (
      lineIndex < lines.length - 1
      && currentChars >= targetCharsPerLine
      && remainingWords >= remainingLines
    ) {
      lineIndex += 1
      currentChars = 0
    }
    lines[lineIndex].push(word)
    currentChars += word.length + 1
  })

  return lines.map((line) => line.join(' ')).filter(Boolean)
}

function wrapTextAuto(ctx, text, maxWidth, letterSpacing = 0, maxLines = 3) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines = []
  let currentLine = words[0]
  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${currentLine} ${words[i]}`
    if (measureTextWidth(ctx, candidate, letterSpacing) <= maxWidth || currentLine.length === 0) {
      currentLine = candidate
    } else {
      lines.push(currentLine)
      currentLine = words[i]
    }
  }
  lines.push(currentLine)

  if (lines.length <= maxLines) return lines
  const merged = [...lines]
  while (merged.length > maxLines) {
    merged[merged.length - 2] = `${merged[merged.length - 2]} ${merged[merged.length - 1]}`
    merged.pop()
  }
  return merged
}

function fitTextBlock({
  ctx,
  text,
  maxWidth,
  baseSize,
  minSize = 24,
  lineTarget = 'auto',
  fontFamily,
  fontWeight,
  letterSpacing = 0,
  maxLines = 3,
}) {
  const requestedLines = Number(lineTarget)
  let fontSize = baseSize
  let lines = ['']

  while (fontSize >= minSize) {
    setFont(ctx, fontSize, fontFamily, fontWeight)
    lines = Number.isFinite(requestedLines) && requestedLines > 0
      ? balanceTextLines(text, requestedLines)
      : wrapTextAuto(ctx, text, maxWidth, letterSpacing, maxLines)

    const widest = Math.max(...lines.map((line) => measureTextWidth(ctx, line, letterSpacing)), 0)
    if (widest <= maxWidth || fontSize === minSize) {
      break
    }
    fontSize -= 2
  }

  return { fontSize, lines }
}

function fitTextContent({
  ctx,
  headlineText,
  subheadlineText,
  kickerText,
  maxWidth,
  maxHeight,
  headlineBaseSize,
  subtitleBaseSize,
  fontFamily,
  fontWeight,
  letterSpacing = 0,
  lineTarget = 'auto',
  showKicker = true,
}) {
  let headlineSize = headlineBaseSize
  let subtitleSize = subtitleBaseSize
  let fittedHeadline = { fontSize: headlineSize, lines: [headlineText || ''] }
  let fittedSubtitle = { fontSize: subtitleSize, lines: [subheadlineText || ''] }

  while (headlineSize >= 24) {
    fittedHeadline = fitTextBlock({
      ctx,
      text: headlineText,
      maxWidth,
      baseSize: headlineSize,
      minSize: 24,
      lineTarget,
      fontFamily,
      fontWeight,
      letterSpacing,
      maxLines: 3,
    })

    fittedSubtitle = fitTextBlock({
      ctx,
      text: subheadlineText,
      maxWidth,
      baseSize: subtitleSize,
      minSize: 14,
      lineTarget: 'auto',
      fontFamily,
      fontWeight: '500',
      letterSpacing: 0,
      maxLines: 2,
    })

    const kickerSize = showKicker && kickerText
      ? clamp(fittedHeadline.fontSize * 0.22, 14, 24)
      : 0
    const kickerGap = kickerSize > 0 ? kickerSize + 10 : 0
    const headlineLineHeight = fittedHeadline.fontSize * 1.02
    const subtitleLineHeight = fittedSubtitle.fontSize * 1.16
    const headlineHeight = fittedHeadline.lines.length * headlineLineHeight
    const subtitleHeight = subheadlineText ? fittedSubtitle.lines.length * subtitleLineHeight + 8 : 0
    const totalHeight = kickerGap + headlineHeight + subtitleHeight

    if (totalHeight <= maxHeight || (headlineSize <= 24 && subtitleSize <= 14)) {
      return {
        headline: fittedHeadline,
        subtitle: fittedSubtitle,
        kickerSize,
        kickerGap,
        headlineLineHeight,
        subtitleLineHeight,
        totalHeight,
      }
    }

    headlineSize = Math.max(24, headlineSize - 2)
    subtitleSize = Math.max(14, subtitleSize - 1)
  }

  const kickerSize = showKicker && kickerText
    ? clamp(fittedHeadline.fontSize * 0.22, 14, 24)
    : 0
  const kickerGap = kickerSize > 0 ? kickerSize + 10 : 0
  const headlineLineHeight = fittedHeadline.fontSize * 1.02
  const subtitleLineHeight = fittedSubtitle.fontSize * 1.16
  const headlineHeight = fittedHeadline.lines.length * headlineLineHeight
  const subtitleHeight = subheadlineText ? fittedSubtitle.lines.length * subtitleLineHeight + 8 : 0

  return {
    headline: fittedHeadline,
    subtitle: fittedSubtitle,
    kickerSize,
    kickerGap,
    headlineLineHeight,
    subtitleLineHeight,
    totalHeight: kickerGap + headlineHeight + subtitleHeight,
  }
}

function getPaceConfig(pace, duration, animationDurationScale = 1) {
  const safeDuration = Math.max(0.9, Number(duration) || 3.5)
  const speedScale = clamp(Number(animationDurationScale) || 1, 0.5, 3)
  let entry = 0.72
  let exit = 0.52

  if (pace === 'soft') {
    entry = Math.min(1.15, safeDuration * 0.34)
    exit = Math.min(0.8, safeDuration * 0.22)
  } else if (pace === 'snappy') {
    entry = Math.min(0.48, safeDuration * 0.18)
    exit = Math.min(0.38, safeDuration * 0.14)
  } else {
    entry = Math.min(0.72, safeDuration * 0.24)
    exit = Math.min(0.52, safeDuration * 0.18)
  }

  const entryGuard = 0.2
  const maxEntry = Math.max(0.14, safeDuration - exit - entryGuard)

  return {
    entry: clamp(entry * speedScale, 0.12, maxEntry),
    exit,
  }
}

function getDirectionVector(direction, width, height) {
  const distanceX = width * 0.16
  const distanceY = height * 0.12
  switch (direction) {
    case 'right':
      return { x: distanceX, y: 0 }
    case 'up':
      return { x: 0, y: -distanceY }
    case 'down':
      return { x: 0, y: distanceY }
    case 'left':
    default:
      return { x: -distanceX, y: 0 }
  }
}

function getResolvedMaskMode(maskMode, fallbackMode = 'directional') {
  if (maskMode === 'none') return 'none'
  if (maskMode === 'center') return 'center'
  if (maskMode === 'left' || maskMode === 'right' || maskMode === 'up' || maskMode === 'down') {
    return maskMode
  }
  return fallbackMode
}

function getInflateScale(entryProgress, inflateAmount = 0) {
  const amount = clamp(Number(inflateAmount) || 0, 0, 2)
  return {
    x: lerp(1 + amount * 0.18, 1, entryProgress),
    y: lerp(1 + amount, 1, entryProgress),
  }
}

function splitTextUnits(text, granularity) {
  if (granularity === 'character') {
    return Array.from(text || '')
  }

  if (granularity === 'word') {
    return String(text || '').match(/\S+\s*/g) || ['']
  }

  return [text]
}

function isVisibleCharacter(unit) {
  return /\S/.test(unit || '')
}

function resolveCharacterFx(characterFx, visibleIndex) {
  if (visibleIndex == null || !Array.isArray(characterFx) || characterFx.length === 0) {
    return null
  }

  const oneBasedIndex = visibleIndex + 1
  let match = null

  characterFx.forEach((rule) => {
    const start = Math.max(1, Math.round(Number(rule?.start) || 1))
    const end = Math.max(start, Math.round(Number(rule?.end) || start))
    if (oneBasedIndex >= start && oneBasedIndex <= end) {
      match = {
        xOffset: clamp(Number(rule?.xOffset) || 0, -160, 160),
        yOffset: clamp(Number(rule?.yOffset) || 0, -160, 160),
        scale: clamp(Number(rule?.scale) || 1, 0.25, 3),
        opacity: clamp(Number(rule?.opacity) || 1, 0.05, 1),
        delay: clamp(Number(rule?.delay) || 0, 0, 0.65),
        rotation: clamp(Number(rule?.rotation) || 0, -45, 45),
        color: rule?.color || null,
      }
    }
  })

  return match
}

function drawTextSegment(ctx, text, x, y, options) {
  const {
    fontSize,
    fontFamily,
    fontWeight,
    letterSpacing,
    color,
    blur = 0,
    scaleX = 1,
    scaleY = 1,
    rotation = 0,
    scaleOrigin = 'top-left',
    unitWidth = null,
  } = options
  setFont(ctx, fontSize, fontFamily, fontWeight)
  ctx.fillStyle = color
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  const measuredWidth = unitWidth ?? measureTextWidth(ctx, text, letterSpacing)
  const textHeight = fontSize

  const previousFilter = ctx.filter
  if (blur > 0.01) {
    ctx.filter = `blur(${blur.toFixed(2)}px)`
  }

  ctx.save()
  let drawStartX = 0
  let drawStartY = 0
  if (scaleOrigin === 'center-bottom') {
    ctx.translate(x + measuredWidth / 2, y + textHeight)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(scaleX, scaleY)
    drawStartX = -measuredWidth / 2
    drawStartY = -textHeight
  } else if (scaleOrigin === 'center') {
    ctx.translate(x + measuredWidth / 2, y + textHeight / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(scaleX, scaleY)
    drawStartX = -measuredWidth / 2
    drawStartY = -textHeight / 2
  } else {
    ctx.translate(x, y)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(scaleX, scaleY)
  }

  if (!letterSpacing) {
    ctx.fillText(text, drawStartX, drawStartY)
    ctx.restore()
    ctx.filter = previousFilter
    return
  }

  const spacing = Number(letterSpacing) || 0
  const glyphs = Array.from(text)
  const widths = glyphs.map((glyph) => ctx.measureText(glyph).width)
  let cursorX = drawStartX

  glyphs.forEach((glyph, index) => {
    ctx.fillText(glyph, cursorX, drawStartY)
    cursorX += widths[index] + spacing
  })

  ctx.restore()
  ctx.filter = previousFilter
}

function drawGranularLine({
  ctx,
  text,
  anchorX,
  y,
  align,
  options,
  unitOrderRef,
  totalUnits,
  baseProgress,
  staggerStep,
  granularity,
}) {
  setFont(ctx, options.fontSize, options.fontFamily, options.fontWeight)
  const units = splitTextUnits(text, granularity)
  const widths = units.map((unit) => measureTextWidth(ctx, unit, options.letterSpacing))
  const totalWidth = widths.reduce((sum, width) => sum + width, 0)
  let startX = anchorX

  if (align === 'center') {
    startX = anchorX - totalWidth / 2
  } else if (align === 'right') {
    startX = anchorX - totalWidth
  }

  const maxStep = totalUnits > 1 ? 0.82 / (totalUnits - 1) : 0
  const effectiveStep = Math.min(staggerStep, maxStep)
  let cursorX = startX

  units.forEach((unit, index) => {
    const order = unitOrderRef.value + index
    const visibleCharacterIndex = options.characterFxIndexRef && granularity === 'character' && isVisibleCharacter(unit)
      ? options.characterFxIndexRef.value
      : null
    const characterFx = resolveCharacterFx(options.characterFx, visibleCharacterIndex)
    const delay = Math.min(0.92, order * effectiveStep + (characterFx?.delay || 0))
    const reveal = totalUnits > 1
      ? clamp((baseProgress - delay) / Math.max(0.01, 1 - delay), 0, 1)
      : baseProgress
    const revealEase = easeOutCubic(reveal)
    const blur = (options.blurAmount || 0) * (1 - revealEase)
    const unitScale = getInflateScale(revealEase, options.inflateAmount)
    const persistentScale = characterFx?.scale || 1
    const shiftX = characterFx?.xOffset || 0
    const shiftY = (1 - revealEase) * (options.shiftY || 0) + (characterFx?.yOffset || 0)

    ctx.save()
    ctx.globalAlpha *= reveal * (characterFx?.opacity || 1)
    drawTextSegment(ctx, unit, cursorX + shiftX, y + shiftY, {
      fontSize: options.fontSize,
      fontFamily: options.fontFamily,
      fontWeight: options.fontWeight,
      letterSpacing: options.letterSpacing,
      color: characterFx?.color || options.color,
      blur,
      scaleX: unitScale.x * persistentScale,
      scaleY: unitScale.y * persistentScale,
      rotation: characterFx?.rotation || 0,
      scaleOrigin: options.scaleOrigin,
      unitWidth: widths[index],
    })
    ctx.restore()

    cursorX += widths[index]
    if (options.characterFxIndexRef && granularity === 'character' && isVisibleCharacter(unit)) {
      options.characterFxIndexRef.value += 1
    }
  })

  unitOrderRef.value += units.length
}

export function getMogMotionState({
  family,
  direction,
  pace,
  exitStyle,
  duration,
  time,
  width,
  height,
  animationDurationScale = 1,
  textGranularity = 'line',
  staggerStep = 0.12,
  blurAmount = 0,
  trackingPull = 0,
  overshootAmount = 0,
  maskMode = 'auto',
  inflateAmount = 0,
}) {
  const { entry, exit } = getPaceConfig(pace, duration, animationDurationScale)
  const localTime = ((time % duration) + duration) % duration
  const entryProgress = clamp(localTime / entry, 0, 1)
  const shouldExit = exitStyle !== 'none'
  const exitStart = shouldExit ? Math.max(entry + 0.35, duration - exit) : duration + 1
  const exitProgress = shouldExit ? clamp((localTime - exitStart) / exit, 0, 1) : 0
  const directionVector = getDirectionVector(direction, width, height)

  let alpha = 1
  let scale = 1
  let translateX = 0
  let translateY = 0
  let reveal = 1
  let boxProgress = 1
  let textProgress = 1
  let accentProgress = 1
  let revealMode = 'directional'
  let trackingBoost = 0
  let lineShiftY = 0
  let scaleOrigin = 'top-left'

  const entryEase = easeOutCubic(entryProgress)
  const entryEaseSmooth = easeInOutCubic(entryProgress)

  if (family === 'slide') {
    alpha = entryEase
    translateX = directionVector.x * (1 - entryEase)
    translateY = directionVector.y * (1 - entryEase)
  } else if (family === 'wipe') {
    alpha = lerp(0.2, 1, entryEase)
    reveal = entryEaseSmooth
    translateX = directionVector.x * (1 - entryEase) * 0.22
    translateY = directionVector.y * (1 - entryEase) * 0.22
    accentProgress = easeOutCubic(clamp((localTime / entry) * 1.15, 0, 1))
  } else if (family === 'pop') {
    alpha = entryEase
    scale = lerp(0.86, 1, entryEaseSmooth)
    accentProgress = easeOutCubic(clamp((localTime / entry) * 1.1, 0, 1))
  } else if (family === 'reveal') {
    alpha = lerp(0.15, 1, entryEase)
    translateY = (direction === 'up' ? -1 : 1) * height * 0.02 * (1 - entryEase)
    textProgress = easeOutCubic(clamp((localTime / entry) * 1.2, 0, 1))
    accentProgress = easeOutCubic(clamp((localTime / entry) * 0.9, 0, 1))
  } else if (family === 'boxBuild') {
    alpha = 1
    boxProgress = easeOutCubic(entryProgress)
    textProgress = easeOutCubic(clamp((localTime - entry * 0.24) / Math.max(0.2, entry * 0.76), 0, 1))
    accentProgress = easeOutCubic(clamp((localTime - entry * 0.08) / Math.max(0.18, entry * 0.56), 0, 1))
    scale = lerp(0.98, 1, entryEaseSmooth)
  } else if (family === 'underlineGrow') {
    alpha = lerp(0.2, 1, entryEase)
    accentProgress = easeOutCubic(clamp((localTime / entry) * 1.18, 0, 1))
    textProgress = easeOutCubic(clamp((localTime - entry * 0.18) / Math.max(0.18, entry * 0.82), 0, 1))
    translateX = directionVector.x * (1 - entryEase) * 0.12
    translateY = directionVector.y * (1 - entryEase) * 0.12
  } else if (family === 'drift') {
    alpha = lerp(0.18, 1, entryEase)
    scale = lerp(1.04, 1, entryEaseSmooth)
    translateX = directionVector.x * (1 - entryEase) * 0.08
    translateY = directionVector.y * (1 - entryEase) * 0.16 + height * 0.026 * (1 - entryEase)
    textProgress = easeOutCubic(clamp((localTime - entry * 0.08) / Math.max(0.16, entry * 0.92), 0, 1))
    accentProgress = easeOutCubic(clamp((localTime / entry) * 0.82, 0, 1))
  } else if (family === 'trackIn') {
    alpha = lerp(0.2, 1, entryEase)
    scale = lerp(1.015, 1, entryEaseSmooth)
    trackingBoost = lerp(Math.min(5, width * 0.0026), 0, entryEaseSmooth)
    textProgress = easeOutCubic(clamp((localTime / entry) * 1.05, 0, 1))
    accentProgress = easeOutCubic(clamp((localTime - entry * 0.1) / Math.max(0.16, entry * 0.9), 0, 1))
  } else if (family === 'stagger') {
    alpha = 1
    textProgress = entryEaseSmooth
    lineShiftY = height * 0.026
    translateX = directionVector.x * (1 - entryEase) * 0.05
    translateY = directionVector.y * (1 - entryEase) * 0.08
    accentProgress = easeOutCubic(clamp((localTime / entry) * 0.88, 0, 1))
  } else if (family === 'splitReveal') {
    alpha = lerp(0.24, 1, entryEase)
    scale = lerp(0.985, 1, entryEaseSmooth)
    reveal = entryEaseSmooth
    revealMode = 'center'
    textProgress = easeOutCubic(clamp((localTime / entry) * 1.08, 0, 1))
    accentProgress = easeOutCubic(clamp((localTime / entry) * 0.96, 0, 1))
  } else if (family === 'inflateMorph') {
    alpha = lerp(0.24, 1, entryEase)
    textProgress = entryEaseSmooth
    accentProgress = easeOutCubic(clamp((localTime / entry) * 0.72, 0, 1))
    scaleOrigin = 'center-bottom'
    lineShiftY = height * 0.01
    trackingBoost += lerp(clamp(Number(trackingPull) || 0, -3, 8), 0, entryEaseSmooth)
  } else {
    alpha = entryEase
  }

  if (family !== 'inflateMorph') {
    trackingBoost += lerp(clamp(Number(trackingPull) || 0, -8, 8), 0, entryEaseSmooth)
  }

  const overshoot = clamp(Number(overshootAmount) || 0, 0, 0.32)
  if (overshoot > 0) {
    const settle = Math.sin(entryProgress * Math.PI) * (1 - entryProgress * 0.25) * overshoot
    scale *= 1 + Math.max(0, settle)
  }

  const resolvedMaskMode = getResolvedMaskMode(maskMode, revealMode)
  if (resolvedMaskMode === 'none') {
    reveal = 1
  } else if (resolvedMaskMode !== 'directional' || reveal < 0.999) {
    reveal = Math.min(reveal, entryEaseSmooth)
    revealMode = resolvedMaskMode
  }

  if (exitProgress > 0) {
    if (exitStyle === 'fade') {
      alpha *= 1 - easeInCubic(exitProgress)
    } else if (exitStyle === 'match') {
      const exitEase = easeInCubic(exitProgress)
      alpha *= 1 - exitEase
      translateX += directionVector.x * 0.42 * exitEase * -1
      translateY += directionVector.y * 0.42 * exitEase * -1
      scale *= lerp(1, 1.03, exitEase)
      reveal *= 1 - exitEase * 0.18
    }
  }

  return {
    alpha,
    scale,
    translateX,
    translateY,
    reveal,
    boxProgress,
    textProgress,
    accentProgress,
    revealMode,
    trackingBoost,
    lineShiftY,
    scaleOrigin,
    textGranularity: textGranularity || 'line',
    staggerStep: clamp(Number(staggerStep) || 0.12, 0, 0.24),
    blurAmount: clamp(Number(blurAmount) || 0, 0, 24),
    inflateAmount: clamp(Number(inflateAmount) || 0, 0, 2),
  }
}

export function drawMogTextBlock(ctx, rect, preset, controls, motion) {
  const padding = clamp(Number(controls.padding) || preset.padding || 24, 12, 80)
  const headlineText = String(controls.headline || '').trim()
  const subheadlineText = String(controls.subheadline || '').trim()
  const kickerText = String(controls.kicker || '').trim()
  const align = controls.textAlign || preset.textAlign || 'left'
  const anchorX = align === 'center'
    ? rect.x + rect.width / 2
    : align === 'right'
      ? rect.x + rect.width - padding
      : rect.x + padding

  const fitted = fitTextContent({
    ctx,
    headlineText,
    subheadlineText,
    kickerText,
    maxWidth: rect.width - padding * 2,
    maxHeight: rect.height - padding * 1.5,
    headlineBaseSize: Number(controls.fontSize) || preset.fontSize || 78,
    subtitleBaseSize: Number(controls.subtitleSize) || preset.subtitleSize || 30,
    fontFamily: controls.fontFamily || preset.fontFamily,
    fontWeight: controls.fontWeight || preset.fontWeight,
    letterSpacing: controls.letterSpacing || preset.letterSpacing || 0,
    lineTarget: controls.lineCount,
    showKicker: controls.showKicker,
  })

  const headlineLayout = fitted.headline
  const subtitleLayout = fitted.subtitle
  const kickerSize = fitted.kickerSize
  const kickerGap = fitted.kickerGap
  const headlineLineHeight = fitted.headlineLineHeight
  const subtitleLineHeight = fitted.subtitleLineHeight
  const headlineHeight = headlineLayout.lines.length * headlineLineHeight
  const totalHeight = fitted.totalHeight
  const startY = rect.y + (rect.height - totalHeight) / 2
  const baseHeadlineLetterSpacing = Number(controls.letterSpacing ?? preset.letterSpacing ?? 0) || 0
  const headlineLetterSpacing = baseHeadlineLetterSpacing + (motion.trackingBoost || 0)
  const subtitleLetterSpacing = Math.max(0, (motion.trackingBoost || 0) * 0.16)
  const granularity = motion.textGranularity || 'line'
  const headlineCharacterFx = Array.isArray(controls.headlineCharacterFx)
    ? controls.headlineCharacterFx.map((rule) => ({
      ...rule,
      color:
        rule?.tint === 'accent'
          ? controls.accentColor || preset.accentColor
          : rule?.tint === 'accent2'
            ? controls.accentColor2 || preset.accentColor2
            : null,
    }))
    : []
  const headlineGranularity = headlineCharacterFx.length > 0 ? 'character' : granularity
  const subtitleGranularity = granularity === 'block' ? 'block' : granularity

  const totalUnits = (() => {
    if (granularity === 'block' && headlineCharacterFx.length === 0) return 1

    let unitCount = 0
    if (controls.showKicker && kickerText) {
      unitCount += splitTextUnits(kickerText.toUpperCase(), granularity).length
    }
    headlineLayout.lines.forEach((line) => {
      unitCount += splitTextUnits(line, headlineGranularity).length
    })
    if (subheadlineText) {
      subtitleLayout.lines.forEach((line) => {
        unitCount += splitTextUnits(line, subtitleGranularity).length
      })
    }

    return unitCount || 1
  })()

  ctx.save()
  ctx.globalAlpha *= motion.textProgress
  ctx.shadowColor = withAlpha(controls.boxColor || preset.boxColor, 0.26)
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 10

  let cursorY = startY
  const unitOrderRef = { value: 0 }
  const headlineCharacterIndexRef = { value: 0 }
  if (controls.showKicker && kickerText) {
    drawGranularLine({
      ctx,
      text: kickerText.toUpperCase(),
      anchorX,
      y: cursorY,
      align,
      unitOrderRef,
      totalUnits,
      baseProgress: motion.textProgress,
      staggerStep: motion.staggerStep,
      granularity,
      options: {
        fontSize: kickerSize,
        fontFamily: controls.fontFamily || preset.fontFamily,
        fontWeight: '700',
        letterSpacing: 2.2,
        color: withAlpha(controls.accentColor || preset.accentColor, 0.95),
        blurAmount: motion.blurAmount * 0.45,
        inflateAmount: motion.inflateAmount * 0.32,
        shiftY: motion.lineShiftY || 0,
        scaleOrigin: motion.scaleOrigin || 'top-left',
      },
    })
    cursorY += kickerGap
  }

  headlineLayout.lines.forEach((line, index) => {
    drawGranularLine({
      ctx,
      text: line,
      anchorX,
      y: cursorY + index * headlineLineHeight,
      align,
      unitOrderRef,
      totalUnits,
      baseProgress: motion.textProgress,
      staggerStep: motion.staggerStep,
      granularity: headlineGranularity,
      options: {
        fontSize: headlineLayout.fontSize,
        fontFamily: controls.fontFamily || preset.fontFamily,
        fontWeight: controls.fontWeight || preset.fontWeight,
        letterSpacing: headlineLetterSpacing,
        color: controls.textColor || preset.textColor,
        blurAmount: motion.blurAmount,
        inflateAmount: motion.inflateAmount,
        shiftY: motion.lineShiftY || 0,
        scaleOrigin: motion.scaleOrigin || 'top-left',
        characterFx: headlineCharacterFx,
        characterFxIndexRef: headlineCharacterIndexRef,
      },
    })
  })

  if (subheadlineText) {
    const subtitleStart = cursorY + headlineHeight + 8
    subtitleLayout.lines.forEach((line, index) => {
      drawGranularLine({
        ctx,
        text: line,
        anchorX,
        y: subtitleStart + index * subtitleLineHeight,
        align,
        unitOrderRef,
        totalUnits,
        baseProgress: motion.textProgress,
        staggerStep: motion.staggerStep,
        granularity: subtitleGranularity,
        options: {
          fontSize: subtitleLayout.fontSize,
          fontFamily: controls.fontFamily || preset.fontFamily,
          fontWeight: '500',
          letterSpacing: subtitleLetterSpacing,
          color: withAlpha(controls.textColor || preset.textColor, 0.82),
          blurAmount: motion.blurAmount * 0.4,
          inflateAmount: motion.inflateAmount * 0.18,
          shiftY: (motion.lineShiftY || 0) * 0.72,
          scaleOrigin: motion.scaleOrigin || 'top-left',
        },
      })
    })
  }
  ctx.restore()
}
