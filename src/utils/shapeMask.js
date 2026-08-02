// Parametric shape masks (Step 1 of vector masking): rectangle / ellipse /
// rounded rect attached to a clip as clip.shapeMask. The mask rasterizes to
// a white-shape-on-transparent canvas with FEATHER AND INVERT BAKED IN, so
// every existing mask consumer — 2D preview (alpha via destination-in), GPU
// preview/export (luminance replace), and the exporter's CPU luminance
// loops — applies it unchanged with invert always reported false. One
// rasterizer, three pipelines, zero new compositor semantics.
//
// Geometry is fractional (percent of the clip's frame), so the same mask
// data fits any resolution; the raster stretches onto the clip's draw rect
// exactly like AI mask assets do. Feather is percent of frame height —
// resolution-independent softness.

export const SHAPE_MASK_TYPES = Object.freeze(['rectangle', 'ellipse', 'rounded', 'spline'])

const RASTER_W = 1280
const RASTER_H = 720
const CACHE_CAP = 12

export const DEFAULT_SHAPE_MASK = Object.freeze({
  shape: 'ellipse',
  centerX: 50, // % of frame width
  centerY: 50, // % of frame height
  width: 60,   // % of frame width
  height: 60,  // % of frame height
  rotation: 0, // degrees
  cornerRadius: 12, // % of the shorter half-extent (rounded rect only)
  feather: 5,  // % of frame height
  invert: false,
})

const clampNumber = (value, min, max, fallback) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

// Spline anchors live in the mask's unit box space: x/y in [-0.5, 0.5] spans
// the width/height box, so center/size/rotation — and their shapeMask.*
// keyframes — move the whole path rigidly without touching the points.
// hIn/hOut are bezier control offsets FROM their anchor.
const SPLINE_CIRCLE_K = 0.276142 // (4/3)·tan(π/8) · 0.5 — circle-approximation handle length for r=0.5
export const DEFAULT_SPLINE_POINTS = Object.freeze([
  { x: 0, y: -0.5, hIn: { x: -SPLINE_CIRCLE_K, y: 0 }, hOut: { x: SPLINE_CIRCLE_K, y: 0 } },
  { x: 0.5, y: 0, hIn: { x: 0, y: -SPLINE_CIRCLE_K }, hOut: { x: 0, y: SPLINE_CIRCLE_K } },
  { x: 0, y: 0.5, hIn: { x: SPLINE_CIRCLE_K, y: 0 }, hOut: { x: -SPLINE_CIRCLE_K, y: 0 } },
  { x: -0.5, y: 0, hIn: { x: 0, y: SPLINE_CIRCLE_K }, hOut: { x: 0, y: -SPLINE_CIRCLE_K } },
])

const roundUnit = (value) => Math.round(value * 10000) / 10000

const normalizeSplineHandle = (handle) => ({
  x: roundUnit(clampNumber(handle?.x, -1.5, 1.5, 0)),
  y: roundUnit(clampNumber(handle?.y, -1.5, 1.5, 0)),
})

/** Null unless there are at least 3 usable anchors (a closed path needs 3). */
export function normalizeSplinePoints(points) {
  if (!Array.isArray(points)) return null
  const normalized = points
    .filter((point) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
    .map((point) => ({
      x: roundUnit(clampNumber(point.x, -1.5, 1.5, 0)),
      y: roundUnit(clampNumber(point.y, -1.5, 1.5, 0)),
      hIn: normalizeSplineHandle(point.hIn),
      hOut: normalizeSplineHandle(point.hOut),
    }))
  return normalized.length >= 3 ? normalized : null
}

/** Null when there is no usable mask (no shape / disabled). */
export function normalizeShapeMask(mask) {
  if (!mask || typeof mask !== 'object') return null
  const shape = SHAPE_MASK_TYPES.includes(mask.shape) ? mask.shape : null
  if (!shape) return null
  const points = shape === 'spline' ? normalizeSplinePoints(mask.points) : null
  if (shape === 'spline' && !points) return null
  return {
    shape,
    centerX: clampNumber(mask.centerX, -50, 150, DEFAULT_SHAPE_MASK.centerX),
    centerY: clampNumber(mask.centerY, -50, 150, DEFAULT_SHAPE_MASK.centerY),
    width: clampNumber(mask.width, 1, 200, DEFAULT_SHAPE_MASK.width),
    height: clampNumber(mask.height, 1, 200, DEFAULT_SHAPE_MASK.height),
    rotation: clampNumber(mask.rotation, -180, 180, 0),
    cornerRadius: clampNumber(mask.cornerRadius, 0, 100, DEFAULT_SHAPE_MASK.cornerRadius),
    feather: clampNumber(mask.feather, 0, 50, DEFAULT_SHAPE_MASK.feather),
    invert: !!mask.invert,
    ...(points ? { points } : {}),
  }
}

/**
 * De Casteljau split of the segment after `index` at t=0.5 — preserves the
 * drawn curve exactly. Returns a new array; used by the gizmo AND applied to
 * every shape keyframe so point counts stay matched for interpolation.
 */
export function insertSplinePointAfter(points, index) {
  if (!Array.isArray(points) || !points[index]) return points
  const from = points[index]
  const to = points[(index + 1) % points.length]
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
  const next = points.map((p) => ({ x: p.x, y: p.y, hIn: { ...p.hIn }, hOut: { ...p.hOut } }))
  next[index].hOut = { x: m1.x - p0.x, y: m1.y - p0.y }
  next[(index + 1) % points.length].hIn = { x: m3.x - p3.x, y: m3.y - p3.y }
  next.splice(index + 1, 0, { x: b.x, y: b.y, hIn: { x: q1.x - b.x, y: q1.y - b.y }, hOut: { x: q2.x - b.x, y: q2.y - b.y } })
  return next
}

export function removeSplinePointAt(points, index) {
  if (!Array.isArray(points) || points.length <= 3) return points
  return points
    .filter((_, i) => i !== index)
    .map((p) => ({ x: p.x, y: p.y, hIn: { ...p.hIn }, hOut: { ...p.hOut } }))
}

export function getShapeMaskSignature(mask) {
  const normalized = normalizeShapeMask(mask)
  return normalized ? JSON.stringify(normalized) : ''
}

const traceShapePath = (ctx, normalized) => {
  const cx = (normalized.centerX / 100) * RASTER_W
  const cy = (normalized.centerY / 100) * RASTER_H
  const halfW = Math.max(1, (normalized.width / 200) * RASTER_W)
  const halfH = Math.max(1, (normalized.height / 200) * RASTER_H)
  ctx.translate(cx, cy)
  ctx.rotate((normalized.rotation * Math.PI) / 180)
  ctx.beginPath()
  if (normalized.shape === 'spline' && normalized.points) {
    const sx = halfW * 2
    const sy = halfH * 2
    const pts = normalized.points
    ctx.moveTo(pts[0].x * sx, pts[0].y * sy)
    for (let i = 0; i < pts.length; i += 1) {
      const from = pts[i]
      const to = pts[(i + 1) % pts.length]
      ctx.bezierCurveTo(
        (from.x + from.hOut.x) * sx, (from.y + from.hOut.y) * sy,
        (to.x + to.hIn.x) * sx, (to.y + to.hIn.y) * sy,
        to.x * sx, to.y * sy,
      )
    }
    ctx.closePath()
  } else if (normalized.shape === 'ellipse') {
    ctx.ellipse(0, 0, halfW, halfH, 0, 0, Math.PI * 2)
  } else if (normalized.shape === 'rounded') {
    const radius = Math.min(halfW, halfH) * (normalized.cornerRadius / 100)
    ctx.roundRect(-halfW, -halfH, halfW * 2, halfH * 2, radius)
  } else {
    ctx.rect(-halfW, -halfH, halfW * 2, halfH * 2)
  }
}

const rasterize = (normalized) => {
  const canvas = document.createElement('canvas')
  canvas.width = RASTER_W
  canvas.height = RASTER_H
  const ctx = canvas.getContext('2d')
  const featherPx = (normalized.feather / 100) * RASTER_H

  const drawShape = () => {
    ctx.save()
    if (featherPx > 0.25) ctx.filter = `blur(${featherPx}px)`
    ctx.fillStyle = '#ffffff'
    traceShapePath(ctx, normalized)
    ctx.fill()
    ctx.restore()
  }

  if (normalized.invert) {
    // Solid white everywhere, then punch a feathered hole: outside keeps
    // the clip, inside disappears.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, RASTER_W, RASTER_H)
    ctx.globalCompositeOperation = 'destination-out'
    drawShape()
    ctx.globalCompositeOperation = 'source-over'
  } else {
    drawShape()
  }
  return canvas
}

// Signature-keyed cache with a small cap: scrubbing re-reads the same mask
// every frame, slider drags produce a short burst of new signatures.
const rasterCache = new Map() // signature -> { alpha, luma }

/**
 * Both matte encodings for a clip's shape mask, or null when the clip has
 * none. Two encodings because the pipelines disagree about where coverage
 * lives:
 * - `alpha`: white shape on TRANSPARENT — coverage in the alpha channel,
 *   for the 2D preview's destination-in compositing.
 * - `luma`: the same coverage as an OPAQUE black-to-white image — for the
 *   GPU mask shader and the exporter's CPU loops, which read UNPREMULTIPLIED
 *   luminance. A feathered transparent-white raster unpremultiplies to
 *   solid white across the whole blur reach (softness lives only in alpha),
 *   which silently un-masks feathered clips there; compositing the alpha
 *   raster over opaque black moves the coverage into RGB, matching the
 *   opaque luminance images the AI raster masks always were.
 * Cached together per parameter signature; safe to call per frame.
 */
export function getShapeMaskCanvases(mask) {
  const normalized = normalizeShapeMask(mask)
  if (!normalized) return null
  const signature = JSON.stringify(normalized)
  let entry = rasterCache.get(signature)
  if (entry) return entry
  const alpha = rasterize(normalized)
  const luma = document.createElement('canvas')
  luma.width = alpha.width
  luma.height = alpha.height
  const lumaCtx = luma.getContext('2d')
  lumaCtx.fillStyle = '#000000'
  lumaCtx.fillRect(0, 0, luma.width, luma.height)
  lumaCtx.drawImage(alpha, 0, 0)
  entry = { alpha, luma }
  if (rasterCache.size >= CACHE_CAP) {
    const oldest = rasterCache.keys().next().value
    rasterCache.delete(oldest)
  }
  rasterCache.set(signature, entry)
  return entry
}
