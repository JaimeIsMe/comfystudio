import { Check, Loader2, X, XCircle } from 'lucide-react'
import { useCanvasGenerationStore } from '../stores/canvasGenerationStore'

export default function CanvasGenerationNotifications() {
  const jobs = useCanvasGenerationStore((state) => state.jobs)
  const dismissJob = useCanvasGenerationStore((state) => state.dismissJob)
  const dismissCompleted = useCanvasGenerationStore((state) => state.dismissCompleted)
  if (jobs.length === 0) return null

  const completedCount = jobs.filter((job) => ['completed', 'failed'].includes(job.status)).length
  return (
    <div className="pointer-events-none fixed right-4 top-12 z-[20000] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      <div className="pointer-events-auto flex items-center justify-between rounded-lg border border-sf-dark-600 bg-sf-dark-950/95 px-3 py-2 text-[10px] text-sf-text-muted shadow-2xl backdrop-blur">
        <span>Image generation jobs ({jobs.length})</span>
        <button type="button" disabled={!completedCount} onClick={dismissCompleted} className="rounded px-1.5 py-1 text-[10px] text-sf-text-secondary hover:bg-sf-dark-800 hover:text-sf-text-primary disabled:cursor-not-allowed disabled:opacity-40">Dismiss completed</button>
      </div>
      {jobs.map((job) => (
        <div key={job.id} className="pointer-events-auto rounded-lg border border-sf-dark-600 bg-sf-dark-950/95 px-3 py-2.5 shadow-2xl backdrop-blur">
          <div className="flex items-start gap-2">
            {job.status === 'completed' ? <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" /> : job.status === 'failed' ? <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" /> : <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-sf-accent" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-sf-text-primary">{job.title || 'Canvas image'}</div>
              <div className="truncate text-[10px] text-sf-text-muted">{job.statusMessage || (job.status === 'completed' ? 'Completed' : job.status === 'failed' ? 'Failed' : 'Queued')}</div>
              {job.error && <div className="mt-1 text-[10px] text-red-300">{job.error}</div>}
            </div>
            <button type="button" onClick={() => dismissJob(job.id)} className="rounded p-0.5 text-sf-text-muted hover:bg-sf-dark-800 hover:text-sf-text-primary" title="Dismiss job"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      ))}
    </div>
  )
}
