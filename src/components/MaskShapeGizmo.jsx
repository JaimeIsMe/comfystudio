import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SHAPE_MASK, normalizeShapeMask } from '../utils/shapeMask'

// On-monitor editing for clip.shapeMask: dashed outline + gold handles over
// the program monitor. Center dot moves the mask, edge handles resize the
// axis, and everything renders inside the clip's transformed frame — the
// same frameRect + CSS transform recipe as PreviewTransformGizmo — so the
// overlay tracks the clip through position/scale/rotation.
//
// Drag math: three zero-size probes at the frame's TL/TR/BL corners are
// measured at dragstart, giving the client-space basis of the clip rect.
// Inverting that 2x2 basis converts pointer deltas straight into fractions
// of the clip frame — correct under preview zoom/pan, clip scale, and clip
// rotation, with no dependency on how those transforms compose upstream.

const clampMaskValue = (key, value) => {
  if (key === 'centerX' || key === 'centerY') return Math.max(-50, Math.min(150, value))
  if (key === 'width' || key === 'height') return Math.max(1, Math.min(200, value))
  return value
}

const roundTo = (value, precision = 2) => {
  const p = 10 ** precision
  return Math.round(value * p) / p
}

export default function MaskShapeGizmo({
  clip,
  mask,
  transform,
  buildVideoTransform,
  frameRect = null,
  disabled = false,
  onInteractionStart,
  onMaskChange,
}) {
  const frameRef = useRef(null)
  const probeTLRef = useRef(null)
  const probeTRRef = useRef(null)
  const probeBLRef = useRef(null)
  const dragRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)

  const normalized = normalizeShapeMask(mask)

  const frameStyle = useMemo(() => {
    const style = (typeof buildVideoTransform === 'function' ? buildVideoTransform(transform) : {}) || {}
    const safeRect = frameRect
      && Number.isFinite(Number(frameRect.x))
      && Number.isFinite(Number(frameRect.y))
      && Number(frameRect.width) > 0
      && Number(frameRect.height) > 0
      ? {
          left: `${Number(frameRect.x)}px`,
          top: `${Number(frameRect.y)}px`,
          width: `${Number(frameRect.width)}px`,
          height: `${Number(frameRect.height)}px`,
        }
      : { inset: 0 }
    return {
      ...safeRect,
      transform: style.transform,
      transformOrigin: style.transformOrigin || '50% 50%',
    }
  }, [buildVideoTransform, frameRect, transform])

  const beginDrag = useCallback((mode, e) => {
    if (disabled || e.button !== 0 || !normalized) return
    const readProbe = (ref) => {
      const rect = ref.current?.getBoundingClientRect()
      return rect ? { x: rect.left, y: rect.top } : null
    }
    const p00 = readProbe(probeTLRef)
    const p10 = readProbe(probeTRRef)
    const p01 = readProbe(probeBLRef)
    if (!p00 || !p10 || !p01) return
    const a = p10.x - p00.x
    const c = p10.y - p00.y
    const b = p01.x - p00.x
    const d = p01.y - p00.y
    const det = a * d - b * c
    if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return

    e.preventDefault()
    e.stopPropagation()
    if (typeof onInteractionStart === 'function') onInteractionStart()
    dragRef.current = {
      mode,
      startMask: { ...normalized },
      startClientX: e.clientX,
      startClientY: e.clientY,
      basis: { a, b, c, d, det },
    }
    setIsDragging(true)
  }, [disabled, normalized, onInteractionStart])

  useEffect(() => {
    if (!isDragging) return undefined

    const handlePointerMove = (e) => {
      const drag = dragRef.current
      if (!drag) return
      const { a, b, c, d, det } = drag.basis
      const dx = e.clientX - drag.startClientX
      const dy = e.clientY - drag.startClientY
      // client delta -> fractions of the clip frame (du along width, dv along height)
      const du = (d * dx - b * dy) / det
      const dv = (-c * dx + a * dy) / det

      const start = drag.startMask
      let updates = null
      if (drag.mode === 'move') {
        updates = {
          centerX: roundTo(clampMaskValue('centerX', start.centerX + du * 100)),
          centerY: roundTo(clampMaskValue('centerY', start.centerY + dv * 100)),
        }
      } else {
        // Resize deltas rotate into the mask's own axes so handles keep
        // meaning "this edge" on rotated masks. Fraction space is mildly
        // anisotropic under extreme aspect ratios; exact at 0/90/180.
        const angle = (-(start.rotation || 0) * Math.PI) / 180
        const duLocal = du * Math.cos(angle) - dv * Math.sin(angle)
        const dvLocal = du * Math.sin(angle) + dv * Math.cos(angle)
        if (drag.mode === 'resize-e' || drag.mode === 'resize-w') {
          const direction = drag.mode === 'resize-e' ? 1 : -1
          updates = { width: roundTo(clampMaskValue('width', start.width + direction * duLocal * 200)) }
        } else if (drag.mode === 'resize-n' || drag.mode === 'resize-s') {
          const direction = drag.mode === 'resize-s' ? 1 : -1
          updates = { height: roundTo(clampMaskValue('height', start.height + direction * dvLocal * 200)) }
        }
      }
      if (updates && typeof onMaskChange === 'function') {
        onMaskChange(updates)
      }
    }

    const finishDrag = () => {
      dragRef.current = null
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
  }, [isDragging, onMaskChange])

  if (!clip || !normalized) return null

  const borderRadius = normalized.shape === 'ellipse'
    ? '50%'
    : normalized.shape === 'rounded'
      ? `${Math.max(2, normalized.cornerRadius * 0.4)}%`
      : '2px'
  // Feather reach hint: the raster feathers by % of frame height in both
  // axes, so the ring inflates width by the aspect-corrected equivalent.
  const featherHeightPct = normalized.feather
  const featherWidthPct = normalized.feather * (9 / 16)

  const maskBoxStyle = {
    left: `${normalized.centerX}%`,
    top: `${normalized.centerY}%`,
    width: `${normalized.width}%`,
    height: `${normalized.height}%`,
    transform: `translate(-50%, -50%) rotate(${normalized.rotation}deg)`,
  }

  const handleClass = 'absolute w-3 h-3 rounded-[3px] bg-sf-accent border border-white/85 shadow-[0_0_8px_rgba(0,0,0,0.4)] pointer-events-auto'

  return (
    <div className="absolute inset-0 overflow-visible pointer-events-none z-40">
      <div ref={frameRef} className="absolute overflow-visible pointer-events-none" style={frameStyle}>
        <div ref={probeTLRef} className="absolute h-0 w-0" style={{ left: 0, top: 0 }} />
        <div ref={probeTRRef} className="absolute h-0 w-0" style={{ left: '100%', top: 0 }} />
        <div ref={probeBLRef} className="absolute h-0 w-0" style={{ left: 0, top: '100%' }} />

        {featherHeightPct > 0 && (
          <div
            className="absolute border border-dotted border-sf-accent/45 pointer-events-none"
            style={{
              left: `${normalized.centerX}%`,
              top: `${normalized.centerY}%`,
              width: `${normalized.width + featherWidthPct * 2}%`,
              height: `${normalized.height + featherHeightPct * 2}%`,
              transform: `translate(-50%, -50%) rotate(${normalized.rotation}deg)`,
              borderRadius,
            }}
          />
        )}

        <div className="absolute pointer-events-none" style={maskBoxStyle}>
          <div
            className="absolute inset-0 border-[1.5px] border-dashed border-sf-accent/95 pointer-events-none"
            style={{ borderRadius }}
          />
          {!disabled && (
            <>
              <button
                type="button"
                aria-label="Move mask"
                title="Drag to move the mask"
                className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sf-accent border border-white/85 shadow-[0_0_8px_rgba(0,0,0,0.4)] pointer-events-auto cursor-move"
                onPointerDown={(e) => beginDrag('move', e)}
              />
              <button
                type="button"
                aria-label="Resize mask height (top)"
                title="Drag to resize height"
                className={`${handleClass} left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize`}
                onPointerDown={(e) => beginDrag('resize-n', e)}
              />
              <button
                type="button"
                aria-label="Resize mask height (bottom)"
                title="Drag to resize height"
                className={`${handleClass} left-1/2 -bottom-1.5 -translate-x-1/2 cursor-ns-resize`}
                onPointerDown={(e) => beginDrag('resize-s', e)}
              />
              <button
                type="button"
                aria-label="Resize mask width (left)"
                title="Drag to resize width"
                className={`${handleClass} -left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize`}
                onPointerDown={(e) => beginDrag('resize-w', e)}
              />
              <button
                type="button"
                aria-label="Resize mask width (right)"
                title="Drag to resize width"
                className={`${handleClass} -right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize`}
                onPointerDown={(e) => beginDrag('resize-e', e)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export { DEFAULT_SHAPE_MASK }
