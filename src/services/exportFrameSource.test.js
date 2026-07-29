import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getWebCodecsExportFallbackReason,
  isExpectedFrameSourceReadAbort,
  needsWebCodecsSourcePreparation,
  WEBCODECS_EXPORT_MAX_SOURCE_DURATION_SEC,
  WEBCODECS_EXPORT_MAX_START_TIME_SEC,
} from './exportFrameSource.js'

test('keeps ordinary short sources on the fast decoder', () => {
  assert.equal(getWebCodecsExportFallbackReason({
    sourceDuration: 180,
    startTime: 30,
  }), null)
})

test('identifies sources that need preparation before fast decoding', () => {
  assert.equal(needsWebCodecsSourcePreparation({
    sourceDuration: WEBCODECS_EXPORT_MAX_SOURCE_DURATION_SEC + 1,
    startTime: 0,
  }), true)
  assert.equal(needsWebCodecsSourcePreparation({
    sourceDuration: 60,
    startTime: WEBCODECS_EXPORT_MAX_START_TIME_SEC + 1,
  }), true)
  assert.equal(needsWebCodecsSourcePreparation({
    sourceDuration: 60,
    startTime: 0,
  }), false)
})

test('falls back when unusually long source media could not be prepared', () => {
  const reason = getWebCodecsExportFallbackReason({
    sourceDuration: WEBCODECS_EXPORT_MAX_SOURCE_DURATION_SEC + 1,
    startTime: 0,
  })

  assert.match(reason, /source duration/)
})

test('keeps a prepared long source on the fast decoder', () => {
  assert.equal(getWebCodecsExportFallbackReason({
    sourceDuration: WEBCODECS_EXPORT_MAX_SOURCE_DURATION_SEC + 1,
    startTime: WEBCODECS_EXPORT_MAX_START_TIME_SEC + 1,
    sourcePrepared: true,
  }), null)
})

test('falls back when the clip starts deep inside its source', () => {
  const reason = getWebCodecsExportFallbackReason({
    sourceDuration: WEBCODECS_EXPORT_MAX_SOURCE_DURATION_SEC,
    startTime: WEBCODECS_EXPORT_MAX_START_TIME_SEC + 1,
  })

  assert.match(reason, /source in-point/)
})

test('does not reject boundary values or missing metadata', () => {
  assert.equal(getWebCodecsExportFallbackReason({
    sourceDuration: WEBCODECS_EXPORT_MAX_SOURCE_DURATION_SEC,
    startTime: WEBCODECS_EXPORT_MAX_START_TIME_SEC,
  }), null)
  assert.equal(getWebCodecsExportFallbackReason(), null)
})

test('ignores only intentional stream aborts after close or clip end', () => {
  const aborted = Object.assign(new Error('BodyStreamBuffer was aborted'), { name: 'AbortError' })
  assert.equal(isExpectedFrameSourceReadAbort(aborted, { pastEnd: true }), true)
  assert.equal(isExpectedFrameSourceReadAbort(aborted, { closed: true }), true)
  assert.equal(isExpectedFrameSourceReadAbort(aborted), false)
  assert.equal(isExpectedFrameSourceReadAbort(new Error('Decoder failed'), { pastEnd: true }), false)
})
