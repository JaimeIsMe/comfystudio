const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')

const bundledFfmpegPath = require('ffmpeg-static')
const {
  HARDWARE_EXPORT_FFMPEG_ENV_KEY,
  getHardwareEncoderProbeCacheKey,
  probeFfmpegVersion,
  resolveHardwareExportFfmpeg,
  resolveHardwareExportRoute,
  validateFfmpegPath,
} = require('../electron/hardwareExportFfmpeg')

test('uses the bundled FFmpeg when no override is configured', () => {
  const result = resolveHardwareExportFfmpeg({ bundledPath: bundledFfmpegPath })
  assert.equal(result.path, bundledFfmpegPath)
  assert.equal(result.source, 'bundled')
  assert.equal(result.warning, null)
})

test('uses a valid saved path for hardware export', () => {
  const result = resolveHardwareExportFfmpeg({
    bundledPath: process.execPath,
    settingPath: bundledFfmpegPath,
  })
  assert.equal(result.path, bundledFfmpegPath)
  assert.equal(result.source, 'setting')
  assert.equal(result.warning, null)
})

test('gives the environment override priority over the saved path', () => {
  const result = resolveHardwareExportFfmpeg({
    bundledPath: bundledFfmpegPath,
    settingPath: bundledFfmpegPath,
    environmentPath: process.execPath,
  })
  assert.equal(result.path, process.execPath)
  assert.equal(result.source, 'environment')
})

test('falls back to bundled FFmpeg and warns when the selected override is invalid', () => {
  const result = resolveHardwareExportFfmpeg({
    bundledPath: bundledFfmpegPath,
    settingPath: 'relative/ffmpeg',
  })
  assert.equal(result.path, bundledFfmpegPath)
  assert.equal(result.source, 'bundled')
  assert.match(result.warning, /saved hardware-export FFmpeg path is invalid/i)
  assert.match(result.warning, /must be absolute/i)
})

test('an invalid environment override does not silently select the saved path', () => {
  const result = resolveHardwareExportFfmpeg({
    bundledPath: bundledFfmpegPath,
    settingPath: bundledFfmpegPath,
    environmentPath: path.join(os.tmpdir(), 'velorn-missing-ffmpeg'),
  })
  assert.equal(result.path, bundledFfmpegPath)
  assert.equal(result.source, 'bundled')
  assert.match(result.warning, new RegExp(HARDWARE_EXPORT_FFMPEG_ENV_KEY))
})

test('rejects directories and missing paths', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-ffmpeg-path-'))
  try {
    const directoryResult = validateFfmpegPath(directory)
    assert.equal(directoryResult.ok, false)
    assert.match(directoryResult.error, /not a file/i)

    const missingResult = validateFfmpegPath(path.join(directory, 'missing-ffmpeg'))
    assert.equal(missingResult.ok, false)
    assert.match(missingResult.error, /could not be found or opened/i)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('rejects a non-executable file on Unix platforms', { skip: process.platform === 'win32' }, async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-ffmpeg-permission-'))
  const filePath = path.join(directory, 'ffmpeg')
  try {
    await fsp.writeFile(filePath, '#!/bin/sh\nexit 0\n', { mode: 0o644 })
    const result = validateFfmpegPath(filePath)
    assert.equal(result.ok, false)
    assert.match(result.error, /not executable/i)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('validates a real FFmpeg executable and reports its version', async () => {
  const result = await probeFfmpegVersion(bundledFfmpegPath)
  assert.equal(result.ok, true)
  assert.match(result.version, /^ffmpeg version\b/i)
})

test('rejects an executable that is not FFmpeg', async () => {
  const result = await probeFfmpegVersion(process.execPath)
  assert.equal(result.ok, false)
  assert.match(result.error, /did not identify itself as FFmpeg|exited with code/i)
})

test('bounds a hung FFmpeg version check with a timeout', async () => {
  const spawnImpl = () => {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    return child
  }

  const startedAt = Date.now()
  const result = await probeFfmpegVersion(bundledFfmpegPath, { spawnImpl, timeoutMs: 100 })
  assert.equal(result.ok, false)
  assert.match(result.error, /timed out/i)
  assert.ok(Date.now() - startedAt < 1000)
})

test('hardware-probe cache keys include the encoder and binary file signature', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-ffmpeg-cache-'))
  const filePath = path.join(directory, 'ffmpeg')
  try {
    await fsp.writeFile(filePath, 'one')
    const h264Key = getHardwareEncoderProbeCacheKey(filePath, 'h264_nvenc')
    const h265Key = getHardwareEncoderProbeCacheKey(filePath, 'hevc_nvenc')
    assert.notEqual(h264Key, h265Key)

    await new Promise((resolve) => setTimeout(resolve, 10))
    await fsp.appendFile(filePath, 'two')
    const replacedKey = getHardwareEncoderProbeCacheKey(filePath, 'h264_nvenc')
    assert.notEqual(replacedKey, h264Key)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('routes a verified hardware export through the selected custom binary', () => {
  const route = resolveHardwareExportRoute({
    hardwareRequested: true,
    useHardwareEncoder: true,
    selection: { path: '/opt/ffmpeg-nvenc', source: 'setting', warning: null },
    bundledPath: '',
  })
  assert.deepEqual(route, {
    path: '/opt/ffmpeg-nvenc',
    source: 'setting',
    warning: null,
  })
})

test('routes a hardware-probe downgrade through bundled FFmpeg', () => {
  const route = resolveHardwareExportRoute({
    hardwareRequested: true,
    useHardwareEncoder: false,
    selection: { path: '/opt/ffmpeg-without-working-nvenc', source: 'setting', warning: null },
    bundledPath: bundledFfmpegPath,
  })
  assert.equal(route.path, bundledFfmpegPath)
  assert.equal(route.source, 'bundled')
})
