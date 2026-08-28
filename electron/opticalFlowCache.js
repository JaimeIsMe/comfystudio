const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const OPTICAL_FLOW_ENGINE = 'ffmpeg-minterpolate'
const OPTICAL_FLOW_ENGINE_VERSION = 1
const OPTICAL_FLOW_CANCELLED_MESSAGE = 'Optical-flow processing cancelled.'
const MIN_OPTICAL_FLOW_MULTIPLIER = 1
const MAX_OPTICAL_FLOW_MULTIPLIER = 4
const MIN_OPTICAL_FLOW_FPS = 1
const MAX_OPTICAL_FLOW_FPS = 240
const MAX_SOURCE_DURATION_SECONDS = 24 * 60 * 60
const MAX_OPTICAL_FLOW_FRAMES = 1000000
// CPU minterpolate is intentionally bounded for the beta. This permits about
// 32 seconds of 1080p at 120 fps, 16 seconds of 4K at 60 fps, or equivalent.
const MAX_OPTICAL_FLOW_PIXEL_FRAMES = 8_000_000_000
const ESTIMATED_H264_BYTES_PER_PIXEL_FRAME = 0.5
const MIN_FREE_DISK_RESERVE_BYTES = 512 * 1024 * 1024
const MIN_ESTIMATED_CACHE_BYTES = 64 * 1024 * 1024
const STALE_OPTICAL_FLOW_TEMP_AGE_MS = 24 * 60 * 60 * 1000
const DEFAULT_PROBE_TIMEOUT_MS = 15000
const ABORT_SETTLE_TIMEOUT_MS = 5000
const MAX_PROCESS_OUTPUT_CHARS = 32000

function makeOpticalFlowError(message, code, details = null) {
  const error = new Error(message)
  error.code = code
  if (details) error.details = details
  return error
}

function makeOpticalFlowCancellationError() {
  return makeOpticalFlowError(OPTICAL_FLOW_CANCELLED_MESSAGE, 'OPTICAL_FLOW_CANCELLED')
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw makeOpticalFlowCancellationError()
}

function appendBounded(current, chunk) {
  const next = `${current}${chunk?.toString?.() || ''}`
  return next.length > MAX_PROCESS_OUTPUT_CHARS
    ? next.slice(-MAX_PROCESS_OUTPUT_CHARS)
    : next
}

function safeNotify(callback, ...args) {
  if (typeof callback !== 'function') return
  try {
    callback(...args)
  } catch (error) {
    console.warn('[Optical Flow] Progress callback failed:', error?.message || error)
  }
}

function normalizeFiniteNumber(value, label, { min, max, exclusiveMin = false } = {}) {
  const parsed = Number(value)
  const belowMinimum = Number.isFinite(min)
    && (exclusiveMin ? parsed <= min : parsed < min)
  if (!Number.isFinite(parsed) || belowMinimum || (Number.isFinite(max) && parsed > max)) {
    const minimumText = Number.isFinite(min)
      ? `${exclusiveMin ? 'greater than' : 'at least'} ${min}`
      : 'finite'
    const maximumText = Number.isFinite(max) ? ` and no more than ${max}` : ''
    throw makeOpticalFlowError(
      `${label} must be ${minimumText}${maximumText}.`,
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  return parsed
}

function formatFilterNumber(value) {
  return Number(value.toFixed(6)).toString()
}

function parseFrameRate(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  const text = String(value || '').trim()
  if (!text || text === '0/0') return null
  const rational = text.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/)
  if (rational) {
    const numerator = Number(rational[1])
    const denominator = Number(rational[2])
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
      return null
    }
    return numerator / denominator
  }
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function resolveOpticalFlowTarget({ sourceFps, targetFps, multiplier } = {}) {
  const normalizedSourceFps = normalizeFiniteNumber(sourceFps, 'Source frame rate', {
    min: MIN_OPTICAL_FLOW_FPS,
    max: MAX_OPTICAL_FLOW_FPS,
  })
  if (targetFps !== undefined && targetFps !== null && multiplier !== undefined && multiplier !== null) {
    throw makeOpticalFlowError(
      'Choose either an optical-flow target frame rate or a multiplier, not both.',
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }

  let normalizedTargetFps
  if (targetFps !== undefined && targetFps !== null) {
    normalizedTargetFps = normalizeFiniteNumber(targetFps, 'Optical-flow target frame rate', {
      min: MIN_OPTICAL_FLOW_FPS,
      max: MAX_OPTICAL_FLOW_FPS,
    })
  } else {
    const normalizedMultiplier = normalizeFiniteNumber(
      multiplier === undefined || multiplier === null ? 2 : multiplier,
      'Optical-flow multiplier',
      { min: MIN_OPTICAL_FLOW_MULTIPLIER, max: MAX_OPTICAL_FLOW_MULTIPLIER, exclusiveMin: true }
    )
    normalizedTargetFps = normalizedSourceFps * normalizedMultiplier
  }

  const resolvedMultiplier = normalizedTargetFps / normalizedSourceFps
  if (normalizedTargetFps <= normalizedSourceFps + 0.000001) {
    throw makeOpticalFlowError(
      'Optical-flow target frame rate must be higher than the source frame rate.',
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  if (normalizedTargetFps > MAX_OPTICAL_FLOW_FPS + 0.000001) {
    throw makeOpticalFlowError(
      `Optical-flow target frame rate cannot exceed ${MAX_OPTICAL_FLOW_FPS} fps.`,
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  if (resolvedMultiplier > MAX_OPTICAL_FLOW_MULTIPLIER + 0.000001) {
    throw makeOpticalFlowError(
      `Optical-flow interpolation cannot exceed ${MAX_OPTICAL_FLOW_MULTIPLIER}x the source frame rate.`,
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }

  return {
    sourceFps: normalizedSourceFps,
    targetFps: Number(normalizedTargetFps.toFixed(6)),
    multiplier: Number(resolvedMultiplier.toFixed(6)),
  }
}

function parseFfmpegTimestamp(value) {
  const match = String(value || '').trim().match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  if (![hours, minutes, seconds].every(Number.isFinite) || minutes >= 60 || seconds >= 60) return null
  return (hours * 3600) + (minutes * 60) + seconds
}

function createFfmpegProgressParser({ jobId = null, durationSeconds = null, onProgress = () => {} } = {}) {
  const duration = Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0
    ? Number(durationSeconds)
    : null
  let buffer = ''
  let values = Object.create(null)

  const emit = (status) => {
    let processedSeconds = parseFfmpegTimestamp(values.out_time)
    if (!Number.isFinite(processedSeconds) && Number.isFinite(Number(values.out_time_us))) {
      processedSeconds = Number(values.out_time_us) / 1000000
    }
    if (!Number.isFinite(processedSeconds)) processedSeconds = 0
    const ratio = duration
      ? Math.max(0, Math.min(1, status === 'end' ? 1 : processedSeconds / duration))
      : null
    safeNotify(onProgress, {
      jobId,
      phase: 'interpolating',
      status,
      processedSeconds,
      durationSeconds: duration,
      ratio,
      progress: ratio === null ? null : ratio * 100,
      percent: ratio === null ? null : ratio * 100,
      frame: Number.isFinite(Number(values.frame)) ? Number(values.frame) : null,
      fps: Number.isFinite(Number(values.fps)) ? Number(values.fps) : null,
      speed: values.speed || null,
    })
    values = Object.create(null)
  }

  const consumeLine = (rawLine) => {
    const line = String(rawLine || '').trim()
    if (!line) return
    const separator = line.indexOf('=')
    if (separator <= 0) return
    const key = line.slice(0, separator)
    const value = line.slice(separator + 1)
    values[key] = value
    if (key === 'progress') emit(value)
  }

  return {
    push(chunk) {
      buffer += chunk?.toString?.() || ''
      const lines = buffer.split(/\r\n|\n|\r/)
      buffer = lines.pop() || ''
      for (const line of lines) consumeLine(line)
    },
    end() {
      if (buffer) consumeLine(buffer)
      buffer = ''
    },
  }
}

function normalizeSessionId(value) {
  const candidate = String(value || '').trim()
  return /^[a-zA-Z0-9._-]{1,120}$/.test(candidate) ? candidate : crypto.randomUUID()
}

function createOpticalFlowCachePaths({ outputPath, jobId, sessionId } = {}) {
  const normalizedSessionId = normalizeSessionId(jobId || sessionId)
  const extension = path.extname(outputPath)
  const stem = path.basename(outputPath, extension) || 'optical-flow'
  const directory = path.dirname(outputPath)
  const prefix = `.${stem}.velorn-optical-flow-${normalizedSessionId}`
  return {
    jobId: normalizedSessionId,
    sessionId: normalizedSessionId,
    stagedOutputPath: path.join(directory, `${prefix}.tmp.mp4`),
    backupOutputPath: path.join(directory, `${prefix}.backup${extension || '.mp4'}`),
  }
}

async function fileExists(fsPromises, filePath) {
  try {
    await fsPromises.access(filePath)
    return true
  } catch {
    return false
  }
}

async function removeOwnedFile(fsPromises, filePath) {
  try {
    await fsPromises.unlink(filePath)
    return null
  } catch (error) {
    return error?.code === 'ENOENT' ? null : error
  }
}

async function cleanupStaleOpticalFlowTemps({
  cacheRoot,
  nowMs = Date.now(),
  maxAgeMs = STALE_OPTICAL_FLOW_TEMP_AGE_MS,
  fsPromises = fs.promises,
} = {}) {
  if (!cacheRoot || typeof cacheRoot !== 'string' || !path.isAbsolute(cacheRoot)) {
    throw makeOpticalFlowError(
      'Stale Optical Flow cleanup requires an absolute cache root.',
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  const normalizedNow = normalizeFiniteNumber(nowMs, 'Stale-cache cleanup time', { min: 0 })
  const normalizedMaxAge = normalizeFiniteNumber(maxAgeMs, 'Stale-cache maximum age', {
    min: 0,
    exclusiveMin: true,
  })
  const result = {
    cacheRoot,
    removedCount: 0,
    removedNames: [],
    errors: [],
  }

  let entries
  try {
    entries = await fsPromises.readdir(cacheRoot, { withFileTypes: true })
  } catch (error) {
    result.errors.push(error?.message || String(error))
    return result
  }

  for (const entry of entries) {
    const name = String(entry?.name || '')
    if (!name.includes('.velorn-optical-flow-') || !name.endsWith('.tmp.mp4')) continue
    // Never follow links and never recurse. lstat below independently verifies
    // the entry in case a filesystem does not provide reliable Dirent types.
    if (entry?.isSymbolicLink?.()) continue
    const candidatePath = path.join(cacheRoot, name)
    let stat
    try {
      stat = await fsPromises.lstat(candidatePath)
    } catch (error) {
      if (error?.code !== 'ENOENT') result.errors.push(`${name}: ${error?.message || error}`)
      continue
    }
    if (!stat.isFile?.() || stat.isSymbolicLink?.()) continue
    const mtimeMs = Number(stat.mtimeMs)
    if (!Number.isFinite(mtimeMs) || normalizedNow - mtimeMs <= normalizedMaxAge) continue
    try {
      await fsPromises.unlink(candidatePath)
      result.removedCount += 1
      result.removedNames.push(name)
    } catch (error) {
      if (error?.code !== 'ENOENT') result.errors.push(`${name}: ${error?.message || error}`)
    }
  }
  return result
}

function normalizedPathForComparison(filePath, platform = process.platform) {
  const resolved = path.resolve(filePath)
  return platform === 'win32' ? resolved.toLowerCase() : resolved
}

async function validateReadableFile(filePath, label, {
  fsPromises = fs.promises,
  executable = false,
  platform = process.platform,
} = {}) {
  if (!filePath || typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw makeOpticalFlowError(`${label} must be an absolute desktop path.`, 'OPTICAL_FLOW_INVALID_INPUT')
  }
  let stat
  try {
    stat = await fsPromises.stat(filePath)
    if (!stat.isFile()) throw new Error('not a file')
    const accessMode = executable && platform !== 'win32'
      ? fs.constants.R_OK | fs.constants.X_OK
      : fs.constants.R_OK
    await fsPromises.access(filePath, accessMode)
  } catch (error) {
    const reason = error?.code === 'EACCES'
      ? 'is not readable or executable'
      : 'could not be found or opened as a file'
    throw makeOpticalFlowError(`${label} ${reason}.`, 'OPTICAL_FLOW_INVALID_INPUT')
  }
  return stat
}

async function validateOpticalFlowPaths({
  ffmpegPath,
  ffprobePath,
  inputPath,
  outputPath,
  allowedOutputRoot = null,
  fsPromises = fs.promises,
  platform = process.platform,
} = {}) {
  await validateReadableFile(ffmpegPath, 'FFmpeg', { fsPromises, executable: true, platform })
  await validateReadableFile(ffprobePath, 'FFprobe', { fsPromises, executable: true, platform })
  const inputStat = await validateReadableFile(inputPath, 'Optical-flow source', { fsPromises, platform })
  if (inputStat.size <= 0) {
    throw makeOpticalFlowError('Optical-flow source is empty.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  if (!outputPath || typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) {
    throw makeOpticalFlowError('Optical-flow cache destination must be an absolute desktop path.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  if (path.extname(outputPath).toLowerCase() !== '.mp4') {
    throw makeOpticalFlowError('Optical-flow cache destination must use the .mp4 extension.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  if (normalizedPathForComparison(inputPath, platform) === normalizedPathForComparison(outputPath, platform)) {
    throw makeOpticalFlowError('Optical-flow cache destination cannot replace its source.', 'OPTICAL_FLOW_INVALID_INPUT')
  }

  const outputDirectory = path.dirname(outputPath)
  if (allowedOutputRoot !== null && allowedOutputRoot !== undefined) {
    if (typeof allowedOutputRoot !== 'string' || !path.isAbsolute(allowedOutputRoot)) {
      throw makeOpticalFlowError(
        'Optical-flow allowed cache root must be an absolute path.',
        'OPTICAL_FLOW_INVALID_INPUT'
      )
    }
    // Reject lexical escapes before mkdir so an untrusted IPC payload cannot
    // create directories outside the project cache as a side effect.
    const lexicalRelative = path.relative(path.resolve(allowedOutputRoot), path.resolve(outputDirectory))
    if (lexicalRelative === '..' || lexicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(lexicalRelative)) {
      throw makeOpticalFlowError(
        'Optical-flow cache destination is outside the allowed project cache.',
        'OPTICAL_FLOW_INVALID_INPUT'
      )
    }
  }
  try {
    await fsPromises.mkdir(outputDirectory, { recursive: true })
    const directoryStat = await fsPromises.stat(outputDirectory)
    if (!directoryStat.isDirectory()) throw new Error('not a directory')
    await fsPromises.access(outputDirectory, fs.constants.W_OK)
    if (await fileExists(fsPromises, outputPath)) {
      const destinationLinkStat = await fsPromises.lstat?.(outputPath)
      if (destinationLinkStat?.isSymbolicLink?.()) throw new Error('destination cannot be a symbolic link')
      const destinationStat = await fsPromises.stat(outputPath)
      if (!destinationStat.isFile()) throw new Error('destination is not a file')
    }
    if (allowedOutputRoot !== null && allowedOutputRoot !== undefined) {
      const [canonicalRoot, canonicalDirectory] = await Promise.all([
        fsPromises.realpath(allowedOutputRoot),
        fsPromises.realpath(outputDirectory),
      ])
      const relativeDirectory = path.relative(canonicalRoot, canonicalDirectory)
      if (relativeDirectory === '..' || relativeDirectory.startsWith(`..${path.sep}`) || path.isAbsolute(relativeDirectory)) {
        throw new Error('destination is outside the allowed project cache')
      }
    }
  } catch (error) {
    throw makeOpticalFlowError(
      `Optical-flow cache destination is not writable: ${error?.message || String(error)}`,
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  return { inputStat }
}

function getFileStatSignature(stat) {
  if (!stat) return null
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]
    .map((value) => value === undefined || value === null ? '' : String(value))
    .join(':')
}

function assertSourceFileUnchanged(beforeStat, afterStat) {
  const before = getFileStatSignature(beforeStat)
  const after = getFileStatSignature(afterStat)
  if (!before || !after || before !== after) {
    throw makeOpticalFlowError(
      'The source video changed while Optical Flow was being built. Rebuild the cache.',
      'OPTICAL_FLOW_SOURCE_CHANGED'
    )
  }
}

function runProcess(binaryPath, args, {
  signal = null,
  spawnImpl = spawn,
  timeoutMs = null,
  label = 'Process',
  onStdout = null,
  onStderr = null,
  cwd = null,
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeOpticalFlowCancellationError())
      return
    }

    let child = null
    let stdout = ''
    let stderr = ''
    let settled = false
    let cancelled = false
    let timedOut = false
    let processTimer = null
    let killSettleTimer = null

    const cleanup = () => {
      if (processTimer) clearTimeout(processTimer)
      if (killSettleTimer) clearTimeout(killSettleTimer)
      signal?.removeEventListener?.('abort', onAbort)
      child?.removeListener?.('error', onError)
      child?.removeListener?.('close', onClose)
      child?.stdout?.removeListener?.('data', onStdoutData)
      child?.stderr?.removeListener?.('data', onStderrData)
    }
    const settle = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const cancellationResult = () => {
      if (cancelled || signal?.aborted) return makeOpticalFlowCancellationError()
      return makeOpticalFlowError(`${label} timed out.`, 'OPTICAL_FLOW_TIMEOUT')
    }
    const requestKill = () => {
      try { child?.kill?.('SIGKILL') } catch { /* close/error or fallback settles */ }
      if (settled) return
      killSettleTimer = setTimeout(() => settle(reject, cancellationResult()), ABORT_SETTLE_TIMEOUT_MS)
      killSettleTimer.unref?.()
    }
    const onAbort = () => {
      if (settled || cancelled) return
      cancelled = true
      requestKill()
    }
    const onStdoutData = (chunk) => {
      stdout = appendBounded(stdout, chunk)
      onStdout?.(chunk)
    }
    const onStderrData = (chunk) => {
      stderr = appendBounded(stderr, chunk)
      onStderr?.(chunk)
    }
    const onError = (error) => {
      if (cancelled || timedOut || signal?.aborted) {
        settle(reject, cancellationResult())
        return
      }
      settle(reject, makeOpticalFlowError(
        `${label} could not start: ${error?.message || String(error)}`,
        'OPTICAL_FLOW_FAILED'
      ))
    }
    const onClose = (code, terminationSignal) => {
      if (cancelled || timedOut || signal?.aborted) {
        settle(reject, cancellationResult())
        return
      }
      if (code === 0) {
        settle(resolve, { stdout, stderr })
        return
      }
      settle(reject, makeOpticalFlowError(
        stderr.trim() || stdout.trim() || (
          terminationSignal
            ? `${label} terminated with signal ${terminationSignal}.`
            : `${label} exited with code ${code}.`
        ),
        'OPTICAL_FLOW_FAILED',
        { exitCode: code, signal: terminationSignal || null }
      ))
    }

    try {
      const spawnOptions = {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
      if (typeof cwd === 'string' && cwd) spawnOptions.cwd = cwd
      child = spawnImpl(binaryPath, args, spawnOptions)
    } catch (error) {
      settle(reject, makeOpticalFlowError(
        `${label} could not start: ${error?.message || String(error)}`,
        'OPTICAL_FLOW_FAILED'
      ))
      return
    }

    child.stdout?.on?.('data', onStdoutData)
    child.stderr?.on?.('data', onStderrData)
    child.once?.('error', onError)
    child.once?.('close', onClose)
    signal?.addEventListener?.('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    if (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0) {
      processTimer = setTimeout(() => {
        if (settled || timedOut) return
        timedOut = true
        requestKill()
      }, Number(timeoutMs))
      processTimer.unref?.()
    }
  })
}

async function probeMinterpolateSupport({
  ffmpegPath,
  signal = null,
  spawnImpl = spawn,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
} = {}) {
  throwIfCancelled(signal)
  const result = await runProcess(ffmpegPath, ['-hide_banner', '-filters'], {
    signal,
    spawnImpl,
    timeoutMs,
    label: 'FFmpeg filter check',
  })
  const listing = `${result.stdout}\n${result.stderr}`
  return {
    available: /(?:^|\s)minterpolate(?:\s|$)/m.test(listing),
    engine: OPTICAL_FLOW_ENGINE,
  }
}

async function probeVideoMetadata({
  ffprobePath,
  inputPath,
  signal = null,
  spawnImpl = spawn,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  countPackets = false,
} = {}) {
  throwIfCancelled(signal)
  const args = [
    '-v', 'error',
  ]
  if (countPackets) args.push('-count_packets')
  args.push(
    '-show_entries', 'stream=index,codec_type,codec_name,width,height,start_time,avg_frame_rate,r_frame_rate,duration,pix_fmt,nb_read_packets,bits_per_raw_sample,color_range,color_transfer,color_primaries,color_space:stream_tags=rotate,alpha_mode:stream_side_data=rotation:format=start_time,duration,format_name',
    '-of', 'json',
    inputPath,
  )
  const result = await runProcess(ffprobePath, args, {
    signal,
    spawnImpl,
    timeoutMs,
    label: 'Optical-flow media probe',
  })

  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    throw makeOpticalFlowError('FFprobe returned invalid media metadata.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : []
  const video = streams.find((stream) => stream?.codec_type === 'video')
  if (!video) {
    throw makeOpticalFlowError('Optical-flow source does not contain a video stream.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  const width = Number(video.width)
  const height = Number(video.height)
  const streamDuration = Number(video.duration)
  const formatDuration = Number(parsed?.format?.duration)
  const streamStartTime = Number(video.start_time)
  const formatStartTime = Number(parsed?.format?.start_time)
  const startTime = Number.isFinite(streamStartTime)
    ? streamStartTime
    : Number.isFinite(formatStartTime) ? formatStartTime : 0
  const duration = Number.isFinite(streamDuration) && streamDuration > 0
    ? streamDuration
    : Number.isFinite(formatDuration) && formatDuration > 0
      ? Math.max(0, formatDuration - Math.max(0, startTime))
      : null
  const avgFrameRate = parseFrameRate(video.avg_frame_rate)
  const realFrameRate = parseFrameRate(video.r_frame_rate)
  const fps = avgFrameRate || realFrameRate
  const variableFrameRate = Boolean(
    avgFrameRate
    && realFrameRate
    && Math.abs(avgFrameRate - realFrameRate) / Math.max(avgFrameRate, realFrameRate) > 0.0015
  )
  const sideDataRotation = Array.isArray(video.side_data_list)
    ? video.side_data_list.map((entry) => Number(entry?.rotation)).find(Number.isFinite)
    : null
  const tagRotation = Number(video?.tags?.rotate)
  const rotation = Number.isFinite(sideDataRotation)
    ? sideDataRotation
    : Number.isFinite(tagRotation) ? tagRotation : 0
  const normalizedRotation = ((Math.round(rotation) % 360) + 360) % 360
  const swapsDisplayDimensions = normalizedRotation === 90 || normalizedRotation === 270
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw makeOpticalFlowError('Optical-flow source has invalid video dimensions.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SOURCE_DURATION_SECONDS) {
    throw makeOpticalFlowError('Optical-flow source has an invalid or unsupported duration.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  if (!Number.isFinite(fps) || fps < MIN_OPTICAL_FLOW_FPS || fps > MAX_OPTICAL_FLOW_FPS) {
    throw makeOpticalFlowError('Optical-flow source has an invalid or unsupported frame rate.', 'OPTICAL_FLOW_INVALID_INPUT')
  }

  return {
    codec: video.codec_name || null,
    pixelFormat: video.pix_fmt || null,
    bitsPerRawSample: Number.isFinite(Number(video.bits_per_raw_sample))
      ? Number(video.bits_per_raw_sample)
      : null,
    colorRange: video.color_range || null,
    colorTransfer: video.color_transfer || null,
    colorPrimaries: video.color_primaries || null,
    colorSpace: video.color_space || null,
    width,
    height,
    displayWidth: swapsDisplayDimensions ? height : width,
    displayHeight: swapsDisplayDimensions ? width : height,
    rotation: normalizedRotation,
    alphaMode: video?.tags?.alpha_mode === undefined ? null : String(video.tags.alpha_mode),
    startTime,
    durationSeconds: duration,
    fps,
    avgFrameRate,
    realFrameRate,
    variableFrameRate,
    frameCount: Number.isFinite(Number(video.nb_read_packets)) && Number(video.nb_read_packets) > 0
      ? Number(video.nb_read_packets)
      : null,
    hasAudio: streams.some((stream) => stream?.codec_type === 'audio'),
    formatName: parsed?.format?.format_name || null,
  }
}

function getPixelFormatBitDepth(pixelFormat) {
  const format = String(pixelFormat || '').toLowerCase()
  const explicitDepth = format.match(/(\d{1,3})(?:le|be)$/)?.[1]
  if (explicitDepth) return Number(explicitDepth)
  return 8
}

function pixelFormatHasAlpha(pixelFormat) {
  return /^(?:yuva|gbrap|rgba|bgra|argb|abgr|ya|ayuv|pal8)/i.test(String(pixelFormat || ''))
}

const SAFE_COLOR_SPACES = new Set([
  'bt709',
  'fcc',
  'bt470bg',
  'smpte170m',
  'smpte240m',
  'bt2020nc',
  'bt2020c',
])
const SAFE_COLOR_PRIMARIES = new Set([
  'bt709',
  'bt470m',
  'bt470bg',
  'smpte170m',
  'smpte240m',
  'film',
  'bt2020',
  'smpte431',
  'smpte432',
  'jedec-p22',
])
const SAFE_COLOR_TRANSFERS = new Set([
  'bt709',
  'bt470m',
  'bt470bg',
  'smpte170m',
  'smpte240m',
  'linear',
  'iec61966-2-1',
  'bt2020-10',
  'bt2020-12',
])
const SCALE_COLOR_MATRIX_BY_SPACE = Object.freeze({
  bt709: 'bt709',
  fcc: 'fcc',
  bt470bg: 'bt470',
  smpte170m: 'smpte170m',
  smpte240m: 'smpte240m',
  bt2020nc: 'bt2020',
  bt2020c: 'bt2020',
})

function safeColorTag(value, allowed) {
  const normalized = String(value || '').trim().toLowerCase()
  return allowed.has(normalized) ? normalized : null
}

function normalizeColorRange(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (['pc', 'full', 'jpeg'].includes(normalized)) return 'full'
  if (['tv', 'limited', 'mpeg'].includes(normalized)) return 'limited'
  return 'unspecified'
}

function normalizeOpticalFlowColorConfig(config = {}) {
  const requestedInputRange = String(config.inputRange || '').toLowerCase()
  const inputRange = requestedInputRange === 'full' || requestedInputRange === 'limited'
    ? requestedInputRange
    : 'unspecified'
  const colorSpace = safeColorTag(config.colorSpace, SAFE_COLOR_SPACES)
  return {
    sourceRange: config.sourceRange || null,
    inputRange,
    outputRange: inputRange === 'unspecified' ? null : 'tv',
    convertsFullRange: inputRange === 'full',
    colorSpace,
    colorPrimaries: safeColorTag(config.colorPrimaries, SAFE_COLOR_PRIMARIES),
    colorTransfer: safeColorTag(config.colorTransfer, SAFE_COLOR_TRANSFERS),
    scaleColorMatrix: colorSpace ? SCALE_COLOR_MATRIX_BY_SPACE[colorSpace] || null : null,
  }
}

function resolveOpticalFlowColorConfig(source = {}) {
  const range = String(source.colorRange || '').trim().toLowerCase()
  const pixelFormat = String(source.pixelFormat || '').trim().toLowerCase()
  const inputRange = normalizeColorRange(range) === 'full' || pixelFormat.startsWith('yuvj')
    ? 'full'
    : normalizeColorRange(range)
  return normalizeOpticalFlowColorConfig({
    sourceRange: range || null,
    inputRange,
    colorSpace: source.colorSpace,
    colorPrimaries: source.colorPrimaries,
    colorTransfer: source.colorTransfer,
  })
}

function buildOpticalFlowColorPipeline(config = {}) {
  const color = normalizeOpticalFlowColorConfig(config)
  const preFilters = []
  if (color.convertsFullRange) {
    let scale = 'scale=iw:ih:flags=accurate_rnd+full_chroma_int:in_range=full:out_range=limited'
    if (color.scaleColorMatrix) {
      scale += `:in_color_matrix=${color.scaleColorMatrix}:out_color_matrix=${color.scaleColorMatrix}`
    }
    preFilters.push(scale)
  }

  const setParams = []
  if (color.outputRange === 'tv') setParams.push('range=limited')
  if (color.colorPrimaries) setParams.push(`color_primaries=${color.colorPrimaries}`)
  if (color.colorTransfer) setParams.push(`color_trc=${color.colorTransfer}`)
  if (color.colorSpace) setParams.push(`colorspace=${color.colorSpace}`)
  const postFilters = setParams.length > 0 ? [`setparams=${setParams.join(':')}`] : []

  const outputArgs = []
  if (color.outputRange === 'tv') outputArgs.push('-color_range', 'tv')
  if (color.colorSpace) outputArgs.push('-colorspace', color.colorSpace)
  if (color.colorPrimaries) outputArgs.push('-color_primaries', color.colorPrimaries)
  if (color.colorTransfer) outputArgs.push('-color_trc', color.colorTransfer)
  return { color, preFilters, postFilters, outputArgs }
}

function validateOpticalFlowSourceCompatibility(source) {
  const bitDepth = source?.bitsPerRawSample || getPixelFormatBitDepth(source?.pixelFormat)
  if (pixelFormatHasAlpha(source?.pixelFormat) || String(source?.alphaMode || '') === '1') {
    throw makeOpticalFlowError(
      'Optical Flow (Beta) does not yet support video with transparency.',
      'OPTICAL_FLOW_UNSUPPORTED_SOURCE',
      {
        reason: 'alpha',
        pixelFormat: source?.pixelFormat || null,
        alphaMode: source?.alphaMode || null,
      }
    )
  }
  if (Number(bitDepth) > 8) {
    throw makeOpticalFlowError(
      'Optical Flow (Beta) currently supports 8-bit SDR video only.',
      'OPTICAL_FLOW_UNSUPPORTED_SOURCE',
      { reason: 'bit-depth', bitDepth, pixelFormat: source?.pixelFormat || null }
    )
  }
  const transfer = String(source?.colorTransfer || '').toLowerCase()
  if (transfer === 'smpte2084' || transfer === 'arib-std-b67') {
    throw makeOpticalFlowError(
      'Optical Flow (Beta) does not yet support HDR video.',
      'OPTICAL_FLOW_UNSUPPORTED_SOURCE',
      { reason: 'hdr', colorTransfer: source?.colorTransfer || null }
    )
  }
  if (source?.variableFrameRate) {
    throw makeOpticalFlowError(
      'Optical Flow (Beta) currently supports constant-frame-rate video only.',
      'OPTICAL_FLOW_UNSUPPORTED_SOURCE',
      { reason: 'variable-frame-rate', avgFrameRate: source.avgFrameRate, realFrameRate: source.realFrameRate }
    )
  }
  if (Math.abs(Number(source?.startTime) || 0) > 0.001) {
    throw makeOpticalFlowError(
      'Optical Flow (Beta) does not yet support video with a nonzero media start time.',
      'OPTICAL_FLOW_UNSUPPORTED_SOURCE',
      { reason: 'nonzero-start-time', startTime: Number(source.startTime) }
    )
  }
  return true
}

function resolveOpticalFlowWindow({
  sourceStart,
  sourceEnd,
  expectedDuration,
  sourceDuration,
  sourceFps,
  targetFps,
  maxFrames,
} = {}) {
  const start = normalizeFiniteNumber(sourceStart, 'Optical-flow source start', {
    min: 0,
    max: MAX_SOURCE_DURATION_SECONDS,
  })
  const end = normalizeFiniteNumber(sourceEnd, 'Optical-flow source end', {
    min: 0,
    max: MAX_SOURCE_DURATION_SECONDS,
    exclusiveMin: true,
  })
  if (end <= start) {
    throw makeOpticalFlowError(
      'Optical-flow source end must be after its source start.',
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  const requestedDuration = end - start
  const expected = normalizeFiniteNumber(expectedDuration, 'Optical-flow expected duration', {
    min: 0,
    max: MAX_SOURCE_DURATION_SECONDS,
    exclusiveMin: true,
  })
  if (Math.abs(expected - requestedDuration) > 0.002) {
    throw makeOpticalFlowError(
      'Optical-flow expected duration must match sourceEnd - sourceStart.',
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  const normalizedSourceDuration = normalizeFiniteNumber(sourceDuration, 'Optical-flow source duration', {
    min: 0,
    max: MAX_SOURCE_DURATION_SECONDS,
    exclusiveMin: true,
  })
  const normalizedSourceFps = normalizeFiniteNumber(sourceFps, 'Source frame rate', {
    min: MIN_OPTICAL_FLOW_FPS,
    max: MAX_OPTICAL_FLOW_FPS,
  })
  const endTolerance = Math.max(0.01, 1 / normalizedSourceFps)
  if (start >= normalizedSourceDuration + endTolerance || end > normalizedSourceDuration + endTolerance) {
    throw makeOpticalFlowError(
      'Optical-flow source window extends beyond the available video.',
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  const normalizedMaxFrames = normalizeFiniteNumber(maxFrames, 'Optical-flow frame limit', {
    min: 1,
    max: MAX_OPTICAL_FLOW_FRAMES,
  })
  if (!Number.isInteger(normalizedMaxFrames)) {
    throw makeOpticalFlowError('Optical-flow frame limit must be a whole number.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  // A compressed video can only begin on a decoded source frame. Expanding
  // the range to CFR boundaries preserves the frame active at an in-between
  // trim point; callers must store these returned source bounds for remapping.
  const boundaryEpsilon = 0.000001
  const actualStart = Math.max(
    0,
    Math.floor((start * normalizedSourceFps) + boundaryEpsilon) / normalizedSourceFps
  )
  const actualEnd = Math.min(
    normalizedSourceDuration,
    Math.ceil((end * normalizedSourceFps) - boundaryEpsilon) / normalizedSourceFps
  )
  if (actualEnd <= actualStart) {
    throw makeOpticalFlowError(
      'Optical-flow source window does not contain a complete source frame.',
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  const duration = actualEnd - actualStart
  const expectedFrameCount = Math.max(1, Math.round(duration * targetFps))
  if (expectedFrameCount > normalizedMaxFrames) {
    throw makeOpticalFlowError(
      `Optical-flow cache would contain about ${expectedFrameCount} frames, above the ${normalizedMaxFrames} frame limit.`,
      'OPTICAL_FLOW_RESOURCE_LIMIT',
      { expectedFrameCount, maxFrames: normalizedMaxFrames }
    )
  }
  return {
    requestedSourceStart: start,
    requestedSourceEnd: end,
    sourceStart: actualStart,
    sourceEnd: actualEnd,
    durationSeconds: duration,
    expectedDuration: expected,
    expectedFrameCount,
    maxFrames: normalizedMaxFrames,
  }
}

function validateOpticalFlowResourceBudget({
  displayWidth,
  displayHeight,
  expectedFrameCount,
  maxPixelFrames = MAX_OPTICAL_FLOW_PIXEL_FRAMES,
} = {}) {
  const width = normalizeFiniteNumber(displayWidth, 'Optical-flow display width', {
    min: 1,
    max: 100000,
  })
  const height = normalizeFiniteNumber(displayHeight, 'Optical-flow display height', {
    min: 1,
    max: 100000,
  })
  const frames = normalizeFiniteNumber(expectedFrameCount, 'Optical-flow estimated frame count', {
    min: 1,
    max: MAX_OPTICAL_FLOW_FRAMES,
  })
  const limit = normalizeFiniteNumber(maxPixelFrames, 'Optical-flow pixel-frame limit', {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  })
  if (![width, height, frames].every(Number.isInteger)) {
    throw makeOpticalFlowError(
      'Optical-flow dimensions and estimated frame count must be whole numbers.',
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  const pixelFrameCount = width * height * frames
  if (!Number.isSafeInteger(pixelFrameCount) || pixelFrameCount > limit) {
    const estimatedText = Number.isFinite(pixelFrameCount)
      ? pixelFrameCount.toLocaleString('en-US')
      : 'an unsafe number of'
    throw makeOpticalFlowError(
      `Optical-flow cache would process ${width}×${height} across about ${frames.toLocaleString('en-US')} frames `
      + `(${estimatedText} pixel-frames), above the ${limit.toLocaleString('en-US')} beta limit. `
      + 'Trim the clip, lower its resolution, or use Frame Blend.',
      'OPTICAL_FLOW_RESOURCE_LIMIT',
      {
        displayWidth: width,
        displayHeight: height,
        expectedFrameCount: frames,
        pixelFrameCount,
        maxPixelFrames: limit,
      }
    )
  }
  return {
    displayWidth: width,
    displayHeight: height,
    expectedFrameCount: frames,
    pixelFrameCount,
    maxPixelFrames: limit,
  }
}

function formatGibibytes(bytes) {
  return `${(Number(bytes) / (1024 ** 3)).toFixed(1)} GB`
}

async function checkOpticalFlowDiskSpace({
  outputPath,
  pixelFrameCount,
  fsPromises = fs.promises,
} = {}) {
  const estimatedCacheBytes = Math.max(
    MIN_ESTIMATED_CACHE_BYTES,
    Math.ceil(Number(pixelFrameCount) * ESTIMATED_H264_BYTES_PER_PIXEL_FRAME)
  )
  const requiredFreeBytes = estimatedCacheBytes + MIN_FREE_DISK_RESERVE_BYTES
  if (typeof fsPromises?.statfs !== 'function') {
    return {
      checked: false,
      estimatedCacheBytes,
      requiredFreeBytes,
      freeBytes: null,
      reason: 'statfs-unavailable',
    }
  }

  let filesystem
  try {
    filesystem = await fsPromises.statfs(path.dirname(outputPath))
  } catch (error) {
    return {
      checked: false,
      estimatedCacheBytes,
      requiredFreeBytes,
      freeBytes: null,
      reason: error?.code || 'statfs-failed',
    }
  }
  const availableBlocks = filesystem?.bavail ?? filesystem?.bfree
  const blockSize = filesystem?.bsize
  let freeBytesBigInt
  try {
    freeBytesBigInt = BigInt(availableBlocks) * BigInt(blockSize)
  } catch {
    return {
      checked: false,
      estimatedCacheBytes,
      requiredFreeBytes,
      freeBytes: null,
      reason: 'invalid-statfs-result',
    }
  }
  const requiredFreeBytesBigInt = BigInt(requiredFreeBytes)
  const freeBytes = freeBytesBigInt > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(freeBytesBigInt)
  if (freeBytesBigInt < requiredFreeBytesBigInt) {
    throw makeOpticalFlowError(
      `Optical Flow needs about ${formatGibibytes(requiredFreeBytes)} free for this cache, `
      + `but only ${formatGibibytes(freeBytes)} is available. Free disk space or use Frame Blend.`,
      'OPTICAL_FLOW_INSUFFICIENT_DISK_SPACE',
      { freeBytes, estimatedCacheBytes, requiredFreeBytes }
    )
  }
  return {
    checked: true,
    estimatedCacheBytes,
    requiredFreeBytes,
    freeBytes,
    reason: null,
  }
}

function buildOpticalFlowArgs({
  inputPath,
  stagedOutputPath,
  sourceStart,
  sourceEnd,
  sourceFps,
  targetFps,
  colorConfig = {},
} = {}) {
  const start = normalizeFiniteNumber(sourceStart, 'Optical-flow source start', {
    min: 0,
    max: MAX_SOURCE_DURATION_SECONDS,
  })
  const end = normalizeFiniteNumber(sourceEnd, 'Optical-flow source end', {
    min: 0,
    max: MAX_SOURCE_DURATION_SECONDS,
    exclusiveMin: true,
  })
  if (end <= start) {
    throw makeOpticalFlowError(
      'Optical-flow source end must be after its source start.',
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  const duration = end - start
  const target = resolveOpticalFlowTarget({ sourceFps, targetFps })
  const sourceStartText = formatFilterNumber(start)
  const durationText = formatFilterNumber(duration)
  const targetFpsText = formatFilterNumber(target.targetFps)
  const colorPipeline = buildOpticalFlowColorPipeline(colorConfig)
  // minterpolate buffers future frames. Normalize PTS first, clone four input
  // frames at the end, then remove the padding. This preserves a nonzero
  // source-window start and prevents FFmpeg from dropping the cache tail.
  const filter = [
    'setpts=PTS-STARTPTS',
    ...colorPipeline.preFilters,
    'tpad=stop_mode=clone:stop=4',
    `minterpolate=fps=${targetFpsText}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:me=epzs:vsbmc=1:scd=fdiff:scd_threshold=10`,
    `trim=duration=${durationText}`,
    'setpts=PTS-STARTPTS',
    'pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:color=black',
    'format=yuv420p',
    ...colorPipeline.postFilters,
  ].join(',')

  return [
    '-y',
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-progress', 'pipe:2',
    '-stats_period', '0.25',
    '-ss', sourceStartText,
    '-t', durationText,
    '-i', inputPath,
    '-map', '0:v:0',
    '-vf', filter,
    '-an',
    '-sn',
    '-dn',
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    ...colorPipeline.outputArgs,
    '-r', targetFpsText,
    '-fps_mode', 'cfr',
    '-t', durationText,
    '-movflags', '+faststart',
    '-f', 'mp4',
    stagedOutputPath,
  ]
}

function validateGeneratedMetadata({
  source,
  generated,
  targetFps,
  expectedDuration,
  expectedFrameCount,
  expectedColor = {},
}) {
  if (!generated || generated.codec !== 'h264') {
    throw makeOpticalFlowError('Optical-flow cache validation did not find an H.264 video.', 'OPTICAL_FLOW_OUTPUT_INVALID')
  }
  if (generated.hasAudio) {
    throw makeOpticalFlowError('Optical-flow cache unexpectedly contains audio.', 'OPTICAL_FLOW_OUTPUT_INVALID')
  }
  if (Math.abs(Number(generated.startTime) || 0) > 0.001) {
    throw makeOpticalFlowError('Optical-flow cache does not start at time zero.', 'OPTICAL_FLOW_OUTPUT_INVALID')
  }
  const expectedWidth = Math.ceil((source.displayWidth || source.width) / 2) * 2
  const expectedHeight = Math.ceil((source.displayHeight || source.height) / 2) * 2
  if (generated.width !== expectedWidth || generated.height !== expectedHeight) {
    throw makeOpticalFlowError('Optical-flow cache dimensions do not match the source.', 'OPTICAL_FLOW_OUTPUT_INVALID')
  }
  if (Math.abs(generated.fps - targetFps) > 0.05) {
    throw makeOpticalFlowError('Optical-flow cache frame rate does not match its target.', 'OPTICAL_FLOW_OUTPUT_INVALID')
  }
  const durationTolerance = Math.max(0.01, 1.1 / targetFps)
  if (Math.abs(generated.durationSeconds - expectedDuration) > durationTolerance) {
    throw makeOpticalFlowError('Optical-flow cache duration does not match its source window.', 'OPTICAL_FLOW_OUTPUT_INVALID')
  }
  if (!Number.isInteger(generated.frameCount) || generated.frameCount <= 0) {
    throw makeOpticalFlowError('Optical-flow cache frame count could not be verified.', 'OPTICAL_FLOW_OUTPUT_INVALID')
  }
  if (Math.abs(generated.frameCount - expectedFrameCount) > 1) {
    throw makeOpticalFlowError(
      `Optical-flow cache contains ${generated.frameCount} frames; expected about ${expectedFrameCount}.`,
      'OPTICAL_FLOW_OUTPUT_INVALID'
    )
  }
  const color = normalizeOpticalFlowColorConfig(expectedColor)
  if (color.outputRange === 'tv' && normalizeColorRange(generated.colorRange) !== 'limited') {
    throw makeOpticalFlowError(
      'Optical-flow cache color range was not normalized to limited range.',
      'OPTICAL_FLOW_OUTPUT_INVALID'
    )
  }
  const expectedTags = [
    ['colorSpace', color.colorSpace, 'colorspace'],
    ['colorPrimaries', color.colorPrimaries, 'color primaries'],
    ['colorTransfer', color.colorTransfer, 'color transfer'],
  ]
  for (const [property, expected, label] of expectedTags) {
    if (!expected) continue
    if (String(generated[property] || '').toLowerCase() !== expected) {
      throw makeOpticalFlowError(
        `Optical-flow cache did not preserve its ${label} metadata.`,
        'OPTICAL_FLOW_OUTPUT_INVALID',
        { property, expected, actual: generated[property] || null }
      )
    }
  }
}

async function finalizeOpticalFlowOutput({
  fsPromises,
  stagedOutputPath,
  outputPath,
  backupOutputPath,
  signal,
}) {
  throwIfCancelled(signal)
  let movedExistingOutput = false
  if (await fileExists(fsPromises, outputPath)) {
    await fsPromises.rename(outputPath, backupOutputPath)
    movedExistingOutput = true
  }

  try {
    // The staged file is complete and verified. Treat the same-directory
    // rename as the commit point; cancellation after it must not restore stale
    // cache data over a valid new derivative.
    await fsPromises.rename(stagedOutputPath, outputPath)
  } catch (error) {
    if (movedExistingOutput) {
      try {
        await fsPromises.rename(backupOutputPath, outputPath)
        movedExistingOutput = false
      } catch (restoreError) {
        const wrapped = makeOpticalFlowError(
          `${error?.message || 'Could not finalize optical-flow cache.'} `
          + `The previous destination remains recoverable at ${backupOutputPath}: `
          + `${restoreError?.message || String(restoreError)}`,
          'OPTICAL_FLOW_RECOVERY_REQUIRED'
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
    ? `The optical-flow cache was saved, but its temporary backup could not be removed: ${cleanupError.message || cleanupError}`
    : null
}

async function createOpticalFlowCache(options = {}) {
  const {
    ffmpegPath,
    ffprobePath,
    inputPath,
    outputPath,
    sourceStart,
    sourceEnd,
    expectedDuration,
    targetFps = null,
    multiplier = null,
    maxFrames,
    jobId,
    signal = null,
    onPhase = () => {},
    onProgress = () => {},
    spawnImpl = spawn,
    fsPromises = fs.promises,
    platform = process.platform,
    allowedOutputRoot = null,
    probeSupportImpl = probeMinterpolateSupport,
    probeMetadataImpl = probeVideoMetadata,
  } = options

  safeNotify(onPhase, 'validating')
  throwIfCancelled(signal)
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(String(jobId || '').trim())) {
    throw makeOpticalFlowError(
      'Optical-flow job id must contain only letters, numbers, periods, underscores, or hyphens.',
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  const pathValidation = await validateOpticalFlowPaths({
    ffmpegPath,
    ffprobePath,
    inputPath,
    outputPath,
    allowedOutputRoot,
    fsPromises,
    platform,
  })

  let staleTempCleanup = null
  if (allowedOutputRoot) {
    safeNotify(onPhase, 'cleaning-stale-cache')
    staleTempCleanup = await cleanupStaleOpticalFlowTemps({
      cacheRoot: allowedOutputRoot,
      fsPromises,
    })
  }

  const paths = createOpticalFlowCachePaths({ outputPath, jobId })
  let preserveBackupForRecovery = false
  let cleanupWarning = null
  await removeOwnedFile(fsPromises, paths.stagedOutputPath)
  if (await fileExists(fsPromises, paths.backupOutputPath)) {
    throw makeOpticalFlowError(
      `A previous optical-flow cache backup still exists at ${paths.backupOutputPath}. Restore or move it before retrying.`,
      'OPTICAL_FLOW_RECOVERY_REQUIRED'
    )
  }

  try {
    safeNotify(onPhase, 'checking-support')
    const support = await probeSupportImpl({ ffmpegPath, signal, spawnImpl })
    if (!support?.available) {
      throw makeOpticalFlowError(
        'This FFmpeg build does not include the minterpolate optical-flow filter.',
        'OPTICAL_FLOW_UNAVAILABLE'
      )
    }

    throwIfCancelled(signal)
    safeNotify(onPhase, 'probing-source')
    const source = await probeMetadataImpl({ ffprobePath, inputPath, signal, spawnImpl })
    validateOpticalFlowSourceCompatibility(source)
    const color = resolveOpticalFlowColorConfig(source)
    const target = resolveOpticalFlowTarget({ sourceFps: source.fps, targetFps, multiplier })
    const window = resolveOpticalFlowWindow({
      sourceStart,
      sourceEnd,
      expectedDuration,
      sourceDuration: source.durationSeconds,
      sourceFps: source.fps,
      targetFps: target.targetFps,
      maxFrames,
    })
    const resourceBudget = validateOpticalFlowResourceBudget({
      displayWidth: source.displayWidth || source.width,
      displayHeight: source.displayHeight || source.height,
      expectedFrameCount: window.expectedFrameCount,
    })
    safeNotify(onPhase, 'checking-disk-space')
    const diskSpace = await checkOpticalFlowDiskSpace({
      outputPath,
      pixelFrameCount: resourceBudget.pixelFrameCount,
      fsPromises,
    })

    throwIfCancelled(signal)
    safeNotify(onPhase, 'interpolating', { ...target, ...window })
    safeNotify(onProgress, {
      jobId: paths.jobId,
      phase: 'interpolating',
      status: 'start',
      processedSeconds: 0,
      durationSeconds: window.durationSeconds,
      ratio: 0,
      progress: 0,
      percent: 0,
      frame: 0,
      fps: null,
      speed: null,
    })
    const progressParser = createFfmpegProgressParser({
      jobId: paths.jobId,
      durationSeconds: window.durationSeconds,
      onProgress,
    })
    try {
      await runProcess(ffmpegPath, buildOpticalFlowArgs({
        inputPath,
        stagedOutputPath: paths.stagedOutputPath,
        sourceStart: window.sourceStart,
        sourceEnd: window.sourceEnd,
        sourceFps: source.fps,
        targetFps: target.targetFps,
        colorConfig: color,
      }), {
        signal,
        spawnImpl,
        label: 'Optical-flow interpolation',
        onStderr: (chunk) => progressParser.push(chunk),
      })
    } finally {
      progressParser.end()
    }

    throwIfCancelled(signal)
    const stagedStat = await fsPromises.stat(paths.stagedOutputPath).catch(() => null)
    if (!stagedStat?.isFile?.() || stagedStat.size <= 0) {
      throw makeOpticalFlowError('FFmpeg did not produce a valid optical-flow cache file.', 'OPTICAL_FLOW_OUTPUT_INVALID')
    }

    safeNotify(onPhase, 'verifying')
    const generated = await probeMetadataImpl({
      ffprobePath,
      inputPath: paths.stagedOutputPath,
      signal,
      spawnImpl,
      countPackets: true,
    })
    validateGeneratedMetadata({
      source,
      generated,
      targetFps: target.targetFps,
      expectedDuration: window.durationSeconds,
      expectedFrameCount: window.expectedFrameCount,
      expectedColor: color,
    })
    const finalSourceStat = await validateReadableFile(inputPath, 'Optical-flow source', {
      fsPromises,
      platform,
    })
    assertSourceFileUnchanged(pathValidation.inputStat, finalSourceStat)

    throwIfCancelled(signal)
    safeNotify(onPhase, 'finalizing')
    cleanupWarning = await finalizeOpticalFlowOutput({
      fsPromises,
      stagedOutputPath: paths.stagedOutputPath,
      outputPath,
      backupOutputPath: paths.backupOutputPath,
      signal,
    })
    safeNotify(onPhase, 'complete')

    return {
      outputPath,
      engine: OPTICAL_FLOW_ENGINE,
      engineVersion: OPTICAL_FLOW_ENGINE_VERSION,
      jobId: paths.jobId,
      source,
      generated,
      sourceStart: window.sourceStart,
      sourceEnd: window.sourceEnd,
      sourceFps: target.sourceFps,
      targetFps: target.targetFps,
      multiplier: target.multiplier,
      durationSeconds: window.durationSeconds,
      expectedFrameCount: window.expectedFrameCount,
      frameCount: generated.frameCount,
      maxFrames: window.maxFrames,
      resourceBudget,
      diskSpace,
      color,
      staleTempCleanup,
      cleanupWarning,
    }
  } catch (error) {
    preserveBackupForRecovery = Boolean(error?.recoveryPath)
    throw error
  } finally {
    const cleanupTargets = [paths.stagedOutputPath]
    if (!preserveBackupForRecovery) cleanupTargets.push(paths.backupOutputPath)
    for (const cleanupPath of cleanupTargets) {
      const cleanupError = await removeOwnedFile(fsPromises, cleanupPath)
      if (cleanupError) {
        console.warn(`[Optical Flow] Could not remove ${cleanupPath}: ${cleanupError.message || cleanupError}`)
      }
    }
  }
}

module.exports = {
  DEFAULT_PROBE_TIMEOUT_MS,
  ESTIMATED_H264_BYTES_PER_PIXEL_FRAME,
  MAX_OPTICAL_FLOW_PIXEL_FRAMES,
  MAX_OPTICAL_FLOW_FRAMES,
  MAX_OPTICAL_FLOW_FPS,
  MAX_OPTICAL_FLOW_MULTIPLIER,
  MIN_OPTICAL_FLOW_FPS,
  MIN_OPTICAL_FLOW_MULTIPLIER,
  MIN_FREE_DISK_RESERVE_BYTES,
  STALE_OPTICAL_FLOW_TEMP_AGE_MS,
  OPTICAL_FLOW_CANCELLED_MESSAGE,
  OPTICAL_FLOW_ENGINE,
  OPTICAL_FLOW_ENGINE_VERSION,
  buildOpticalFlowArgs,
  buildOpticalFlowColorPipeline,
  checkOpticalFlowDiskSpace,
  cleanupStaleOpticalFlowTemps,
  createFfmpegProgressParser,
  createOpticalFlowCache,
  createOpticalFlowCachePaths,
  finalizeOpticalFlowOutput,
  getFileStatSignature,
  getPixelFormatBitDepth,
  makeOpticalFlowCancellationError,
  parseFfmpegTimestamp,
  parseFrameRate,
  probeMinterpolateSupport,
  probeVideoMetadata,
  pixelFormatHasAlpha,
  normalizeColorRange,
  normalizeOpticalFlowColorConfig,
  resolveOpticalFlowColorConfig,
  resolveOpticalFlowTarget,
  resolveOpticalFlowWindow,
  runProcess,
  assertSourceFileUnchanged,
  validateGeneratedMetadata,
  validateOpticalFlowResourceBudget,
  validateOpticalFlowSourceCompatibility,
  validateOpticalFlowPaths,
}
