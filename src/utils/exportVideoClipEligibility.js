import { hasVideoSolo, isVideoTrackVisible } from './videoTrackVisibility.js'
import { isBetweenClipTransition } from './transitionKinds.js'

const normalizeTransitionSplit = (split = null, alignment = 'center') => {
  if (split && Number.isFinite(Number(split.clipA)) && Number.isFinite(Number(split.clipB))) {
    const clipA = Math.max(0, Number(split.clipA))
    const clipB = Math.max(0, Number(split.clipB))
    const total = clipA + clipB
    if (total > 0) return { clipA: clipA / total, clipB: clipB / total }
  }
  if (alignment === 'start') return { clipA: 1, clipB: 0 }
  if (alignment === 'end') return { clipA: 0, clipB: 1 }
  return { clipA: 0.5, clipB: 0.5 }
}

/**
 * IDs of visual clips that can contribute to an export range. This is used
 * to scope expensive/required source preparation, not to replace the
 * frame-by-frame compositor's authoritative active-clip calculation.
 */
export function getRenderableVideoClipIds({
  clips = [],
  tracks = [],
  transitions = [],
  rangeStart = 0,
  rangeEnd = 0,
  soloClipIds = null,
} = {}) {
  const safeStart = Number(rangeStart) || 0
  const safeEnd = Number(rangeEnd) || 0
  const soloSet = Array.isArray(soloClipIds) && soloClipIds.length > 0
    ? new Set(soloClipIds)
    : null
  const anyVideoSolo = hasVideoSolo(tracks)
  const visibleVideoTrackIds = new Set(
    tracks
      .filter((track) => isVideoTrackVisible(track, anyVideoSolo))
      .map((track) => track.id)
  )
  const transitionContributorIds = new Set()

  if (!soloSet) {
    for (const transition of transitions || []) {
      if (!isBetweenClipTransition(transition)) continue
      const clipA = clips.find((clip) => clip.id === transition.clipAId)
      const clipB = clips.find((clip) => clip.id === transition.clipBId)
      if (!clipA || !clipB || clipA.trackId !== clipB.trackId) continue
      if (!visibleVideoTrackIds.has(clipA.trackId) || clipA.enabled === false || clipB.enabled === false) continue
      const duration = Math.max(0, Number(transition.duration) || 0)
      const split = normalizeTransitionSplit(
        transition?.settings?.split,
        transition?.settings?.alignment || 'center'
      )
      const editPoint = Number.isFinite(Number(transition.editPoint))
        ? Number(transition.editPoint)
        : ((Number(clipA.startTime) || 0) + (Number(clipA.duration) || 0))
      const transitionStart = editPoint - duration * split.clipA
      const transitionEnd = editPoint + duration * split.clipB
      if (transitionStart < safeEnd && transitionEnd > safeStart) {
        transitionContributorIds.add(clipA.id)
        transitionContributorIds.add(clipB.id)
      }
    }
  }

  return new Set(clips.filter((clip) => {
    if (!clip?.id || clip.enabled === false) return false
    if (soloSet && !soloSet.has(clip.id)) return false
    if (clip.trackId && !visibleVideoTrackIds.has(clip.trackId)) return false
    const clipStart = Number(clip.startTime) || 0
    const clipEnd = clipStart + Math.max(0, Number(clip.duration) || 0)
    return (clipStart < safeEnd && clipEnd > safeStart) || transitionContributorIds.has(clip.id)
  }).map((clip) => clip.id))
}
