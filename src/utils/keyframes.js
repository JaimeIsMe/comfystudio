/**
 * Keyframe utilities for animation interpolation
 * 
 * Keyframe structure:
 * {
 *   time: number,      // Time in seconds (relative to clip start)
 *   value: number,     // The value at this keyframe
 *   easing: string,    // Easing function: 'linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'
 * }
 */

// Easing functions (t is normalized 0-1)
export const easingFunctions = {
  linear: (t) => t,
  
  easeIn: (t) => t * t,
  
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  
  easeInOut: (t) => t < 0.5 
    ? 2 * t * t 
    : 1 - Math.pow(-2 * t + 2, 2) / 2,
  
  // Cubic versions (smoother)
  easeInCubic: (t) => t * t * t,
  
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  
  easeInOutCubic: (t) => t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2,
  
  // Hold - no interpolation, jump to value
  hold: () => 0,
}

/**
 * Available easing options for UI
 */
export const EASING_OPTIONS = [
  { id: 'linear', label: 'Linear', icon: '/' },
  { id: 'easeIn', label: 'Ease In', icon: '⌒' },
  { id: 'easeOut', label: 'Ease Out', icon: '⌓' },
  { id: 'easeInOut', label: 'Ease In/Out', icon: '∿' },
  { id: 'hold', label: 'Hold', icon: '▭' },
]

/**
 * Properties that can be keyframed
 */
export const KEYFRAMEABLE_PROPERTIES = [
  { id: 'positionX', label: 'Position X', group: 'position', unit: 'px' },
  { id: 'positionY', label: 'Position Y', group: 'position', unit: 'px' },
  { id: 'scaleX', label: 'Scale X', group: 'scale', unit: '%' },
  { id: 'scaleY', label: 'Scale Y', group: 'scale', unit: '%' },
  { id: 'rotation', label: 'Rotation', group: 'rotation', unit: '°' },
  { id: 'opacity', label: 'Opacity', group: 'opacity', unit: '%' },
  { id: 'blur', label: 'Blur', group: 'effects', unit: 'px' },
  { id: 'anchorX', label: 'Anchor X', group: 'anchor', unit: '%' },
  { id: 'anchorY', label: 'Anchor Y', group: 'anchor', unit: '%' },
  { id: 'cropTop', label: 'Crop Top', group: 'crop', unit: '%' },
  { id: 'cropBottom', label: 'Crop Bottom', group: 'crop', unit: '%' },
  { id: 'cropLeft', label: 'Crop Left', group: 'crop', unit: '%' },
  { id: 'cropRight', label: 'Crop Right', group: 'crop', unit: '%' },
  { id: 'brightness', label: 'Exposure', group: 'adjustments', unit: '' },
  { id: 'contrast', label: 'Contrast', group: 'adjustments', unit: '' },
  { id: 'saturation', label: 'Saturation', group: 'adjustments', unit: '' },
  { id: 'gain', label: 'Gain', group: 'adjustments', unit: '' },
  { id: 'gamma', label: 'Gamma', group: 'adjustments', unit: '' },
  { id: 'offset', label: 'Offset', group: 'adjustments', unit: '' },
  { id: 'hue', label: 'Hue', group: 'adjustments', unit: 'deg' },
]

export const ADJUSTMENT_KEYFRAME_PROPERTIES = ['brightness', 'contrast', 'saturation', 'gain', 'gamma', 'offset', 'hue', 'blur']

/**
 * Get the value of a property at a specific time, interpolating between keyframes
 * 
 * @param {Array} keyframes - Array of keyframes for this property, sorted by time
 * @param {number} time - Time in seconds (relative to clip start)
 * @param {number} defaultValue - Default value if no keyframes exist
 * @returns {number} - Interpolated value at the given time
 */
export function getValueAtTime(keyframes, time, defaultValue = 0) {
  // No keyframes - return default
  if (!keyframes || keyframes.length === 0) {
    return defaultValue
  }
  
  // Single keyframe - return its value
  if (keyframes.length === 1) {
    return keyframes[0].value
  }
  
  // Sort keyframes by time (should already be sorted, but just in case)
  const sorted = [...keyframes].sort((a, b) => a.time - b.time)
  
  // Before first keyframe - return first value
  if (time <= sorted[0].time) {
    return sorted[0].value
  }
  
  // After last keyframe - return last value
  if (time >= sorted[sorted.length - 1].time) {
    return sorted[sorted.length - 1].value
  }
  
  // Find surrounding keyframes
  let prevKeyframe = sorted[0]
  let nextKeyframe = sorted[1]
  
  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].time && time <= sorted[i + 1].time) {
      prevKeyframe = sorted[i]
      nextKeyframe = sorted[i + 1]
      break
    }
  }
  
  // Calculate normalized time between keyframes (0-1)
  const duration = nextKeyframe.time - prevKeyframe.time
  if (duration === 0) return prevKeyframe.value
  
  const t = (time - prevKeyframe.time) / duration
  
  // Apply easing function from the previous keyframe
  const easingFn = easingFunctions[prevKeyframe.easing] || easingFunctions.linear
  
  // Handle 'hold' easing - no interpolation
  if (prevKeyframe.easing === 'hold') {
    return prevKeyframe.value
  }
  
  const easedT = easingFn(t)
  
  // Linear interpolation with eased time
  return prevKeyframe.value + (nextKeyframe.value - prevKeyframe.value) * easedT
}

/**
 * Get all animated transform values at a specific time
 * 
 * @param {Object} clip - The clip object with transform and keyframes
 * @param {number} clipTime - Time relative to clip start (in seconds)
 * @returns {Object} - Transform object with interpolated values
 */
export function getAnimatedTransform(clip, clipTime) {
  if (!clip) return null
  
  const baseTransform = clip.transform || {}
  const keyframes = clip.keyframes || {}
  
  // Start with base transform values
  const animatedTransform = { ...baseTransform }
  
  // Override with keyframed values
  for (const prop of KEYFRAMEABLE_PROPERTIES) {
    const propKeyframes = keyframes[prop.id]
    if (propKeyframes && propKeyframes.length > 0) {
      animatedTransform[prop.id] = getValueAtTime(
        propKeyframes, 
        clipTime, 
        baseTransform[prop.id]
      )
    }
  }
  
  return animatedTransform
}

/**
 * Get keyframed adjustment values at a specific time.
 *
 * @param {Object} clip - Clip containing adjustments and keyframes
 * @param {number} clipTime - Time relative to clip start (seconds)
 * @returns {Object} - Adjustment values (brightness/contrast/saturation/gain/gamma/offset/hue/blur)
 */
export function getAnimatedAdjustmentSettings(clip, clipTime) {
  if (!clip) return null

  const baseAdjustments = clip.adjustments || {}
  const keyframes = clip.keyframes || {}
  const animatedAdjustments = { ...baseAdjustments }

  for (const propertyId of ADJUSTMENT_KEYFRAME_PROPERTIES) {
    const propertyKeyframes = keyframes[propertyId]
    const baseValue = baseAdjustments[propertyId] ?? 0
    if (propertyKeyframes && propertyKeyframes.length > 0) {
      animatedAdjustments[propertyId] = getValueAtTime(propertyKeyframes, clipTime, baseValue)
    } else if (!Object.prototype.hasOwnProperty.call(animatedAdjustments, propertyId)) {
      animatedAdjustments[propertyId] = baseValue
    }
  }

  return animatedAdjustments
}

/**
 * Check if a property has a keyframe at a specific time
 * 
 * @param {Array} keyframes - Keyframes for the property
 * @param {number} time - Time to check
 * @param {number} tolerance - Time tolerance for matching (default 0.05s)
 * @returns {Object|null} - The keyframe if found, null otherwise
 */
export function getKeyframeAtTime(keyframes, time, tolerance = 0.05) {
  if (!keyframes || keyframes.length === 0) return null
  
  return keyframes.find(kf => Math.abs(kf.time - time) <= tolerance) || null
}

/**
 * Check if a property has any keyframes
 * 
 * @param {Object} keyframes - All keyframes for a clip
 * @param {string} propertyId - Property to check
 * @returns {boolean}
 */
export function hasKeyframes(keyframes, propertyId) {
  return keyframes?.[propertyId]?.length > 0
}

/**
 * Add or update a keyframe
 * 
 * @param {Array} keyframes - Existing keyframes for the property
 * @param {number} time - Time for the keyframe
 * @param {number} value - Value at this keyframe
 * @param {string} easing - Easing function (default: 'easeInOut')
 * @returns {Array} - New keyframes array
 */
export function setKeyframe(keyframes, time, value, easing = 'easeInOut') {
  const newKeyframes = [...(keyframes || [])]
  
  // Find existing keyframe at this time
  const existingIndex = newKeyframes.findIndex(kf => Math.abs(kf.time - time) < 0.05)
  
  if (existingIndex >= 0) {
    // Update existing keyframe
    newKeyframes[existingIndex] = { ...newKeyframes[existingIndex], value, easing }
  } else {
    // Add new keyframe
    newKeyframes.push({ time, value, easing })
  }
  
  // Sort by time
  newKeyframes.sort((a, b) => a.time - b.time)
  
  return newKeyframes
}

/**
 * Remove a keyframe at a specific time
 * 
 * @param {Array} keyframes - Existing keyframes
 * @param {number} time - Time of keyframe to remove
 * @param {number} tolerance - Time tolerance for matching
 * @returns {Array} - New keyframes array without the removed keyframe
 */
export function removeKeyframe(keyframes, time, tolerance = 0.05) {
  if (!keyframes) return []
  return keyframes.filter(kf => Math.abs(kf.time - time) > tolerance)
}

/**
 * Get all keyframe times for a clip (across all properties)
 * Useful for displaying keyframes on the timeline
 * 
 * @param {Object} keyframes - All keyframes for a clip
 * @returns {Array} - Array of { time, properties } objects
 */
export function getAllKeyframeTimes(keyframes) {
  if (!keyframes) return []
  
  const timeMap = new Map()
  
  for (const [propId, propKeyframes] of Object.entries(keyframes)) {
    if (!propKeyframes) continue
    
    for (const kf of propKeyframes) {
      const roundedTime = Math.round(kf.time * 100) / 100 // Round to avoid floating point issues
      
      if (!timeMap.has(roundedTime)) {
        timeMap.set(roundedTime, { time: roundedTime, properties: [] })
      }
      timeMap.get(roundedTime).properties.push(propId)
    }
  }
  
  return Array.from(timeMap.values()).sort((a, b) => a.time - b.time)
}

/**
 * Copy keyframes from one property to another (useful for linked scale)
 * 
 * @param {Array} sourceKeyframes - Source keyframes
 * @returns {Array} - Copied keyframes array
 */
export function copyKeyframes(sourceKeyframes) {
  if (!sourceKeyframes) return []
  return sourceKeyframes.map(kf => ({ ...kf }))
}

/**
 * Quantize a time value to the nearest frame boundary.
 *
 * @param {number} time - Time value in seconds
 * @param {number} fps - Frames per second
 * @returns {number} - Quantized time
 */
export function quantizeTimeToFrame(time, fps) {
  const parsedTime = Number(time)
  if (!Number.isFinite(parsedTime)) return 0

  const parsedFps = Number(fps)
  if (!Number.isFinite(parsedFps) || parsedFps <= 0) return parsedTime

  const frameDuration = 1 / parsedFps
  return Math.round(parsedTime / frameDuration) * frameDuration
}

export default {
  easingFunctions,
  EASING_OPTIONS,
  KEYFRAMEABLE_PROPERTIES,
  ADJUSTMENT_KEYFRAME_PROPERTIES,
  getValueAtTime,
  getAnimatedTransform,
  getAnimatedAdjustmentSettings,
  getKeyframeAtTime,
  hasKeyframes,
  setKeyframe,
  removeKeyframe,
  getAllKeyframeTimes,
  copyKeyframes,
  quantizeTimeToFrame,
}
