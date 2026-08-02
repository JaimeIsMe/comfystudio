// Pull-model tap on the preview's committed frame, for consumers like the
// video scopes. CanvasPreviewRenderer registers a getter returning its
// last-committed frame canvas and commit serial; consumers poll the getter
// and compare serials. Pull (not push) keeps the render loop free of any
// per-frame work when nothing is reading — a scopes panel that is closed
// costs the compositor exactly nothing.

let frameSource = null

export function registerPreviewFrameSource(getter) {
  frameSource = typeof getter === 'function' ? getter : null
}

export function unregisterPreviewFrameSource(getter) {
  if (frameSource === getter) frameSource = null
}

/** { canvas, serial, time } | null — canvas is LIVE (do not mutate, copy to read). */
export function getPreviewFrameSnapshot() {
  if (!frameSource) return null
  try {
    return frameSource() || null
  } catch (_) {
    return null
  }
}
