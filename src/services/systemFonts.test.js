import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CURATED_FONT_FAMILIES,
  getSystemFontCatalogSnapshot,
  loadSystemFontFamilies,
  mergeFontFamilies,
  resolveFontFamilySelection,
  resetSystemFontCacheForTests,
  subscribeSystemFontCatalog,
} from './systemFonts.js'

test.afterEach(() => {
  resetSystemFontCacheForTests()
})

test('merges curated, installed, and project font names without case-insensitive duplicates', () => {
  const families = mergeFontFamilies(
    ['Inter', 'Arial'],
    ['arial', 'Noto Sans'],
    'Project Custom Font'
  )
  assert.deepEqual(families, ['Inter', 'Arial', 'Noto Sans', 'Project Custom Font'])
})

test('resolves legacy casing without rewriting missing project font names', () => {
  const families = ['Arial', 'Inter', 'Noto Sans']
  assert.equal(resolveFontFamilySelection(families, 'arial'), 'Arial')
  assert.equal(resolveFontFamilySelection(families, 'Project Custom Font'), 'Project Custom Font')
})

test('shares one renderer request and publishes loading and ready states', async () => {
  let calls = 0
  let resolveRequest
  const fontApi = {
    getSystemFonts: async () => {
      calls += 1
      return new Promise((resolve) => {
        resolveRequest = resolve
      })
    },
  }
  const states = []
  const unsubscribe = subscribeSystemFontCatalog((catalog) => states.push(catalog.status))

  const first = loadSystemFontFamilies({ fontApi })
  const second = loadSystemFontFamilies({ fontApi })
  assert.equal(calls, 1)
  assert.equal(getSystemFontCatalogSnapshot().status, 'loading')

  resolveRequest({ success: true, fonts: ['Noto Sans', 'Inter'], source: 'test' })
  const [firstCatalog, secondCatalog] = await Promise.all([first, second])
  unsubscribe()

  assert.equal(firstCatalog.status, 'ready')
  assert.deepEqual(secondCatalog, firstCatalog)
  assert.deepEqual(firstCatalog.families, [...CURATED_FONT_FAMILIES, 'Noto Sans'])
  assert.deepEqual(states, ['loading', 'ready'])
})

test('keeps curated fonts usable after failure and force-refreshes explicitly', async () => {
  const refreshArguments = []
  const fontApi = {
    getSystemFonts: async (forceRefresh) => {
      refreshArguments.push(forceRefresh)
      if (!forceRefresh) return { success: false, fonts: [], error: 'unavailable' }
      return { success: true, fonts: ['Recovered Sans'], source: 'test' }
    },
  }

  const failed = await loadSystemFontFamilies({ fontApi })
  assert.equal(failed.status, 'error')
  assert.deepEqual(failed.families, [...CURATED_FONT_FAMILIES])

  await loadSystemFontFamilies({ fontApi })
  assert.deepEqual(refreshArguments, [false])

  const retried = await loadSystemFontFamilies({ fontApi, forceRefresh: true })
  assert.equal(retried.status, 'ready')
  assert.ok(retried.families.includes('Recovered Sans'))
  assert.deepEqual(refreshArguments, [false, true])
})
