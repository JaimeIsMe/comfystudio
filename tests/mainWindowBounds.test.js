const test = require('node:test')
const assert = require('node:assert/strict')

const {
  MIN_MAIN_WINDOW_BOUNDS,
  clampWindowBoundsToWorkArea,
  getAdaptiveMainWindowMinimum,
  sanitizeWindowBounds,
} = require('../electron/mainWindowBounds')

test('saved bounds keep the editor design minimum without requiring an 800px-tall window', () => {
  assert.deepEqual(
    sanitizeWindowBounds({ x: 10.2, y: 20.7, width: 900, height: 500 }),
    { x: 10, y: 21, width: 1200, height: 640 }
  )
  assert.equal(MIN_MAIN_WINDOW_BOUNDS.height, 640)
})

test('1366x768-class work areas can contain the restored window', () => {
  assert.deepEqual(
    clampWindowBoundsToWorkArea(
      { x: 0, y: 0, width: 1600, height: 1000 },
      { x: 0, y: 0, width: 1366, height: 728 }
    ),
    { x: 0, y: 0, width: 1366, height: 728 }
  )
})

test('scaled displays smaller than the design minimum remain usable', () => {
  const bounds = clampWindowBoundsToWorkArea(
    { x: 0, y: 0, width: 1600, height: 1000 },
    { x: 0, y: 0, width: 1093, height: 575 }
  )

  assert.deepEqual(bounds, { x: 0, y: 0, width: 1093, height: 575 })
  assert.deepEqual(getAdaptiveMainWindowMinimum(bounds), { width: 1093, height: 575 })
})

test('normal displays retain the intended minimum resize size', () => {
  assert.deepEqual(
    getAdaptiveMainWindowMinimum({ width: 1600, height: 1000 }),
    { width: 1200, height: 640 }
  )
})
