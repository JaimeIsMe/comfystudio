import {
  buildCaptionControlsFromPreset,
  getCaptionPresetById,
} from '../config/captionPresets'
import { renderMogFrame, getSupportedMogMimeType } from './mogRenderer'
import {
  renderKineticCaptionFrame,
  renderKineticPreviewDataUrl,
  generateKineticCaptionVideoBlob,
  getKineticStyleById,
} from './kineticCaptionRenderer'

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getCueDuration(cue) {
  const start = Number(cue?.start) || 0
  const end = Number(cue?.end) || 0
  return Math.max(0.4, end - start)
}

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length
}

function pickFromCycle(cycle, index) {
  if (!Array.isArray(cycle) || cycle.length === 0) return null
  return cycle[index % cycle.length]
}

const POSITION_TO_TEMPLATE = {
  'bottom-left': 'ctaBanner',
  'bottom-right': 'ctaBanner',
  'headlineCenter': 'headlineCenter',
  'upper-center': 'headlineCenter',
  'top-right': 'boxTitle',
}

function resolveTemplateForPosition(position, fallback) {
  return POSITION_TO_TEMPLATE[position] || fallback || 'ctaBanner'
}

export function resolveCueStyle(preset, cue, cueIndex, totalCues) {
  const v = preset?.variations
  if (!v) return {}

  const words = countWords(cue?.text)
  const isShort = words <= 3
  const isVeryShort = words <= 2
  const endsWithEmphasis = /[!?]$/.test(String(cue?.text || '').trim())
  const overrides = {}

  const cycledPosition = pickFromCycle(v.positionCycle, cueIndex)
  if (cycledPosition) {
    overrides.position = cycledPosition
    overrides.templateId = resolveTemplateForPosition(cycledPosition, preset.templateId)
  }

  const cycledMotion = pickFromCycle(v.motionCycle, cueIndex)
  if (cycledMotion) {
    overrides.animationStyle = cycledMotion
  }

  if (v.sizeMode === 'adaptive') {
    if (isShort) {
      overrides.fontSize = Math.round((preset.fontSize || 78) * 1.25)
      overrides.fontWeight = '900'
    } else if (words >= 7) {
      overrides.fontSize = Math.round((preset.fontSize || 78) * 0.82)
    }
  }

  if (v.emphasisOnShort && isShort) {
    overrides.templateId = 'headlineCenter'
    overrides.position = 'bottom-left'
    if (!overrides.fontSize) {
      overrides.fontSize = Math.round((preset.fontSize || 78) * 1.25)
    }
    overrides.fontWeight = '900'

    if (isShort && cycledMotion !== 'pop') {
      overrides.animationStyle = 'pop'
    }
  }

  if (v.uppercaseShort && isVeryShort && cue?.text) {
    overrides.headline = String(cue.text).toUpperCase()
  }

  if (v.emphasisOnPunctuation && endsWithEmphasis) {
    overrides.textColor = preset.accentColor || preset.textColor
  }

  return overrides
}

export function getActiveCaptionCue(cues = [], time = 0) {
  return (Array.isArray(cues) ? cues : []).find((cue) => {
    const start = Number(cue?.start) || 0
    const end = Number(cue?.end) || 0
    return time >= start && time < end
  }) || null
}

function getActiveCaptionCueIndex(cues = [], time = 0) {
  const safeCues = Array.isArray(cues) ? cues : []
  return safeCues.findIndex((cue) => {
    const start = Number(cue?.start) || 0
    const end = Number(cue?.end) || 0
    return time >= start && time < end
  })
}

function isKineticPreset(preset) {
  return preset?.renderer === 'kinetic'
}

export function renderCaptionFrame({
  ctx,
  width,
  height,
  preset,
  cues,
  time = 0,
  transparent = true,
  previewBackground = null,
}) {
  if (!ctx || !width || !height) return

  const resolvedPreset = getCaptionPresetById(preset?.id || preset)

  if (isKineticPreset(resolvedPreset)) {
    renderKineticCaptionFrame({ ctx, width, height, style: resolvedPreset, cues, time })
    return
  }

  const safeCues = Array.isArray(cues) ? cues : []
  const cueIndex = getActiveCaptionCueIndex(safeCues, time)

  ctx.clearRect(0, 0, width, height)
  if (cueIndex < 0) return

  const activeCue = safeCues[cueIndex]
  const styleOverrides = resolveCueStyle(resolvedPreset, activeCue, cueIndex, safeCues.length)

  const controls = buildCaptionControlsFromPreset(resolvedPreset, {
    text: styleOverrides.headline || activeCue.text,
    duration: getCueDuration(activeCue),
    overrides: styleOverrides,
  })

  const framePreset = (styleOverrides.templateId || styleOverrides.position)
    ? { ...resolvedPreset, ...styleOverrides }
    : resolvedPreset

  renderMogFrame({
    ctx,
    width,
    height,
    preset: framePreset,
    controls,
    time: clamp(time - activeCue.start, 0, controls.duration),
    transparent,
    previewBackground,
  })
}

export function renderCaptionPresetPreviewDataUrl(preset, width = 240, height = 140) {
  if (typeof document === 'undefined') return null

  const resolvedPreset = getCaptionPresetById(preset?.id || preset)

  if (isKineticPreset(resolvedPreset)) {
    return renderKineticPreviewDataUrl(resolvedPreset, width, height)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const previewCue = [{
    id: 'preview-cue',
    start: 0,
    end: 2.2,
    text: resolvedPreset.sampleText,
  }]

  renderCaptionFrame({
    ctx,
    width,
    height,
    preset: resolvedPreset,
    cues: previewCue,
    time: 0.8,
    transparent: false,
    previewBackground: 'studio',
  })

  return canvas.toDataURL('image/png')
}

export async function generateCaptionVideoBlob({
  preset,
  cues,
  width,
  height,
  duration,
  fps,
}) {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Transparent caption export is not supported in this runtime.')
  }

  const resolvedPreset = getCaptionPresetById(preset?.id || preset)

  if (isKineticPreset(resolvedPreset)) {
    return generateKineticCaptionVideoBlob({
      style: resolvedPreset,
      cues,
      width,
      height,
      duration,
      fps,
    })
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas context unavailable.')
  }

  const safeDuration = Math.max(
    0.4,
    Number(duration)
      || Math.max(...(Array.isArray(cues) ? cues.map((cue) => Number(cue?.end) || 0) : [0]))
      || 0.4
  )
  const safeFps = Math.max(1, Math.round(Number(fps) || 24))
  const stream = canvas.captureStream(safeFps)
  const mimeType = getSupportedMogMimeType()

  let recorder
  try {
    recorder = mimeType
      ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
      : new MediaRecorder(stream)
  } catch (_) {
    throw new Error('Could not initialize caption recorder.')
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
      renderCaptionFrame({
        ctx,
        width,
        height,
        preset: resolvedPreset,
        cues,
        time: frame / safeFps,
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
      reject(new Error('Failed while recording animated captions.'))
    }

    recorder.onstop = () => {
      if (stopped) return
      stopped = true
      cleanup()
      const finalMimeType = mimeType || 'video/webm'
      const blob = new Blob(chunks, { type: finalMimeType })
      if (blob.size <= 0) {
        reject(new Error('Caption overlay output is empty.'))
        return
      }
      resolve(blob)
    }

    drawFrame()
    recorder.start()

    if (totalFrames <= 1) {
      recorder.stop()
      return
    }

    timer = setInterval(() => {
      frame += 1
      drawFrame()
      if (frame >= totalFrames - 1) {
        clearInterval(timer)
        timer = null
        recorder.stop()
      }
    }, frameIntervalMs)
  })
}
