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
      startPoints: normalized.points
        ? normalized.points.map((p) => ({ x: p.x, y: p.y, hIn: { ...p.hIn }, hOut: { ...p.hOut } }))
        : null,
      altKey: !!e.altKey,
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
      } else if (drag.mode.startsWith('point:') || drag.mode.startsWith('hin:') || drag.mode.startsWith('hout:')) {
        // Vertex drags land in the mask's unit box space: un-rotate the
        // frame-fraction delta, then divide by the box extent. Handle pairs
        // that start mirrored stay mirrored unless the drag began with Alt.
        const [kind, indexRaw] = drag.mode.split(':')
        const index = Number(indexRaw)
        const startPoints = drag.startPoints
        if (startPoints && startPoints[index]) {
          const angle = (-(start.rotation || 0) * Math.PI) / 180
          const duLocal = du * Math.cos(angle) - dv * Math.sin(angle)
          const dvLocal = du * Math.sin(angle) + dv * Math.cos(angle)
          const dxUnit = (duLocal * 100) / Math.max(1, start.width)
          const dyUnit = (dvLocal * 100) / Math.max(1, start.height)
          const clampUnit = (value) => Math.max(-1.5, Math.min(1.5, Math.round(value * 10000) / 10000))
          const nextPoints = startPoints.map((p) => ({ x: p.x, y: p.y, hIn: { ...p.hIn }, hOut: { ...p.hOut } }))
          const target = nextPoints[index]
          if (kind === 'point') {
            target.x = clampUnit(startPoints[index].x + dxUnit)
            target.y = clampUnit(startPoints[index].y + dyUnit)
          } else {
            const which = kind === 'hin' ? 'hIn' : 'hOut'
            const other = which === 'hIn' ? 'hOut' : 'hIn'
            const fromHandle = startPoints[index][which]
            const nextHandle = { x: clampUnit(fromHandle.x + dxUnit), y: clampUnit(fromHandle.y + dyUnit) }
            target[which] = nextHandle
            const otherHandle = startPoints[index][other]
            const wasMirrored = Math.abs(fromHandle.x + otherHandle.x) < 0.001 && Math.abs(fromHandle.y + otherHandle.y) < 0.001
            if (wasMirrored && !drag.altKey) {
              target[other] = { x: -nextHandle.x, y: -nextHandle.y }
            }
          }
          updates = { points: nextPoints }
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

  const clonePoints = () => (normalized?.points
    ? normalized.points.map((p) => ({ x: p.x, y: p.y, hIn: { ...p.hIn }, hOut: { ...p.hOut } }))
    : null)

  const insertPointAfter = (index) => {
    const pts = normalized?.points
    if (disabled || !pts) return
    // De Casteljau split at t=0.5 preserves the drawn curve exactly.
    const from = pts[index]
    const to = pts[(index + 1) % pts.length]
    const mid = (m, n) => ({ x: (m.x + n.x) / 2, y: (m.y + n.y) / 2 })
    const p0 = { x: from.x, y: from.y }
    const c1 = { x: from.x + from.hOut.x, y: from.y + from.hOut.y }
    const c2 = { x: to.x + to.hIn.x, y: to.y + to.hIn.y }
    const p3 = { x: to.x, y: to.y }
    const m1 = mid(p0, c1)
    const m2 = mid(c1, c2)
    const m3 = mid(c2, p3)
    const q1 = mid(m1, m2)
    const q2 = mid(m2, m3)
    const b = mid(q1, q2)
    const nextPoints = clonePoints()
    nextPoints[index].hOut = { x: m1.x - p0.x, y: m1.y - p0.y }
    nextPoints[(index + 1) % pts.length].hIn = { x: m3.x - p3.x, y: m3.y - p3.y }
    nextPoints.splice(index + 1, 0, { x: b.x, y: b.y, hIn: { x: q1.x - b.x, y: q1.y - b.y }, hOut: { x: q2.x - b.x, y: q2.y - b.y } })
    if (typeof onInteractionStart === 'function') onInteractionStart()
    if (typeof onMaskChange === 'function') onMaskChange({ points: nextPoints })
  }

  const removePoint = (index) => {
    const pts = normalized?.points
    if (disabled || !pts || pts.length <= 3) return
    const nextPoints = clonePoints().filter((_, i) => i !== index)
    if (typeof onInteractionStart === 'function') onInteractionStart()
    if (typeof onMaskChange === 'function') onMaskChange({ points: nextPoints })
  }

  if (!clip || !normalized) return null

  const isSpline = normalized.shape === 'spline' && Array.isArray(normalized.points)
  const toBoxPct = (value) => (value + 0.5) * 100
  const splinePathD = isSpline
    ? (() => {
      const pts = normalized.points
      let d = `M ${toBoxPct(pts[0].x)} ${toBoxPct(pts[0].y)}`
      for (let i = 0; i < pts.length; i += 1) {
        const from = pts[i]
        const to = pts[(i + 1) % pts.length]
        d += ` C ${toBoxPct(from.x + from.hOut.x)} ${toBoxPct(from.y + from.hOut.y)}, ${toBoxPct(to.x + to.hIn.x)} ${toBoxPct(to.y + to.hIn.y)}, ${toBoxPct(to.x)} ${toBoxPct(to.y)}`
      }
      return `${d} Z`
    })()
    : null

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
            className={`absolute inset-0 border-[1.5px] border-dashed pointer-events-none ${isSpline ? 'border-sf-accent/25' : 'border-sf-accent/95'}`}
            style={{ borderRadius }}
          />
          {isSpline && (
            <svg
              className="absolute inset-0 h-full w-full overflow-visible pointer-events-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <path
                d={splinePathD}
                fill="none"
                stroke="rgb(var(--sf-accent))"
                strokeWidth="1.5"
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
              {!disabled && normalized.points.map((p, i) => (
                <g key={`stems-${i}`} stroke="rgba(255,255,255,0.5)" strokeWidth="1">
                  <line x1={toBoxPct(p.x)} y1={toBoxPct(p.y)} x2={toBoxPct(p.x + p.hIn.x)} y2={toBoxPct(p.y + p.hIn.y)} vectorEffect="non-scaling-stroke" />
                  <line x1={toBoxPct(p.x)} y1={toBoxPct(p.y)} x2={toBoxPct(p.x + p.hOut.x)} y2={toBoxPct(p.y + p.hOut.y)} vectorEffect="non-scaling-stroke" />
                </g>
              ))}
            </svg>
          )}
          {isSpline && !disabled && normalized.points.map((p, i) => {
            const next = normalized.points[(i + 1) % normalized.points.length]
            const mid = (m, n) => ({ x: (m.x + n.x) / 2, y: (m.y + n.y) / 2 })
            const c1 = { x: p.x + p.hOut.x, y: p.y + p.hOut.y }
            const c2 = { x: next.x + next.hIn.x, y: next.y + next.hIn.y }
            const m1 = mid(p, c1)
            const m2 = mid(c1, c2)
            const m3 = mid(c2, next)
            const q1 = mid(m1, m2)
            const q2 = mid(m2, m3)
            const b = mid(q1, q2)
            return (
              <button
                key={`insert-${i}`}
                type="button"
                aria-label="Add spline point"
                title="Click to add a point here"
                className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/70 bg-sf-dark-800/70 pointer-events-auto cursor-copy hover:bg-sf-accent hover:border-white"
                style={{ left: `${toBoxPct(b.x)}%`, top: `${toBoxPct(b.y)}%` }}
                onClick={() => insertPointAfter(i)}
              />
            )
          })}
          {isSpline && !disabled && normalized.points.map((p, i) => (
            <button
              key={`hin-${i}`}
              type="button"
              aria-label={`Spline in-handle ${i + 1}`}
              title="Drag to shape the curve. Alt-drag to break the pair."
              className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/85 border border-sf-dark-700 pointer-events-auto cursor-grab"
              style={{ left: `${toBoxPct(p.x + p.hIn.x)}%`, top: `${toBoxPct(p.y + p.hIn.y)}%` }}
              onPointerDown={(e) => beginDrag(`hin:${i}`, e)}
            />
          ))}
          {isSpline && !disabled && normalized.points.map((p, i) => (
            <button
              key={`hout-${i}`}
              type="button"
              aria-label={`Spline out-handle ${i + 1}`}
              title="Drag to shape the curve. Alt-drag to break the pair."
              className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/85 border border-sf-dark-700 pointer-events-auto cursor-grab"
              style={{ left: `${toBoxPct(p.x + p.hOut.x)}%`, top: `${toBoxPct(p.y + p.hOut.y)}%` }}
              onPointerDown={(e) => beginDrag(`hout:${i}`, e)}
            />
          ))}
          {isSpline && !disabled && normalized.points.map((p, i) => (
            <button
              key={`anchor-${i}`}
              type="button"
              aria-label={`Spline point ${i + 1}`}
              title="Drag to move the point. Alt-click to delete it."
              className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sf-accent border border-white/85 shadow-[0_0_8px_rgba(0,0,0,0.4)] pointer-events-auto cursor-grab"
              style={{ left: `${toBoxPct(p.x)}%`, top: `${toBoxPct(p.y)}%` }}
              onPointerDown={(e) => {
                if (e.altKey) {
                  e.preventDefault()
                  e.stopPropagation()
                  removePoint(i)
                  return
                }
                beginDrag(`point:${i}`, e)
              }}
            />
          ))}
          {!disabled && (
            <>
              <button
                type="button"
                aria-label="Move mask"
                title="Drag to move the mask"
                className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sf-accent border border-white/85 shadow-[0_0_8px_rgba(0,0,0,0.4)] pointer-events-auto cursor-move"
                onPointerDown={(e) => beginDrag('move', e)}
              />
              {/* Spline mode hides the edge handles: the seeded circle's
                  cardinal anchors sit exactly where these live, and the later
                  sibling steals the click — dragging "the top point" would
                  resize height and mirror the bottom. Width/Height sliders
                  still scale the whole path. */}
              {!isSpline && (
                <>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export { DEFAULT_SHAPE_MASK }
