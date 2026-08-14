const CLEAN_EXPORT_CANCELLATION_MESSAGES = new Set([
  'export cancelled',
  'rtx upscale cancelled',
])

/**
 * Distinguish an ordinary user cancellation from an export failure whose
 * diagnostics happen to contain the word "cancelled" (including a retained
 * output path). Keep this exact so cleanup failures are never hidden.
 */
export const isCleanExportCancellation = (value) => {
  const message = typeof value === 'string' ? value : value?.message
  const normalized = String(message || '')
    .trim()
    .replace(/[.!]+$/g, '')
    .toLowerCase()
  return CLEAN_EXPORT_CANCELLATION_MESSAGES.has(normalized)
}

export const createExportWorkerJobId = () => {
  const token = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `export-${token}`
}

/** Only the UI job that installed a completion record may consume an event. */
export const isMatchingExportWorkerEvent = (expectedJobId, metadata) => (
  typeof expectedJobId === 'string'
  && expectedJobId.length > 0
  && metadata?.jobId === expectedJobId
)

/**
 * Events for another worker remain externally observable, but never own or
 * settle the active UI export promise.
 */
export const classifyExportWorkerEvent = (expectedJobId, metadata) => (
  isMatchingExportWorkerEvent(expectedJobId, metadata) ? 'active' : 'external'
)
