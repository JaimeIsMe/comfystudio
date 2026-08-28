const DEFAULT_FPS = 24
const NEIGHBOR_TOLERANCE_SECONDS = 0.01

const INFINITE_CLIP_TYPES = new Set([
  'image',
  'adjustment',
  'text',
  'shape',
  'captions',
])

const finiteNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const getTimeScale = (clip) => {
  const baseScale = finiteNumber(clip?.sourceTimeScale, 0)
    || (finiteNumber(clip?.timelineFps, 0) > 0 && finiteNumber(clip?.sourceFps, 0) > 0
      ? Number(clip.timelineFps) / Number(clip.sourceFps)
      : 1)
  const speed = finiteNumber(clip?.speed, 1)
  return Math.max(0.0001, baseScale * (speed > 0 ? speed : 1))
}

const getFiniteSourceDuration = (clip, fallbackTrimEnd) => {
  if (INFINITE_CLIP_TYPES.has(clip?.type)) return Infinity
  if (clip?.sourceDuration === Infinity || clip?.sourceDuration === 'Infinity') return Infinity
  const parsed = Number(clip?.sourceDuration)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return fallbackTrimEnd
}

export const getMultiClipTrimTargetIds = ({ selectedClipIds, primaryClipId } = {}) => {
  const selected = Array.isArray(selectedClipIds)
    ? [...new Set(selectedClipIds.filter(Boolean))]
    : []
  return selected.includes(primaryClipId) ? selected : [primaryClipId].filter(Boolean)
}

export function createMultiClipTrimSession({
  clips,
  targetClipIds,
  primaryClipId,
  edge,
  fps = DEFAULT_FPS,
} = {}) {
  if (edge !== 'left' && edge !== 'right') return null
  const clipList = Array.isArray(clips) ? clips : []
  const targetIds = [...new Set((Array.isArray(targetClipIds) ? targetClipIds : []).filter(Boolean))]
  const targets = targetIds
    .map((clipId) => clipList.find((clip) => clip?.id === clipId))
    .filter(Boolean)
  const primary = targets.find((clip) => clip.id === primaryClipId)
  if (!primary || targets.length === 0) return null

  const safeFps = Math.max(1, finiteNumber(fps, DEFAULT_FPS))
  const minimumDuration = 1 / safeFps
  let groupMinimumDelta = -Infinity
  let groupMaximumDelta = Infinity

  const snapshots = targets.map((clip) => {
    const startTime = Math.max(0, finiteNumber(clip.startTime, 0))
    const duration = Math.max(minimumDuration, finiteNumber(clip.duration, minimumDuration))
    const endTime = startTime + duration
    const timeScale = getTimeScale(clip)
    const trimStart = Math.max(0, finiteNumber(clip.trimStart, 0))
    const fallbackTrimEnd = trimStart + duration * timeScale
    const explicitTrimEnd = Number(clip.trimEnd)
    const trimEnd = Number.isFinite(explicitTrimEnd)
      ? Math.max(trimStart, explicitTrimEnd)
      : fallbackTrimEnd
    const infinitelyExtendable = INFINITE_CLIP_TYPES.has(clip?.type)
    const sourceDuration = getFiniteSourceDuration(clip, trimEnd)

    const trackNeighbors = clipList.filter((candidate) => (
      candidate?.id !== clip.id && candidate?.trackId === clip.trackId
    ))
    const leftNeighborEnd = trackNeighbors
      .map((candidate) => finiteNumber(candidate.startTime, 0) + Math.max(0, finiteNumber(candidate.duration, 0)))
      .filter((candidateEnd) => candidateEnd <= startTime + NEIGHBOR_TOLERANCE_SECONDS)
      .reduce((nearest, candidateEnd) => Math.max(nearest, candidateEnd), -Infinity)
    const rightNeighborStart = trackNeighbors
      .map((candidate) => finiteNumber(candidate.startTime, 0))
      .filter((candidateStart) => candidateStart >= endTime - NEIGHBOR_TOLERANCE_SECONDS)
      .reduce((nearest, candidateStart) => Math.min(nearest, candidateStart), Infinity)

    let minimumDelta
    let maximumDelta
    if (edge === 'left') {
      minimumDelta = -startTime
      if (!infinitelyExtendable) {
        minimumDelta = Math.max(minimumDelta, -trimStart / timeScale)
      }
      if (Number.isFinite(leftNeighborEnd)) {
        minimumDelta = Math.max(minimumDelta, leftNeighborEnd - startTime)
      }
      maximumDelta = duration - minimumDuration
    } else {
      minimumDelta = minimumDuration - duration
      maximumDelta = Infinity
      if (Number.isFinite(sourceDuration)) {
        maximumDelta = Math.min(
          maximumDelta,
          (sourceDuration - trimStart) / timeScale - duration
        )
      }
      if (Number.isFinite(rightNeighborStart)) {
        maximumDelta = Math.min(maximumDelta, rightNeighborStart - endTime)
      }
    }

    groupMinimumDelta = Math.max(groupMinimumDelta, minimumDelta)
    groupMaximumDelta = Math.min(groupMaximumDelta, maximumDelta)

    return {
      id: clip.id,
      startTime,
      duration,
      endTime,
      trimStart,
      trimEnd,
      timeScale,
    }
  })

  // Invalid legacy timing should never invert the gesture. Pin both bounds
  // to the nearest legal delta so the selected clips remain aligned.
  if (groupMinimumDelta > groupMaximumDelta) {
    const pinnedDelta = Math.abs(groupMinimumDelta) <= Math.abs(groupMaximumDelta)
      ? groupMinimumDelta
      : groupMaximumDelta
    groupMinimumDelta = pinnedDelta
    groupMaximumDelta = pinnedDelta
  }

  const primarySnapshot = snapshots.find((snapshot) => snapshot.id === primaryClipId)
  return {
    edge,
    primaryClipId,
    primaryEdgeTime: edge === 'left' ? primarySnapshot.startTime : primarySnapshot.endTime,
    targetClipIds: snapshots.map((snapshot) => snapshot.id),
    snapshots,
    minimumDelta: groupMinimumDelta,
    maximumDelta: groupMaximumDelta,
  }
}

export function resolveMultiClipTrim(session, requestedDelta) {
  if (!session || !Array.isArray(session.snapshots)) {
    return { delta: 0, updates: [] }
  }
  const parsedDelta = finiteNumber(requestedDelta, 0)
  const minimumDelta = finiteNumber(session.minimumDelta, -Infinity)
  const maximumDelta = finiteNumber(session.maximumDelta, Infinity)
  const delta = Math.max(minimumDelta, Math.min(maximumDelta, parsedDelta))

  const updates = session.snapshots.map((snapshot) => {
    if (session.edge === 'left') {
      return {
        id: snapshot.id,
        updates: {
          startTime: snapshot.startTime + delta,
          duration: snapshot.duration - delta,
          trimStart: Math.max(0, snapshot.trimStart + delta * snapshot.timeScale),
        },
      }
    }
    const duration = snapshot.duration + delta
    return {
      id: snapshot.id,
      updates: {
        duration,
        trimEnd: snapshot.trimStart + duration * snapshot.timeScale,
      },
    }
  })

  return {
    delta,
    updates,
    constrained: Math.abs(delta - parsedDelta) > 1e-7,
  }
}
