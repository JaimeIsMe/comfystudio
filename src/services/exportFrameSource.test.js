import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getWebCodecsExportFallbackReason,
  WEBCODECS_EXPORT_MAX_SOURCE_DURATION_SEC,
  WEBCODECS_EXPORT_MAX_START_TIME_SEC,
} from './exportFrameSource.js'

test('keeps ordinary short sources on the fast decoder', () => {
  assert.equal(getWebCodecsExportFallbackReason({
    sourceDuration: 180,
    startTime: 30,
  }), null)
})

test('falls back for unusually long source media', () => {
  const reason = getWebCodecsExportFallbackReason({
    sourceDuration: WEBCODECS_EXPORT_MAX_SOURCE_DURATION_SEC + 1,
    startTime: 0,
  })

  assert.match(reason, /source duration/)
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
