import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLOUD_CREDIT_DISPLAY_CHANGED_EVENT,
  getShowCloudCreditBalance,
  setShowCloudCreditBalance,
} from './cloudCreditDisplaySettings.js'

function installBrowserMocks(initialValue = null) {
  const values = new Map()
  if (initialValue !== null) {
    values.set('velorn-show-cloud-credit-balance', initialValue)
  }

  const events = []
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  globalThis.window = {
    dispatchEvent: (event) => events.push(event),
  }

  return { events, values }
}

test.afterEach(() => {
  delete globalThis.localStorage
  delete globalThis.window
})

test('shows the cloud credit balance by default', () => {
  installBrowserMocks()
  assert.equal(getShowCloudCreditBalance(), true)
})

test('reads a disabled preference from local storage', () => {
  installBrowserMocks('false')
  assert.equal(getShowCloudCreditBalance(), false)
})

test('persists and announces visibility changes', () => {
  const { events, values } = installBrowserMocks()

  assert.equal(setShowCloudCreditBalance(false), false)
  assert.equal(values.get('velorn-show-cloud-credit-balance'), 'false')
  assert.equal(events.length, 1)
  assert.equal(events[0].type, CLOUD_CREDIT_DISPLAY_CHANGED_EVENT)
  assert.deepEqual(events[0].detail, { show: false })
})
