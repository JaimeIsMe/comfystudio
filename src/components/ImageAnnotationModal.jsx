import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Circle, Square, Type, Trash2, Pencil } from 'lucide-react'

const DEFAULT_COLOR = '#ef4444'
const STROKE_WIDTH_NORM = 0.008
const TEXT_SIZE_NORM = 0.04
const MAX_CANVAS_SIZE = 640
const HANDLE_RADIUS_NORM = 0.02
const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#ffffff', '#78716c',
]

let shapeIdCounter = 0
function nextId() {
  return `s_${++shapeIdCounter}_${Date.now()}`
}

/**
 * Modal to annotate an image with circles, rectangles, freehand, and text for Qwen reference.
 * Shapes can be moved/resized. Export returns a PNG blob (image + overlays).
 */
export default function ImageAnnotationModal({
  isOpen,
  onClose,
  initialImageUrl,
  otherImageAssets = [],
  onUseAsRef,
}) {
  const imageRef = useRef(null)
  const drawAreaRef = useRef(null) // the inner div that wraps the image - used for correct coords
  const [imageUrl, setImageUrl] = useState(initialImageUrl || '')
  const [imageSize, setImageSize] = useState({ w: 1, h: 1 })
  const [scale, setScale] = useState(1)
  const [tool, setTool] = useState('circle')
  const [currentColor, setCurrentColor] = useState(DEFAULT_COLOR)
  const [shapes, setShapes] = useState([])
  const [drag, setDrag] = useState(null) // in-progress draw: circle/rect/path
  const [textInput, setTextInput] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [interaction, setInteraction] = useState(null) // { type: 'move'|'resize', id, startNx, startNy, startShape }

  useEffect(() => {
    if (!isOpen) return
    setImageUrl(initialImageUrl || '')
    setShapes([])
    setDrag(null)
    setTextInput(null)
    setSelectedId(null)
    setInteraction(null)
  }, [isOpen, initialImageUrl])

  useEffect(() => {
    if (!imageUrl) {
      setImageSize({ w: 1, h: 1 })
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      setImageSize({ w: img.naturalWidth, h: img.naturalHeight })
      imageRef.current = img
    }
    img.onerror = () => setImageUrl('')
    img.src = imageUrl
  }, [imageUrl])

  useEffect(() => {
    if (!drawAreaRef.current || !imageSize.w || !imageSize.h) return
    const rect = drawAreaRef.current.getBoundingClientRect()
    const maxW = Math.min(rect.width, MAX_CANVAS_SIZE)
    const maxH = Math.min(rect.height, MAX_CANVAS_SIZE)
    setScale(Math.min(maxW / imageSize.w, maxH / imageSize.h, 1))
  }, [imageSize])

  const clientToNormalized = useCallback((clientX, clientY) => {
    const el = drawAreaRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const x = (clientX - rect.left) / rect.width
    const y = (clientY - rect.top) / rect.height
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    }
  }, [])

  const hitTestCircle = (nx, ny, cx, cy, rx, ry) => {
    const dx = (nx - cx) / Math.max(rx, 0.001)
    const dy = (ny - cy) / Math.max(ry, 0.001)
    return dx * dx + dy * dy <= 1
  }

  const hitTestRect = (nx, ny, x, y, w, h) => {
    return nx >= x && nx <= x + w && ny >= y && ny <= y + h
  }

  const hitTestPath = (nx, ny, points, threshold = 0.02) => {
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, y1] = points[i]
      const [x2, y2] = points[i + 1]
      const dx = x2 - x1, dy = y2 - y1
      const len = Math.hypot(dx, dy) || 1e-6
      const t = Math.max(0, Math.min(1, ((nx - x1) * dx + (ny - y1) * dy) / (len * len)))
      const px = x1 + t * dx
      const py = y1 + t * dy
      if (Math.hypot(nx - px, ny - py) <= threshold) return true
    }
    return false
  }

  const hitTestText = (nx, ny, x, y) => {
    const h = TEXT_SIZE_NORM
    const w = 0.3
    return nx >= x && nx <= x + w && ny >= y - h && ny <= y
  }

  const getShapeAt = useCallback((nx, ny) => {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i]
      if (s.type === 'circle' && hitTestCircle(nx, ny, s.cx, s.cy, s.rx, s.ry)) return s
      if (s.type === 'rect' && hitTestRect(nx, ny, s.x, s.y, s.w, s.h)) return s
      if (s.type === 'path' && s.points?.length >= 2 && hitTestPath(nx, ny, s.points)) return s
      if (s.type === 'text' && hitTestText(nx, ny, s.x, s.y)) return s
    }
    return null
  }, [shapes])

  const getResizeHandleAt = useCallback((nx, ny, shape) => {
    const hr = HANDLE_RADIUS_NORM
    if (shape.type === 'circle') {
      const hx = shape.cx + shape.rx
      const hy = shape.cy
      if (Math.hypot(nx - hx, ny - hy) <= hr) return 'right'
    }
    if (shape.type === 'rect') {
      const { x, y, w, h } = shape
      if (Math.hypot(nx - (x + w), ny - y) <= hr) return 'tr'
      if (Math.hypot(nx - (x + w), ny - (y + h)) <= hr) return 'br'
      if (Math.hypot(nx - x, ny - (y + h)) <= hr) return 'bl'
      if (Math.hypot(nx - x, ny - y) <= hr) return 'tl'
    }
    return null
  }, [])

  const handlePointerDown = useCallback((e) => {
    if (!imageSize.w || !imageSize.h) return
    const { x: nx, y: ny } = clientToNormalized(e.clientX, e.clientY)

    if (textInput) return
    if (drag) return
    if (interaction) return

    const selected = selectedId ? shapes.find(s => s.id === selectedId) : null
    if (selected) {
      const handle = getResizeHandleAt(nx, ny, selected)
      if (handle) {
        setInteraction({ type: 'resize', id: selected.id, handle, startNx: nx, startNy: ny, startShape: { ...selected } })
        return
      }
    }

    const hit = getShapeAt(nx, ny)
    if (hit) {
      setSelectedId(hit.id)
      setInteraction({ type: 'move', id: hit.id, startNx: nx, startNy: ny, startShape: { ...hit } })
      return
    }

    setSelectedId(null)

    if (tool === 'circle') {
      setDrag({ type: 'circle', cx: nx, cy: ny, rx: 0, ry: 0, color: currentColor })
      return
    }
    if (tool === 'rect') {
      setDrag({ type: 'rect', x: nx, y: ny, w: 0, h: 0, color: currentColor })
      return
    }
    if (tool === 'freehand') {
      setDrag({ type: 'path', points: [[nx, ny]], color: currentColor })
      return
    }
    if (tool === 'text') {
      setTextInput({ x: nx, y: ny, value: '' })
      return
    }
  }, [tool, currentColor, imageSize, shapes, selectedId, interaction, drag, textInput, clientToNormalized, getShapeAt, getResizeHandleAt])

  const handlePointerMove = useCallback((e) => {
    const { x: nx, y: ny } = clientToNormalized(e.clientX, e.clientY)

    if (interaction?.type === 'move') {
      const s = interaction.startShape
      const dx = nx - interaction.startNx
      const dy = ny - interaction.startNy
      setShapes(prev => prev.map(sh => {
        if (sh.id !== interaction.id) return sh
        if (sh.type === 'circle') return { ...sh, cx: s.cx + dx, cy: s.cy + dy }
        if (sh.type === 'rect') return { ...sh, x: s.x + dx, y: s.y + dy }
        if (sh.type === 'text') return { ...sh, x: s.x + dx, y: s.y + dy }
        if (sh.type === 'path') return { ...sh, points: (s.points || []).map(([px, py]) => [px + dx, py + dy]) }
        return sh
      }))
      return
    }

    if (interaction?.type === 'resize') {
      const sh = shapes.find(s => s.id === interaction.id)
      if (!sh) return
      if (sh.type === 'circle') {
        const dx = nx - sh.cx
        const dy = ny - sh.cy
        const r = Math.hypot(dx, dy)
        setShapes(prev => prev.map(s => s.id === interaction.id ? { ...s, rx: r, ry: r } : s))
      }
      if (sh.type === 'rect') {
        const { handle } = interaction
        const s = interaction.startShape
        let x = s.x, y = s.y, w = s.w, h = s.h
        const min = 0.02
        if (handle === 'tr') {
          x = s.x
          y = ny
          w = nx - s.x
          h = s.y + s.h - ny
        } else if (handle === 'br') {
          x = s.x
          y = s.y
          w = nx - s.x
          h = ny - s.y
        } else if (handle === 'bl') {
          x = nx
          y = s.y
          w = s.x + s.w - nx
          h = ny - s.y
        } else if (handle === 'tl') {
          x = nx
          y = ny
          w = s.x + s.w - nx
          h = s.y + s.h - ny
        }
        if (w < min) { x = x + w - min; w = min }
        if (h < min) { y = y + h - min; h = min }
        setShapes(prev => prev.map(s => s.id === interaction.id ? { ...s, x, y, w, h } : s))
      }
      return
    }

    if (drag?.type === 'circle') {
      setDrag(prev => ({ ...prev, rx: Math.abs(nx - prev.cx), ry: Math.abs(ny - prev.cy) }))
      return
    }
    if (drag?.type === 'rect') {
      setDrag(prev => ({
        ...prev,
        w: nx - prev.x,
        h: ny - prev.y,
      }))
      return
    }
    if (drag?.type === 'path') {
      setDrag(prev => ({ ...prev, points: [...prev.points, [nx, ny]] }))
    }
  }, [drag, interaction, shapes, clientToNormalized, getShapeAt])

  const handlePointerUp = useCallback(() => {
    if (drag) {
      if (drag.type === 'circle' && (drag.rx > 0.01 || drag.ry > 0.01)) {
        setShapes(prev => [...prev, { ...drag, id: nextId() }])
      }
      if (drag.type === 'rect' && Math.abs(drag.w) > 0.01 && Math.abs(drag.h) > 0.01) {
        const w = drag.w
        const h = drag.h
        const x = w >= 0 ? drag.x : drag.x + w
        const y = h >= 0 ? drag.y : drag.y + h
        setShapes(prev => [...prev, { ...drag, x, y, w: Math.abs(w), h: Math.abs(h), id: nextId() }])
      }
      if (drag.type === 'path' && drag.points.length >= 2) {
        setShapes(prev => [...prev, { ...drag, id: nextId() }])
      }
      setDrag(null)
      return
    }
    setInteraction(null)
  }, [drag])

  const commitText = useCallback((value) => {
    if (textInput && value.trim()) {
      setShapes(prev => [...prev, { type: 'text', x: textInput.x, y: textInput.y, text: value.trim(), color: currentColor, id: nextId() }])
    }
    setTextInput(null)
  }, [textInput, currentColor])

  const clearAnnotations = useCallback(() => {
    setShapes([])
    setDrag(null)
    setTextInput(null)
    setSelectedId(null)
    setInteraction(null)
  }, [])

  const deleteSelected = useCallback(() => {
    if (selectedId) {
      setShapes(prev => prev.filter(s => s.id !== selectedId))
      setSelectedId(null)
      setInteraction(null)
    }
  }, [selectedId])

  const exportToBlob = useCallback(() => {
    const img = imageRef.current
    if (!img) return null
    const w = img.naturalWidth
    const h = img.naturalHeight
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const lw = Math.max(2, w * STROKE_WIDTH_NORM)
    const fontSize = Math.max(12, h * TEXT_SIZE_NORM)
    ctx.font = `${fontSize}px sans-serif`
    const allShapes = drag ? [...shapes, drag] : shapes
    for (const s of allShapes) {
      const color = s.color || DEFAULT_COLOR
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = lw
      if (s.type === 'circle') {
        const cx = s.cx * w, cy = s.cy * h, rx = Math.max(2, s.rx * w), ry = Math.max(2, s.ry * h)
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
        ctx.stroke()
      } else if (s.type === 'rect') {
        const x = s.x * w, y = s.y * h, rw = s.w * w, rh = s.h * h
        ctx.strokeRect(x, y, rw, rh)
      } else if (s.type === 'path' && s.points?.length >= 2) {
        ctx.beginPath()
        ctx.moveTo(s.points[0][0] * w, s.points[0][1] * h)
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i][0] * w, s.points[i][1] * h)
        ctx.stroke()
      } else if (s.type === 'text') {
        const px = s.x * w
        const py = s.y * h
        ctx.strokeStyle = '#000'
        ctx.lineWidth = Math.max(2, fontSize / 6)
        ctx.lineJoin = 'round'
        ctx.miterLimit = 2
        ctx.strokeText(s.text, px, py)
        ctx.fillStyle = color
        ctx.fillText(s.text, px, py)
      }
    }
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    })
  }, [shapes, drag])

  const handleUseAsRef = useCallback(async (slot) => {
    const blob = await exportToBlob()
    if (blob && onUseAsRef) onUseAsRef(blob, slot)
    onClose()
  }, [exportToBlob, onUseAsRef, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-sf-dark-900 border border-sf-dark-600 rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-sf-dark-700">
          <h3 className="text-sm font-medium text-sf-text-primary">Annotate reference image</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-sf-dark-700 text-sf-text-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-sf-dark-700 flex-wrap">
          <span className="text-[10px] text-sf-text-muted uppercase">Source</span>
          <select
            value={imageUrl === (initialImageUrl || '') ? '__current__' : imageUrl}
            onChange={e => {
              const v = e.target.value
              setImageUrl(v === '__current__' ? (initialImageUrl || '') : v)
              setShapes([])
              setDrag(null)
              setTextInput(null)
              setSelectedId(null)
            }}
            className="bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
          >
            <option value="__current__">Current input</option>
            {otherImageAssets.filter(a => a.url && a.url !== initialImageUrl).map(a => (
              <option key={a.id} value={a.url}>{a.name}</option>
            ))}
          </select>
          <span className="text-[10px] text-sf-text-muted ml-2">Color</span>
          <div className="flex gap-1">
            {COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setCurrentColor(c)}
                className={`w-5 h-5 rounded border-2 ${currentColor === c ? 'border-white scale-110' : 'border-sf-dark-600'}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <span className="text-[10px] text-sf-text-muted ml-2">Tools</span>
          {['circle', 'rect', 'freehand', 'text'].map(t => (
            <button
              key={t}
              onClick={() => setTool(t)}
              className={`p-1.5 rounded ${tool === t ? 'bg-sf-accent text-white' : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'}`}
              title={t === 'rect' ? 'Rectangle' : t === 'freehand' ? 'Freehand' : t === 'circle' ? 'Circle' : 'Text'}
            >
              {t === 'circle' && <Circle className="w-4 h-4" />}
              {t === 'rect' && <Square className="w-4 h-4" />}
              {t === 'freehand' && <Pencil className="w-4 h-4" />}
              {t === 'text' && <Type className="w-4 h-4" />}
            </button>
          ))}
          {shapes.length > 0 && (
            <button onClick={clearAnnotations} className="p-1.5 rounded bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600" title="Clear all">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {selectedId && (
            <button onClick={deleteSelected} className="text-xs text-sf-error hover:bg-sf-dark-700 px-2 py-1 rounded">Delete selected</button>
          )}
        </div>

        <div
          className="flex-1 min-h-[320px] flex items-center justify-center bg-sf-dark-950 relative overflow-hidden"
          style={{ touchAction: 'none' }}
        >
          {imageUrl && (
            <div
              ref={drawAreaRef}
              className="relative cursor-crosshair"
              style={{ width: imageSize.w * scale, height: imageSize.h * scale }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              <img
                src={imageUrl}
                alt="Annotate"
                className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
                draggable={false}
              />
              <AnnotationOverlay
                scale={scale}
                imageSize={imageSize}
                shapes={shapes}
                drag={drag}
                selectedId={selectedId}
              />
            </div>
          )}
          {!imageUrl && (
            <p className="text-sf-text-muted text-sm">Select an image on the left, or choose another source above.</p>
          )}
        </div>

        {textInput && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 items-center bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 shadow-lg z-10">
            <input
              type="text"
              placeholder="e.g. remove this person"
              value={textInput?.value ?? ''}
              onChange={e => setTextInput(prev => ({ ...prev, value: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') commitText(textInput?.value); if (e.key === 'Escape') setTextInput(null) }}
              className="bg-sf-dark-900 border border-sf-dark-600 rounded px-2 py-1 text-sm text-sf-text-primary w-56"
              autoFocus
            />
            <button onClick={() => commitText(textInput?.value)} className="text-xs bg-sf-accent text-white px-2 py-1 rounded">Add</button>
            <button onClick={() => setTextInput(null)} className="text-xs text-sf-text-muted">Cancel</button>
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-3 border-t border-sf-dark-700">
          <p className="text-[10px] text-sf-text-muted">Draw shapes and text, then move/resize by selecting. Use as reference 1 or 2.</p>
          <div className="flex gap-2">
            <button
              onClick={() => handleUseAsRef(1)}
              disabled={!imageUrl}
              className="px-3 py-1.5 rounded-lg bg-sf-accent text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Use as Ref 1
            </button>
            <button
              onClick={() => handleUseAsRef(2)}
              disabled={!imageUrl}
              className="px-3 py-1.5 rounded-lg bg-sf-accent/80 text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Use as Ref 2
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AnnotationOverlay({ scale, imageSize, shapes, drag, selectedId }) {
  const w = imageSize.w * scale
  const h = imageSize.h * scale
  const strokeW = Math.max(2, w * STROKE_WIDTH_NORM)
  const fontSize = Math.max(12, h * TEXT_SIZE_NORM)
  const hr = Math.max(4, w * 0.02)

  return (
    <svg className="absolute inset-0 pointer-events-none" width={w} height={h} style={{ left: 0, top: 0 }}>
      {shapes.map((s) => {
        const color = s.color || DEFAULT_COLOR
        if (s.type === 'circle') {
          const cx = s.cx * w, cy = s.cy * h, rx = Math.max(2, s.rx * w), ry = Math.max(2, s.ry * h)
          return (
            <g key={s.id}>
              <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={color} strokeWidth={strokeW} />
              {selectedId === s.id && (
                <circle cx={cx + rx} cy={cy} r={hr} fill={color} stroke="#fff" strokeWidth={2} />
              )}
            </g>
          )
        }
        if (s.type === 'rect') {
          const x = s.x * w, y = s.y * h, rw = s.w * w, rh = s.h * h
          return (
            <g key={s.id}>
              <rect x={x} y={y} width={rw} height={rh} fill="none" stroke={color} strokeWidth={strokeW} />
              {selectedId === s.id && (
                <>
                  <circle cx={x} cy={y} r={hr} fill={color} stroke="#fff" strokeWidth={2} />
                  <circle cx={x + rw} cy={y} r={hr} fill={color} stroke="#fff" strokeWidth={2} />
                  <circle cx={x + rw} cy={y + rh} r={hr} fill={color} stroke="#fff" strokeWidth={2} />
                  <circle cx={x} cy={y + rh} r={hr} fill={color} stroke="#fff" strokeWidth={2} />
                </>
              )}
            </g>
          )
        }
        if (s.type === 'path' && s.points?.length >= 2) {
          const d = `M ${s.points[0][0] * w} ${s.points[0][1] * h} ` + s.points.slice(1).map(([px, py]) => `L ${px * w} ${py * h}`).join(' ')
          return <path key={s.id} d={d} fill="none" stroke={color} strokeWidth={strokeW} />
        }
        if (s.type === 'text') {
          const x = s.x * w, y = s.y * h
          const strokeW = Math.max(2, fontSize / 6)
          return (
            <text
              key={s.id}
              x={x}
              y={y}
              fill={color}
              stroke="#000"
              strokeWidth={strokeW}
              strokeLinejoin="round"
              paintOrder="stroke"
              fontSize={fontSize}
              fontFamily="sans-serif"
            >
              {s.text}
            </text>
          )
        }
        return null
      })}
      {drag && (() => {
        const color = drag.color || DEFAULT_COLOR
        if (drag.type === 'circle') {
          const cx = drag.cx * w, cy = drag.cy * h, rx = Math.max(2, drag.rx * w), ry = Math.max(2, drag.ry * h)
          return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={color} strokeWidth={strokeW} strokeDasharray="4 2" />
        }
        if (drag.type === 'rect') {
          const x = drag.x * w, y = drag.y * h, rw = drag.w * w, rh = drag.h * h
          return <rect x={x} y={y} width={rw} height={rh} fill="none" stroke={color} strokeWidth={strokeW} strokeDasharray="4 2" />
        }
        if (drag.type === 'path' && drag.points?.length >= 2) {
          const d = `M ${drag.points[0][0] * w} ${drag.points[0][1] * h} ` + drag.points.slice(1).map(([px, py]) => `L ${px * w} ${py * h}`).join(' ')
          return <path d={d} fill="none" stroke={color} strokeWidth={strokeW} strokeDasharray="4 2" />
        }
        return null
      })()}
    </svg>
  )
}
