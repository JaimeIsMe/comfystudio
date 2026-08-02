import { useMemo, useState } from 'react'
import { Film, Image as ImageIcon } from 'lucide-react'
import { BROWSER_IMAGE_EXTENSIONS } from '../../utils/imageSequenceDetection'

/**
 * Import prompt for detected image sequences. One row per sequence: frame
 * range, fps (defaults to the project rate — retag later from the asset's
 * provenance if it was wrong), and a Sequence/Stills choice. Import runs the
 * transcodes; rows fill with real ffmpeg progress.
 */
function ImageSequenceImportDialog({
  plan,
  defaultFps = 24,
  busy = false,
  progress = {},
  error = '',
  onImport,
  onClose,
}) {
  const sequences = plan?.sequences || []

  // Stills fallback only exists where we hold real File objects the normal
  // importer can read: the dropped files themselves. Folder-expanded rows are
  // path-only, and TIFF/EXR/DPX stills can't render in the browser at all.
  const rowStillsFiles = useMemo(() => sequences.map((seq) => {
    if (plan?.expandedFrom === 'sibling') return (plan?.droppedFiles || []).filter((f) => f instanceof File)
    return seq.frames.map((frame) => frame.file?.file).filter((f) => f instanceof File)
  }), [plan, sequences])

  const [rowConfig, setRowConfig] = useState(() => sequences.map(() => ({
    fps: defaultFps,
    mode: 'sequence',
  })))

  const updateRow = (index, patch) => {
    setRowConfig((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const handleImport = () => {
    if (busy) return
    onImport?.(sequences.map((seq, i) => ({
      sequence: seq,
      fps: Number(rowConfig[i]?.fps) > 0 ? Number(rowConfig[i].fps) : defaultFps,
      mode: rowConfig[i]?.mode || 'sequence',
      stillsFiles: rowStillsFiles[i] || [],
    })))
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose?.()
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-sf-dark-600 bg-sf-dark-800 shadow-2xl">
        <div className="border-b border-sf-dark-700 px-4 py-3">
          <h3 className="text-sm font-medium text-sf-text-primary">
            Import Image Sequence{sequences.length === 1 ? '' : 's'}
          </h3>
          <p className="mt-1 text-xs text-sf-text-muted">
            Numbered frames import as one clip. The frame rate is saved with the asset, so it can be re-interpreted later.
          </p>
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto px-4 py-3">
          {sequences.map((seq, i) => {
            const config = rowConfig[i] || {}
            const stillsAllowed = (rowStillsFiles[i] || []).length > 0
              && BROWSER_IMAGE_EXTENSIONS.includes(seq.ext)
            const rowProgress = progress[`seq_${i}`]
            const percent = rowProgress?.totalFrames
              ? Math.min(100, Math.round((rowProgress.frame / rowProgress.totalFrames) * 100))
              : null
            return (
              <div key={seq.displayName} className="rounded border border-sf-dark-700 bg-sf-dark-900/60 p-2.5">
                <div className="flex items-center gap-2">
                  <Film className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                  <span className="truncate font-mono text-xs text-sf-text-primary" title={seq.displayName}>
                    {seq.displayName}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-sf-text-muted">
                    {seq.count} frames
                  </span>
                </div>
                {seq.missing.length > 0 && (
                  <p className="mt-1 text-[11px] text-amber-400/90">
                    {seq.missing.length} missing frame{seq.missing.length === 1 ? '' : 's'} — the previous frame holds.
                  </p>
                )}
                {seq.ext === '.exr' && (
                  <p className="mt-1 text-[11px] text-sf-text-muted">
                    EXR imports through a standard linear → Rec.709 transform (experimental).
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded bg-sf-dark-900 p-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => updateRow(i, { mode: 'sequence' })}
                      className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                        (config.mode || 'sequence') === 'sequence'
                          ? 'bg-sf-accent text-black'
                          : 'text-sf-text-secondary hover:bg-sf-dark-700'
                      }`}
                    >
                      Sequence
                    </button>
                    <button
                      type="button"
                      disabled={busy || !stillsAllowed}
                      title={stillsAllowed
                        ? 'Import the dropped files as individual stills'
                        : 'Stills are unavailable here — this format only imports as a sequence'}
                      onClick={() => updateRow(i, { mode: 'stills' })}
                      className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                        config.mode === 'stills'
                          ? 'bg-sf-accent text-black'
                          : stillsAllowed
                            ? 'text-sf-text-secondary hover:bg-sf-dark-700'
                            : 'cursor-not-allowed text-sf-text-muted/50'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <ImageIcon className="h-3 w-3" />
                        Stills
                      </span>
                    </button>
                  </div>
                  {(config.mode || 'sequence') === 'sequence' && (
                    <label className="ml-auto flex items-center gap-1.5 text-[11px] text-sf-text-secondary">
                      fps
                      <input
                        type="number"
                        min="1"
                        max="240"
                        step="0.001"
                        disabled={busy}
                        value={config.fps ?? defaultFps}
                        onChange={(e) => updateRow(i, { fps: e.target.value })}
                        className="w-16 rounded border border-sf-dark-600 bg-sf-dark-900 px-1.5 py-0.5 text-right font-mono text-[11px] text-sf-text-primary focus:border-sf-accent focus:outline-none"
                      />
                    </label>
                  )}
                </div>
                {busy && (config.mode || 'sequence') === 'sequence' && (
                  <div className="mt-2 h-1 overflow-hidden rounded bg-sf-dark-700">
                    <div
                      className="h-full bg-sf-accent transition-[width] duration-300"
                      style={{ width: `${percent ?? 4}%` }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="border-t border-sf-dark-700 px-4 py-3">
          {(plan?.leftoverFiles || []).length > 0 && (
            <p className="mb-2 text-[11px] text-sf-text-muted">
              {plan.leftoverFiles.length} other file{plan.leftoverFiles.length === 1 ? '' : 's'} will import normally.
            </p>
          )}
          {error && <p className="mb-2 text-[11px] text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="rounded bg-sf-dark-700 px-3 py-1.5 text-xs text-sf-text-secondary transition-colors hover:bg-sf-dark-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleImport}
              className="rounded bg-sf-accent px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-sf-accent/90 disabled:opacity-60"
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ImageSequenceImportDialog
