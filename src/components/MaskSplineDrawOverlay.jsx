import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Pen-draw surface for spline masks: click places a corner point, click-drag
// pulls out symmetric bezier handles, clicking the first point (or Enter)
// closes the path, Escape cancels. Points are collected in clip-frame
// fractions; on close the drawn bounding box becomes the mask's center/size
// box and the points convert to the mask's unit space, so every existing
// box/shape animation behaves identically for drawn and seeded splines.
const CLOSE_MIN_POINTS = 3
const DRAG_HANDLE_THRESHOLD_PX = 4
const MIN_BOX_SPAN = 0.02

const roundTo = (value, precision) => {
  const p = 10 ** precision
  return Math.round(value * p) / p
}

export default function MaskSplineDrawOverlay({
  transform,
  buildVideoTransform,
  frameRect = null,
  onCommit,
  onCancel,
}) {
  const probeTLRef = useRef(null)
  const probeTRRef = useRef(null)
  const probeBLRef = useRef(null)
  const [points, setPoints] = useState([]) // { u, v, h: { u, v } } in frame fractions
  const [draft, setDraft] = useState(null) // in-progress point while dragging handles
  const [cursor, setCursor] = useState(null)
  const drawDragRef = useRef(null)

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

  const clientToFrame = useCallback((clientX, clientY) => {
    const readProbe = (ref) => {
      const rect = ref.current?.getBoundingClientRect()
      return rect ? { x: rect.left, y: rect.top } : null
    }
    const p00 = readProbe(probeTLRef)
    const p10 = readProbe(probeTRRef)
    const p01 = readProbe(probeBLRef)
    if (!p00 || !p10 || !p01) return null
    const a = p10.x - p00.x
    const c = p10.y - p00.y
    const b = p01.x - p00.x
    const d = p01.y - p00.y
    const det = a * d - b * c
    if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return null
    const dx = clientX - p00.x
    const dy = clientY - p00.y
    return {
      u: (d * dx - b * dy) / det,
      v: (-c * dx + a * dy) / det,
    }
  }, [])

  const closePath = useCallback((finalPoints) => {
    const anchors = finalPoints ?? points
    if (anchors.length < CLOSE_MIN_POINTS || typeof onCommit !== 'function') return
    const minU = Math.min(...anchors.map((p) => p.u))
    const maxU = Math.max(...anchors.map((p) => p.u))
    const minV = Math.min(...anchors.map((p) => p.v))
    const maxV = Math.max(...anchors.map((p) => p.v))
    const spanU = Math.max(MIN_BOX_SPAN, maxU - minU)
    const spanV = Math.max(MIN_BOX_SPAN, maxV - minV)
    const centerU = (minU + maxU) / 2
    const centerV = (minV + maxV) / 2
    onCommit({
      shape: 'spline',
      centerX: roundTo(centerU * 100, 2),
      centerY: roundTo(centerV * 100, 2),
      width: roundTo(spanU * 100, 2),
      height: roundTo(spanV * 100, 2),
      rotation: 0,
      points: anchors.map((p) => ({
        x: roundTo((p.u - centerU) / spanU, 4),
        y: roundTo((p.v - centerV) / spanV, 4),
        hIn: { x: roundTo(-p.h.u / spanU, 4), y: roundTo(-p.h.v / spanV, 4) },
        hOut: { x: roundTo(p.h.u / spanU, 4), y: roundTo(p.h.v / spanV, 4) },
      })),
    })
  }, [onCommit, points])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (typeof onCancel === 'function') onCancel()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        closePath()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [closePath, onCancel])

  const handleSurfacePointerDown = useCallback((event) => {
    if (event.button !== 0) return
    const framePoint = clientToFrame(event.clientX, event.clientY)
    if (!framePoint) return
    event.preventDefault()
    event.stopPropagation()
    drawDragRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      anchor: framePoint,
    }
    setDraft({ u: framePoint.u, v: framePoint.v, h: { u: 0, v: 0 } })
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* synthetic pointers */ }
  }, [clientToFrame])

  const handleSurfacePointerMove = useCallback((event) => {
    const framePoint = clientToFrame(event.clientX, event.clientY)
    if (framePoint) setCursor(framePoint)
    const drag = drawDragRef.current
    if (!drag) return
    const movedPx = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY)
    if (movedPx < DRAG_HANDLE_THRESHOLD_PX || !framePoint) return
    setDraft({
      u: drag.anchor.u,
      v: drag.anchor.v,
      h: { u: framePoint.u - drag.anchor.u, v: framePoint.v - drag.anchor.v },
    })
  }, [clientToFrame])

  const handleSurfacePointerUp = useCallback(() => {
    const drag = drawDragRef.current
    drawDragRef.current = null
    if (!drag) return
    setDraft((current) => {
      if (current) setPoints((existing) => [...existing, current])
      return null
    })
  }, [])

  const handleFirstPointClick = useCallback((event) => {
    event.preventDefault()
    event.stopPropagation()
    closePath()
  }, [closePath])

  const toPct = (value) => value * 100
  const pathD = useMemo(() => {
    if (points.length < 2) return null
    let d = `M ${toPct(points[0].u)} ${toPct(points[0].v)}`
    for (let i = 0; i < points.length - 1; i += 1) {
      const from = points[i]
      const to = points[i + 1]
      d += ` C ${toPct(from.u + from.h.u)} ${toPct(from.v + from.h.v)}, ${toPct(to.u - to.h.u)} ${toPct(to.v - to.h.v)}, ${toPct(to.u)} ${toPct(to.v)}`
    }
    return d
  }, [points])

  const lastPoint = draft || points[points.length - 1] || null
  const canClose = points.length >= CLOSE_MIN_POINTS

  return (
    <div className="absolute inset-0 overflow-visible pointer-events-none z-50">
      <div className="absolute overflow-visible pointer-events-none" style={frameStyle}>
        <div ref={probeTLRef} className="absolute h-0 w-0" style={{ left: 0, top: 0 }} />
        <div ref={probeTRRef} className="absolute h-0 w-0" style={{ left: '100%', top: 0 }} />
        <div ref={probeBLRef} className="absolute h-0 w-0" style={{ left: 0, top: '100%' }} />

        <div
          className="absolute inset-0 pointer-events-auto cursor-crosshair"
          style={{ touchAction: 'none' }}
          onPointerDown={handleSurfacePointerDown}
          onPointerMove={handleSurfacePointerMove}
          onPointerUp={handleSurfacePointerUp}
          onPointerCancel={handleSurfacePointerUp}
        />

        <svg
          className="absolute inset-0 h-full w-full overflow-visible pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {pathD && (
            <path d={pathD} fill="none" stroke="rgb(var(--sf-accent))" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
          )}
          {lastPoint && cursor && !drawDragRef.current && (
            <line
              x1={toPct(lastPoint.u + lastPoint.h.u)}
              y1={toPct(lastPoint.v + lastPoint.h.v)}
              x2={toPct(cursor.u)}
              y2={toPct(cursor.v)}
              stroke="rgba(255,255,255,0.4)"
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {draft && (draft.h.u !== 0 || draft.h.v !== 0) && (
            <g stroke="rgba(255,255,255,0.55)" strokeWidth="1">
              <line x1={toPct(draft.u)} y1={toPct(draft.v)} x2={toPct(draft.u + draft.h.u)} y2={toPct(draft.v + draft.h.v)} vectorEffect="non-scaling-stroke" />
              <line x1={toPct(draft.u)} y1={toPct(draft.v)} x2={toPct(draft.u - draft.h.u)} y2={toPct(draft.v - draft.h.v)} vectorEffect="non-scaling-stroke" />
            </g>
          )}
        </svg>

        {points.map((point, index) => (
          index === 0 ? (
            <button
              key="draw-first"
              type="button"
              aria-label={canClose ? 'Close the spline' : 'First spline point'}
              title={canClose ? 'Click to close the spline' : 'First point — add at least 3 to close'}
              className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border pointer-events-auto ${
                canClose
                  ? 'bg-sf-accent border-white cursor-pointer ring-2 ring-sf-accent/40 hover:scale-125 transition-transform'
                  : 'bg-sf-accent/80 border-white/85'
              }`}
              style={{ left: `${toPct(point.u)}%`, top: `${toPct(point.v)}%` }}
              onPointerDown={(event) => { event.preventDefault(); event.stopPropagation() }}
              onClick={handleFirstPointClick}
            />
          ) : (
            <div
              key={`draw-point-${index}`}
              className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sf-accent border border-white/85 pointer-events-none"
              style={{ left: `${toPct(point.u)}%`, top: `${toPct(point.v)}%` }}
            />
          )
        ))}
        {draft && (
          <div
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 border border-sf-dark-700 pointer-events-none"
            style={{ left: `${toPct(draft.u)}%`, top: `${toPct(draft.v)}%` }}
          />
        )}
      </div>

      <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-md bg-sf-dark-900/90 border border-sf-dark-600 text-[10px] text-sf-text-secondary pointer-events-none whitespace-nowrap">
        Click to add points · drag for curves · {canClose ? 'click the first point or press Enter to close' : `${points.length}/3 points`} · Esc cancels
      </div>
    </div>
  )
}
