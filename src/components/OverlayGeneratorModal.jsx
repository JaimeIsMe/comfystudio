import { useState, useCallback, useEffect, useMemo } from 'react'
import { X, Palette, Layout, Circle, Sparkles } from 'lucide-react'
import {
  DEFAULT_LETTERBOX_ASPECT,
  LETTERBOX_ASPECT_PRESETS,
  resolveLetterboxAspect,
  getLetterboxContentRect,
  generateLetterboxOverlayBlob,
} from '../utils/overlayGenerators'

/**
 * Generate overlay assets (PNG for matte/letterbox/vignette, PNG or loop video for grain).
 */
function generateColorMatteBlob(width, height, color) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png')
  })
}

/**
 * Generate vignette overlay: transparent center, dark edges (radial gradient).
 */
function generateVignetteBlob(width, height, strength, softness) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const cx = width / 2
  const cy = height / 2
  const maxR = Math.sqrt(cx * cx + cy * cy)
  const innerR = maxR * (1 - softness / 100)
  const gradient = ctx.createRadialGradient(cx, cy, innerR, cx, cy, maxR)
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(1, `rgba(0,0,0,${strength / 100})`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png')
  })
}

/**
 * Bilinear interpolation helper for value noise.
 */
function lerp(a, b, t) {
  return a + (b - a) * t
}

/**
 * Draw a single film-grain frame using value noise with bilinear interpolation.
 * Softer, more organic grain; no blocky same-value regions.
 * intensity 0–100 = opacity; size = noise wavelength (1 fine, 2 medium, 4 coarse).
 */
function drawFilmGrainFrame(ctx, width, height, intensity, size = 1) {
  const imageData = ctx.createImageData(width, height)
  const data = imageData.data
  const mid = 128
  const amplitude = 48
  const alpha = Math.round((intensity / 100) * 255)
  const gridStep = Math.max(1, Math.min(8, size))
  const gridW = Math.ceil(width / gridStep) + 1
  const gridH = Math.ceil(height / gridStep) + 1
  const grid = new Float32Array(gridW * gridH)
  for (let i = 0; i < grid.length; i++) {
    grid[i] = mid + (Math.random() * 2 - 1) * amplitude
  }

  for (let y = 0; y < height; y++) {
    const gy = Math.min(Math.floor(y / gridStep), gridH - 2)
    const ty = (y / gridStep) - Math.floor(y / gridStep)
    for (let x = 0; x < width; x++) {
      const gx = Math.min(Math.floor(x / gridStep), gridW - 2)
      const tx = (x / gridStep) - Math.floor(x / gridStep)
      const v00 = grid[gy * gridW + gx]
      const v10 = grid[gy * gridW + gx + 1]
      const v01 = grid[(gy + 1) * gridW + gx]
      const v11 = grid[(gy + 1) * gridW + gx + 1]
      let v = lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty)
      v += (Math.random() - 0.5) * 14
      const clamped = Math.max(0, Math.min(255, Math.round(v)))
      const i = (y * width + x) * 4
      data[i] = clamped
      data[i + 1] = clamped
      data[i + 2] = clamped
      data[i + 3] = alpha
    }
  }
  ctx.putImageData(imageData, 0, 0)
}

function generateFilmGrainBlob(width, height, intensity, size = 1) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas context unavailable'))
  drawFilmGrainFrame(ctx, width, height, intensity, size)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png')
  })
}

function getSupportedLoopMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  const preferred = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  for (const type of preferred) {
    if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(type)) return type
  }
  return null
}

/**
 * Generate a loopable animated film-grain video (WebM).
 */
function generateFilmGrainLoopBlob(width, height, intensity, size = 1, durationSec = 3, fps = 12) {
  if (typeof MediaRecorder === 'undefined') {
    return Promise.reject(new Error('Animated grain is not supported in this browser/runtime'))
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas context unavailable'))

  const stream = canvas.captureStream(Math.max(1, fps))
  const mimeType = getSupportedLoopMimeType()
  let recorder
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
  } catch (_) {
    return Promise.reject(new Error('Could not initialize video recorder for animated grain'))
  }

  return new Promise((resolve, reject) => {
    const chunks = []
    const totalFrames = Math.max(1, Math.round(durationSec * fps))
    const frameIntervalMs = Math.max(1, Math.round(1000 / Math.max(1, fps)))
    let frame = 0
    let timer = null
    let stopped = false

    const cleanup = () => {
      if (timer) clearInterval(timer)
      stream.getTracks().forEach((t) => t.stop())
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }
    recorder.onerror = () => {
      if (stopped) return
      stopped = true
      cleanup()
      reject(new Error('Failed while recording animated grain'))
    }
    recorder.onstop = () => {
      if (stopped) return
      stopped = true
      cleanup()
      const blob = new Blob(chunks, { type: mimeType || 'video/webm' })
      if (blob.size <= 0) reject(new Error('Animated grain output is empty'))
      else resolve(blob)
    }

    // Draw initial frame before recording starts.
    drawFilmGrainFrame(ctx, width, height, intensity, size)
    recorder.start()

    timer = setInterval(() => {
      drawFilmGrainFrame(ctx, width, height, intensity, size)
      frame += 1
      if (frame >= totalFrames) {
        clearInterval(timer)
        timer = null
        recorder.stop()
      }
    }, frameIntervalMs)
  })
}

export default function OverlayGeneratorModal({
  isOpen,
  onClose,
  onAdd,
  timelineSize = { width: 1920, height: 1080 },
  defaultFolderId = null,
  initialType = 'letterbox',
}) {
  const [type, setType] = useState(initialType)
  const [name, setName] = useState('')
  const [useTimelineSize, setUseTimelineSize] = useState(true)
  const [customWidth, setCustomWidth] = useState(1920)
  const [customHeight, setCustomHeight] = useState(1080)
  // Color matte
  const [color, setColor] = useState('#000000')
  // Letterbox
  const [letterboxAspectPreset, setLetterboxAspectPreset] = useState(String(DEFAULT_LETTERBOX_ASPECT))
  const [letterboxCustomAspect, setLetterboxCustomAspect] = useState(String(DEFAULT_LETTERBOX_ASPECT))
  const [barColor, setBarColor] = useState('#000000')
  // Vignette
  const [strength, setStrength] = useState(60)
  const [softness, setSoftness] = useState(50)
  // Film grain
  const [grainIntensity, setGrainIntensity] = useState(40)
  const [grainSize, setGrainSize] = useState(1) // 1 = fine, 2 = medium, 4 = coarse
  const [grainAnimated, setGrainAnimated] = useState(true)
  const [grainDuration, setGrainDuration] = useState(3)
  const [grainFps, setGrainFps] = useState(12)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isOpen) setType(initialType)
  }, [isOpen, initialType])

  const width = useTimelineSize ? (timelineSize?.width ?? 1920) : customWidth
  const height = useTimelineSize ? (timelineSize?.height ?? 1080) : customHeight
  const targetLetterboxAspect = useMemo(
    () => resolveLetterboxAspect(letterboxAspectPreset, letterboxCustomAspect, DEFAULT_LETTERBOX_ASPECT),
    [letterboxAspectPreset, letterboxCustomAspect]
  )
  const hasValidLetterboxAspect = Number.isFinite(targetLetterboxAspect) && targetLetterboxAspect > 0
  const letterboxPreviewBars = useMemo(() => {
    if (!hasValidLetterboxAspect) return null
    const rect = getLetterboxContentRect(width, height, targetLetterboxAspect)
    return {
      topPct: (rect.offsetY / height) * 100,
      bottomPct: ((height - (rect.offsetY + rect.height)) / height) * 100,
      leftPct: (rect.offsetX / width) * 100,
      rightPct: ((width - (rect.offsetX + rect.width)) / width) * 100,
    }
  }, [width, height, targetLetterboxAspect, hasValidLetterboxAspect])

  const handleGenerate = useCallback(async () => {
    setError(null)
    setGenerating(true)
    try {
      let blob
      let assetType = 'image'
      let mimeType = 'image/png'
      let assetSettings = { width, height }
      let assetDuration = null
      let defaultName = name.trim()
      if (type === 'color') {
        blob = await generateColorMatteBlob(width, height, color)
        if (!defaultName) defaultName = `Color matte ${width}×${height}`
      } else if (type === 'letterbox') {
        blob = await generateLetterboxOverlayBlob(width, height, targetLetterboxAspect, barColor)
        assetSettings = {
          ...assetSettings,
          overlayKind: 'letterbox',
          targetAspect: targetLetterboxAspect,
          aspectPreset: letterboxAspectPreset,
          customAspect: letterboxAspectPreset === 'custom' ? letterboxCustomAspect : null,
          barColor,
        }
        if (!defaultName) defaultName = `Letterbox ${targetLetterboxAspect.toFixed(2)}:1`
      } else if (type === 'vignette') {
        blob = await generateVignetteBlob(width, height, strength, softness)
        if (!defaultName) defaultName = 'Vignette overlay'
      } else {
        if (grainAnimated) {
          blob = await generateFilmGrainLoopBlob(width, height, grainIntensity, grainSize, grainDuration, grainFps)
          assetType = 'video'
          mimeType = blob.type || 'video/webm'
          assetDuration = grainDuration
          assetSettings = { width, height, duration: grainDuration, fps: grainFps }
          if (!defaultName) defaultName = `Film grain loop ${grainDuration}s`
        } else {
          blob = await generateFilmGrainBlob(width, height, grainIntensity, grainSize)
          if (!defaultName) defaultName = 'Film grain overlay'
        }
      }
      onAdd({
        name: defaultName,
        type: assetType,
        blob,
        folderId: defaultFolderId,
        isImported: false,
        mimeType,
        settings: assetSettings,
        ...(assetDuration ? { duration: assetDuration, audioEnabled: false } : {}),
      })
      onClose()
    } catch (err) {
      setError(err?.message || 'Failed to generate overlay')
    } finally {
      setGenerating(false)
    }
  }, [
    type,
    name,
    width,
    height,
    color,
    targetLetterboxAspect,
    letterboxAspectPreset,
    letterboxCustomAspect,
    barColor,
    strength,
    softness,
    grainIntensity,
    grainSize,
    grainAnimated,
    grainDuration,
    grainFps,
    onAdd,
    onClose,
    defaultFolderId,
  ])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-sf-dark-800 border border-sf-dark-600 rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-sf-dark-700">
          <h3 className="text-sm font-medium text-sf-text-primary">Create overlay</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-sf-dark-600 text-sf-text-muted hover:text-sf-text-primary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-3">
          {/* Type */}
          <div>
            <label className="text-[10px] text-sf-text-muted block mb-1.5">Type</label>
            <div className="flex gap-1 p-0.5 bg-sf-dark-900 rounded">
              {[
                { id: 'letterbox', label: 'Letterbox', icon: Layout },
                { id: 'vignette', label: 'Vignette', icon: Circle },
                { id: 'color', label: 'Color matte', icon: Palette },
                { id: 'grain', label: 'Film grain', icon: Sparkles },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setType(id)}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[11px] transition-colors ${
                    type === id ? 'bg-sf-accent text-white' : 'text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div>
            <label className="text-[10px] text-sf-text-muted block mb-1">Resolution</label>
            <div className="flex gap-2 items-center">
              <label className="flex items-center gap-1.5 text-xs text-sf-text-primary cursor-pointer">
                <input
                  type="radio"
                  checked={useTimelineSize}
                  onChange={() => setUseTimelineSize(true)}
                  className="accent-sf-accent"
                />
                Match timeline ({timelineSize?.width ?? 1920}×{timelineSize?.height ?? 1080})
              </label>
              <label className="flex items-center gap-1.5 text-xs text-sf-text-primary cursor-pointer">
                <input
                  type="radio"
                  checked={!useTimelineSize}
                  onChange={() => setUseTimelineSize(false)}
                  className="accent-sf-accent"
                />
                Custom
              </label>
            </div>
            {!useTimelineSize && (
              <div className="flex gap-2 mt-1">
                <input
                  type="number"
                  min={1}
                  max={4096}
                  value={customWidth}
                  onChange={(e) => setCustomWidth(parseInt(e.target.value, 10) || 1920)}
                  className="w-20 bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                />
                <span className="text-sf-text-muted">×</span>
                <input
                  type="number"
                  min={1}
                  max={4096}
                  value={customHeight}
                  onChange={(e) => setCustomHeight(parseInt(e.target.value, 10) || 1080)}
                  className="w-20 bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                />
              </div>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="text-[10px] text-sf-text-muted block mb-1">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'color' ? 'Color matte' : type === 'letterbox' ? 'Letterbox 2.39:1' : type === 'grain' ? 'Film grain overlay' : 'Vignette'}
              className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
            />
          </div>

          {/* Type-specific options */}
          {type === 'color' && (
            <div>
              <label className="text-[10px] text-sf-text-muted block mb-1">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-10 h-8 rounded border border-sf-dark-600 cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="flex-1 bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary font-mono"
                />
              </div>
            </div>
          )}

          {type === 'letterbox' && (
            <>
              <div>
                <label className="text-[10px] text-sf-text-muted block mb-1">Aspect ratio</label>
                <select
                  value={letterboxAspectPreset}
                  onChange={(e) => setLetterboxAspectPreset(e.target.value)}
                  className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                >
                  {LETTERBOX_ASPECT_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                  ))}
                </select>
              </div>
              {letterboxAspectPreset === 'custom' && (
                <div>
                  <label className="text-[10px] text-sf-text-muted block mb-1">Custom ratio (W:H)</label>
                  <input
                    type="number"
                    min={0.1}
                    max={10}
                    step={0.01}
                    value={letterboxCustomAspect}
                    onChange={(e) => setLetterboxCustomAspect(e.target.value)}
                    className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                  />
                </div>
              )}
              <div>
                <label className="text-[10px] text-sf-text-muted block mb-1">Bar color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={barColor}
                    onChange={(e) => setBarColor(e.target.value)}
                    className="w-10 h-8 rounded border border-sf-dark-600 cursor-pointer bg-transparent"
                  />
                  <input
                    type="text"
                    value={barColor}
                    onChange={(e) => setBarColor(e.target.value)}
                    className="flex-1 bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-sf-text-muted block mb-1">Preview</label>
                <div
                  className="relative w-full rounded border border-sf-dark-600 overflow-hidden bg-sf-dark-900"
                  style={{ aspectRatio: `${Math.max(1, width)} / ${Math.max(1, height)}` }}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-sf-accent/30 via-sf-dark-700 to-purple-500/25" />
                  {letterboxPreviewBars && (
                    <>
                      {letterboxPreviewBars.topPct > 0.001 && (
                        <div className="absolute left-0 right-0 top-0" style={{ height: `${letterboxPreviewBars.topPct}%`, backgroundColor: barColor }} />
                      )}
                      {letterboxPreviewBars.bottomPct > 0.001 && (
                        <div className="absolute left-0 right-0 bottom-0" style={{ height: `${letterboxPreviewBars.bottomPct}%`, backgroundColor: barColor }} />
                      )}
                      {letterboxPreviewBars.leftPct > 0.001 && (
                        <div className="absolute top-0 bottom-0 left-0" style={{ width: `${letterboxPreviewBars.leftPct}%`, backgroundColor: barColor }} />
                      )}
                      {letterboxPreviewBars.rightPct > 0.001 && (
                        <div className="absolute top-0 bottom-0 right-0" style={{ width: `${letterboxPreviewBars.rightPct}%`, backgroundColor: barColor }} />
                      )}
                    </>
                  )}
                  <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white">
                    {hasValidLetterboxAspect ? `${targetLetterboxAspect.toFixed(2)}:1` : 'Invalid ratio'}
                  </div>
                </div>
              </div>
            </>
          )}

          {type === 'vignette' && (
            <>
              <div>
                <label className="text-[10px] text-sf-text-muted block mb-1">Strength ({strength}%)</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={strength}
                  onChange={(e) => setStrength(parseInt(e.target.value, 10))}
                  className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                />
              </div>
              <div>
                <label className="text-[10px] text-sf-text-muted block mb-1">Softness ({softness}%)</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={softness}
                  onChange={(e) => setSoftness(parseInt(e.target.value, 10))}
                  className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                />
              </div>
            </>
          )}

          {type === 'grain' && (
            <>
              <div>
                <label className="text-[10px] text-sf-text-muted block mb-1">Intensity ({grainIntensity}%)</label>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={grainIntensity}
                  onChange={(e) => setGrainIntensity(parseInt(e.target.value, 10))}
                  className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
                />
                <p className="text-[9px] text-sf-text-muted mt-0.5">Use Overlay or Soft light blend on the clip for best result.</p>
              </div>
              <div>
                <label className="text-[10px] text-sf-text-muted block mb-1">Grain size</label>
                <select
                  value={grainSize}
                  onChange={(e) => setGrainSize(Number(e.target.value))}
                  className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                >
                  <option value={1}>Fine</option>
                  <option value={2}>Medium</option>
                  <option value={4}>Coarse</option>
                </select>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs text-sf-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={grainAnimated}
                    onChange={(e) => setGrainAnimated(e.target.checked)}
                    className="accent-sf-accent"
                  />
                  Animated loop
                </label>
              </div>
              {grainAnimated && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-sf-text-muted block mb-1">Duration (s)</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={grainDuration}
                      onChange={(e) => setGrainDuration(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 3)))}
                      className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-sf-text-muted block mb-1">FPS</label>
                    <select
                      value={grainFps}
                      onChange={(e) => setGrainFps(Number(e.target.value))}
                      className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                    >
                      <option value={10}>10</option>
                      <option value={12}>12</option>
                      <option value={15}>15</option>
                      <option value={24}>24</option>
                      <option value={30}>30</option>
                    </select>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="text-xs text-sf-error">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 p-3 border-t border-sf-dark-700">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-sf-text-secondary hover:text-sf-text-primary rounded bg-sf-dark-700 hover:bg-sf-dark-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || (type === 'letterbox' && !hasValidLetterboxAspect)}
            className="px-3 py-1.5 text-xs text-white rounded bg-sf-accent hover:bg-sf-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? 'Generating…' : 'Create overlay'}
          </button>
        </div>
      </div>
    </div>
  )
}
