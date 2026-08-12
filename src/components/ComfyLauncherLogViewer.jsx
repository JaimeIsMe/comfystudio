import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  ExternalLink,
  Filter,
  FolderOpen,
  Pause,
  Play,
  Search,
  Trash2,
  X,
} from 'lucide-react'

import {
  fetchComfyLauncherLogsTail,
  getComfyLauncherLogs,
  openComfyLauncherLogFile,
  subscribeComfyLauncherLogs,
  subscribeComfyLauncherState,
  getComfyLauncherSnapshot,
} from '../services/comfyLauncher'
import { useI18n } from '../i18n/I18nContext'

const STREAM_CHIPS = [
  { id: 'event', label: 'generation', dotClass: 'bg-violet-400/80' },
  { id: 'stdout', label: 'stdout', dotClass: 'bg-emerald-400/70' },
  { id: 'stderr', label: 'stderr', dotClass: 'bg-amber-300/80' },
  { id: 'system', label: 'system', dotClass: 'bg-sky-400/80' },
]

function formatTimestamp(ts) {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
  } catch {
    return ''
  }
}

function ComfyLauncherLogViewer({ open, onClose }) {
  const { t } = useI18n()
  const [state, setState] = useState(() => getComfyLauncherSnapshot())
  const [logs, setLogs] = useState(() => getComfyLauncherLogs())
  const [paused, setPaused] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [filterText, setFilterText] = useState('')
  const [enabledStreams, setEnabledStreams] = useState({ event: true, stdout: true, stderr: true, system: true })
  const [copyFeedback, setCopyFeedback] = useState('')
  const scrollRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const unsubState = subscribeComfyLauncherState((next) => setState(next))
    return unsubState
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    fetchComfyLauncherLogsTail({ tailLines: 1000 }).then(setLogs).catch(() => {})
    const unsubLogs = subscribeComfyLauncherLogs(() => {
      if (!paused) setLogs(getComfyLauncherLogs())
    })
    return unsubLogs
  }, [open, paused])

  // When paused flips back to false, snapshot to current.
  useEffect(() => {
    if (!paused && open) setLogs(getComfyLauncherLogs())
  }, [paused, open])

  const filteredLogs = useMemo(() => {
    const trimmedFilter = filterText.trim().toLowerCase()
    return logs.filter((entry) => {
      if (!enabledStreams[entry.stream]) return false
      if (!trimmedFilter) return true
      return entry.text.toLowerCase().includes(trimmedFilter)
    })
  }, [logs, filterText, enabledStreams])

  useEffect(() => {
    if (!open || !autoScroll) return
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [filteredLogs, autoScroll, open])

  const handleCopyAll = useCallback(async () => {
    try {
      const text = filteredLogs.map((entry) => `[${formatTimestamp(entry.ts)}][${entry.stream}] ${entry.text}`).join('\n')
      await navigator.clipboard?.writeText(text)
      setCopyFeedback(t('logViewer.copiedLines', { count: filteredLogs.length }))
      setTimeout(() => setCopyFeedback(''), 1500)
    } catch (err) {
      setCopyFeedback(t('logViewer.copyFailed'))
      setTimeout(() => setCopyFeedback(''), 1500)
    }
  }, [filteredLogs, t])

  const handleClear = useCallback(() => {
    // Renderer-side clear only; the on-disk log keeps growing.
    setLogs([])
  }, [])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl h-[80vh] bg-sf-dark-900 border border-sf-dark-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-sf-dark-700">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2 h-2 rounded-full ${state.state === 'running' ? 'bg-emerald-400' : state.state === 'starting' || state.state === 'stopping' ? 'bg-amber-400 animate-pulse' : state.state === 'external' ? 'bg-sky-400' : state.state === 'crashed' ? 'bg-red-500' : 'bg-slate-400'}`} />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-sf-text-primary">{t('logViewer.title')}</div>
              <div className="text-[11px] text-sf-text-muted truncate">{state.statusMessage || t('logViewer.endpoint', { endpoint: state.httpBase || t('feedback.unknown') })}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-sf-dark-700 text-sf-text-muted hover:text-sf-text-primary"
            title={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-sf-dark-700 bg-sf-dark-950/50">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sf-text-muted" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder={t('logViewer.filter')}
              className="w-full pl-7 pr-2 py-1.5 text-[11.5px] bg-sf-dark-800 border border-sf-dark-700 rounded text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
            />
          </div>

          <div className="flex items-center gap-1 px-2 py-1 rounded bg-sf-dark-800 border border-sf-dark-700">
            <Filter className="w-3 h-3 text-sf-text-muted" />
            {STREAM_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setEnabledStreams((prev) => ({ ...prev, [chip.id]: !prev[chip.id] }))}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider transition-colors ${enabledStreams[chip.id]
                  ? 'bg-sf-dark-700 text-sf-text-primary'
                  : 'text-sf-text-muted hover:text-sf-text-secondary'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${chip.dotClass}`} />
                {chip.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setPaused((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${paused
              ? 'bg-amber-500/20 border border-amber-500/40 text-amber-200'
              : 'bg-sf-dark-800 border border-sf-dark-700 text-sf-text-secondary hover:bg-sf-dark-700'
            }`}
            title={paused ? t('logViewer.resume') : t('logViewer.pause')}
          >
            {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            {paused ? t('logViewer.paused') : t('logViewer.live')}
          </button>

          <label className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-sf-dark-800 border border-sf-dark-700 text-[11px] text-sf-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-sf-accent w-3 h-3"
            />
            {t('logViewer.autoScroll')}
          </label>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyAll}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-sf-dark-800 border border-sf-dark-700 text-sf-text-secondary hover:bg-sf-dark-700"
              title={t('logViewer.copyHelp')}
            >
              <Copy className="w-3 h-3" />
              {t('logViewer.copy')}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-sf-dark-800 border border-sf-dark-700 text-sf-text-secondary hover:bg-sf-dark-700"
              title={t('logViewer.clearHelp')}
            >
              <Trash2 className="w-3 h-3" />
              {t('logViewer.clearView')}
            </button>
            <button
              type="button"
              onClick={() => { void openComfyLauncherLogFile() }}
              disabled={!state.logFilePath}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-sf-dark-800 border border-sf-dark-700 text-sf-text-secondary hover:bg-sf-dark-700 disabled:opacity-50"
              title={state.logFilePath || t('logViewer.noFile')}
            >
              <FolderOpen className="w-3 h-3" />
              {t('logViewer.openFile')}
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto bg-black/70 px-3 py-2 font-mono text-[11px] text-sf-text-secondary leading-snug"
        >
          {filteredLogs.length === 0 ? (
            <div className="px-2 py-1.5 text-sf-text-muted italic">
              {logs.length === 0
                ? t('logViewer.empty')
                : t('logViewer.noMatch')}
            </div>
          ) : (
            filteredLogs.map((entry, idx) => (
              <div
                key={`${entry.ts}-${idx}`}
                className={`whitespace-pre-wrap break-words py-px ${entry.stream === 'stderr'
                  ? 'text-amber-300/90'
                  : entry.stream === 'system'
                    ? 'text-sky-300/85'
                    : entry.stream === 'event'
                      ? 'text-violet-300/90'
                      : 'text-sf-text-secondary'
                }`}
              >
                <span className="text-sf-text-muted/70 mr-2">{formatTimestamp(entry.ts)}</span>
                {entry.text}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-sf-dark-700 bg-sf-dark-950/50 text-[10.5px] text-sf-text-muted">
          <span>{t('logViewer.lineSummary', {
            visible: filteredLogs.length,
            total: logs.length,
            rolling: logs.length >= 2000 ? t('logViewer.rolling') : '',
            paused: paused ? t('logViewer.pausedSuffix') : '',
          })}</span>
          <span>{copyFeedback}</span>
          {state.logFilePath && (
            <span className="truncate inline-flex items-center gap-1" title={state.logFilePath}>
              <ExternalLink className="w-3 h-3" />
              <span className="truncate max-w-[260px]">{state.logFilePath}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default ComfyLauncherLogViewer
