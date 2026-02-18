const DEFAULT_FPS = 24

const DEFAULT_TRANSFORM_BASE = {
  positionX: 0,
  positionY: 0,
  scaleX: 100,
  scaleY: 100,
  rotation: 0,
  opacity: 100,
}

export const TEXT_ANIMATION_MODE_OPTIONS = [
  { id: 'in', label: 'In' },
  { id: 'out', label: 'Out' },
  { id: 'inOut', label: 'In + Out' },
]

export const TEXT_ANIMATION_KEYFRAME_PROPERTIES = [
  'opacity',
  'positionX',
  'positionY',
  'scaleX',
  'scaleY',
  'rotation',
]

const PRESET_DEFINITIONS = {
  fade: {
    id: 'fade',
    name: 'Fade',
    inDuration: 0.45,
    outDuration: 0.35,
    inEasing: 'easeOutCubic',
    outEasing: 'easeInCubic',
    buildInFrom: () => ({ opacity: 0 }),
    buildOutTo: () => ({ opacity: 0 }),
  },
  slideUp: {
    id: 'slideUp',
    name: 'Slide Up',
    inDuration: 0.55,
    outDuration: 0.4,
    inEasing: 'easeOutCubic',
    outEasing: 'easeInCubic',
    buildInFrom: (base) => ({
      opacity: 0,
      positionY: base.positionY + 140,
    }),
    buildOutTo: (base) => ({
      opacity: 0,
      positionY: base.positionY - 90,
    }),
  },
  slideDown: {
    id: 'slideDown',
    name: 'Slide Down',
    inDuration: 0.55,
    outDuration: 0.4,
    inEasing: 'easeOutCubic',
    outEasing: 'easeInCubic',
    buildInFrom: (base) => ({
      opacity: 0,
      positionY: base.positionY - 140,
    }),
    buildOutTo: (base) => ({
      opacity: 0,
      positionY: base.positionY + 90,
    }),
  },
  slideLeft: {
    id: 'slideLeft',
    name: 'Slide Left',
    inDuration: 0.5,
    outDuration: 0.4,
    inEasing: 'easeOutCubic',
    outEasing: 'easeInCubic',
    buildInFrom: (base) => ({
      opacity: 0,
      positionX: base.positionX + 220,
    }),
    buildOutTo: (base) => ({
      opacity: 0,
      positionX: base.positionX - 180,
    }),
  },
  pop: {
    id: 'pop',
    name: 'Pop',
    inDuration: 0.42,
    outDuration: 0.35,
    inEasing: 'easeOutCubic',
    outEasing: 'easeInCubic',
    buildInFrom: () => ({
      opacity: 0,
      scaleX: 72,
      scaleY: 72,
    }),
    buildOutTo: () => ({
      opacity: 0,
      scaleX: 122,
      scaleY: 122,
    }),
  },
  spinIn: {
    id: 'spinIn',
    name: 'Spin In',
    inDuration: 0.55,
    outDuration: 0.42,
    inEasing: 'easeOutCubic',
    outEasing: 'easeInCubic',
    buildInFrom: () => ({
      opacity: 0,
      scaleX: 82,
      scaleY: 82,
      rotation: -18,
    }),
    buildOutTo: () => ({
      opacity: 0,
      scaleX: 108,
      scaleY: 108,
      rotation: 12,
    }),
  },
}

export const TEXT_ANIMATION_PRESETS = Object.values(PRESET_DEFINITIONS).map((preset) => ({
  id: preset.id,
  name: preset.name,
}))

const normalizeMode = (mode) => {
  if (mode === 'in' || mode === 'out' || mode === 'inOut') return mode
  return 'inOut'
}

const toSafeNumber = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const roundToFrame = (time, fps) => {
  if (!Number.isFinite(fps) || fps <= 0) return time
  const frameDuration = 1 / fps
  return Math.round(time / frameDuration) * frameDuration
}

const upsertKeyframe = (target, property, time, value, easing = 'linear') => {
  if (!Number.isFinite(time) || !Number.isFinite(value)) return
  const frames = target[property] ? [...target[property]] : []
  const existingIndex = frames.findIndex((frame) => Math.abs(frame.time - time) < 0.0005)

  if (existingIndex >= 0) {
    frames[existingIndex] = { time, value, easing }
  } else {
    frames.push({ time, value, easing })
  }

  frames.sort((a, b) => a.time - b.time)
  target[property] = frames
}

/**
 * Build keyframes for a text animation preset.
 * Returns only transform-keyframe properties touched by title animations.
 */
export function buildTextAnimationPresetKeyframes({
  presetId,
  mode = 'inOut',
  clipDuration,
  fps = DEFAULT_FPS,
  baseTransform = {},
}) {
  const preset = PRESET_DEFINITIONS[presetId]
  if (!preset) {
    return {
      keyframes: {},
      appliedPresetId: null,
      appliedMode: normalizeMode(mode),
    }
  }

  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS
  const frameDuration = 1 / safeFps
  const safeDuration = Math.max(frameDuration, toSafeNumber(clipDuration, frameDuration))
  const normalizedMode = normalizeMode(mode)
  const hasIn = normalizedMode === 'in' || normalizedMode === 'inOut'
  const hasOut = normalizedMode === 'out' || normalizedMode === 'inOut'

  const mergedBase = { ...DEFAULT_TRANSFORM_BASE, ...baseTransform }
  const inFrom = preset.buildInFrom(mergedBase) || {}
  const outTo = preset.buildOutTo(mergedBase) || {}
  const animatedProps = Array.from(
    new Set([...Object.keys(inFrom), ...Object.keys(outTo)].filter((prop) => TEXT_ANIMATION_KEYFRAME_PROPERTIES.includes(prop)))
  )

  if (animatedProps.length === 0 || (!hasIn && !hasOut)) {
    return {
      keyframes: {},
      appliedPresetId: preset.id,
      appliedMode: normalizedMode,
    }
  }

  let inDuration = hasIn ? Math.max(frameDuration, toSafeNumber(preset.inDuration, 0.5)) : 0
  let outDuration = hasOut ? Math.max(frameDuration, toSafeNumber(preset.outDuration, 0.35)) : 0

  if (hasIn && hasOut && inDuration + outDuration > safeDuration) {
    const scale = safeDuration / (inDuration + outDuration)
    inDuration = Math.max(frameDuration, inDuration * scale)
    outDuration = Math.max(frameDuration, outDuration * scale)
  }

  const inEndTime = hasIn ? roundToFrame(Math.min(safeDuration, inDuration), safeFps) : 0
  const outStartRaw = hasOut ? roundToFrame(Math.max(0, safeDuration - outDuration), safeFps) : safeDuration
  const outStartTime = hasIn && hasOut ? Math.max(inEndTime, outStartRaw) : outStartRaw
  const endTime = roundToFrame(safeDuration, safeFps)
  const keyframes = {}

  for (const property of animatedProps) {
    const baseValue = toSafeNumber(mergedBase[property], 0)

    if (hasIn) {
      const fromValue = toSafeNumber(inFrom[property], baseValue)
      upsertKeyframe(keyframes, property, 0, fromValue, preset.inEasing || 'easeOutCubic')
      upsertKeyframe(keyframes, property, inEndTime, baseValue, 'linear')
    }

    if (hasOut) {
      upsertKeyframe(keyframes, property, outStartTime, baseValue, preset.outEasing || 'easeInCubic')
      const toValue = toSafeNumber(outTo[property], baseValue)
      upsertKeyframe(keyframes, property, endTime, toValue, 'linear')
    }
  }

  return {
    keyframes,
    appliedPresetId: preset.id,
    appliedMode: normalizedMode,
  }
}
