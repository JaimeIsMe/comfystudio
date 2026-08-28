const DEFAULT_MAIN_WINDOW_BOUNDS = Object.freeze({ width: 1600, height: 1000 })
const MIN_MAIN_WINDOW_BOUNDS = Object.freeze({ width: 1200, height: 640 })

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function sanitizeWindowBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null

  const x = finiteNumber(bounds.x)
  const y = finiteNumber(bounds.y)
  const width = finiteNumber(bounds.width)
  const height = finiteNumber(bounds.height)
  if ([x, y, width, height].some((value) => value === null)) return null

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(MIN_MAIN_WINDOW_BOUNDS.width, Math.round(width)),
    height: Math.max(MIN_MAIN_WINDOW_BOUNDS.height, Math.round(height)),
  }
}

function clampWindowBoundsToWorkArea(bounds, workArea) {
  if (!workArea || typeof workArea !== 'object') {
    throw new TypeError('A display work area is required.')
  }

  const width = Math.min(
    Math.max(MIN_MAIN_WINDOW_BOUNDS.width, bounds?.width || DEFAULT_MAIN_WINDOW_BOUNDS.width),
    workArea.width
  )
  const height = Math.min(
    Math.max(MIN_MAIN_WINDOW_BOUNDS.height, bounds?.height || DEFAULT_MAIN_WINDOW_BOUNDS.height),
    workArea.height
  )
  const requestedX = Number(bounds?.x)
  const requestedY = Number(bounds?.y)
  const centeredX = workArea.x + Math.round((workArea.width - width) / 2)
  const centeredY = workArea.y + Math.round((workArea.height - height) / 2)
  const x = Math.min(
    Math.max(workArea.x, Number.isFinite(requestedX) ? requestedX : centeredX),
    workArea.x + Math.max(0, workArea.width - width)
  )
  const y = Math.min(
    Math.max(workArea.y, Number.isFinite(requestedY) ? requestedY : centeredY),
    workArea.y + Math.max(0, workArea.height - height)
  )

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  }
}

function getAdaptiveMainWindowMinimum(bounds) {
  const width = finiteNumber(bounds?.width)
  const height = finiteNumber(bounds?.height)

  return {
    width: Math.min(MIN_MAIN_WINDOW_BOUNDS.width, Math.max(1, Math.round(width || MIN_MAIN_WINDOW_BOUNDS.width))),
    height: Math.min(MIN_MAIN_WINDOW_BOUNDS.height, Math.max(1, Math.round(height || MIN_MAIN_WINDOW_BOUNDS.height))),
  }
}

module.exports = {
  DEFAULT_MAIN_WINDOW_BOUNDS,
  MIN_MAIN_WINDOW_BOUNDS,
  clampWindowBoundsToWorkArea,
  getAdaptiveMainWindowMinimum,
  sanitizeWindowBounds,
}
