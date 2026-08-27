import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DISCOVER_TAB_VISIBILITY_CHANGED_EVENT,
  getShowDiscoverTab,
  hydrateShowDiscoverTab,
  setShowDiscoverTab,
} from './discoverTabVisibilitySettings.mjs'

function installBrowserMocks({
  localValue = null,
  electronValue = null,
  electronReadError = null,
  getSettingImpl = null,
} = {}) {
  const values = new Map()
  if (localValue !== null) values.set('velorn-show-discover-tab', localValue)

  const events = []
  const electronWrites = []
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  globalThis.window = {
    electronAPI: {
      getSetting: async () => {
        if (getSettingImpl) return getSettingImpl()
        if (electronReadError) throw electronReadError
        return electronValue
      },
      setSetting: async (key, value) => {
        electronWrites.push({ key, value })
        return { success: true }
      },
    },
    dispatchEvent: (event) => events.push(event),
  }

  return { electronWrites, events, values }
}

test.afterEach(() => {
  delete globalThis.localStorage
  delete globalThis.window
})

test('shows Discover by default', () => {
  installBrowserMocks()
  assert.equal(getShowDiscoverTab(), true)
})

test('reads a hidden preference from local storage', () => {
  installBrowserMocks({ localValue: 'false' })
  assert.equal(getShowDiscoverTab(), false)
})

test('hydrates from the Electron setting and mirrors it locally', async () => {
  const { values } = installBrowserMocks({ localValue: 'true', electronValue: false })

  assert.equal(await hydrateShowDiscoverTab(), false)
  assert.equal(values.get('velorn-show-discover-tab'), 'false')
})

test('falls back to local storage when Electron settings cannot be read', async () => {
  installBrowserMocks({ localValue: 'false', electronReadError: new Error('unavailable') })
  assert.equal(await hydrateShowDiscoverTab(), false)
})

test('persists and announces visibility changes', async () => {
  const { electronWrites, events, values } = installBrowserMocks()

  assert.equal(await setShowDiscoverTab(false), false)
  assert.equal(values.get('velorn-show-discover-tab'), 'false')
  assert.deepEqual(electronWrites, [{ key: 'showDiscoverTab', value: false }])
  assert.equal(events.length, 1)
  assert.equal(events[0].type, DISCOVER_TAB_VISIBILITY_CHANGED_EVENT)
  assert.deepEqual(events[0].detail, { show: false })
})

test('a late hydration cannot overwrite a newer user choice', async () => {
  let resolveRead
  const delayedRead = new Promise((resolve) => { resolveRead = resolve })
  const { values } = installBrowserMocks({
    localValue: 'true',
    getSettingImpl: () => delayedRead,
  })

  const hydration = hydrateShowDiscoverTab()
  await Promise.resolve()
  await setShowDiscoverTab(false)
  resolveRead(true)

  assert.equal(await hydration, false)
  assert.equal(values.get('velorn-show-discover-tab'), 'false')
})
