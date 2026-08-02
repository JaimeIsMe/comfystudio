import { useEffect, useRef, useState } from 'react'
import { getPreviewFrameSnapshot } from '../services/previewFrameTap'

// Video scopes over the program monitor's committed frame: luma waveform,
// RGB parade, and a vectorscope — the objective read of exposure and color
// that a laptop panel can't give you, and the fastest way to see that one
// AI-generated shot runs warmer than its neighbors.
//
// Everything here is strictly opt-in cost: the panel polls the preview's
// committed frame (pull model, serial-compared) at ~10Hz while mounted and
// does all math on a 320×180 downsample. Closed panel = zero work anywhere.

const SAMPLE_W = 320
const SAMPLE_H = 180
const POLL_MS = 100

const SCOPE_MODES = [
  { id: 'waveform', label: 'Waveform', title: 'Luma waveform (BT.709) — exposure by column' },
  { id: 'parade', label: 'RGB Parade', title: 'R/G/B waveforms side by side — channel balance' },
  { id: 'vectorscope', label: 'Vectorscope', title: 'Chroma distribution — hue angle, saturation radius' },
]

// BT.709, matching the pipeline end to end.
const lumaOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

// 75% primary/secondary targets for the vectorscope graticule, positions
// computed from the same Cb/Cr math as the plot so they land exactly where
// a 75% color bar plots.
const VECTOR_TARGETS = [
  { label: 'R', r: 0.75, g: 0, b: 0 },
  { label: 'Yl', r: 0.75, g: 0.75, b: 0 },
  { label: 'G', r: 0, g: 0.75, b: 0 },
  { label: 'Cy', r: 0, g: 0.75, b: 0.75 },
  { label: 'B', r: 0, g: 0, b: 0.75 },
  { label: 'Mg', r: 0.75, g: 0, b: 0.75 },
]

const cbCrOf = (r, g, b) => {
  const y = lumaOf(r, g, b)
  return [(b - y) / 1.8556, (r - y) / 1.5748] // each in [-0.5, 0.5]
}

export default function ScopesPanel() {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem('comfystudio-scopes-mode') || 'waveform'
    } catch (_) {
      return 'waveform'
    }
  })
  const [hasFrame, setHasFrame] = useState(false)
  const scopeCanvasRef = useRef(null)
  const sampleCanvasRef = useRef(null)
  const lastSerialRef = useRef(-1)
  const lastModeRef = useRef(null)

  useEffect(() => {
    try {
      localStorage.setItem('comfystudio-scopes-mode', mode)
    } catch (_) { /* ignore */ }
  }, [mode])

  useEffect(() => {
    let disposed = false

    const drawGraticuleWaveform = (ctx, w, h, thirds) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.font = '9px monospace'
      ctx.lineWidth = 1
      for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
        const y = Math.round((1 - frac) * (h - 1)) + 0.5
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
        if (!thirds) ctx.fillText(String(Math.round(frac * 100)), 4, Math.min(h - 3, Math.max(9, y - 3)))
      }
      if (thirds) {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'
        for (const frac of [1 / 3, 2 / 3]) {
          const x = Math.round(frac * w) + 0.5
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, h)
          ctx.stroke()
        }
      }
    }

    const renderWaveformLike = (ctx, w, h, pixels, channels) => {
      // channels: [{ offset (rgba index), tint [r,g,b], x0frac, x1frac }]
      const out = ctx.createImageData(w, h)
      const data = out.data
      const counts = new Float32Array(w * h)
      for (const ch of channels) {
        counts.fill(0)
        const x0 = Math.round(ch.x0frac * w)
        const spanW = Math.round((ch.x1frac - ch.x0frac) * w)
        for (let sy = 0; sy < SAMPLE_H; sy++) {
          const rowBase = sy * SAMPLE_W * 4
          for (let sx = 0; sx < SAMPLE_W; sx++) {
            const base = rowBase + sx * 4
            const value = ch.offset >= 0
              ? pixels[base + ch.offset] / 255
              : lumaOf(pixels[base] / 255, pixels[base + 1] / 255, pixels[base + 2] / 255)
            const px = x0 + Math.min(spanW - 1, Math.floor((sx / SAMPLE_W) * spanW))
            const py = Math.min(h - 1, Math.max(0, Math.round((1 - value) * (h - 1))))
            counts[py * w + px] += 1
          }
        }
        // sqrt tone-map: a column has SAMPLE_H hits spread over h rows.
        const gainBase = 255 * Math.sqrt(1 / (SAMPLE_H / h) / 6)
        for (let i = 0; i < counts.length; i++) {
          const count = counts[i]
          if (count === 0) continue
          const intensity = Math.min(255, Math.sqrt(count) * gainBase)
          const base = i * 4
          data[base] = Math.min(255, data[base] + intensity * ch.tint[0])
          data[base + 1] = Math.min(255, data[base + 1] + intensity * ch.tint[1])
          data[base + 2] = Math.min(255, data[base + 2] + intensity * ch.tint[2])
        }
      }
      for (let i = 3; i < data.length; i += 4) data[i] = 255
      ctx.putImageData(out, 0, 0)
    }

    const renderVectorscope = (ctx, w, h, pixels) => {
      const out = ctx.createImageData(w, h)
      const data = out.data
      const cx = w / 2
      const cy = h / 2
      const diameter = Math.min(w, h) * 0.92
      const counts = new Float32Array(w * h)
      for (let i = 0; i < SAMPLE_W * SAMPLE_H; i++) {
        const base = i * 4
        const [cb, cr] = cbCrOf(pixels[base] / 255, pixels[base + 1] / 255, pixels[base + 2] / 255)
        const px = Math.round(cx + cb * diameter)
        const py = Math.round(cy - cr * diameter)
        if (px < 0 || px >= w || py < 0 || py >= h) continue
        counts[py * w + px] += 1
      }
      for (let i = 0; i < counts.length; i++) {
        const count = counts[i]
        if (count === 0) continue
        const intensity = Math.min(255, 40 + Math.sqrt(count) * 60)
        const base = i * 4
        data[base] = intensity * 0.65
        data[base + 1] = intensity
        data[base + 2] = intensity * 0.75
      }
      for (let i = 3; i < data.length; i += 4) data[i] = 255
      ctx.putImageData(out, 0, 0)

      // Graticule: circle, crosshair, 75% targets, skin-tone line.
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cx, cy, diameter / 2, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx - diameter / 2, cy)
      ctx.lineTo(cx + diameter / 2, cy)
      ctx.moveTo(cx, cy - diameter / 2)
      ctx.lineTo(cx, cy + diameter / 2)
      ctx.stroke()
      ctx.font = '9px monospace'
      for (const target of VECTOR_TARGETS) {
        const [cb, cr] = cbCrOf(target.r, target.g, target.b)
        const tx = cx + cb * diameter
        const ty = cy - cr * diameter
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'
        ctx.strokeRect(tx - 3.5, ty - 3.5, 7, 7)
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.fillText(target.label, tx + 5, ty - 4)
      }
      // Skin-tone line: the I-axis direction where face tones cluster.
      const skinAngle = (123 / 180) * Math.PI
      ctx.strokeStyle = 'rgba(255,190,150,0.35)'
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(skinAngle) * (diameter / 2), cy - Math.sin(skinAngle) * (diameter / 2))
      ctx.stroke()
    }

    const update = () => {
      if (disposed) return
      const scopeCanvas = scopeCanvasRef.current
      if (!scopeCanvas) return
      const snapshot = getPreviewFrameSnapshot()
      if (!snapshot?.canvas || !snapshot.canvas.width) {
        if (lastSerialRef.current !== -2) {
          lastSerialRef.current = -2
          setHasFrame(false)
        }
        return
      }
      const modeChanged = lastModeRef.current !== mode
      if (!modeChanged && snapshot.serial === lastSerialRef.current) return
      lastSerialRef.current = snapshot.serial
      lastModeRef.current = mode
      setHasFrame(true)

      if (!sampleCanvasRef.current) {
        sampleCanvasRef.current = document.createElement('canvas')
        sampleCanvasRef.current.width = SAMPLE_W
        sampleCanvasRef.current.height = SAMPLE_H
      }
      const sampleCtx = sampleCanvasRef.current.getContext('2d', { willReadFrequently: true })
      sampleCtx.drawImage(snapshot.canvas, 0, 0, SAMPLE_W, SAMPLE_H)
      const pixels = sampleCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data

      const w = scopeCanvas.width
      const h = scopeCanvas.height
      const ctx = scopeCanvas.getContext('2d')
      ctx.fillStyle = '#0b0b0e'
      ctx.fillRect(0, 0, w, h)

      if (mode === 'waveform') {
        renderWaveformLike(ctx, w, h, pixels, [
          { offset: -1, tint: [0.55, 1, 0.6], x0frac: 0, x1frac: 1 },
        ])
        drawGraticuleWaveform(ctx, w, h, false)
      } else if (mode === 'parade') {
        renderWaveformLike(ctx, w, h, pixels, [
          { offset: 0, tint: [1, 0.25, 0.25], x0frac: 0, x1frac: 1 / 3 },
          { offset: 1, tint: [0.3, 1, 0.3], x0frac: 1 / 3, x1frac: 2 / 3 },
          { offset: 2, tint: [0.35, 0.55, 1], x0frac: 2 / 3, x1frac: 1 },
        ])
        drawGraticuleWaveform(ctx, w, h, true)
      } else {
        renderVectorscope(ctx, w, h, pixels)
      }
    }

    const interval = window.setInterval(update, POLL_MS)
    update()
    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [mode])

  return (
    <div className="h-full flex flex-col bg-sf-dark-950">
      <div className="flex-shrink-0 h-8 px-3 border-b border-sf-dark-700 flex items-center gap-1.5">
        {SCOPE_MODES.map((scopeMode) => (
          <button
            key={scopeMode.id}
            type="button"
            onClick={() => setMode(scopeMode.id)}
            title={scopeMode.title}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
              mode === scopeMode.id
                ? 'bg-sf-accent/20 text-sf-accent border border-sf-accent/40'
                : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
            }`}
          >
            {scopeMode.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-sf-text-muted">
          Program monitor · BT.709
        </span>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-3">
        {!hasFrame && (
          <div className="absolute text-xs text-sf-text-muted">
            No committed preview frame yet — park the playhead over a clip.
          </div>
        )}
        <canvas
          ref={scopeCanvasRef}
          width={mode === 'vectorscope' ? 360 : 640}
          height={mode === 'vectorscope' ? 360 : 288}
          className="max-h-full max-w-full rounded border border-sf-dark-700"
          style={{ imageRendering: 'auto', opacity: hasFrame ? 1 : 0.35 }}
        />
      </div>
    </div>
  )
}
