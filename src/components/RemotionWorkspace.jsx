import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock3, Palette, Sparkles, Type } from 'lucide-react'
import useAssetsStore from '../stores/assetsStore'
import useProjectStore from '../stores/projectStore'
import { isElectron, writeGeneratedOverlayToProject } from '../services/fileSystem'

const DEFAULTS = Object.freeze({
  name: '',
  template: 'lower-third',
  title: 'YOUR HEADLINE',
  subtitle: 'Subheading or call-to-action',
  duration: 4,
  fps: 30,
  accentColor: '#f59e0b',
  textColor: '#ffffff',
  panelOpacity: 72,
})

const REMOTION_TEMPLATE_OPTIONS = Object.freeze([
  { id: 'lower-third', label: 'Lower Third' },
  { id: 'cinematic-lower-third', label: 'Cinematic Lower Third' },
  { id: 'corner-bug', label: 'Corner Bug (Logo Tag)' },
  { id: 'cta-banner', label: 'CTA Banner' },
  { id: 'split-title', label: 'Split Title' },
  { id: 'title-card', label: 'Title Card' },
  { id: 'end-slate', label: 'End Slate' },
  { id: 'caption-strip', label: 'Caption Strip' },
])
const REMOTION_TEMPLATE_ID_SET = new Set(REMOTION_TEMPLATE_OPTIONS.map((option) => option.id))

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function sanitizeHexColor(value, fallback) {
  const text = String(value || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text
  return fallback
}

function normalizeTemplateId(value, fallback = DEFAULTS.template) {
  const id = String(value || '').trim().toLowerCase()
  return REMOTION_TEMPLATE_ID_SET.has(id) ? id : fallback
}

function getTemplateLabel(templateId) {
  const resolved = normalizeTemplateId(templateId)
  const match = REMOTION_TEMPLATE_OPTIONS.find((option) => option.id === resolved)
  return match?.label || 'Lower Third'
}

export default function RemotionWorkspace() {
  const assets = useAssetsStore(state => state.assets)
  const addAsset = useAssetsStore(state => state.addAsset)
  const updateAsset = useAssetsStore(state => state.updateAsset)
  const setPreview = useAssetsStore(state => state.setPreview)
  const { currentProjectHandle, getCurrentTimelineSettings } = useProjectStore()

  const timelineSettings = getCurrentTimelineSettings?.() || { width: 1920, height: 1080, fps: 24 }
  const [useTimelineSize, setUseTimelineSize] = useState(true)
  const [customWidth, setCustomWidth] = useState(Number(timelineSettings.width) || 1920)
  const [customHeight, setCustomHeight] = useState(Number(timelineSettings.height) || 1080)
  const [name, setName] = useState(DEFAULTS.name)
  const [template, setTemplate] = useState(DEFAULTS.template)
  const [title, setTitle] = useState(DEFAULTS.title)
  const [subtitle, setSubtitle] = useState(DEFAULTS.subtitle)
  const [duration, setDuration] = useState(DEFAULTS.duration)
  const [fps, setFps] = useState(DEFAULTS.fps)
  const [accentColor, setAccentColor] = useState(DEFAULTS.accentColor)
  const [textColor, setTextColor] = useState(DEFAULTS.textColor)
  const [panelOpacity, setPanelOpacity] = useState(DEFAULTS.panelOpacity)
  const [editingAssetId, setEditingAssetId] = useState(null)
  const [lastRenderedAssetId, setLastRenderedAssetId] = useState(null)
  const [isRendering, setIsRendering] = useState(false)
  const [status, setStatus] = useState({ type: null, message: '' })

  const width = useTimelineSize
    ? Math.max(1, Math.round(Number(timelineSettings.width) || 1920))
    : Math.max(1, Math.round(Number(customWidth) || 1920))
  const height = useTimelineSize
    ? Math.max(1, Math.round(Number(timelineSettings.height) || 1080))
    : Math.max(1, Math.round(Number(customHeight) || 1080))

  const recentRemotionAssets = useMemo(
    () => assets.filter(a => a?.settings?.overlayKind === 'remotion').slice(0, 8),
    [assets]
  )
  const lastRenderedAsset = useMemo(
    () => assets.find(a => a.id === lastRenderedAssetId) || null,
    [assets, lastRenderedAssetId]
  )

  const loadAssetIntoForm = (asset) => {
    if (!asset || asset?.settings?.overlayKind !== 'remotion') return
    const settings = asset.settings || {}
    const remotion = settings.remotion || {}
    setEditingAssetId(asset.id)
    setName(asset.name || '')
    setTemplate(normalizeTemplateId(settings.remotionTemplate, DEFAULTS.template))
    setTitle(remotion.title || DEFAULTS.title)
    setSubtitle(remotion.subtitle || '')
    setDuration(clampNumber(asset.duration ?? settings.duration, 1, 20, DEFAULTS.duration))
    setFps(clampNumber(settings.fps, 12, 60, DEFAULTS.fps))
    setAccentColor(sanitizeHexColor(remotion.accentColor, DEFAULTS.accentColor))
    setTextColor(sanitizeHexColor(remotion.textColor, DEFAULTS.textColor))
    setPanelOpacity(clampNumber((Number(remotion.panelOpacity) || 0.72) * 100, 5, 95, DEFAULTS.panelOpacity))
    setUseTimelineSize(false)
    setCustomWidth(clampNumber(settings.width, 1, 4096, timelineSettings.width || 1920))
    setCustomHeight(clampNumber(settings.height, 1, 4096, timelineSettings.height || 1080))
    setLastRenderedAssetId(asset.id)
    setPreview(asset)
    setStatus({ type: null, message: '' })
  }

  const resetForm = () => {
    setEditingAssetId(null)
    setName(DEFAULTS.name)
    setTemplate(DEFAULTS.template)
    setTitle(DEFAULTS.title)
    setSubtitle(DEFAULTS.subtitle)
    setDuration(DEFAULTS.duration)
    setFps(DEFAULTS.fps)
    setAccentColor(DEFAULTS.accentColor)
    setTextColor(DEFAULTS.textColor)
    setPanelOpacity(DEFAULTS.panelOpacity)
    setUseTimelineSize(true)
    setCustomWidth(Number(timelineSettings.width) || 1920)
    setCustomHeight(Number(timelineSettings.height) || 1080)
    setStatus({ type: null, message: '' })
  }

  const handleCreate = async () => {
    if (!window?.electronAPI?.renderRemotionOverlay) {
      setStatus({ type: 'error', message: 'Remotion rendering is available in Electron mode only.' })
      return
    }
    setStatus({ type: null, message: '' })
    setIsRendering(true)
    const normalizedOpacity = clampNumber(panelOpacity, 5, 95, 72) / 100

    try {
      const renderResult = await window.electronAPI.renderRemotionOverlay({
        template,
        width,
        height,
        fps: clampNumber(fps, 12, 60, 30),
        durationSec: clampNumber(duration, 1, 20, 4),
        title,
        subtitle,
        accentColor: sanitizeHexColor(accentColor, DEFAULTS.accentColor),
        textColor: sanitizeHexColor(textColor, DEFAULTS.textColor),
        panelOpacity: normalizedOpacity,
      })

      if (!renderResult?.success || !renderResult.outputPath) {
        throw new Error(renderResult?.error || 'Remotion render failed')
      }

      const readResult = await window.electronAPI.readFileAsBuffer(renderResult.outputPath)
      if (!readResult?.success || !readResult.data) {
        throw new Error(readResult?.error || 'Could not read rendered overlay file')
      }

      const blob = new Blob([readResult.data], { type: renderResult.mimeType || 'video/webm' })
      const defaultName = (name || '').trim()
        || ((title || '').trim()
          ? `Motion ${String(title).trim().slice(0, 28)}`
          : `Motion ${getTemplateLabel(template)}`)
      const settings = {
        width,
        height,
        duration: renderResult.durationSec || duration,
        fps: renderResult.fps || fps,
        overlayKind: 'remotion',
        hasAlpha: renderResult.hasAlpha !== false,
        remotionTemplate: template,
        remotion: {
          title: String(title || '').trim(),
          subtitle: String(subtitle || '').trim(),
          accentColor: sanitizeHexColor(accentColor, DEFAULTS.accentColor),
          textColor: sanitizeHexColor(textColor, DEFAULTS.textColor),
          panelOpacity: normalizedOpacity,
        },
      }
      const existingAsset = editingAssetId ? assets.find(a => a.id === editingAssetId) : null

      const applyGeneratedAsset = (nextAsset) => {
        if (editingAssetId && existingAsset) {
          const updatedAsset = {
            ...existingAsset,
            ...nextAsset,
            id: existingAsset.id,
            folderId: existingAsset.folderId ?? null,
          }
          updateAsset(editingAssetId, updatedAsset)
          return updatedAsset
        }
        return addAsset({ ...nextAsset, folderId: null })
      }

      let generatedAsset = null
      if (currentProjectHandle && isElectron() && typeof currentProjectHandle === 'string') {
        const persisted = await writeGeneratedOverlayToProject(
          currentProjectHandle,
          blob,
          defaultName,
          'video',
          settings
        )
        generatedAsset = applyGeneratedAsset(persisted)
      } else {
        generatedAsset = applyGeneratedAsset({
          name: defaultName,
          type: 'video',
          url: URL.createObjectURL(blob),
          isImported: false,
          mimeType: blob.type || 'video/webm',
          settings,
          duration: settings.duration,
          audioEnabled: false,
        })
      }
      if (generatedAsset) {
        setLastRenderedAssetId(generatedAsset.id)
        setPreview(generatedAsset)
      }

      setStatus({
        type: 'success',
        message: editingAssetId && existingAsset
          ? `Updated motion overlay: ${defaultName}`
          : `Created motion overlay: ${defaultName}`,
      })

      try {
        await window.electronAPI.deleteFile(renderResult.outputPath)
        const renderDir = await window.electronAPI.pathDirname(renderResult.outputPath)
        await window.electronAPI.deleteDirectory(renderDir, { recursive: true })
      } catch (_) {
        // Best-effort cleanup for temporary render artifacts.
      }
    } catch (err) {
      setStatus({ type: 'error', message: err?.message || 'Failed to create Remotion overlay' })
    } finally {
      setIsRendering(false)
    }
  }

  const handleSendToEditor = () => {
    if (!lastRenderedAsset) return
    setPreview(lastRenderedAsset)
    window.dispatchEvent(new CustomEvent('comfystudio-open-editor-from-remotion', {
      detail: { assetId: lastRenderedAsset.id },
    }))
  }

  return (
    <div className="h-full w-full bg-sf-dark-950 text-sf-text-primary overflow-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-sf-accent" />
              Remotion Workspace (Beta)
            </h1>
            <p className="text-sm text-sf-text-muted mt-1">
              Build transparent motion overlays with larger controls and in-place update support.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {editingAssetId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-3 py-2 rounded bg-sf-dark-700 text-sf-text-primary text-sm hover:bg-sf-dark-600"
              >
                New Asset
              </button>
            )}
            <button
              type="button"
              onClick={handleCreate}
              disabled={isRendering}
              className="px-4 py-2 rounded bg-sf-accent text-white text-sm hover:bg-sf-accent/90 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isRendering
                ? (editingAssetId ? 'Updating Motion…' : 'Rendering Motion…')
                : (editingAssetId ? 'Update Existing Motion Asset' : 'Create Motion Asset')}
            </button>
          </div>
        </div>

        {status.message && (
          <div
            className={`rounded border px-3 py-2 text-sm flex items-center gap-2 ${
              status.type === 'success'
                ? 'border-green-500/40 bg-green-500/10 text-green-200'
                : 'border-red-500/40 bg-red-500/10 text-red-200'
            }`}
          >
            {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {status.message}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-4 bg-sf-dark-900 border border-sf-dark-700 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-sf-text-muted block mb-1">Template</label>
                <select
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-2 text-sm"
                >
                  {REMOTION_TEMPLATE_OPTIONS.map((templateOption) => (
                    <option key={templateOption.id} value={templateOption.id}>{templateOption.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-sf-text-muted block mb-1">Asset name (optional)</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-2 text-sm"
                  placeholder="Motion lower-third"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-sf-text-muted block mb-1 flex items-center gap-1">
                  <Type className="w-3.5 h-3.5" />
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-sf-text-muted block mb-1">Subtitle</label>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-sf-text-muted block mb-1 flex items-center gap-1">
                  <Clock3 className="w-3.5 h-3.5" />
                  Duration (s)
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={duration}
                  onChange={(e) => setDuration(clampNumber(e.target.value, 1, 20, DEFAULTS.duration))}
                  className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-sf-text-muted block mb-1">FPS</label>
                <select
                  value={fps}
                  onChange={(e) => setFps(clampNumber(e.target.value, 12, 60, DEFAULTS.fps))}
                  className="w-full bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-2 text-sm"
                >
                  <option value={24}>24</option>
                  <option value={30}>30</option>
                  <option value={48}>48</option>
                  <option value={60}>60</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-sf-text-muted block mb-1 flex items-center gap-1">
                  <Palette className="w-3.5 h-3.5" />
                  Accent color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="w-10 h-10 rounded border border-sf-dark-600 bg-transparent"
                  />
                  <input
                    type="text"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="flex-1 bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-sf-text-muted block mb-1">Text color</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={textColor}
                    onChange={(e) => setTextColor(e.target.value)}
                    className="w-10 h-10 rounded border border-sf-dark-600 bg-transparent"
                  />
                  <input
                    type="text"
                    value={textColor}
                    onChange={(e) => setTextColor(e.target.value)}
                    className="flex-1 bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-2 text-sm font-mono"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs text-sf-text-muted block mb-1">Panel opacity ({panelOpacity}%)</label>
              <input
                type="range"
                min={5}
                max={95}
                value={panelOpacity}
                onChange={(e) => setPanelOpacity(clampNumber(e.target.value, 5, 95, DEFAULTS.panelOpacity))}
                className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-sf-text-muted block">Resolution</label>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={useTimelineSize}
                    onChange={() => setUseTimelineSize(true)}
                    className="accent-sf-accent"
                  />
                  Match timeline ({timelineSettings.width}×{timelineSettings.height})
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
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
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    min={1}
                    max={4096}
                    value={customWidth}
                    onChange={(e) => setCustomWidth(clampNumber(e.target.value, 1, 4096, 1920))}
                    className="w-24 bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1.5 text-sm"
                  />
                  <span className="text-sf-text-muted">×</span>
                  <input
                    type="number"
                    min={1}
                    max={4096}
                    value={customHeight}
                    onChange={(e) => setCustomHeight(clampNumber(e.target.value, 1, 4096, 1080))}
                    className="w-24 bg-sf-dark-700 border border-sf-dark-600 rounded px-2 py-1.5 text-sm"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-sf-dark-900 border border-sf-dark-700 rounded-lg p-4">
              <h3 className="text-sm font-medium mb-2">Starter Roadmap</h3>
              <div className="text-xs text-sf-text-muted space-y-1">
                <div>- Multi-template library (kinetic titles, CTA cards, end slates)</div>
                <div>- In-place re-render from this workspace</div>
                <div>- Presets + per-project brand kits (fonts/colors)</div>
                <div>- Timeline-linked editable instances</div>
              </div>
            </div>

            <div className="bg-sf-dark-900 border border-sf-dark-700 rounded-lg p-4">
              <h3 className="text-sm font-medium mb-2">Recent Remotion Assets</h3>
              {recentRemotionAssets.length === 0 ? (
                <p className="text-xs text-sf-text-muted">No Remotion assets yet. Create one to get started.</p>
              ) : (
                <div className="space-y-2">
                  {recentRemotionAssets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => loadAssetIntoForm(asset)}
                      className={`w-full text-left px-2 py-1.5 rounded border transition-colors ${
                        editingAssetId === asset.id
                          ? 'bg-sf-accent/20 border-sf-accent/40'
                          : 'bg-sf-dark-800 border-sf-dark-700 hover:bg-sf-dark-700'
                      }`}
                    >
                      <div className="text-xs text-sf-text-primary">{asset.name}</div>
                      <div className="text-[10px] text-sf-text-muted">
                        {asset.settings?.width || '?'}×{asset.settings?.height || '?'} · {asset.settings?.fps || '?'}fps · {asset.duration?.toFixed?.(2) || asset.settings?.duration || '?'}s
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-sf-dark-900 border border-sf-dark-700 rounded-lg p-4 text-xs text-sf-text-muted">
              <div className="font-medium text-sf-text-primary mb-1">Current output</div>
              <div>
                Transparent WebM overlay with alpha, ready for top-track compositing.
              </div>
            </div>
          </div>
        </div>

        <div className="bg-sf-dark-900 border border-sf-dark-700 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Render Result</h3>
              <p className="text-xs text-sf-text-muted mt-0.5">
                Review the latest motion render, then send it to Editor (Assets only, no timeline placement).
              </p>
            </div>
            <button
              type="button"
              onClick={handleSendToEditor}
              disabled={!lastRenderedAsset}
              className="px-3 py-2 rounded bg-sf-accent text-white text-xs hover:bg-sf-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send to Editor
            </button>
          </div>

          {!lastRenderedAsset ? (
            <p className="text-xs text-sf-text-muted">
              Create or update a motion asset to preview it here before sending to Editor.
            </p>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="relative rounded border border-sf-dark-700 bg-sf-dark-950 overflow-hidden aspect-video">
                {(lastRenderedAsset?.settings?.overlayKind === 'remotion' || lastRenderedAsset?.settings?.hasAlpha === true) && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      backgroundImage: `
                        linear-gradient(45deg, #333 25%, transparent 25%),
                        linear-gradient(-45deg, #333 25%, transparent 25%),
                        linear-gradient(45deg, transparent 75%, #333 75%),
                        linear-gradient(-45deg, transparent 75%, #333 75%)
                      `,
                      backgroundSize: '20px 20px',
                      backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                      backgroundColor: '#222',
                      zIndex: 1,
                    }}
                  />
                )}
                <video
                  src={lastRenderedAsset.url}
                  controls
                  className="w-full h-full"
                  style={{ objectFit: 'contain', position: 'relative', zIndex: 2 }}
                />
              </div>

              <div className="rounded border border-sf-dark-700 bg-sf-dark-800/60 p-3 text-xs space-y-2">
                <div className="text-sf-text-primary font-medium">{lastRenderedAsset.name || 'Untitled motion asset'}</div>
                <div className="text-sf-text-muted">
                  Template: {getTemplateLabel(lastRenderedAsset?.settings?.remotionTemplate || DEFAULTS.template)}
                </div>
                <div className="text-sf-text-muted">
                  {lastRenderedAsset?.settings?.width || '?'}×{lastRenderedAsset?.settings?.height || '?'} · {lastRenderedAsset?.settings?.fps || '?'}fps · {(lastRenderedAsset?.duration ?? lastRenderedAsset?.settings?.duration ?? '?')}s
                </div>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => loadAssetIntoForm(lastRenderedAsset)}
                    className="px-2.5 py-1.5 rounded bg-sf-dark-700 text-sf-text-primary text-xs hover:bg-sf-dark-600"
                  >
                    Load Into Form
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
