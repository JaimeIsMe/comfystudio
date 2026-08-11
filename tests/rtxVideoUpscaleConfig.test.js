import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeRtxUpscaleQuality,
  resolveRtx4kDimensions,
  resolveRtxNvencEncoder,
} from '../src/config/rtxVideoUpscaleConfig.js'

test('preserves landscape and vertical aspect ratios at a 4K long side', () => {
  assert.deepEqual(resolveRtx4kDimensions(1920, 1080), { width: 3840, height: 2160 })
  assert.deepEqual(resolveRtx4kDimensions(1080, 1920), { width: 2160, height: 3840 })
})

test('rounds unusual aspect ratios to dimensions accepted by the RTX runtime', () => {
  const result = resolveRtx4kDimensions(1000, 777)
  assert.equal(result.width, 3840)
  assert.equal(result.height % 8, 0)
})

test('falls back to high quality for unknown values', () => {
  assert.equal(normalizeRtxUpscaleQuality('low'), 'LOW')
  assert.equal(normalizeRtxUpscaleQuality('not-a-quality'), 'HIGH')
})

test('maps the selected delivery codec to the matching NVENC encoder', () => {
  assert.equal(resolveRtxNvencEncoder('h264'), 'h264_nvenc')
  assert.equal(resolveRtxNvencEncoder('h265'), 'hevc_nvenc')
  assert.equal(resolveRtxNvencEncoder('unexpected'), 'h264_nvenc')
})
