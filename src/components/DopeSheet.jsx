import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, Diamond, Magnet, Trash2 } from 'lucide-react'
import useTimelineStore from '../stores/timelineStore'
import { KEYFRAMEABLE_PROPERTIES, EASING_OPTIONS, getAnimatedTransform, getAnimatedAdjustmentSettings, quantizeTimeToFrame } from '../utils/keyframes'

const LEFT_COLUMN_WIDTH = 148
const KEYFRAME_MATCH_TOLERANCE = 0.05
const RULER_HEIGHT = 32
const PROPERTY_ROW_HEIGHT = 36

const getMajorRulerStep = (pixelsPerSecond) => {
  const candidates = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120]
  const minSpacingPx = 90
  return candidates.find((step) => step * pixelsPerSecond >= minSpacingPx) || candidates[candidates.length - 1]
}

function DopeSheet() {
  const {
    selectedClipIds,
    clips,
    playheadPosition,
    setPlayheadPosition,
    saveToHistory,
    moveKeyframeTime,
    moveKeyframesAtTime,
    setKeyframe,
    removeKeyframe,
    timelineFps,
    zoom,
  } = useTimelineStore()
  const [frameSnapEnabled, setFrameSnapEnabled] = useState(true)
  const [selectedKeyframe, setSelectedKeyframe] = useState(null) // { propertyId, time }
  const [selectedKeyframes, setSelectedKeyframes] = useState([]) // [{ propertyId, time }]
  const [dragState, setDragState] = useState(null)
  const [marqueeState, setMarqueeState] = useState(null) // { startX, startY, currentX, currentY } in scroll-content coords
  const dragHistorySavedRef = useRef(false)
  const lanesScrollRef = useRef(null)

  const selectedClip = useMemo(() => {
    if (!selectedClipIds.length) return null
    return clips.find((clip) => clip.id === selectedClipIds[0]) || null
  }, [clips, selectedClipIds])

  const pixelsPerSecond = zoom / 5
  const clipDuration = Math.max(0.001, Number(selectedClip?.duration) || 0.001)
  const laneWidth = Math.max(1, clipDuration * pixelsPerSecond)

  const clipLocalPlayheadTime = selectedClip
    ? playheadPosition - selectedClip.startTime
    : 0
  const safeFps = Number.isFinite(Number(timelineFps)) && Number(timelineFps) > 0 ? Number(timelineFps) : 24

  const propertyRows = useMemo(() => {
    if (!selectedClip) return []

    return KEYFRAMEABLE_PROPERTIES.filter((property) => {
      const hasBaseValue = Object.prototype.hasOwnProperty.call(selectedClip.transform || {}, property.id)
      const hasAdjustmentBaseValue = Object.prototype.hasOwnProperty.call(selectedClip.adjustments || {}, property.id)
      const hasKeyframes = (selectedClip.keyframes?.[property.id] || []).length > 0
      return hasBaseValue || hasAdjustmentBaseValue || hasKeyframes
    })
  }, [selectedClip])

  const rulerTicks = useMemo(() => {
    if (!selectedClip) return { major: [], minor: [] }

    const majorStep = getMajorRulerStep(pixelsPerSecond)
    const minorDivisions = majorStep >= 10 ? 5 : 4
    const minorStep = majorStep / minorDivisions
    const major = []
    const minor = []
    const maxSteps = Math.ceil(clipDuration / minorStep)

    for (let i = 0; i <= maxSteps; i += 1) {
      const time = Number((i * minorStep).toFixed(6))
      if (time > clipDuration + 0.000001) break

      if (i % minorDivisions === 0) {
        major.push(time)
      } else {
        minor.push(time)
      }
    }

    return { major, minor }
  }, [clipDuration, pixelsPerSecond, selectedClip])

  const formatSeconds = (seconds) => {
    if (!Number.isFinite(seconds)) return '0.00s'
    return `${seconds.toFixed(2)}s`
  }

  const clampToClipRange = useCallback(
    (time) => Math.max(0, Math.min(clipDuration, time)),
    [clipDuration]
  )

  const isSameKeyframeTime = useCallback((a, b) => (
    Math.abs(Number(a || 0) - Number(b || 0)) < KEYFRAME_MATCH_TOLERANCE
  ), [])

  const normalizeKeyframeSelection = useCallback((entries = []) => {
    const normalized = []
    for (const entry of entries) {
      const propertyId = String(entry?.propertyId || '').trim()
      const time = Number(entry?.time)
      if (!propertyId || !Number.isFinite(time)) continue
      const exists = normalized.some((item) => (
        item.propertyId === propertyId && isSameKeyframeTime(item.time, time)
      ))
      if (!exists) normalized.push({ propertyId, time })
    }
    return normalized
  }, [isSameKeyframeTime])

  const isKeyframeSelected = useCallback((propertyId, time) => (
    selectedKeyframes.some((entry) => (
      entry.propertyId === propertyId && isSameKeyframeTime(entry.time, time)
    ))
  ), [isSameKeyframeTime, selectedKeyframes])

  const normalizeEditableTime = useCallback((time) => {
    const clamped = clampToClipRange(time)
    if (!frameSnapEnabled) return clamped
    return clampToClipRange(quantizeTimeToFrame(clamped, safeFps))
  }, [clampToClipRange, frameSnapEnabled, safeFps])

  const collectKeyframesInMarquee = useCallback((rectState) => {
    if (!selectedClip || !rectState) return []

    const left = Math.min(rectState.startX, rectState.currentX)
    const right = Math.max(rectState.startX, rectState.currentX)
    const top = Math.min(rectState.startY, rectState.currentY)
    const bottom = Math.max(rectState.startY, rectState.currentY)
    const hits = []

    propertyRows.forEach((property, rowIndex) => {
      const rowCenterY = RULER_HEIGHT + rowIndex * PROPERTY_ROW_HEIGHT + (PROPERTY_ROW_HEIGHT / 2)
      if (rowCenterY < top || rowCenterY > bottom) return

      const keyframes = selectedClip.keyframes?.[property.id] || []
      keyframes.forEach((keyframe) => {
        const x = LEFT_COLUMN_WIDTH + (clampToClipRange(keyframe.time) * pixelsPerSecond)
        if (x < left || x > right) return
        hits.push({ propertyId: property.id, time: keyframe.time })
      })
    })

    return normalizeKeyframeSelection(hits)
  }, [clampToClipRange, normalizeKeyframeSelection, pixelsPerSecond, propertyRows, selectedClip])

  const setPlayheadFromMouseEvent = useCallback((event) => {
    if (!selectedClip) return

    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const clipTime = normalizeEditableTime(x / pixelsPerSecond)
    setPlayheadPosition(selectedClip.startTime + clipTime)
  }, [normalizeEditableTime, pixelsPerSecond, selectedClip, setPlayheadPosition])

  const startMarqueeSelection = useCallback((event) => {
    if (!selectedClip || !lanesScrollRef.current) return

    const scrollElement = lanesScrollRef.current
    const scrollRect = scrollElement.getBoundingClientRect()
    const pointerX = event.clientX - scrollRect.left + scrollElement.scrollLeft
    const pointerY = event.clientY - scrollRect.top + scrollElement.scrollTop

    setDragState(null)
    setSelectedKeyframe(null)
    setSelectedKeyframes([])
    setMarqueeState({
      startX: pointerX,
      startY: pointerY,
      currentX: pointerX,
      currentY: pointerY,
    })
  }, [selectedClip])

  const handleLaneMouseDown = useCallback((event) => {
    if (event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      startMarqueeSelection(event)
      return
    }
    setPlayheadFromMouseEvent(event)
  }, [setPlayheadFromMouseEvent, startMarqueeSelection])

  const addKeyframeAtPlayhead = useCallback((propertyId) => {
    if (!selectedClip) return

    const targetTime = normalizeEditableTime(clipLocalPlayheadTime)
    const animatedTransform = getAnimatedTransform(selectedClip, targetTime) || selectedClip.transform || {}
    const animatedAdjustments = selectedClip.type === 'adjustment'
      ? (getAnimatedAdjustmentSettings(selectedClip, targetTime) || selectedClip.adjustments || {})
      : {}
    const hasAdjustmentValue = Object.prototype.hasOwnProperty.call(animatedAdjustments, propertyId)
    const rawValue = hasAdjustmentValue
      ? animatedAdjustments[propertyId]
      : (animatedTransform[propertyId]
        ?? selectedClip.transform?.[propertyId]
        ?? selectedClip.adjustments?.[propertyId]
        ?? 0)
    const value = Number.isFinite(Number(rawValue)) ? Number(rawValue) : 0

    setKeyframe(selectedClip.id, propertyId, targetTime, value, 'easeInOut', { saveHistory: true })
    setSelectedKeyframe({ propertyId, time: targetTime })
    setSelectedKeyframes([{ propertyId, time: targetTime }])
  }, [clipLocalPlayheadTime, normalizeEditableTime, selectedClip, setKeyframe])

  const deleteSelectedKeyframes = useCallback(() => {
    if (!selectedClip) return
    const targets = normalizeKeyframeSelection(
      selectedKeyframes.length > 0
        ? selectedKeyframes
        : (selectedKeyframe ? [selectedKeyframe] : [])
    )
    if (targets.length === 0) return

    saveToHistory()
    targets.forEach((target) => {
      removeKeyframe(
        selectedClip.id,
        target.propertyId,
        target.time,
        { saveHistory: false }
      )
    })

    setSelectedKeyframes([])
    setSelectedKeyframe(null)
  }, [normalizeKeyframeSelection, removeKeyframe, saveToHistory, selectedClip, selectedKeyframe, selectedKeyframes])

  const startKeyframeDrag = (event, propertyId, keyframeTime) => {
    if (event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      startMarqueeSelection(event)
      return
    }

    event.preventDefault()
    event.stopPropagation()
    if (!selectedClip) return

    const clickedKeyframe = { propertyId, time: keyframeTime }
    const clickedIsInSelection = isKeyframeSelected(propertyId, keyframeTime)
    const shouldMoveSelection = clickedIsInSelection && selectedKeyframes.length > 1 && !event.shiftKey
    const activeSelection = normalizeKeyframeSelection(
      shouldMoveSelection ? selectedKeyframes : [clickedKeyframe]
    )
    const selectionTimes = activeSelection.map((entry) => entry.time)

    dragHistorySavedRef.current = false
    setSelectedKeyframe(clickedKeyframe)
    setSelectedKeyframes(activeSelection)
    setDragState({
      clipId: selectedClip.id,
      propertyId,
      sourceTime: keyframeTime,
      currentTime: keyframeTime,
      startX: event.clientX,
      groupMove: event.shiftKey && !shouldMoveSelection,
      selectionEntries: shouldMoveSelection
        ? activeSelection.map((entry) => ({
          propertyId: entry.propertyId,
          sourceTime: entry.time,
          currentTime: entry.time,
        }))
        : null,
      selectionMinTime: selectionTimes.length > 0 ? Math.min(...selectionTimes) : keyframeTime,
      selectionMaxTime: selectionTimes.length > 0 ? Math.max(...selectionTimes) : keyframeTime,
      currentDelta: 0,
    })
  }

  useEffect(() => {
    if (!dragState || !selectedClip) return undefined

    const handleMouseMove = (event) => {
      const deltaX = event.clientX - dragState.startX

      if (Array.isArray(dragState.selectionEntries) && dragState.selectionEntries.length > 1) {
        const anchorTargetTime = normalizeEditableTime(dragState.sourceTime + (deltaX / pixelsPerSecond))
        const minDelta = -Math.max(0, Number(dragState.selectionMinTime) || 0)
        const maxDelta = clipDuration - Math.max(0, Number(dragState.selectionMaxTime) || 0)
        const boundedDelta = Math.max(minDelta, Math.min(anchorTargetTime - dragState.sourceTime, maxDelta))

        if (Math.abs(boundedDelta - Number(dragState.currentDelta || 0)) < 0.0005) {
          return
        }

        if (!dragHistorySavedRef.current) {
          saveToHistory()
          dragHistorySavedRef.current = true
        }

        const nextEntries = dragState.selectionEntries.map((entry) => ({
          ...entry,
          targetTime: normalizeEditableTime(entry.sourceTime + boundedDelta),
        }))
        const orderedIndices = nextEntries
          .map((_, index) => index)
          .sort((a, b) => (
            boundedDelta >= 0
              ? nextEntries[b].currentTime - nextEntries[a].currentTime
              : nextEntries[a].currentTime - nextEntries[b].currentTime
          ))

        let movedAny = false
        for (const index of orderedIndices) {
          const entry = nextEntries[index]
          if (isSameKeyframeTime(entry.targetTime, entry.currentTime)) continue

          const moved = moveKeyframeTime(
            dragState.clipId,
            entry.propertyId,
            entry.currentTime,
            entry.targetTime,
            { saveHistory: false }
          )
          if (!moved) continue

          nextEntries[index] = {
            ...entry,
            currentTime: entry.targetTime,
          }
          movedAny = true
        }

        if (!movedAny) {
          return
        }

        const nextSelection = nextEntries.map((entry) => ({
          propertyId: entry.propertyId,
          time: entry.currentTime,
        }))
        setSelectedKeyframes(nextSelection)
        setSelectedKeyframe((previous) => {
          if (!previous) return nextSelection[0] || null
          const previousIndex = dragState.selectionEntries.findIndex((entry) => (
            entry.propertyId === previous.propertyId && isSameKeyframeTime(entry.currentTime, previous.time)
          ))
          if (previousIndex >= 0) {
            return {
              propertyId: nextEntries[previousIndex].propertyId,
              time: nextEntries[previousIndex].currentTime,
            }
          }
          return nextSelection[0] || null
        })
        setDragState((previous) => {
          if (!previous) return previous
          return {
            ...previous,
            currentDelta: boundedDelta,
            currentTime: dragState.sourceTime + boundedDelta,
            selectionEntries: nextEntries.map((entry) => ({
              propertyId: entry.propertyId,
              sourceTime: entry.sourceTime,
              currentTime: entry.currentTime,
            })),
          }
        })
        return
      }

      const targetTime = normalizeEditableTime(dragState.sourceTime + (deltaX / pixelsPerSecond))

      if (isSameKeyframeTime(targetTime, dragState.currentTime)) {
        return
      }

      if (!dragHistorySavedRef.current) {
        saveToHistory()
        dragHistorySavedRef.current = true
      }

      const moved = dragState.groupMove
        ? moveKeyframesAtTime(
          dragState.clipId,
          dragState.currentTime,
          targetTime,
          { saveHistory: false }
        )
        : moveKeyframeTime(
          dragState.clipId,
          dragState.propertyId,
          dragState.currentTime,
          targetTime,
          { saveHistory: false }
        )

      if (!moved) {
        return
      }

      setSelectedKeyframes([{ propertyId: dragState.propertyId, time: targetTime }])
      setSelectedKeyframe((previous) => {
        if (!previous) return previous
        if (previous.propertyId !== dragState.propertyId) return previous
        return { ...previous, time: targetTime }
      })

      setDragState((previous) => {
        if (!previous) return previous
        return {
          ...previous,
          currentTime: targetTime,
        }
      })
    }

    const handleMouseUp = () => {
      setDragState(null)
      dragHistorySavedRef.current = false
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [
    clipDuration,
    dragState,
    isSameKeyframeTime,
    moveKeyframeTime,
    moveKeyframesAtTime,
    normalizeEditableTime,
    pixelsPerSecond,
    saveToHistory,
    selectedClip,
  ])

  useEffect(() => {
    if (!marqueeState || !selectedClip || !lanesScrollRef.current) return undefined

    const scrollElement = lanesScrollRef.current
    const updateSelection = (nextState) => {
      const nextSelected = collectKeyframesInMarquee(nextState)
      setSelectedKeyframes(nextSelected)
      setSelectedKeyframe(nextSelected.length === 1 ? nextSelected[0] : null)
    }

    updateSelection(marqueeState)

    const handleMouseMove = (event) => {
      const rect = scrollElement.getBoundingClientRect()
      const currentX = event.clientX - rect.left + scrollElement.scrollLeft
      const currentY = event.clientY - rect.top + scrollElement.scrollTop
      const nextState = {
        ...marqueeState,
        currentX,
        currentY,
      }
      setMarqueeState(nextState)
      updateSelection(nextState)
    }

    const handleMouseUp = () => {
      setMarqueeState(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'crosshair'

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [collectKeyframesInMarquee, marqueeState, selectedClip])

  useEffect(() => {
    if (!selectedClip || !selectedKeyframe) return
    const keyframes = selectedClip.keyframes?.[selectedKeyframe.propertyId] || []
    const stillExists = keyframes.some((keyframe) => isSameKeyframeTime(keyframe.time, selectedKeyframe.time))
    if (!stillExists) {
      if (selectedKeyframes.length > 0) {
        setSelectedKeyframe(selectedKeyframes[0] || null)
      } else {
        setSelectedKeyframe(null)
      }
    }
  }, [isSameKeyframeTime, selectedClip, selectedKeyframe, selectedKeyframes])

  useEffect(() => {
    if (!selectedClip || selectedKeyframes.length === 0) return

    const validSelection = normalizeKeyframeSelection(
      selectedKeyframes.filter((entry) => {
        const keyframes = selectedClip.keyframes?.[entry.propertyId] || []
        return keyframes.some((keyframe) => isSameKeyframeTime(keyframe.time, entry.time))
      })
    )

    const isUnchanged = (
      validSelection.length === selectedKeyframes.length
      && validSelection.every((entry) => (
        selectedKeyframes.some((existing) => (
          existing.propertyId === entry.propertyId && isSameKeyframeTime(existing.time, entry.time)
        ))
      ))
    )
    if (isUnchanged) return

    setSelectedKeyframes(validSelection)
    if (validSelection.length === 0) {
      setSelectedKeyframe(null)
    } else if (
      !selectedKeyframe
      || !validSelection.some((entry) => (
        entry.propertyId === selectedKeyframe.propertyId && isSameKeyframeTime(entry.time, selectedKeyframe.time)
      ))
    ) {
      setSelectedKeyframe(validSelection[0])
    }
  }, [isSameKeyframeTime, normalizeKeyframeSelection, selectedClip, selectedKeyframe, selectedKeyframes])

  useEffect(() => {
    if ((selectedKeyframes.length === 0 && !selectedKeyframe) || dragState || marqueeState) return undefined

    const handleKeyDown = (event) => {
      const target = event.target
      const isTypingField = target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (isTypingField) return

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelectedKeyframes()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteSelectedKeyframes, dragState, marqueeState, selectedKeyframe, selectedKeyframes.length])

  const marqueeBox = useMemo(() => {
    if (!marqueeState) return null
    const left = Math.min(marqueeState.startX, marqueeState.currentX)
    const top = Math.min(marqueeState.startY, marqueeState.currentY)
    const width = Math.abs(marqueeState.currentX - marqueeState.startX)
    const height = Math.abs(marqueeState.currentY - marqueeState.startY)
    return { left, top, width, height }
  }, [marqueeState])

  const selectedKeyframeCount = selectedKeyframes.length > 0
    ? selectedKeyframes.length
    : (selectedKeyframe ? 1 : 0)

  const selectedKeyframeTargets = useMemo(() => {
    if (!selectedClip) return []

    const selection = normalizeKeyframeSelection(
      selectedKeyframes.length > 0
        ? selectedKeyframes
        : (selectedKeyframe ? [selectedKeyframe] : [])
    )

    return selection.map((entry) => {
      const keyframes = selectedClip.keyframes?.[entry.propertyId] || []
      const match = keyframes.find((keyframe) => isSameKeyframeTime(keyframe.time, entry.time))
      if (!match) return null
      return {
        propertyId: entry.propertyId,
        time: match.time,
        value: match.value,
        easing: match.easing || 'linear',
      }
    }).filter(Boolean)
  }, [isSameKeyframeTime, normalizeKeyframeSelection, selectedClip, selectedKeyframe, selectedKeyframes])

  const selectedEasingValue = useMemo(() => {
    if (selectedKeyframeTargets.length === 0) return ''
    const first = selectedKeyframeTargets[0].easing
    const allSame = selectedKeyframeTargets.every((target) => target.easing === first)
    return allSame ? first : 'mixed'
  }, [selectedKeyframeTargets])

  const applyEasingToSelection = useCallback((nextEasing) => {
    if (!selectedClip || !nextEasing || nextEasing === 'mixed') return
    if (!EASING_OPTIONS.some((option) => option.id === nextEasing)) return
    if (selectedKeyframeTargets.length === 0) return

    saveToHistory()
    selectedKeyframeTargets.forEach((target) => {
      setKeyframe(
        selectedClip.id,
        target.propertyId,
        target.time,
        target.value,
        nextEasing,
        { saveHistory: false }
      )
    })
  }, [saveToHistory, selectedClip, selectedKeyframeTargets, setKeyframe])

  if (!selectedClip) {
    return (
      <div className="h-full bg-sf-dark-900 border-t border-sf-dark-700 flex items-center justify-center">
        <div className="text-center text-sf-text-muted">
          <Clock3 className="w-5 h-5 mx-auto mb-2 opacity-70" />
          <p className="text-sm">Select a clip to edit keyframes in Dope Sheet.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full bg-sf-dark-900 border-t border-sf-dark-700 flex flex-col min-h-0">
      <div className="h-8 px-3 border-b border-sf-dark-700 bg-sf-dark-800 flex items-center justify-between text-[11px]">
        <div className="text-sf-text-secondary flex items-center gap-3">
          <span>
            Clip: <span className="text-sf-text-primary">{selectedClip.name}</span>
          </span>
          <button
            onClick={() => setFrameSnapEnabled((value) => !value)}
            className={`px-2 py-0.5 rounded text-[10px] border transition-colors flex items-center gap-1 ${
              frameSnapEnabled
                ? 'bg-sf-accent/20 text-sf-accent border-sf-accent/40'
                : 'bg-sf-dark-700 text-sf-text-muted border-sf-dark-600 hover:bg-sf-dark-600'
            }`}
            title={frameSnapEnabled ? 'Frame snap ON (click to allow free-time keyframes)' : 'Frame snap OFF (click to snap keyframes to frames)'}
          >
            <Magnet className="w-3 h-3" />
            {frameSnapEnabled ? `Frame Snap (${safeFps}fps)` : 'Free Time'}
          </button>
          <span className="text-[10px] text-sf-text-muted">Alt+Drag = marquee select keyframes | Shift+Drag = move same-time column</span>
          {selectedKeyframeCount > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-sf-text-muted">Easing</span>
              <select
                value={selectedEasingValue}
                onChange={(event) => applyEasingToSelection(event.target.value)}
                className="px-1.5 py-0.5 rounded text-[10px] border border-sf-dark-600 bg-sf-dark-700 text-sf-text-secondary focus:outline-none focus:ring-1 focus:ring-sf-accent/60"
                title="Set easing for selected keyframe(s)"
              >
                {selectedEasingValue === 'mixed' && (
                  <option value="mixed" disabled>Mixed</option>
                )}
                {EASING_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {selectedKeyframeCount > 0 && (
            <button
              onClick={deleteSelectedKeyframes}
              className="px-1.5 py-0.5 rounded text-[10px] border border-sf-error/50 text-sf-error bg-sf-error/10 hover:bg-sf-error/20 transition-colors flex items-center gap-1"
              title="Delete selected keyframe(s) (Delete / Backspace)"
            >
              <Trash2 className="w-3 h-3" />
              {selectedKeyframeCount > 1 ? `Delete Keyframes (${selectedKeyframeCount})` : 'Delete Keyframe'}
            </button>
          )}
        </div>
        <div className="text-sf-text-muted">
          Playhead: <span className="text-sf-text-secondary">{formatSeconds(clampToClipRange(clipLocalPlayheadTime))}</span>
        </div>
      </div>

      <div ref={lanesScrollRef} className="flex-1 min-h-0 overflow-auto">
        <div className="relative" style={{ minWidth: `${LEFT_COLUMN_WIDTH + laneWidth}px` }}>
          <div className="flex h-8 border-b border-sf-dark-700 bg-sf-dark-800">
            <div
              className="sticky left-0 z-20 flex items-center px-3 text-[10px] uppercase tracking-wide text-sf-text-muted border-r border-sf-dark-700 bg-sf-dark-800"
              style={{ width: `${LEFT_COLUMN_WIDTH}px` }}
            >
              Property
            </div>
            <div
              className="relative border-r border-sf-dark-700 cursor-pointer"
              style={{ width: `${laneWidth}px` }}
              onMouseDown={handleLaneMouseDown}
            >
              {rulerTicks.minor.map((time) => (
                <div
                  key={`minor-${time}`}
                  className="absolute bottom-0 w-px h-2 bg-sf-dark-600/70"
                  style={{ left: `${time * pixelsPerSecond}px` }}
                />
              ))}
              {rulerTicks.major.map((time) => (
                <div
                  key={`major-${time}`}
                  className="absolute top-0 bottom-0"
                  style={{ left: `${time * pixelsPerSecond}px` }}
                >
                  <div className="w-px h-full bg-sf-dark-600" />
                  <span className="absolute top-0.5 left-1 text-[9px] text-sf-text-muted font-mono">
                    {formatSeconds(time)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {propertyRows.length === 0 && (
            <div className="h-16 flex items-center justify-center text-xs text-sf-text-muted border-b border-sf-dark-800">
              This clip does not expose keyframeable properties yet.
            </div>
          )}

          {propertyRows.map((property) => {
            const keyframes = selectedClip.keyframes?.[property.id] || []

            return (
              <div key={property.id} className="flex h-9 border-b border-sf-dark-800">
                <div
                  className="sticky left-0 z-10 flex items-center justify-between px-3 text-[11px] border-r border-sf-dark-700 bg-sf-dark-900"
                  style={{ width: `${LEFT_COLUMN_WIDTH}px` }}
                >
                  <span className="text-sf-text-secondary">{property.label}</span>
                  <span className="text-[9px] text-sf-text-muted">{property.unit}</span>
                </div>
                <div
                  className="relative border-r border-sf-dark-700 cursor-pointer"
                  style={{ width: `${laneWidth}px` }}
                  onMouseDown={handleLaneMouseDown}
                  onDoubleClick={() => addKeyframeAtPlayhead(property.id)}
                >
                  <div
                    className="absolute top-0 bottom-0 w-px bg-yellow-500/80 pointer-events-none"
                    style={{
                      left: `${clampToClipRange(clipLocalPlayheadTime) * pixelsPerSecond}px`,
                    }}
                  />

                  {keyframes.map((keyframe, index) => (
                    <div
                      key={`${property.id}-${index}-${keyframe.time}`}
                      className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-ew-resize ${
                        isKeyframeSelected(property.id, keyframe.time)
                        || (selectedKeyframe?.propertyId === property.id && isSameKeyframeTime(selectedKeyframe?.time, keyframe.time))
                          ? 'z-20'
                          : 'z-10'
                      }`}
                      style={{ left: `${clampToClipRange(keyframe.time) * pixelsPerSecond}px` }}
                      title={`${property.label}: ${keyframe.value.toFixed(2)}${property.unit} at ${formatSeconds(keyframe.time)} (${keyframe.easing || 'linear'})`}
                      onMouseDown={(event) => startKeyframeDrag(event, property.id, keyframe.time)}
                      onDoubleClick={(event) => event.stopPropagation()}
                    >
                      <Diamond
                        className={`w-3 h-3 ${
                          isKeyframeSelected(property.id, keyframe.time)
                          || (selectedKeyframe?.propertyId === property.id && isSameKeyframeTime(selectedKeyframe?.time, keyframe.time))
                            ? 'text-sf-accent fill-sf-accent'
                            : 'text-yellow-400 fill-yellow-400'
                        }`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {marqueeBox && (
            <div
              className="absolute pointer-events-none border border-sf-accent/80 bg-sf-accent/10 rounded-sm z-30"
              style={{
                left: `${marqueeBox.left}px`,
                top: `${marqueeBox.top}px`,
                width: `${marqueeBox.width}px`,
                height: `${marqueeBox.height}px`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default DopeSheet
