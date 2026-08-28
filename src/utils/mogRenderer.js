import { buildMogStateFromPreset } from './mogPresets'
import { drawMogTextBlock, getMogMotionState } from './mogTextEngine'
import { quoteCssFontFamily } from './fontFamily'

const PREVIEW_CARD_BACKGROUND = ['#09111F', '#0F172A', '#1D4ED8']

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
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

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = clamp(radius, 0, Math.min(width, height) / 2)
  ctx.beginPath()
  ctx.moveTo(x + safeRadius, y)
  ctx.lineTo(x + width - safeRadius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
  ctx.lineTo(x + width, y + height - safeRadius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
  ctx.lineTo(x + safeRadius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
  ctx.lineTo(x, y + safeRadius)
  ctx.quadraticCurveTo(x, y, x + safeRadius, y)
  ctx.closePath()
}

function setFont(ctx, size, family, weight = '700') {
  ctx.font = `${weight} ${Math.round(size)}px ${quoteCssFontFamily(family)}, sans-serif`
}

function applyMotionWrapper(ctx, bounds, motion, direction, drawFn) {
  ctx.save()
  ctx.globalAlpha *= motion.alpha
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  ctx.translate(centerX + motion.translateX, centerY + motion.translateY)
  ctx.scale(motion.scale, motion.scale)
  ctx.translate(-centerX, -centerY)

  if (motion.reveal < 0.999) {
    const reveal = clamp(motion.reveal, 0.01, 1)
    let clipX = bounds.x
    let clipY = bounds.y
    let clipW = bounds.width
    let clipH = bounds.height
    const revealDirection = motion.revealMode && motion.revealMode !== 'directional'
      ? motion.revealMode
      : direction
    if (revealDirection === 'center') {
      clipW = bounds.width * reveal
      clipX = bounds.x + (bounds.width - clipW) / 2
    } else if (revealDirection === 'right') {
      clipW = bounds.width * reveal
      clipX = bounds.x + bounds.width - clipW
    } else if (revealDirection === 'up') {
      clipH = bounds.height * reveal
      clipY = bounds.y + bounds.height - clipH
    } else if (revealDirection === 'down') {
      clipH = bounds.height * reveal
    } else {
      clipW = bounds.width * reveal
    }
    ctx.beginPath()
    ctx.rect(clipX, clipY, clipW, clipH)
    ctx.clip()
  }

  drawFn()
  ctx.restore()
}

function getLayoutBounds(templateId, width, height, margin, position = 'bottom-left') {
  const safeMargin = clamp(Number(margin) || 72, 24, Math.min(width, height) * 0.18)
  const landscape = width >= height

  if (templateId === 'headlineCenter') {
    const boxWidth = width * (landscape ? 0.68 : 0.82)
    const boxHeight = height * (landscape ? 0.28 : 0.24)
    const x = (width - boxWidth) / 2
    const y = position === 'upper-center'
      ? safeMargin
      : (height - boxHeight) / 2
    return { x, y, width: boxWidth, height: boxHeight }
  }

  if (templateId === 'boxTitle') {
    const boxWidth = width * (landscape ? 0.42 : 0.78)
    const boxHeight = height * (landscape ? 0.22 : 0.17)
    const x = position === 'top-right'
      ? width - boxWidth - safeMargin
      : safeMargin
    return { x, y: safeMargin, width: boxWidth, height: boxHeight }
  }

  if (templateId === 'quoteCard') {
    const boxWidth = width * (landscape ? 0.56 : 0.84)
    const boxHeight = height * (landscape ? 0.42 : 0.36)
    return {
      x: (width - boxWidth) / 2,
      y: (height - boxHeight) / 2,
      width: boxWidth,
      height: boxHeight,
    }
  }

  if (templateId === 'ctaBanner') {
    const boxWidth = width * (landscape ? 0.58 : 0.88)
    const boxHeight = height * (landscape ? 0.16 : 0.12)
    return {
      x: (width - boxWidth) / 2,
      y: height - boxHeight - safeMargin,
      width: boxWidth,
      height: boxHeight,
    }
  }

  if (templateId === 'socialCard') {
    const boxWidth = width * (landscape ? 0.44 : 0.78)
    const boxHeight = height * (landscape ? 0.5 : 0.36)
    return {
      x: (width - boxWidth) / 2,
      y: (height - boxHeight) / 2,
      width: boxWidth,
      height: boxHeight,
    }
  }

  if (templateId === 'nameRole') {
    const boxWidth = width * (landscape ? 0.5 : 0.86)
    const boxHeight = height * (landscape ? 0.2 : 0.14)
    return {
      x: safeMargin,
      y: height - boxHeight - safeMargin,
      width: boxWidth,
      height: boxHeight,
    }
  }

  const boxWidth = width * (landscape ? 0.52 : 0.88)
  const boxHeight = height * (landscape ? 0.22 : 0.16)
  const x = position === 'bottom-right' ? width - boxWidth - safeMargin : safeMargin
  return {
    x,
    y: height - boxHeight - safeMargin,
    width: boxWidth,
    height: boxHeight,
  }
}

function fillGradientAccent(ctx, x, y, width, height, colorA, colorB, vertical = false, alpha = 1) {
  const gradient = ctx.createLinearGradient(x, y, vertical ? x : x + width, vertical ? y + height : y)
  gradient.addColorStop(0, withAlpha(colorA, alpha))
  gradient.addColorStop(1, withAlpha(colorB, alpha))
  ctx.fillStyle = gradient
  ctx.fillRect(x, y, width, height)
}

function drawAccent(ctx, rect, preset, controls, motion) {
  if (!controls.showAccent) return
  const accentColor = controls.accentColor || preset.accentColor
  const accentColor2 = controls.accentColor2 || preset.accentColor2 || accentColor
  const style = preset.accentStyle
  const progress = clamp(motion.accentProgress, 0, 1)

  ctx.save()
  ctx.globalAlpha *= 0.95

  if (style === 'bar') {
    fillGradientAccent(ctx, rect.x, rect.y, 10, rect.height * progress, accentColor, accentColor2, true)
  } else if (style === 'ribbon') {
    fillGradientAccent(ctx, rect.x, rect.y + rect.height - 8, rect.width * progress, 8, accentColor, accentColor2)
  } else if (style === 'pill') {
    const width = rect.width * clamp(0.35 + progress * 0.65, 0.15, 1)
    drawRoundedRect(ctx, rect.x + rect.width / 2 - width / 2, rect.y + rect.height - 20, width, 10, 999)
    const gradient = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y)
    gradient.addColorStop(0, withAlpha(accentColor, 0.95))
    gradient.addColorStop(1, withAlpha(accentColor2, 0.95))
    ctx.fillStyle = gradient
    ctx.fill()
  } else if (style === 'box') {
    drawRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 28)
    ctx.lineWidth = 3
    const gradient = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height)
    gradient.addColorStop(0, withAlpha(accentColor, 0.95))
    gradient.addColorStop(1, withAlpha(accentColor2, 0.85))
    ctx.strokeStyle = gradient
    ctx.stroke()
  } else if (style === 'underline') {
    fillGradientAccent(ctx, rect.x + rect.width * 0.08, rect.y + rect.height - 8, rect.width * 0.84 * progress, 6, accentColor, accentColor2)
  } else {
    fillGradientAccent(ctx, rect.x + rect.width * 0.05, rect.y + rect.height - 7, rect.width * 0.72 * progress, 6, accentColor, accentColor2)
  }

  ctx.restore()
}

function drawBox(ctx, rect, preset, controls, motion) {
  if (!controls.showBox) return
  const opacity = clamp((Number(controls.boxOpacity) || preset.boxOpacity || 80) / 100, 0.08, 1)
  const boxProgress = clamp(motion.boxProgress, 0, 1)
  const width = rect.width * boxProgress
  const x = rect.x + (rect.width - width) / 2
  const color = controls.boxColor || preset.boxColor
  ctx.save()
  drawRoundedRect(ctx, x, rect.y, width, rect.height, clamp(rect.height * 0.12, 16, 32))
  const gradient = ctx.createLinearGradient(x, rect.y, x + width, rect.y + rect.height)
  gradient.addColorStop(0, withAlpha(color, opacity))
  gradient.addColorStop(1, withAlpha(color, opacity * 0.75))
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.restore()
}

function renderTemplate(ctx, width, height, preset, controls, motion) {
  const bounds = getLayoutBounds(preset.templateId, width, height, controls.margin, preset.position)
  applyMotionWrapper(ctx, bounds, motion, controls.direction || preset.direction, () => {
    const expanded = { ...bounds }

    if (preset.templateId === 'ctaBanner') {
      expanded.height *= 0.9
      expanded.y += bounds.height * 0.05
    }

    drawBox(ctx, expanded, preset, controls, motion)
    drawAccent(ctx, expanded, preset, controls, motion)

    if (preset.templateId === 'quoteCard') {
      ctx.save()
      ctx.globalAlpha *= motion.textProgress
      setFont(ctx, Math.max(36, (Number(controls.fontSize) || preset.fontSize) * 0.52), controls.fontFamily || preset.fontFamily, '700')
      ctx.fillStyle = withAlpha(controls.accentColor || preset.accentColor, 0.92)
      ctx.fillText('“', expanded.x + 24, expanded.y + 18)
      ctx.restore()
    }

    if (preset.templateId === 'socialCard') {
      const stackHeight = expanded.height * 0.22
      ctx.save()
      ctx.globalAlpha *= clamp(motion.accentProgress, 0, 1) * 0.85
      fillGradientAccent(ctx, expanded.x, expanded.y, expanded.width, stackHeight, controls.accentColor || preset.accentColor, controls.accentColor2 || preset.accentColor2, false, 0.95)
      ctx.restore()
    }

    drawMogTextBlock(ctx, expanded, preset, controls, motion)
  })
}

function drawBackdrop(ctx, width, height, mode) {
  if (mode === 'checker') {
    const size = Math.max(18, Math.round(Math.min(width, height) / 18))
    for (let y = 0; y < height; y += size) {
      for (let x = 0; x < width; x += size) {
        const even = ((x / size) + (y / size)) % 2 === 0
        ctx.fillStyle = even ? '#101826' : '#1B2435'
        ctx.fillRect(x, y, size, size)
      }
    }
    return
  }

  const gradient = ctx.createLinearGradient(0, 0, width, height)
  if (mode === 'studio') {
    gradient.addColorStop(0, '#060B16')
    gradient.addColorStop(0.58, '#0B1220')
    gradient.addColorStop(1, '#111827')
  } else {
    gradient.addColorStop(0, '#182942')
    gradient.addColorStop(0.4, '#6BA1A5')
    gradient.addColorStop(1, '#18243A')
  }
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  if (mode === 'landscape') {
    ctx.fillStyle = 'rgba(255,255,255,0.14)'
    ctx.beginPath()
    ctx.ellipse(width * 0.52, height * 0.2, width * 0.34, height * 0.16, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(15, 23, 42, 0.52)'
    ctx.beginPath()
    ctx.moveTo(0, height * 0.78)
    ctx.lineTo(width * 0.22, height * 0.55)
    ctx.lineTo(width * 0.42, height * 0.67)
    ctx.lineTo(width * 0.58, height * 0.48)
    ctx.lineTo(width, height * 0.75)
    ctx.lineTo(width, height)
    ctx.lineTo(0, height)
    ctx.closePath()
    ctx.fill()
  }
}

export function renderMogFrame({
  ctx,
  width,
  height,
  preset,
  controls,
  time = 0,
  transparent = true,
  previewBackground = null,
}) {
  if (!ctx || !preset) return
  ctx.clearRect(0, 0, width, height)
  if (!transparent || previewBackground) {
    drawBackdrop(ctx, width, height, previewBackground || 'studio')
  }

  const duration = clamp(Number(controls.duration) || 3.5, 1, 10)
  const motion = getMogMotionState({
    family: controls.animationStyle || preset.motionFamily,
    direction: controls.direction || preset.direction,
    pace: controls.pace || preset.pace,
    exitStyle: controls.exitStyle || preset.exitStyle,
    animationDurationScale: controls.animationDurationScale,
    textGranularity: controls.textGranularity,
    staggerStep: controls.staggerStep,
    blurAmount: controls.blurAmount,
    trackingPull: controls.trackingPull,
    overshootAmount: controls.overshootAmount,
    maskMode: controls.maskMode,
    inflateAmount: controls.inflateAmount,
    duration,
    time,
    width,
    height,
  })

  renderTemplate(ctx, width, height, preset, controls, motion)
}

export function renderMogPreviewDataUrl(preset, width = 240, height = 140) {
  if (typeof document === 'undefined' || !preset) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const controls = buildMogStateFromPreset(preset)
  renderMogFrame({
    ctx,
    width,
    height,
    preset,
    controls,
    time: (controls.duration || 3.5) * 0.42,
    transparent: false,
    previewBackground: 'studio',
  })
  return canvas.toDataURL('image/png')
}

export function getSupportedMogMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  const preferred = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  for (const type of preferred) {
    if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(type)) {
      return type
    }
  }
  return null
}

export async function generateMogVideoBlob({
  preset,
  controls,
  width,
  height,
  duration,
  fps,
}) {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Transparent motion export is not supported in this runtime')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas context unavailable')
  }

  const stream = canvas.captureStream(Math.max(1, fps))
  const mimeType = getSupportedMogMimeType()
  let recorder
  try {
    recorder = mimeType
      ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
      : new MediaRecorder(stream)
  } catch (error) {
    throw new Error('Could not initialize motion asset recorder')
  }

  return new Promise((resolve, reject) => {
    const chunks = []
    const totalFrames = Math.max(1, Math.round(duration * fps))
    const frameIntervalMs = Math.max(1, Math.round(1000 / Math.max(1, fps)))
    let frame = 0
    let timer = null
    let stopped = false

    const cleanup = () => {
      if (timer) clearInterval(timer)
      stream.getTracks().forEach((track) => track.stop())
    }

    const drawCurrentFrame = () => {
      renderMogFrame({
        ctx,
        width,
        height,
        preset,
        controls,
        time: frame / fps,
        transparent: true,
      })
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data)
      }
    }

    recorder.onerror = () => {
      if (stopped) return
      stopped = true
      cleanup()
      reject(new Error('Failed while recording transparent motion asset'))
    }

    recorder.onstop = () => {
      if (stopped) return
      stopped = true
      cleanup()
      const finalMimeType = mimeType || 'video/webm'
      const blob = new Blob(chunks, { type: finalMimeType })
      if (blob.size <= 0) {
        reject(new Error('Motion asset output is empty'))
        return
      }
      resolve(blob)
    }

    drawCurrentFrame()
    recorder.start()

    if (totalFrames <= 1) {
      recorder.stop()
      return
    }

    timer = setInterval(() => {
      frame += 1
      drawCurrentFrame()
      if (frame >= totalFrames - 1) {
        clearInterval(timer)
        timer = null
        recorder.stop()
      }
    }, frameIntervalMs)
  })
}

export function getPreviewCardBackground() {
  return PREVIEW_CARD_BACKGROUND
}
