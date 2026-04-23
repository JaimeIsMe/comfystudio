import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Cloud, Film, Loader2, Sparkles, X } from 'lucide-react'
import { checkWorkflowDependencies } from '../services/workflowDependencies'
import {
  TOPAZ_VIDEO_UPSCALE_CREATIVITY_OPTIONS,
  TOPAZ_VIDEO_UPSCALE_DEFAULTS,
  TOPAZ_VIDEO_UPSCALE_MODEL_OPTIONS,
  TOPAZ_VIDEO_UPSCALE_RESOLUTION_OPTIONS,
  TOPAZ_VIDEO_UPSCALE_WORKFLOW_ID,
  getAssetResolutionDimensions,
  getTopazVideoUpscaleCreditsPerSecond,
  getTopazVideoUpscaleResolutionNotice,
  isTopazVideoUpscaleResolutionDisabled,
  topazVideoUpscaleModelSupportsCreativity,
} from '../config/topazVideoUpscaleConfig'
import { buildTopazVideoUpscaleBaseName, runTopazVideoUpscale } from '../services/topazVideoUpscale'
import { formatCreditsPerSecond, formatCreditsRange } from '../utils/comfyCredits'

function getDefaultResolutionForAsset(asset) {
  const preferred = TOPAZ_VIDEO_UPSCALE_RESOLUTION_OPTIONS.find((option) => (
    !isTopazVideoUpscaleResolutionDisabled(asset, option.id)
  ))
  return preferred?.id || TOPAZ_VIDEO_UPSCALE_DEFAULTS.resolution
}

export default function TopazVideoUpscaleDialog({ asset, onClose }) {
  const [model, setModel] = useState(TOPAZ_VIDEO_UPSCALE_DEFAULTS.model)
  const [targetResolution, setTargetResolution] = useState(() => getDefaultResolutionForAsset(asset))
  const [creativity, setCreativity] = useState(TOPAZ_VIDEO_UPSCALE_DEFAULTS.creativity)
  const [isRunning, setIsRunning] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [dependencyResult, setDependencyResult] = useState(null)
  const [dependencyLoading, setDependencyLoading] = useState(true)
  const [estimatedCredits, setEstimatedCredits] = useState(null)

  useEffect(() => {
    setTargetResolution(getDefaultResolutionForAsset(asset))
  }, [asset])

  useEffect(() => {
    let cancelled = false
    setDependencyLoading(true)
    checkWorkflowDependencies(TOPAZ_VIDEO_UPSCALE_WORKFLOW_ID)
      .then((result) => {
        if (!cancelled) {
          setDependencyResult(result)
        }
      })
      .catch((dependencyError) => {
        if (!cancelled) {
          setDependencyResult({
            workflowId: TOPAZ_VIDEO_UPSCALE_WORKFLOW_ID,
            status: 'error',
            error: dependencyError instanceof Error ? dependencyError.message : String(dependencyError || 'Failed to check workflow readiness.'),
            hasBlockingIssues: false,
            missingAuth: false,
            missingNodes: [],
            missingModels: [],
          })
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDependencyLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const { width, height } = useMemo(() => getAssetResolutionDimensions(asset), [asset])
  const selectedResolutionDisabled = isTopazVideoUpscaleResolutionDisabled(asset, targetResolution)
  const selectedResolutionNotice = getTopazVideoUpscaleResolutionNotice(asset, targetResolution)
  const modelSupportsCreativity = topazVideoUpscaleModelSupportsCreativity(model)
  const hasBlockingDependencyIssue = Boolean(dependencyResult?.hasBlockingIssues)
  const canRun = !isRunning && !selectedResolutionDisabled && !hasBlockingDependencyIssue
  const guideCreditsPerSecond = getTopazVideoUpscaleCreditsPerSecond(model, targetResolution)
  const guideCreditsLabel = guideCreditsPerSecond != null
    ? formatCreditsPerSecond(guideCreditsPerSecond)
    : 'Pricing unavailable'
  const liveEstimatedCreditsLabel = estimatedCredits ? formatCreditsRange(estimatedCredits) : ''

  const handleRun = async () => {
    if (!asset || !canRun) return
    setError('')
    setIsRunning(true)
    setProgress(0)
    setStatusMessage('Preparing Topaz upscale…')
    setEstimatedCredits(null)

    try {
      await runTopazVideoUpscale({
        sourceAsset: asset,
        folderId: asset?.folderId ?? null,
        baseName: buildTopazVideoUpscaleBaseName(asset, targetResolution),
        model,
        targetResolution,
        creativity,
        onStatus: (status) => {
          setStatusMessage(status?.statusMessage || 'Running Topaz upscale…')
          setProgress(Math.max(0, Math.min(100, Number(status?.progress) || 0)))
          if (status?.estimatedCredits) {
            setEstimatedCredits(status.estimatedCredits)
          }
        },
      })
      setIsRunning(false)
      onClose?.()
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError || 'Topaz upscale failed.'))
      setIsRunning(false)
    }
  }

  if (!asset) return null

  const resolutionSummary = width && height ? `${width}x${height}` : 'Resolution unknown'
  const durationSummary = Number(asset?.duration || asset?.settings?.duration || 0) > 0
    ? `${Number(asset.duration || asset.settings?.duration || 0).toFixed(1)}s`
    : ''

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70" onClick={() => !isRunning && onClose?.()}>
      <div
        className="w-full max-w-lg mx-4 overflow-hidden rounded-xl border border-sf-dark-700 bg-sf-dark-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-sf-dark-700 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-sf-text-primary">Topaz Video Upscale</h2>
              <p className="text-xs text-sf-text-muted">Cloud upscaling for project video assets</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !isRunning && onClose?.()}
            disabled={isRunning}
            className="rounded-lg p-1.5 text-sf-text-muted transition-colors hover:bg-sf-dark-700 disabled:opacity-50"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">
              <Cloud className="h-3.5 w-3.5" />
              Cloud only
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-sf-dark-700 bg-sf-dark-800 px-2.5 py-1 text-[11px] font-medium text-sf-text-secondary">
              <Film className="h-3.5 w-3.5" />
              Leaves the source clip untouched
            </span>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {dependencyLoading ? (
            <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-850 px-3 py-2 text-sm text-sf-text-secondary">
              Checking Topaz workflow readiness…
            </div>
          ) : dependencyResult?.missingAuth ? (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Topaz Video Upscale needs your Comfy Partner API key before it can run.
            </div>
          ) : dependencyResult?.hasBlockingIssues ? (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Topaz Video Upscale is missing required nodes or models. Open Workflow Setup to install them before running.
            </div>
          ) : dependencyResult?.error ? (
            <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-850 px-3 py-2 text-sm text-sf-text-secondary">
              {dependencyResult.error}
            </div>
          ) : null}

          <div className="flex items-center gap-3 rounded-lg border border-sf-dark-700 bg-sf-dark-850 p-3">
            <div className="flex h-16 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sf-dark-800">
              {asset?.url ? (
                <video
                  src={asset.url}
                  className="h-full w-full object-cover"
                  muted
                />
              ) : (
                <Film className="h-6 w-6 text-sf-text-muted" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-sf-text-primary">{asset.name}</div>
              <div className="mt-1 text-xs text-sf-text-muted">
                {resolutionSummary}
                {durationSummary ? ` • ${durationSummary}` : ''}
              </div>
            </div>
            <div className="rounded-md bg-sf-dark-800 px-2 py-1 text-[10px] uppercase tracking-wide text-sf-text-muted">
              Source
            </div>
          </div>

          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-sf-text-secondary">Topaz model</div>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={isRunning}
              className="w-full rounded-lg border border-sf-dark-700 bg-sf-dark-900 px-3 py-2 text-sm text-sf-text-primary outline-none disabled:opacity-50"
            >
              {TOPAZ_VIDEO_UPSCALE_MODEL_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div>
            <div className="mb-2 text-[11px] font-medium text-sf-text-secondary">Target resolution</div>
            <div className="grid grid-cols-2 gap-2">
              {TOPAZ_VIDEO_UPSCALE_RESOLUTION_OPTIONS.map((option) => {
                const isDisabled = isTopazVideoUpscaleResolutionDisabled(asset, option.id)
                const isSelected = targetResolution === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={isRunning || isDisabled}
                    onClick={() => setTargetResolution(option.id)}
                    className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                      isSelected
                        ? 'border-amber-400/60 bg-amber-500/10 text-amber-200'
                        : 'border-sf-dark-700 bg-sf-dark-850 text-sf-text-primary hover:border-sf-dark-600'
                    } ${isDisabled ? 'cursor-not-allowed opacity-45 hover:border-sf-dark-700' : ''}`}
                  >
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="mt-1 text-[11px] text-sf-text-muted">
                      {option.id}
                    </div>
                  </button>
                )
              })}
            </div>
            {selectedResolutionNotice && (
              <div className="mt-2 text-xs text-amber-200">{selectedResolutionNotice}</div>
            )}
          </div>

          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-sf-text-secondary">Upscale creativity</div>
            <select
              value={creativity}
              onChange={(event) => setCreativity(event.target.value)}
              disabled={isRunning || !modelSupportsCreativity}
              className="w-full rounded-lg border border-sf-dark-700 bg-sf-dark-900 px-3 py-2 text-sm text-sf-text-primary outline-none disabled:opacity-50"
            >
              {TOPAZ_VIDEO_UPSCALE_CREATIVITY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs text-sf-text-muted">
              {modelSupportsCreativity
                ? 'Creativity is exposed for Starlight (Astra) Creative.'
                : 'Creativity only applies to Starlight (Astra) Creative.'}
            </div>
          </label>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-amber-200/80">
                  Estimated cost
                </div>
                <div className="mt-1 text-sm font-medium text-amber-100">
                  {guideCreditsLabel}
                </div>
              </div>
              <div className="rounded-full border border-amber-400/20 bg-black/20 px-2.5 py-1 text-[10px] font-medium text-amber-200">
                Pricing guide
              </div>
            </div>
            <div className="mt-2 text-xs text-amber-100/75">
              Approximate per-second rate from the ComfyUI partner nodes pricing guide. Multiply by clip length for a rough total.
            </div>
            {liveEstimatedCreditsLabel && (
              <div className="mt-3 rounded-lg border border-amber-400/15 bg-black/15 px-3 py-2 text-xs text-amber-100/85">
                Current Topaz job estimate: {liveEstimatedCreditsLabel}
              </div>
            )}
          </div>

          {isRunning && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="flex items-center gap-3">
                <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                <div className="flex-1 text-sm text-amber-100">
                  {statusMessage || 'Running Topaz upscale…'}
                </div>
                <div className="text-xs font-medium text-amber-200">
                  {Math.round(progress)}%
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-sf-dark-800">
                <div
                  className="h-full bg-amber-400 transition-all duration-300"
                  style={{ width: `${Math.max(4, Math.min(100, progress || 0))}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-sf-dark-700 bg-sf-dark-850 px-5 py-4">
          <button
            type="button"
            onClick={() => onClose?.()}
            disabled={isRunning}
            className="px-4 py-2 text-sm text-sf-text-secondary transition-colors hover:text-sf-text-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={!canRun}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-sf-dark-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-sf-dark-700 disabled:text-sf-text-muted"
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Upscale Video
          </button>
        </div>
      </div>
    </div>
  )
}
