import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const SCALE_MIN = 1
const SCALE_MAX = 1000
const POSITION_SNAP_STEP = 10
const SCALE_SNAP_STEP = 5
const ROTATION_SNAP_STEP = 5

function normalizeRotationDegrees(value) {
  if (!Number.isFinite(value)) return 0
  const normalized = ((value + 180) % 360 + 360) % 360 - 180
  return Object.is(normalized, -0) ? 0 : normalized
}

function clampScale(value) {
  if (!Number.isFinite(value)) return SCALE_MIN
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, value))
}

function roundTo(value, precision = 3) {
  if (!Number.isFinite(value)) return value
  const p = 10 ** precision
  return Math.round(value * p) / p
}

function getSafeNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getDragStartTransform(transform) {
  return {
    positionX: getSafeNumber(transform?.positionX, 0),
    positionY: getSafeNumber(transform?.positionY, 0),
    scaleX: getSafeNumber(transform?.scaleX, 100),
    scaleY: getSafeNumber(transform?.scaleY, 100),
    rotation: getSafeNumber(transform?.rotation, 0),
  }
}

function snapToStep(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value
  return Math.round(value / step) * step
}

export default function PreviewTransformGizmo({
  clip,
  transform,
  buildVideoTransform,
  previewScale,
  zoomScale = 1,
  disabled = false,
  onInteractionStart,
  onTransformChange,
  onTransformCommit,
}) {
  const frameRef = useRef(null)
  const dragStateRef = useRef(null)
  const pendingCommitRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)

  const effectiveZoom = Number.isFinite(Number(zoomScale)) && Number(zoomScale) > 0
    ? Number(zoomScale)
    : 1
  const pxPerTimelineX = Math.max(0.0001, getSafeNumber(previewScale?.x, 1) * effectiveZoom)
  const pxPerTimelineY = Math.max(0.0001, getSafeNumber(previewScale?.y, 1) * effectiveZoom)

  const frameStyle = useMemo(() => {
    const style = (typeof buildVideoTransform === 'function' ? buildVideoTransform(transform) : {}) || {}
    return {
      transform: style.transform,
      transformOrigin: style.transformOrigin || '50% 50%',
    }
  }, [buildVideoTransform, transform])

  const beginDrag = useCallback((mode, e) => {
    if (!clip || disabled) return
    if (e.button !== 0) return
    const frameEl = frameRef.current
    if (!frameEl) return
    const frameRect = frameEl.getBoundingClientRect()
    const startTransform = getDragStartTransform(transform)
    const centerX = frameRect.left + frameRect.width / 2
    const centerY = frameRect.top + frameRect.height / 2
    const startDistance = Math.max(8, Math.hypot(e.clientX - centerX, e.clientY - centerY))
    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX)
    const startOffsetX = Math.max(8, Math.abs(e.clientX - centerX))
    const startOffsetY = Math.max(8, Math.abs(e.clientY - centerY))

    e.preventDefault()
    e.stopPropagation()
    if (typeof onInteractionStart === 'function') {
      onInteractionStart()
    }

    pendingCommitRef.current = null
    dragStateRef.current = {
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startTransform,
      centerX,
      centerY,
      startDistance,
      startAngle,
      startOffsetX,
      startOffsetY,
    }
    setIsDragging(true)
  }, [clip, disabled, transform, onInteractionStart])

  useEffect(() => {
    if (!isDragging) return undefined

    const handlePointerMove = (e) => {
      const drag = dragStateRef.current
      if (!drag) return

      let updates = null
      const snap = e.shiftKey
      if (drag.mode === 'move') {
        const deltaX = (e.clientX - drag.startClientX) / pxPerTimelineX
        const deltaY = (e.clientY - drag.startClientY) / pxPerTimelineY
        let positionX = drag.startTransform.positionX + deltaX
        let positionY = drag.startTransform.positionY + deltaY
        if (snap) {
          positionX = snapToStep(positionX, POSITION_SNAP_STEP)
          positionY = snapToStep(positionY, POSITION_SNAP_STEP)
        }
        updates = {
          positionX: roundTo(positionX),
          positionY: roundTo(positionY),
        }
      } else if (drag.mode === 'scale-uniform') {
        const distance = Math.max(8, Math.hypot(e.clientX - drag.centerX, e.clientY - drag.centerY))
        const factor = Math.max(0.01, distance / drag.startDistance)
        let scaleX = clampScale(drag.startTransform.scaleX * factor)
        let scaleY = clampScale(drag.startTransform.scaleY * factor)
        if (snap) {
          scaleX = snapToStep(scaleX, SCALE_SNAP_STEP)
          scaleY = snapToStep(scaleY, SCALE_SNAP_STEP)
        }
        updates = {
          scaleX: roundTo(scaleX, 2),
          scaleY: roundTo(scaleY, 2),
        }
      } else if (drag.mode === 'scale-x') {
        const offsetX = Math.max(8, Math.abs(e.clientX - drag.centerX))
        const factorX = Math.max(0.01, offsetX / drag.startOffsetX)
        let scaleX = clampScale(drag.startTransform.scaleX * factorX)
        if (snap) {
          scaleX = snapToStep(scaleX, SCALE_SNAP_STEP)
        }
        updates = {
          scaleX: roundTo(scaleX, 2),
        }
      } else if (drag.mode === 'scale-y') {
        const offsetY = Math.max(8, Math.abs(e.clientY - drag.centerY))
        const factorY = Math.max(0.01, offsetY / drag.startOffsetY)
        let scaleY = clampScale(drag.startTransform.scaleY * factorY)
        if (snap) {
          scaleY = snapToStep(scaleY, SCALE_SNAP_STEP)
        }
        updates = {
          scaleY: roundTo(scaleY, 2),
        }
      } else if (drag.mode === 'rotate') {
        const angle = Math.atan2(e.clientY - drag.centerY, e.clientX - drag.centerX)
        const deltaDegrees = ((angle - drag.startAngle) * 180) / Math.PI
        let rotation = normalizeRotationDegrees(drag.startTransform.rotation + deltaDegrees)
        if (snap) {
          rotation = snapToStep(rotation, ROTATION_SNAP_STEP)
        }
        updates = {
          rotation: roundTo(rotation, 2),
        }
      }

      if (updates && typeof onTransformChange === 'function') {
        onTransformChange(updates)
        pendingCommitRef.current = updates
      }
    }

    const finishDrag = () => {
      const updates = pendingCommitRef.current
      if (updates && typeof onTransformCommit === 'function') {
        onTransformCommit(updates)
      }
      pendingCommitRef.current = null
      dragStateRef.current = null
      setIsDragging(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', finishDrag)
    }
  }, [isDragging, pxPerTimelineX, pxPerTimelineY, onTransformChange, onTransformCommit])

  if (!clip || !transform) return null

  return (
    <div className="absolute inset-0 pointer-events-none z-40">
      <div
        ref={frameRef}
        className={`absolute inset-0 border-2 border-sf-accent/85 bg-sf-accent/5 pointer-events-auto ${disabled ? 'cursor-default' : 'cursor-move'}`}
        style={frameStyle}
        title="Drag to move. Hold Shift to snap."
        onPointerDown={(e) => beginDrag('move', e)}
      >
        {!disabled && (
          <>
            <button
              type="button"
              aria-label="Scale from top-left"
              className="absolute -left-1.5 -top-1.5 w-3 h-3 rounded-full bg-sf-accent border border-white/80 cursor-nwse-resize"
              title="Scale uniformly (Shift snaps)"
              onPointerDown={(e) => beginDrag('scale-uniform', e)}
            />
            <button
              type="button"
              aria-label="Scale from top-right"
              className="absolute -right-1.5 -top-1.5 w-3 h-3 rounded-full bg-sf-accent border border-white/80 cursor-nesw-resize"
              title="Scale uniformly (Shift snaps)"
              onPointerDown={(e) => beginDrag('scale-uniform', e)}
            />
            <button
              type="button"
              aria-label="Scale from bottom-left"
              className="absolute -left-1.5 -bottom-1.5 w-3 h-3 rounded-full bg-sf-accent border border-white/80 cursor-nesw-resize"
              title="Scale uniformly (Shift snaps)"
              onPointerDown={(e) => beginDrag('scale-uniform', e)}
            />
            <button
              type="button"
              aria-label="Scale from bottom-right"
              className="absolute -right-1.5 -bottom-1.5 w-3 h-3 rounded-full bg-sf-accent border border-white/80 cursor-nwse-resize"
              title="Scale uniformly (Shift snaps)"
              onPointerDown={(e) => beginDrag('scale-uniform', e)}
            />
            <button
              type="button"
              aria-label="Scale width"
              className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-sf-accent border border-white/80 cursor-ew-resize"
              title="Scale width only (Shift snaps)"
              onPointerDown={(e) => beginDrag('scale-x', e)}
            />
            <button
              type="button"
              aria-label="Scale width"
              className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-sf-accent border border-white/80 cursor-ew-resize"
              title="Scale width only (Shift snaps)"
              onPointerDown={(e) => beginDrag('scale-x', e)}
            />
            <button
              type="button"
              aria-label="Scale height"
              className="absolute left-1/2 -translate-x-1/2 -top-1.5 w-3 h-3 rounded-full bg-sf-accent border border-white/80 cursor-ns-resize"
              title="Scale height only (Shift snaps)"
              onPointerDown={(e) => beginDrag('scale-y', e)}
            />
            <button
              type="button"
              aria-label="Scale height"
              className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 rounded-full bg-sf-accent border border-white/80 cursor-ns-resize"
              title="Scale height only (Shift snaps)"
              onPointerDown={(e) => beginDrag('scale-y', e)}
            />

            <div className="absolute left-1/2 -translate-x-1/2 -top-7 pointer-events-none">
              <div className="w-px h-4 bg-sf-accent/80 mx-auto" />
              <button
                type="button"
                aria-label="Rotate clip"
                className="w-3.5 h-3.5 rounded-full bg-sf-accent border border-white/80 pointer-events-auto cursor-grab active:cursor-grabbing"
                title="Rotate (Shift snaps to 5deg)"
                onPointerDown={(e) => beginDrag('rotate', e)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

