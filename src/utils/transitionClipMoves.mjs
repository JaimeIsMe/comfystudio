const DEFAULT_MOVE_EPSILON = 1e-6

const getClipStartTime = (clip) => {
  const value = Number(clip?.startTime)
  return Number.isFinite(value) ? value : null
}

const translateFiniteTime = (value, delta) => {
  if (value == null) return value
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric + delta : value
}

/**
 * Keep absolute between-transition metadata attached to a group move.
 *
 * A between transition moves only when both of its clips moved by the same
 * timeline delta and still share a track. If one side moves independently,
 * the transition stays put until the normal drop-time validity cleanup
 * decides whether the edit relationship still exists.
 */
export const translateTransitionsForClipMoves = ({
  transitions = [],
  beforeClips = [],
  afterClips = [],
  epsilon = DEFAULT_MOVE_EPSILON,
} = {}) => {
  if (!Array.isArray(transitions) || transitions.length === 0) return transitions || []

  const beforeById = new Map((beforeClips || []).map((clip) => [clip?.id, clip]))
  const afterById = new Map((afterClips || []).map((clip) => [clip?.id, clip]))

  let changed = false
  const translated = transitions.map((transition) => {
    if (transition?.kind !== 'between') return transition

    const beforeA = beforeById.get(transition.clipAId)
    const beforeB = beforeById.get(transition.clipBId)
    const afterA = afterById.get(transition.clipAId)
    const afterB = afterById.get(transition.clipBId)
    if (!beforeA || !beforeB || !afterA || !afterB) return transition
    if (afterA.trackId !== afterB.trackId) return transition

    const beforeAStart = getClipStartTime(beforeA)
    const beforeBStart = getClipStartTime(beforeB)
    const afterAStart = getClipStartTime(afterA)
    const afterBStart = getClipStartTime(afterB)
    if ([beforeAStart, beforeBStart, afterAStart, afterBStart].some((value) => value == null)) {
      return transition
    }

    const deltaA = afterAStart - beforeAStart
    const deltaB = afterBStart - beforeBStart
    if (Math.abs(deltaA) <= epsilon || Math.abs(deltaA - deltaB) > epsilon) return transition

    const shiftedTransition = { ...transition }
    let transitionChanged = false
    for (const field of ['editPoint', 'originalClipAEnd', 'originalClipBStart']) {
      if (transition[field] != null) {
        const shiftedValue = translateFiniteTime(transition[field], deltaA)
        if (!Object.is(shiftedValue, transition[field])) {
          shiftedTransition[field] = shiftedValue
          transitionChanged = true
        }
      }
    }
    if (!transitionChanged) return transition
    changed = true
    return shiftedTransition
  })
  return changed ? translated : transitions
}
