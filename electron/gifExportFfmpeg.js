const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const GIF_ENCODER_NAME = 'gif-palette'
const GIF_PALETTE_FILTER = 'palettegen=max_colors=256:stats_mode=diff:reserve_transparent=0'
const GIF_DITHER_FILTER = 'paletteuse=dither=sierra2_4a:diff_mode=rectangle'
const GIF_CANCELLED_MESSAGE = 'Export cancelled'
const MAX_STDERR_CHARS = 24000

const appendLimitedStderr = (current, data) => {
  const next = `${current}${data?.toString?.() || ''}`
  return next.length > MAX_STDERR_CHARS ? next.slice(-MAX_STDERR_CHARS) : next
}

const makeCancellationError = () => {
  const error = new Error(GIF_CANCELLED_MESSAGE)
  error.code = 'EXPORT_CANCELLED'
  return error
}

const throwIfCancelled = (signal) => {
  if (signal?.aborted) throw makeCancellationError()
}

const normalizeGifFps = (value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 240) {
    throw new Error('GIF frame rate must be greater than 0 and no more than 240 fps.')
  }
  return String(parsed)
}

const normalizeSessionId = (value) => {
  const candidate = String(value || '').trim()
  if (/^[a-zA-Z0-9._-]{1,120}$/.test(candidate)) return candidate
  return crypto.randomUUID()
}

function buildGifPaletteArgs({ framePattern, fps, palettePath }) {
  return [
    '-y',
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-framerate', normalizeGifFps(fps),
    '-start_number', '1',
    '-i', framePattern,
    '-vf', GIF_PALETTE_FILTER,
    '-frames:v', '1',
    '-update', '1',
    palettePath,
  ]
}

function buildGifEncodeArgs({ framePattern, fps, palettePath, stagedOutputPath }) {
  return [
    '-y',
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-framerate', normalizeGifFps(fps),
    '-start_number', '1',
    '-i', framePattern,
    '-i', palettePath,
    '-filter_complex', `[0:v][1:v]${GIF_DITHER_FILTER}`,
    '-an',
    '-loop', '0',
    '-gifflags', '+offsetting+transdiff',
    '-f', 'gif',
    stagedOutputPath,
  ]
}

function createGifExportPaths({ framePattern, outputPath, sessionId }) {
  const normalizedSessionId = normalizeSessionId(sessionId)
  const outputDirectory = path.dirname(outputPath)
  const outputExtension = path.extname(outputPath)
  const outputStem = path.basename(outputPath, outputExtension) || 'export'
  const scratchPrefix = `.${outputStem}.velorn-gif-${normalizedSessionId}`

  return {
    sessionId: normalizedSessionId,
    palettePath: path.join(path.dirname(framePattern), `.velorn-gif-${normalizedSessionId}-palette.png`),
    stagedOutputPath: path.join(outputDirectory, `${scratchPrefix}.tmp.gif`),
    backupOutputPath: path.join(outputDirectory, `${scratchPrefix}.backup${outputExtension || '.gif'}`),
  }
}

const fileExists = async (fsPromises, filePath) => {
  try {
    await fsPromises.access(filePath)
    return true
  } catch {
    return false
  }
}

const removeOwnedFile = async (fsPromises, filePath) => {
  try {
    await fsPromises.unlink(filePath)
    return null
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    return error
  }
}

const runFfmpeg = ({
  ffmpegPath,
  args,
  signal,
  label,
  spawnImpl = spawn,
  abortTimeoutMs = 5000,
}) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(makeCancellationError())
    return
  }

  let child
  let stderr = ''
  let settled = false
  let cancelled = false
  let abortTimer = null

  const cleanup = () => {
    if (abortTimer) clearTimeout(abortTimer)
    signal?.removeEventListener?.('abort', onAbort)
    child?.stderr?.removeListener?.('data', onStderr)
    child?.removeListener?.('error', onError)
    child?.removeListener?.('close', onClose)
  }
  const settle = (callback, value) => {
    if (settled) return
    settled = true
    cleanup()
    callback(value)
  }
  const onStderr = (data) => {
    stderr = appendLimitedStderr(stderr, data)
  }
  const onError = (error) => {
    if (cancelled || signal?.aborted) {
      settle(reject, makeCancellationError())
      return
    }
    settle(reject, new Error(`${label} could not start: ${error?.message || String(error)}`))
  }
  const onClose = (code) => {
    if (cancelled || signal?.aborted) {
      settle(reject, makeCancellationError())
      return
    }
    if (code === 0) {
      settle(resolve, { stderr })
      return
    }
    settle(reject, new Error(stderr.trim() || `${label} exited with code ${code}`))
  }
  const onAbort = () => {
    if (settled || cancelled) return
    cancelled = true
    try {
      child?.kill?.('SIGKILL')
    } catch {
      // The close/error listener or bounded timeout below settles the job.
    }
    abortTimer = setTimeout(() => settle(reject, makeCancellationError()), abortTimeoutMs)
    abortTimer.unref?.()
  }

  try {
    child = spawnImpl(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  } catch (error) {
    settle(reject, new Error(`${label} could not start: ${error?.message || String(error)}`))
    return
  }

  child.stderr?.on?.('data', onStderr)
  child.once?.('error', onError)
  child.once?.('close', onClose)
  signal?.addEventListener?.('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
})

const finalizeGifOutput = async ({
  fsPromises,
  stagedOutputPath,
  outputPath,
  backupOutputPath,
  signal,
}) => {
  throwIfCancelled(signal)
  let movedExistingOutput = false

  if (await fileExists(fsPromises, outputPath)) {
    await fsPromises.rename(outputPath, backupOutputPath)
    movedExistingOutput = true
  }

  try {
    // Once a complete staged GIF reaches this same-directory rename, it is
    // the committed result. A cancellation arriving after this point should
    // not roll a valid delivery back to a stale file.
    await fsPromises.rename(stagedOutputPath, outputPath)
  } catch (error) {
    if (movedExistingOutput) {
      try {
        await fsPromises.rename(backupOutputPath, outputPath)
        movedExistingOutput = false
      } catch (restoreError) {
        const wrapped = new Error(
          `${error?.message || 'Could not finalize GIF output.'} `
          + `The previous destination could not be restored automatically; it remains at ${backupOutputPath}: `
          + `${restoreError?.message || String(restoreError)}`
        )
        wrapped.recoveryPath = backupOutputPath
        throw wrapped
      }
    }
    throw error
  }

  if (!movedExistingOutput) return null
  const cleanupError = await removeOwnedFile(fsPromises, backupOutputPath)
  return cleanupError
    ? `The GIF was saved, but its temporary backup could not be removed: ${cleanupError.message || cleanupError}`
    : null
}

async function encodeGifFromPngSequence(options = {}) {
  const {
    ffmpegPath,
    framePattern,
    fps,
    outputPath,
    sessionId,
    signal = null,
    onPhase = () => {},
    spawnImpl = spawn,
    fsPromises = fs.promises,
  } = options

  if (!ffmpegPath || !framePattern || !outputPath) {
    throw new Error('Missing GIF export inputs.')
  }
  if (!path.isAbsolute(framePattern) || !path.isAbsolute(outputPath)) {
    throw new Error('GIF export paths must be absolute desktop paths.')
  }
  normalizeGifFps(fps)
  throwIfCancelled(signal)

  const paths = createGifExportPaths({ framePattern, outputPath, sessionId })
  let preserveBackupForRecovery = false
  let cleanupWarning = null

  // These names contain a unique session token and are owned exclusively by
  // this export. Clearing them first also makes a retried IPC id deterministic.
  await removeOwnedFile(fsPromises, paths.palettePath)
  await removeOwnedFile(fsPromises, paths.stagedOutputPath)
  // A backup is the recovery copy of a pre-existing user destination. Never
  // delete one speculatively, even when a caller accidentally reuses a job
  // id after a failed finalization.
  if (await fileExists(fsPromises, paths.backupOutputPath)) {
    throw new Error(`A previous GIF export backup still exists at ${paths.backupOutputPath}. Restore or move it before retrying.`)
  }

  try {
    onPhase('palette')
    await runFfmpeg({
      ffmpegPath,
      args: buildGifPaletteArgs({ framePattern, fps, palettePath: paths.palettePath }),
      signal,
      label: 'GIF palette generation',
      spawnImpl,
    })

    throwIfCancelled(signal)
    onPhase('encode')
    await runFfmpeg({
      ffmpegPath,
      args: buildGifEncodeArgs({
        framePattern,
        fps,
        palettePath: paths.palettePath,
        stagedOutputPath: paths.stagedOutputPath,
      }),
      signal,
      label: 'GIF encoding',
      spawnImpl,
    })

    throwIfCancelled(signal)
    onPhase('finalize')
    cleanupWarning = await finalizeGifOutput({
      fsPromises,
      stagedOutputPath: paths.stagedOutputPath,
      outputPath,
      backupOutputPath: paths.backupOutputPath,
      signal,
    })

    return {
      outputPath,
      encoderUsed: GIF_ENCODER_NAME,
      cleanupWarning,
    }
  } catch (error) {
    preserveBackupForRecovery = Boolean(error?.recoveryPath)
    throw error
  } finally {
    const cleanupTargets = [paths.palettePath, paths.stagedOutputPath]
    if (!preserveBackupForRecovery) cleanupTargets.push(paths.backupOutputPath)
    for (const cleanupPath of cleanupTargets) {
      const cleanupError = await removeOwnedFile(fsPromises, cleanupPath)
      if (cleanupError) {
        console.warn(`[GIF Export] Could not remove ${cleanupPath}: ${cleanupError.message || cleanupError}`)
      }
    }
  }
}

module.exports = {
  GIF_CANCELLED_MESSAGE,
  GIF_DITHER_FILTER,
  GIF_ENCODER_NAME,
  GIF_PALETTE_FILTER,
  buildGifEncodeArgs,
  buildGifPaletteArgs,
  createGifExportPaths,
  encodeGifFromPngSequence,
  makeCancellationError,
  normalizeGifFps,
  runFfmpeg,
}
