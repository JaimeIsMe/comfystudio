import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assetHasAlpha,
  canUseOpaqueVideoDerivative,
  normalizeTransparentExportSettings,
  shouldUseWebCodecsForAsset,
  supportsTransparentExport,
} from './alphaMedia.mjs'

test('recognizes only explicitly flagged alpha assets', () => {
  const alphaAsset = { settings: { hasAlpha: true } }
  assert.equal(assetHasAlpha(alphaAsset), true)
  assert.equal(assetHasAlpha({ settings: { hasAlpha: false } }), false)
  assert.equal(shouldUseWebCodecsForAsset(alphaAsset), false)
  assert.equal(shouldUseWebCodecsForAsset({}), true)
})

test('supports transparent WebM and ProRes 4444 delivery', () => {
  assert.equal(supportsTransparentExport({ format: 'webm' }), true)
  assert.equal(supportsTransparentExport({ format: 'prores', proresProfile: '4' }), true)
  assert.equal(supportsTransparentExport({ format: 'prores', proresProfile: '3' }), false)
  assert.equal(supportsTransparentExport({ format: 'png-seq' }), false)
  assert.equal(supportsTransparentExport({ format: 'mp4' }), false)
})

test('normalizes alpha delivery without changing ordinary exports', () => {
  assert.deepEqual(normalizeTransparentExportSettings({ format: 'mp4', transparent: false }), {
    format: 'mp4',
    transparent: false,
  })
  assert.deepEqual(normalizeTransparentExportSettings({
    format: 'prores',
    proresProfile: '3',
    transparent: true,
    useHardwareEncoder: true,
    postProcessUpscale: 'rtx-4k',
  }), {
    format: 'prores',
    proresProfile: '4',
    transparent: true,
    useHardwareEncoder: false,
    postProcessUpscale: 'none',
  })
  assert.equal(normalizeTransparentExportSettings({ format: 'mp4', transparent: true }).transparent, false)
})

test('never permits opaque derivatives for alpha masters', () => {
  assert.equal(canUseOpaqueVideoDerivative({}), true)
  assert.equal(canUseOpaqueVideoDerivative({ settings: { hasAlpha: true } }), false)
})
