const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const HARDWARE_EXPORT_FFMPEG_SETTING_KEY = 'hardwareExportFfmpegPath'
const HARDWARE_EXPORT_FFMPEG_ENV_KEY = 'VELORN_FFMPEG_PATH'
const DEFAULT_VERSION_PROBE_TIMEOUT_MS = 5000
const MAX_PROBE_OUTPUT_BYTES = 32 * 1024

function normalizeFfmpegPath(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function validateFfmpegPath(binaryPath, options = {}) {
  const platform = options.platform || process.platform
  const fsImpl = options.fsImpl || fs
  const normalizedPath = normalizeFfmpegPath(binaryPath)

  if (!normalizedPath) {
    return { ok: false, path: '', error: 'Choose an FFmpeg executable first.' }
  }
  if (!path.isAbsolute(normalizedPath)) {
    return { ok: false, path: normalizedPath, error: 'The FFmpeg path must be absolute.' }
  }

  try {
    const stat = fsImpl.statSync(normalizedPath)
    if (!stat.isFile()) {
      return { ok: false, path: normalizedPath, error: 'The selected FFmpeg path is not a file.' }
    }
    if (platform !== 'win32') {
      fsImpl.accessSync(normalizedPath, fs.constants.X_OK)
    }
  } catch (error) {
    const reason = error?.code === 'EACCES'
      ? 'The selected FFmpeg file is not executable.'
      : 'The selected FFmpeg file could not be found or opened.'
    return { ok: false, path: normalizedPath, error: reason }
  }

  return { ok: true, path: normalizedPath, error: null }
}

function resolveHardwareExportFfmpeg(options = {}) {
  const bundledPath = normalizeFfmpegPath(options.bundledPath)
  const settingPath = normalizeFfmpegPath(options.settingPath)
  const environmentPath = normalizeFfmpegPath(options.environmentPath)
  const platform = options.platform || process.platform
  const fsImpl = options.fsImpl || fs

  const configured = environmentPath
    ? { source: 'environment', path: environmentPath }
    : settingPath
      ? { source: 'setting', path: settingPath }
      : null

  if (configured) {
    const validation = validateFfmpegPath(configured.path, { platform, fsImpl })
    if (validation.ok) {
      return {
        path: validation.path,
        source: configured.source,
        settingPath,
        environmentPath,
        warning: null,
      }
    }

    const sourceLabel = configured.source === 'environment'
      ? HARDWARE_EXPORT_FFMPEG_ENV_KEY
      : 'saved hardware-export FFmpeg path'
    return {
      path: bundledPath,
      source: 'bundled',
      settingPath,
      environmentPath,
      warning: `${sourceLabel} is invalid: ${validation.error} Velorn will use its bundled FFmpeg.`,
    }
  }

  return {
    path: bundledPath,
    source: 'bundled',
    settingPath,
    environmentPath,
    warning: null,
  }
}

function appendBoundedOutput(current, chunk) {
  const next = current + String(chunk || '')
  return next.length > MAX_PROBE_OUTPUT_BYTES
    ? next.slice(-MAX_PROBE_OUTPUT_BYTES)
    : next
}

function probeFfmpegVersion(binaryPath, options = {}) {
  const validation = validateFfmpegPath(binaryPath, options)
  if (!validation.ok) return Promise.resolve(validation)

  const spawnImpl = options.spawnImpl || spawn
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(100, Number(options.timeoutMs))
    : DEFAULT_VERSION_PROBE_TIMEOUT_MS

  return new Promise((resolve) => {
    let child
    try {
      child = spawnImpl(validation.path, ['-hide_banner', '-version'], {
        windowsHide: true,
        shell: false,
      })
    } catch (error) {
      resolve({ ok: false, path: validation.path, error: error?.message || String(error) })
      return
    }

    let output = ''
    let settled = false
    let timer = null
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ path: validation.path, ...result })
    }

    timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* process already exited */ }
      finish({ ok: false, error: 'Timed out while checking the selected FFmpeg executable.' })
    }, timeoutMs)

    child.stdout?.on('data', (data) => {
      output = appendBoundedOutput(output, data)
    })
    child.stderr?.on('data', (data) => {
      output = appendBoundedOutput(output, data)
    })
    child.on('error', (error) => {
      finish({ ok: false, error: error?.message || String(error) })
    })
    child.on('close', (code) => {
      const versionLine = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /^ffmpeg version\b/i.test(line)) || ''
      if (code === 0 && versionLine) {
        finish({ ok: true, version: versionLine, error: null })
        return
      }
      finish({
        ok: false,
        error: versionLine
          ? `FFmpeg exited with code ${code}.`
          : 'The selected file did not identify itself as FFmpeg.',
      })
    })
  })
}

function getHardwareEncoderProbeCacheKey(binaryPath, encoderName, options = {}) {
  const fsImpl = options.fsImpl || fs
  let canonicalPath = normalizeFfmpegPath(binaryPath)
  let fileSignature = ''
  try {
    canonicalPath = fsImpl.realpathSync(canonicalPath)
    const stat = fsImpl.statSync(canonicalPath)
    fileSignature = `${stat.size}:${stat.mtimeMs}`
  } catch {
    canonicalPath = path.resolve(canonicalPath || '.')
  }
  return `${canonicalPath}\u0000${fileSignature}\u0000${String(encoderName || '').trim()}`
}

function resolveHardwareExportRoute(options = {}) {
  const bundledPath = normalizeFfmpegPath(options.bundledPath)
  const selection = options.selection || {}
  const hardwareActive = options.hardwareRequested === true && options.useHardwareEncoder === true
  return {
    path: hardwareActive ? normalizeFfmpegPath(selection.path) || bundledPath : bundledPath,
    source: hardwareActive ? selection.source || 'bundled' : 'bundled',
    warning: selection.warning || null,
  }
}

module.exports = {
  DEFAULT_VERSION_PROBE_TIMEOUT_MS,
  HARDWARE_EXPORT_FFMPEG_ENV_KEY,
  HARDWARE_EXPORT_FFMPEG_SETTING_KEY,
  getHardwareEncoderProbeCacheKey,
  normalizeFfmpegPath,
  probeFfmpegVersion,
  resolveHardwareExportFfmpeg,
  resolveHardwareExportRoute,
  validateFfmpegPath,
}
