import { COLOR_ADJUSTMENT_KEYS, TONAL_ADJUSTMENT_GROUP_KEYS, DEFAULT_TONAL_ADJUSTMENT_GROUP, DEFAULT_ADJUSTMENT_SETTINGS } from './adjustments'
import { getAnimatedAdjustmentSettings } from './keyframes'

// Per-group bypass (clip.bypass = { mask?, color?, effects? }): Resolve-style
// A/B toggles that mute a whole category without losing its settings. The
// flags persist with the clip and are honored by preview AND export; cache
// signatures include them, so bakes invalidate on toggle.
export const BYPASSABLE_GROUPS = Object.freeze(['mask', 'color', 'effects'])

export const isClipBypassed = (clip, group) => clip?.bypass?.[group] === true

const EMPTY_EFFECTS = Object.freeze([])

/** clip.effects as the renderers should see them: empty while Effects is bypassed. */
export function getRenderEffects(clip) {
  return isClipBypassed(clip, 'effects') ? EMPTY_EFFECTS : (clip?.effects || EMPTY_EFFECTS)
}

/**
 * The clip's adjustment settings as the renderers should see them. Returns
 * the un-copied source object when nothing is bypassed so identity-based
 * caches keep working. Color bypass zeroes the grade, tonal groups, and LUT;
 * effects bypass zeroes blur (blur lives in adjustments but belongs to the
 * Effects group).
 */
export function getRenderAdjustments(clip, clipTime) {
  const raw = getAnimatedAdjustmentSettings(clip, clipTime) || clip?.adjustments || {}
  const colorOff = isClipBypassed(clip, 'color')
  const effectsOff = isClipBypassed(clip, 'effects')
  if (!colorOff && !effectsOff) return raw
  const next = { ...raw }
  if (colorOff) {
    for (const key of COLOR_ADJUSTMENT_KEYS) next[key] = DEFAULT_ADJUSTMENT_SETTINGS[key]
    for (const groupKey of TONAL_ADJUSTMENT_GROUP_KEYS) next[groupKey] = { ...DEFAULT_TONAL_ADJUSTMENT_GROUP }
    next.lut = null
  }
  if (effectsOff) next.blur = 0
  return next
}
