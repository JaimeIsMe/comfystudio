const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const {
  DEFAULT_PROBE_TIMEOUT_MS,
  MAX_OPTICAL_FLOW_FRAMES,
  MAX_OPTICAL_FLOW_PIXEL_FRAMES,
  assertSourceFileUnchanged,
  buildOpticalFlowColorPipeline,
  createOpticalFlowCachePaths,
  finalizeOpticalFlowOutput,
  probeVideoMetadata,
  resolveOpticalFlowColorConfig,
  resolveOpticalFlowTarget,
  resolveOpticalFlowWindow,
  runProcess,
  validateGeneratedMetadata,
  validateOpticalFlowPaths,
  validateOpticalFlowResourceBudget,
  validateOpticalFlowSourceCompatibility,
} = require('./opticalFlowCache')

const RIFE_ENGINE = 'rife-ncnn-vulkan'
const RIFE_ENGINE_VERSION = '20221029'
const RIFE_SECURE_BUILD_MARKER = 'Velorn secure build: PNG input and output only; WebP is disabled.'
// Omitting -g lets pinned ncnn prefer a discrete Vulkan GPU before falling
// back to an integrated device. Vulkan device 0 is not guaranteed to be the
// high-performance adapter on multi-GPU laptops and workstations.
const DEFAULT_RIFE_GPU_ID = null
const DEFAULT_RIFE_THREADS = '2:4:2'
const DEFAULT_SCENE_CUT_THRESHOLD = 0.25
const RIFE_WORK_MARKER = '.velorn-rife-'
const RIFE_WORK_SUFFIX = '.work'
const STALE_RIFE_WORK_AGE_MS = 24 * 60 * 60 * 1000
const MIN_FREE_DISK_RESERVE_BYTES = 512 * 1024 * 1024
const PNG_BYTES_PER_PIXEL_ESTIMATE = 3.1
const MAX_PROCESS_OUTPUT_CHARS = 32000

function makeRifeError(message, code, details = null) {
  const error = new Error(message)
  error.code = code
  if (details) error.details = details
  return error
}

function makeCancellationError() {
  return makeRifeError('Optical-flow processing cancelled.', 'OPTICAL_FLOW_CANCELLED')
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw makeCancellationError()
}

function safeNotify(callback, ...args) {
  if (typeof callback !== 'function') return
  try {
    callback(...args)
  } catch (error) {
    console.warn('[Optical Flow / RIFE] Callback failed:', error?.message || error)
  }
}

function formatNumber(value) {
  return Number(Number(value).toFixed(6)).toString()
}

function normalizeJobId(value) {
  const jobId = String(value || '').trim()
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(jobId)) {
    throw makeRifeError(
      'Optical-flow job id must contain only letters, numbers, periods, underscores, or hyphens.',
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  return jobId
}

function normalizeGpuId(value = DEFAULT_RIFE_GPU_ID) {
  if (value === null || value === undefined) return null
  const gpuId = Number(value)
  if (!Number.isInteger(gpuId) || gpuId < 0 || gpuId > 31) {
    throw makeRifeError('RIFE GPU id must be a whole number from 0 through 31.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  return gpuId
}

function normalizeRifeThreads(value = DEFAULT_RIFE_THREADS) {
  const text = String(value || '').trim()
  const match = text.match(/^(\d+):(\d+):(\d+)$/)
  if (!match || match.slice(1).some((part) => Number(part) < 1 || Number(part) > 64)) {
    throw makeRifeError(
      'RIFE worker threads must use load:process:save counts from 1 through 64.',
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  return text
}

function normalizeSceneCutThreshold(value = DEFAULT_SCENE_CUT_THRESHOLD) {
  const threshold = Number(value)
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw makeRifeError('Scene-cut threshold must be greater than 0 and no more than 1.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  return threshold
}

function isContainedPath(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath))
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  )
}

function createRifeWorkPaths({ outputPath, jobId } = {}) {
  const normalizedJobId = normalizeJobId(jobId)
  if (!outputPath || typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) {
    throw makeRifeError('Optical-flow cache destination must be an absolute desktop path.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  const extension = path.extname(outputPath)
  const stem = path.basename(outputPath, extension) || 'optical-flow'
  const outputDirectory = path.dirname(outputPath)
  const workRoot = path.join(
    outputDirectory,
    `.${stem}${RIFE_WORK_MARKER}${normalizedJobId}${RIFE_WORK_SUFFIX}`
  )
  return {
    ...createOpticalFlowCachePaths({ outputPath, jobId: normalizedJobId }),
    workRoot,
    inputFramesPath: path.join(workRoot, 'input'),
    outputFramesPath: path.join(workRoot, 'output'),
    inputFramePattern: path.join(workRoot, 'input', '%08d.png'),
    outputFramePattern: path.join(workRoot, 'output', '%08d.png'),
  }
}

async function validateReadableFile(filePath, label, {
  fsPromises = fs.promises,
  executable = false,
  platform = process.platform,
} = {}) {
  if (!filePath || typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw makeRifeError(`${label} must be an absolute desktop path.`, 'OPTICAL_FLOW_UNAVAILABLE')
  }
  try {
    const stat = await fsPromises.stat(filePath)
    if (!stat.isFile() || stat.size <= 0) throw new Error('not a nonempty file')
    const accessMode = executable && platform !== 'win32'
      ? fs.constants.R_OK | fs.constants.X_OK
      : fs.constants.R_OK
    await fsPromises.access(filePath, accessMode)
    return stat
  } catch (error) {
    throw makeRifeError(
      `${label} could not be found or opened${executable ? ' as an executable' : ''}. Reinstall Velorn to restore Optical Flow.`,
      'OPTICAL_FLOW_UNAVAILABLE',
      { path: filePath, reason: error?.code || error?.message || String(error) }
    )
  }
}

async function validateRifeRuntime({
  rifeExecutablePath,
  modelPath,
  fsPromises = fs.promises,
  platform = process.platform,
} = {}) {
  await validateReadableFile(rifeExecutablePath, 'Portable RIFE', {
    fsPromises,
    executable: true,
    platform,
  })
  if (!modelPath || typeof modelPath !== 'string' || !path.isAbsolute(modelPath)) {
    throw makeRifeError('RIFE model path must be an absolute desktop path.', 'OPTICAL_FLOW_UNAVAILABLE')
  }
  // The portable executable identifies v4 models from the directory name
  // before loading them. Renaming this folder causes its custom frame-count
  // mode to fail even when the model files themselves are valid.
  if (!String(modelPath).toLowerCase().includes('rife-v4')) {
    throw makeRifeError(
      'Portable RIFE requires its v4 model to remain in a folder whose name contains "rife-v4".',
      'OPTICAL_FLOW_UNAVAILABLE'
    )
  }
  let modelStat
  try {
    modelStat = await fsPromises.stat(modelPath)
    if (!modelStat.isDirectory()) throw new Error('not a directory')
    await fsPromises.access(modelPath, fs.constants.R_OK)
  } catch (error) {
    throw makeRifeError(
      'The portable RIFE model folder is missing or unreadable. Reinstall Velorn to restore Optical Flow.',
      'OPTICAL_FLOW_UNAVAILABLE',
      { path: modelPath, reason: error?.code || error?.message || String(error) }
    )
  }

  const canonicalModelPath = await fsPromises.realpath(modelPath)
  const requiredFiles = ['flownet.param', 'flownet.bin']
  const files = {}
  for (const filename of requiredFiles) {
    const candidatePath = path.join(modelPath, filename)
    const stat = await validateReadableFile(candidatePath, `RIFE model file ${filename}`, {
      fsPromises,
      platform,
    })
    const canonicalCandidate = await fsPromises.realpath(candidatePath)
    if (!isContainedPath(canonicalModelPath, canonicalCandidate)) {
      throw makeRifeError(
        `RIFE model file ${filename} resolves outside its model folder.`,
        'OPTICAL_FLOW_UNAVAILABLE'
      )
    }
    files[filename] = { path: candidatePath, size: stat.size }
  }

  return {
    executablePath: rifeExecutablePath,
    modelPath,
    modelName: path.basename(modelPath),
    modelFiles: files,
  }
}

async function probeRifeRuntime({
  rifeExecutablePath,
  signal = null,
  spawnImpl = spawn,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  requireSecureBuild = false,
} = {}) {
  throwIfCancelled(signal)
  let result
  try {
    result = await runProcess(rifeExecutablePath, ['-h'], {
      signal,
      spawnImpl,
      timeoutMs,
      label: 'Portable RIFE compatibility check',
    })
  } catch (error) {
    if (error?.code === 'OPTICAL_FLOW_CANCELLED') throw error
    if (requireSecureBuild) {
      throw makeRifeError(
        `Velorn's trusted smooth-motion engine failed its secure startup check: ${error?.message || String(error)}`,
        'OPTICAL_FLOW_UNAVAILABLE'
      )
    }
    // The upstream 2022 portable build prints valid help but exits with -1.
    // Preserve it only for explicitly untrusted local development fixtures.
    if (/rife-ncnn-vulkan|num-frame|target frame count/i.test(String(error?.message || ''))) {
      return { available: true, engine: RIFE_ENGINE }
    }
    throw makeRifeError(
      `Portable RIFE could not start on this computer: ${error?.message || String(error)}`,
      'OPTICAL_FLOW_UNAVAILABLE'
    )
  }

  const output = `${result.stdout}\n${result.stderr}`
  const compatible = /rife-ncnn-vulkan|num-frame|target frame count/i.test(output)
  if (requireSecureBuild && (!compatible || !output.includes(RIFE_SECURE_BUILD_MARKER))) {
    throw makeRifeError(
      'Velorn\'s trusted smooth-motion engine did not report the required PNG-only secure-build marker.',
      'OPTICAL_FLOW_UNAVAILABLE'
    )
  }
  return {
    available: compatible,
    engine: RIFE_ENGINE,
  }
}

async function cleanupStaleRifeWorkDirectories({
  cacheRoot,
  nowMs = Date.now(),
  maxAgeMs = STALE_RIFE_WORK_AGE_MS,
  fsPromises = fs.promises,
} = {}) {
  if (!cacheRoot || typeof cacheRoot !== 'string' || !path.isAbsolute(cacheRoot)) {
    throw makeRifeError('Stale RIFE cleanup requires an absolute cache root.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  const result = { cacheRoot, removedCount: 0, removedNames: [], errors: [] }
  let entries
  try {
    entries = await fsPromises.readdir(cacheRoot, { withFileTypes: true })
  } catch (error) {
    result.errors.push(error?.message || String(error))
    return result
  }
  for (const entry of entries) {
    const name = String(entry?.name || '')
    if (!name.includes(RIFE_WORK_MARKER) || !name.endsWith(RIFE_WORK_SUFFIX)) continue
    if (!entry?.isDirectory?.() || entry?.isSymbolicLink?.()) continue
    const candidatePath = path.join(cacheRoot, name)
    let stat
    try {
      stat = await fsPromises.lstat(candidatePath)
    } catch (error) {
      if (error?.code !== 'ENOENT') result.errors.push(`${name}: ${error?.message || error}`)
      continue
    }
    if (!stat.isDirectory?.() || stat.isSymbolicLink?.()) continue
    if (!Number.isFinite(Number(stat.mtimeMs)) || nowMs - Number(stat.mtimeMs) <= maxAgeMs) continue
    try {
      await fsPromises.rm(candidatePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      result.removedCount += 1
      result.removedNames.push(name)
    } catch (error) {
      if (error?.code !== 'ENOENT') result.errors.push(`${name}: ${error?.message || error}`)
    }
  }
  return result
}

async function createOwnedWorkDirectory({ paths, allowedOutputRoot, fsPromises = fs.promises } = {}) {
  const outputDirectory = path.dirname(paths.stagedOutputPath)
  if (!isContainedPath(outputDirectory, paths.workRoot)) {
    throw makeRifeError('RIFE scratch directory escaped its cache destination.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  if (allowedOutputRoot && !isContainedPath(allowedOutputRoot, paths.workRoot)) {
    throw makeRifeError('RIFE scratch directory is outside the allowed project cache.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  try {
    await fsPromises.mkdir(paths.workRoot, { recursive: false, mode: 0o700 })
    await Promise.all([
      fsPromises.mkdir(paths.inputFramesPath, { mode: 0o700 }),
      fsPromises.mkdir(paths.outputFramesPath, { mode: 0o700 }),
    ])
    const canonicalOutputDirectory = await fsPromises.realpath(outputDirectory)
    const canonicalWorkRoot = await fsPromises.realpath(paths.workRoot)
    if (!isContainedPath(canonicalOutputDirectory, canonicalWorkRoot)) {
      throw new Error('scratch directory resolves outside the cache destination')
    }
    if (allowedOutputRoot) {
      const canonicalAllowedRoot = await fsPromises.realpath(allowedOutputRoot)
      if (!isContainedPath(canonicalAllowedRoot, canonicalWorkRoot)) {
        throw new Error('scratch directory resolves outside the allowed project cache')
      }
    }
  } catch (error) {
    // This exact path was derived from a validated job id and destination and
    // was created exclusively by this attempt. Remove a partially-created
    // tree when one of the child-directory or canonical-path checks fails.
    if (error?.code !== 'EEXIST') {
      try {
        await fsPromises.rm(paths.workRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      } catch {
        // The original validation/creation error is more useful to the user.
      }
    }
    if (error?.code === 'EEXIST') {
      throw makeRifeError(
        'A RIFE scratch folder for this job already exists. Wait for that job to finish or restart Velorn.',
        'OPTICAL_FLOW_BUSY'
      )
    }
    throw makeRifeError(
      `Velorn could not create a safe RIFE scratch folder: ${error?.message || String(error)}`,
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
}

async function removeOwnedWorkDirectory({ workRoot, outputDirectory, fsPromises = fs.promises } = {}) {
  if (!workRoot || !outputDirectory || !isContainedPath(outputDirectory, workRoot)) return null
  const name = path.basename(workRoot)
  if (!name.includes(RIFE_WORK_MARKER) || !name.endsWith(RIFE_WORK_SUFFIX)) return null
  try {
    await fsPromises.rm(workRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    return null
  } catch (error) {
    return error?.code === 'ENOENT' ? null : error
  }
}

function buildRifeDecodeArgs({
  inputPath,
  inputFramePattern,
  sourceStart,
  durationSeconds,
  sourceFrameCount,
} = {}) {
  return [
    '-y',
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-progress', 'pipe:2',
    '-stats_period', '0.25',
    '-ss', formatNumber(sourceStart),
    '-t', formatNumber(durationSeconds),
    '-i', inputPath,
    '-map', '0:v:0',
    '-vf', 'setpts=PTS-STARTPTS,format=rgb24',
    '-an',
    '-sn',
    '-dn',
    '-fps_mode', 'passthrough',
    '-frames:v', String(sourceFrameCount),
    '-start_number', '1',
    '-f', 'image2',
    inputFramePattern,
  ]
}

function buildSceneCutDetectionArgs({ inputFramePattern, sourceFps, threshold } = {}) {
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'info',
    '-framerate', formatNumber(sourceFps),
    '-start_number', '1',
    '-i', inputFramePattern,
    '-vf', `select='gt(scene,${formatNumber(threshold)})',showinfo`,
    '-an',
    '-f', 'null',
    '-',
  ]
}

function buildRifeArgs({
  inputFramesPath,
  outputFramesPath,
  modelPath,
  targetFrameCount,
  gpuId = DEFAULT_RIFE_GPU_ID,
  rifeThreads = DEFAULT_RIFE_THREADS,
  uhdMode = true,
} = {}) {
  const normalizedGpuId = normalizeGpuId(gpuId)
  const args = [
    '-i', inputFramesPath,
    '-o', outputFramesPath,
    '-n', String(targetFrameCount),
    '-m', modelPath,
  ]
  if (normalizedGpuId !== null) args.push('-g', String(normalizedGpuId))
  args.push(
    '-j', normalizeRifeThreads(rifeThreads),
    '-f', '%08d.png',
    '-v'
  )
  if (uhdMode !== false) args.push('-u')
  return args
}

function buildRifeEncodeArgs({
  outputFramePattern,
  stagedOutputPath,
  targetFps,
  targetFrameCount,
  colorConfig = {},
} = {}) {
  const targetFpsText = formatNumber(targetFps)
  const colorPipeline = buildOpticalFlowColorPipeline(colorConfig)
  let scale = 'scale=ceil(iw/2)*2:ceil(ih/2)*2:flags=accurate_rnd+full_chroma_int:in_range=full:out_range=limited'
  if (colorPipeline.color.scaleColorMatrix) {
    scale += `:out_color_matrix=${colorPipeline.color.scaleColorMatrix}`
  }
  const filters = [scale, 'format=yuv420p', ...colorPipeline.postFilters].join(',')
  return [
    '-y',
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-progress', 'pipe:2',
    '-stats_period', '0.25',
    '-framerate', targetFpsText,
    '-start_number', '1',
    '-i', outputFramePattern,
    '-map', '0:v:0',
    '-vf', filters,
    '-frames:v', String(targetFrameCount),
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
    '-movflags', '+faststart',
    '-f', 'mp4',
    stagedOutputPath,
  ]
}

function createOverallProgressEmitter({ jobId, onProgress = () => {} } = {}) {
  let lastPercent = 0
  return (phase, localRatio, extra = {}) => {
    const ranges = {
      decoding: [0, 20],
      'detecting-scenes': [20, 20],
      interpolating: [20, 85],
      'protecting-scene-cuts': [85, 85],
      encoding: [85, 99],
      complete: [100, 100],
    }
    const [start, end] = ranges[phase] || [lastPercent, lastPercent]
    const normalizedRatio = Math.max(0, Math.min(1, Number(localRatio) || 0))
    const percent = Math.max(lastPercent, Math.min(100, start + ((end - start) * normalizedRatio)))
    lastPercent = percent
    safeNotify(onProgress, {
      jobId,
      phase,
      ratio: percent / 100,
      progress: percent,
      percent,
      ...extra,
    })
  }
}

function createFfmpegStageProgressParser({
  phase,
  expectedFrames,
  durationSeconds,
  emitProgress,
} = {}) {
  let buffer = ''
  let values = Object.create(null)
  const consumeLine = (rawLine) => {
    const line = String(rawLine || '').trim()
    if (!line) return
    const separator = line.indexOf('=')
    if (separator <= 0) return
    values[line.slice(0, separator)] = line.slice(separator + 1)
    if (!line.startsWith('progress=')) return
    const frame = Number(values.frame)
    const outTimeUs = Number(values.out_time_us)
    const frameRatio = Number.isFinite(frame) && expectedFrames > 0 ? frame / expectedFrames : 0
    const timeRatio = Number.isFinite(outTimeUs) && durationSeconds > 0
      ? (outTimeUs / 1000000) / durationSeconds
      : 0
    const done = values.progress === 'end'
    emitProgress(phase, done ? 1 : Math.max(frameRatio, timeRatio), {
      status: values.progress,
      frame: Number.isFinite(frame) ? frame : null,
      totalFrames: expectedFrames,
      fps: Number.isFinite(Number(values.fps)) ? Number(values.fps) : null,
      speed: values.speed || null,
    })
    values = Object.create(null)
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

function createRifeProgressParser({ targetFrameCount, emitProgress } = {}) {
  let buffer = ''
  let completedFrames = 0
  const consumeLine = (rawLine) => {
    const line = String(rawLine || '').trim()
    if (!/\s->\s.+\sdone\s*$/.test(line)) return
    completedFrames = Math.min(targetFrameCount, completedFrames + 1)
    emitProgress('interpolating', completedFrames / targetFrameCount, {
      status: completedFrames === targetFrameCount ? 'end' : 'continue',
      frame: completedFrames,
      totalFrames: targetFrameCount,
      fps: null,
      speed: null,
    })
  }
  return {
    push(chunk) {
      buffer += chunk?.toString?.() || ''
      if (buffer.length > MAX_PROCESS_OUTPUT_CHARS) buffer = buffer.slice(-MAX_PROCESS_OUTPUT_CHARS)
      const lines = buffer.split(/\r\n|\n|\r/)
      buffer = lines.pop() || ''
      for (const line of lines) consumeLine(line)
    },
    end() {
      if (buffer) consumeLine(buffer)
      buffer = ''
    },
    get completedFrames() {
      return completedFrames
    },
  }
}

function createSceneCutParser({ sourceFps, sourceFrameCount } = {}) {
  let buffer = ''
  const indices = new Set()
  const consumeLine = (line) => {
    if (!/Parsed_showinfo/.test(line)) return
    const ptsTime = Number(String(line).match(/\bpts_time:\s*(-?\d+(?:\.\d+)?)/)?.[1])
    if (!Number.isFinite(ptsTime)) return
    const frameIndex = Math.round(ptsTime * sourceFps)
    if (frameIndex > 0 && frameIndex < sourceFrameCount) indices.add(frameIndex)
  }
  return {
    push(chunk) {
      buffer += chunk?.toString?.() || ''
      if (buffer.length > MAX_PROCESS_OUTPUT_CHARS) buffer = buffer.slice(-MAX_PROCESS_OUTPUT_CHARS)
      const lines = buffer.split(/\r\n|\n|\r/)
      buffer = lines.pop() || ''
      for (const line of lines) consumeLine(line)
    },
    end() {
      if (buffer) consumeLine(buffer)
      buffer = ''
      return [...indices].sort((first, second) => first - second)
    },
  }
}

function getRifeSceneCutReplacementPlan({
  sourceFrameCount,
  targetFrameCount,
  cutSourceFrameIndices = [],
} = {}) {
  if (!Number.isInteger(sourceFrameCount) || sourceFrameCount < 2) {
    throw makeRifeError('RIFE requires at least two decoded source frames.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  if (!Number.isInteger(targetFrameCount) || targetFrameCount < sourceFrameCount) {
    throw makeRifeError('RIFE target frame count must not be lower than its source frame count.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  const cutIndices = new Set(
    cutSourceFrameIndices
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0 && value < sourceFrameCount)
  )
  const replacements = []
  for (let outputIndex = 0; outputIndex < targetFrameCount; outputIndex += 1) {
    const position = (outputIndex * sourceFrameCount) / targetFrameCount
    let sourceIndex = Math.floor(position)
    let fraction = position - sourceIndex
    if (sourceIndex >= sourceFrameCount - 1) {
      sourceIndex = sourceFrameCount - 2
      fraction = 1
    }
    if (!cutIndices.has(sourceIndex + 1) || fraction <= 0.000001 || fraction >= 0.999999) continue
    replacements.push({
      outputFrameNumber: outputIndex + 1,
      sourceFrameNumber: sourceIndex + 1,
      cutSourceFrameIndex: sourceIndex + 1,
      fraction,
    })
  }
  return replacements
}

async function applySceneCutReplacementPlan({
  plan,
  inputFramesPath,
  outputFramesPath,
  signal = null,
  fsPromises = fs.promises,
} = {}) {
  for (const replacement of plan) {
    throwIfCancelled(signal)
    const sourcePath = path.join(inputFramesPath, `${String(replacement.sourceFrameNumber).padStart(8, '0')}.png`)
    const destinationPath = path.join(outputFramesPath, `${String(replacement.outputFrameNumber).padStart(8, '0')}.png`)
    await fsPromises.copyFile(sourcePath, destinationPath)
  }
  return plan.length
}

async function validateNumberedFrameDirectory({
  directoryPath,
  expectedFrameCount,
  label,
  fsPromises = fs.promises,
} = {}) {
  const entries = await fsPromises.readdir(directoryPath, { withFileTypes: true })
  if (entries.length !== expectedFrameCount) {
    throw makeRifeError(
      `${label} contains ${entries.length} frames; expected ${expectedFrameCount}.`,
      'OPTICAL_FLOW_OUTPUT_INVALID'
    )
  }
  const names = entries.map((entry) => entry.name).sort()
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]))
  for (let index = 0; index < expectedFrameCount; index += 1) {
    const expectedName = `${String(index + 1).padStart(8, '0')}.png`
    const entry = entriesByName.get(expectedName)
    if (!entry || !entry.isFile?.() || entry.isSymbolicLink?.() || names[index] !== expectedName) {
      throw makeRifeError(`${label} is missing a safe ${expectedName} frame.`, 'OPTICAL_FLOW_OUTPUT_INVALID')
    }
  }
  // A nonempty first and last frame catches truncated writes without adding a
  // filesystem stat for every frame in a long cache.
  for (const frameName of [names[0], names[names.length - 1]]) {
    const framePath = path.join(directoryPath, frameName)
    const stat = await fsPromises.lstat(framePath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
      throw makeRifeError(`${label} contains an empty or unsafe frame.`, 'OPTICAL_FLOW_OUTPUT_INVALID')
    }
  }
  return names
}

function resolveRifeFramePlan({
  durationSeconds,
  sourceFps,
  requestedTargetFps,
  maxFrames = MAX_OPTICAL_FLOW_FRAMES,
} = {}) {
  const duration = Number(durationSeconds)
  const sourceRate = Number(sourceFps)
  const requestedRate = Number(requestedTargetFps)
  const frameLimit = Number(maxFrames)
  if (![duration, sourceRate, requestedRate].every((value) => Number.isFinite(value) && value > 0)) {
    throw makeRifeError('RIFE frame planning requires valid source timing.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  if (!Number.isInteger(frameLimit) || frameLimit < 1 || frameLimit > MAX_OPTICAL_FLOW_FRAMES) {
    throw makeRifeError('RIFE frame limit must be a supported whole number.', 'OPTICAL_FLOW_INVALID_INPUT')
  }

  // Derive M from decoded N, rather than independently rounding duration at
  // two rates. This is the exact mapping used by RIFE directory mode and keeps
  // the encoded CFR duration equal to N / sourceFps.
  const sourceFrameCount = Math.max(1, Math.round(duration * sourceRate))
  // Round upward so the encoded derivative never lands below the requested
  // sampling density merely because this source window contains few frames.
  // Subtract only a tiny floating-point tolerance so exact integer ratios do
  // not accidentally gain an extra frame.
  const requestedTargetFrameCount = sourceFrameCount * requestedRate / sourceRate
  const targetFrameCount = Math.max(1, Math.ceil(requestedTargetFrameCount - 1e-9))
  if (sourceFrameCount < 2) {
    throw makeRifeError(
      'Optical Flow needs at least two source frames. Extend the clip or use Frame sampling.',
      'OPTICAL_FLOW_INVALID_INPUT'
    )
  }
  if (targetFrameCount <= sourceFrameCount) {
    throw makeRifeError(
      'This source window is too short for the requested Optical Flow rate to add a frame. Extend the clip or use Frame Blend.',
      'OPTICAL_FLOW_INVALID_INPUT',
      { sourceFrameCount, targetFrameCount, sourceFps: sourceRate, requestedTargetFps: requestedRate }
    )
  }
  if (targetFrameCount > frameLimit) {
    throw makeRifeError(
      `Optical-flow cache would contain about ${targetFrameCount} frames, above the ${frameLimit} frame limit.`,
      'OPTICAL_FLOW_RESOURCE_LIMIT',
      { expectedFrameCount: targetFrameCount, maxFrames: frameLimit }
    )
  }

  const effectiveTargetFps = sourceRate * targetFrameCount / sourceFrameCount
  return {
    sourceFrameCount,
    targetFrameCount,
    requestedTargetFps: requestedRate,
    targetFps: Number(effectiveTargetFps.toFixed(6)),
    multiplier: Number((targetFrameCount / sourceFrameCount).toFixed(6)),
    durationSeconds: sourceFrameCount / sourceRate,
  }
}

function estimateRifeScratchBytes({ width, height, sourceFrameCount, targetFrameCount } = {}) {
  const values = [width, height, sourceFrameCount, targetFrameCount].map(Number)
  if (values.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw makeRifeError('RIFE scratch estimate requires positive whole-number dimensions and frame counts.', 'OPTICAL_FLOW_INVALID_INPUT')
  }
  const estimatedScratchBytes = Math.ceil(
    width * height * (sourceFrameCount + targetFrameCount) * PNG_BYTES_PER_PIXEL_ESTIMATE
  )
  if (!Number.isSafeInteger(estimatedScratchBytes)) {
    throw makeRifeError('RIFE scratch estimate exceeds a safe size.', 'OPTICAL_FLOW_RESOURCE_LIMIT')
  }
  return estimatedScratchBytes
}

async function checkRifeDiskSpace({
  outputPath,
  estimatedScratchBytes,
  fsPromises = fs.promises,
} = {}) {
  const requiredFreeBytes = estimatedScratchBytes + MIN_FREE_DISK_RESERVE_BYTES
  if (typeof fsPromises.statfs !== 'function') {
    return { checked: false, estimatedScratchBytes, requiredFreeBytes, freeBytes: null }
  }
  let statfs
  try {
    statfs = await fsPromises.statfs(path.dirname(outputPath))
  } catch {
    return { checked: false, estimatedScratchBytes, requiredFreeBytes, freeBytes: null }
  }
  let freeBytesBigInt
  try {
    freeBytesBigInt = BigInt(statfs.bavail ?? statfs.bfree) * BigInt(statfs.bsize)
  } catch {
    return { checked: false, estimatedScratchBytes, requiredFreeBytes, freeBytes: null }
  }
  const freeBytes = freeBytesBigInt > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(freeBytesBigInt)
  if (freeBytesBigInt < BigInt(requiredFreeBytes)) {
    const requiredGb = (requiredFreeBytes / (1024 ** 3)).toFixed(1)
    const freeGb = (freeBytes / (1024 ** 3)).toFixed(1)
    throw makeRifeError(
      `Optical Flow needs about ${requiredGb} GB free for temporary RIFE frames, but only ${freeGb} GB is available.`,
      'OPTICAL_FLOW_INSUFFICIENT_DISK_SPACE',
      { freeBytes, estimatedScratchBytes, requiredFreeBytes }
    )
  }
  return { checked: true, estimatedScratchBytes, requiredFreeBytes, freeBytes }
}

async function removeOwnedFile(fsPromises, filePath) {
  try {
    await fsPromises.unlink(filePath)
    return null
  } catch (error) {
    return error?.code === 'ENOENT' ? null : error
  }
}

function isLikelyVulkanFailure(error) {
  return /vulkan|vkcreate|gpu|device|driver|ncnn::get_gpu|failed to create/i.test(String(error?.message || ''))
}

async function createRifeInterpolationCache(options = {}) {
  const {
    ffmpegPath,
    ffprobePath,
    rifeExecutablePath,
    modelPath,
    inputPath,
    outputPath,
    sourceStart,
    sourceEnd,
    expectedDuration,
    targetFps = null,
    multiplier = null,
    maxFrames = MAX_OPTICAL_FLOW_FRAMES,
    jobId: rawJobId,
    gpuId = DEFAULT_RIFE_GPU_ID,
    rifeThreads = DEFAULT_RIFE_THREADS,
    uhdMode = true,
    sceneCutThreshold = DEFAULT_SCENE_CUT_THRESHOLD,
    signal = null,
    onPhase = () => {},
    onProgress = () => {},
    spawnImpl = spawn,
    fsPromises = fs.promises,
    platform = process.platform,
    allowedOutputRoot = null,
    requireSecureBuild = false,
    probeRuntimeImpl = probeRifeRuntime,
    probeMetadataImpl = probeVideoMetadata,
  } = options

  const jobId = normalizeJobId(rawJobId)
  const normalizedGpuId = normalizeGpuId(gpuId)
  const normalizedThreads = normalizeRifeThreads(rifeThreads)
  const normalizedSceneThreshold = normalizeSceneCutThreshold(sceneCutThreshold)
  const paths = createRifeWorkPaths({ outputPath, jobId })
  const emitProgress = createOverallProgressEmitter({ jobId, onProgress })
  let preserveBackupForRecovery = false
  let workDirectoryCreated = false
  let cleanupWarning = null

  safeNotify(onPhase, 'validating')
  throwIfCancelled(signal)
  const pathValidation = await validateOpticalFlowPaths({
    ffmpegPath,
    ffprobePath,
    inputPath,
    outputPath,
    allowedOutputRoot,
    fsPromises,
    platform,
  })
  const runtime = await validateRifeRuntime({ rifeExecutablePath, modelPath, fsPromises, platform })

  let staleWorkCleanup = null
  if (allowedOutputRoot) {
    safeNotify(onPhase, 'cleaning-stale-cache')
    staleWorkCleanup = await cleanupStaleRifeWorkDirectories({ cacheRoot: allowedOutputRoot, fsPromises })
  }

  await removeOwnedFile(fsPromises, paths.stagedOutputPath)
  try {
    await fsPromises.access(paths.backupOutputPath)
    throw makeRifeError(
      `A previous optical-flow cache backup still exists at ${paths.backupOutputPath}. Restore or move it before retrying.`,
      'OPTICAL_FLOW_RECOVERY_REQUIRED'
    )
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  try {
    safeNotify(onPhase, 'checking-support')
    const support = await probeRuntimeImpl({
      rifeExecutablePath,
      signal,
      spawnImpl,
      requireSecureBuild,
    })
    if (!support?.available) {
      throw makeRifeError(
        'This portable RIFE runtime is not compatible with the current computer.',
        'OPTICAL_FLOW_UNAVAILABLE'
      )
    }

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
    const framePlan = resolveRifeFramePlan({
      durationSeconds: window.durationSeconds,
      sourceFps: source.fps,
      requestedTargetFps: target.targetFps,
      maxFrames: window.maxFrames,
    })
    const { sourceFrameCount } = framePlan
    const resourceBudget = validateOpticalFlowResourceBudget({
      displayWidth: source.displayWidth || source.width,
      displayHeight: source.displayHeight || source.height,
      expectedFrameCount: framePlan.targetFrameCount,
      maxPixelFrames: MAX_OPTICAL_FLOW_PIXEL_FRAMES,
    })
    const estimatedScratchBytes = estimateRifeScratchBytes({
      width: source.displayWidth || source.width,
      height: source.displayHeight || source.height,
      sourceFrameCount,
      targetFrameCount: framePlan.targetFrameCount,
    })
    safeNotify(onPhase, 'checking-disk-space')
    const diskSpace = await checkRifeDiskSpace({ outputPath, estimatedScratchBytes, fsPromises })

    throwIfCancelled(signal)
    await createOwnedWorkDirectory({ paths, allowedOutputRoot, fsPromises })
    workDirectoryCreated = true

    safeNotify(onPhase, 'decoding', {
      ...target,
      ...window,
      ...framePlan,
    })
    emitProgress('decoding', 0, { status: 'start', frame: 0, totalFrames: sourceFrameCount })
    const decodeParser = createFfmpegStageProgressParser({
      phase: 'decoding',
      expectedFrames: sourceFrameCount,
      durationSeconds: framePlan.durationSeconds,
      emitProgress,
    })
    try {
      await runProcess(ffmpegPath, buildRifeDecodeArgs({
        inputPath,
        inputFramePattern: paths.inputFramePattern,
        sourceStart: window.sourceStart,
        durationSeconds: framePlan.durationSeconds,
        sourceFrameCount,
      }), {
        signal,
        spawnImpl,
        label: 'Optical-flow frame preparation',
        onStderr: (chunk) => decodeParser.push(chunk),
      })
    } finally {
      decodeParser.end()
    }
    await validateNumberedFrameDirectory({
      directoryPath: paths.inputFramesPath,
      expectedFrameCount: sourceFrameCount,
      label: 'Decoded RIFE input',
      fsPromises,
    })
    const afterDecodeSourceStat = await fsPromises.stat(inputPath)
    assertSourceFileUnchanged(pathValidation.inputStat, afterDecodeSourceStat)

    safeNotify(onPhase, 'detecting-scenes')
    emitProgress('detecting-scenes', 0, {
      status: 'start',
      frame: sourceFrameCount,
      totalFrames: sourceFrameCount,
    })
    const sceneParser = createSceneCutParser({ sourceFps: source.fps, sourceFrameCount })
    let sceneCutSourceFrameIndices = []
    try {
      await runProcess(ffmpegPath, buildSceneCutDetectionArgs({
        inputFramePattern: paths.inputFramePattern,
        sourceFps: source.fps,
        threshold: normalizedSceneThreshold,
      }), {
        signal,
        spawnImpl,
        label: 'Optical-flow scene-cut analysis',
        onStderr: (chunk) => sceneParser.push(chunk),
      })
    } finally {
      sceneCutSourceFrameIndices = sceneParser.end()
    }

    safeNotify(onPhase, 'interpolating')
    emitProgress('interpolating', 0, {
      status: 'start',
      frame: 0,
      totalFrames: framePlan.targetFrameCount,
    })
    const rifeParser = createRifeProgressParser({
      targetFrameCount: framePlan.targetFrameCount,
      emitProgress,
    })
    try {
      await runProcess(rifeExecutablePath, buildRifeArgs({
        inputFramesPath: paths.inputFramesPath,
        outputFramesPath: paths.outputFramesPath,
        modelPath: runtime.modelName,
        targetFrameCount: framePlan.targetFrameCount,
        gpuId: normalizedGpuId,
        rifeThreads: normalizedThreads,
        uhdMode,
      }), {
        signal,
        spawnImpl,
        label: 'Portable RIFE interpolation',
        cwd: path.dirname(runtime.modelPath),
        onStdout: (chunk) => rifeParser.push(chunk),
        onStderr: (chunk) => rifeParser.push(chunk),
      })
    } catch (error) {
      if (error?.code === 'OPTICAL_FLOW_CANCELLED') throw error
      if (isLikelyVulkanFailure(error)) {
        throw makeRifeError(
          'Portable RIFE could not use a compatible Vulkan GPU. Update the graphics driver or use Frame Blend.',
          'OPTICAL_FLOW_GPU_UNAVAILABLE',
          { cause: error?.message || String(error) }
        )
      }
      throw error
    } finally {
      rifeParser.end()
    }
    emitProgress('interpolating', 1, {
      status: 'end',
      frame: framePlan.targetFrameCount,
      totalFrames: framePlan.targetFrameCount,
    })
    await validateNumberedFrameDirectory({
      directoryPath: paths.outputFramesPath,
      expectedFrameCount: framePlan.targetFrameCount,
      label: 'Portable RIFE output',
      fsPromises,
    })

    const sceneCutReplacementPlan = getRifeSceneCutReplacementPlan({
      sourceFrameCount,
      targetFrameCount: framePlan.targetFrameCount,
      cutSourceFrameIndices: sceneCutSourceFrameIndices,
    })
    if (sceneCutReplacementPlan.length > 0) {
      safeNotify(onPhase, 'protecting-scene-cuts', {
        sceneCutCount: sceneCutSourceFrameIndices.length,
        replacementFrameCount: sceneCutReplacementPlan.length,
      })
      await applySceneCutReplacementPlan({
        plan: sceneCutReplacementPlan,
        inputFramesPath: paths.inputFramesPath,
        outputFramesPath: paths.outputFramesPath,
        signal,
        fsPromises,
      })
    }

    throwIfCancelled(signal)
    safeNotify(onPhase, 'encoding')
    emitProgress('encoding', 0, {
      status: 'start',
      frame: 0,
      totalFrames: framePlan.targetFrameCount,
    })
    const encodeParser = createFfmpegStageProgressParser({
      phase: 'encoding',
      expectedFrames: framePlan.targetFrameCount,
      durationSeconds: framePlan.durationSeconds,
      emitProgress,
    })
    try {
      await runProcess(ffmpegPath, buildRifeEncodeArgs({
        outputFramePattern: paths.outputFramePattern,
        stagedOutputPath: paths.stagedOutputPath,
        targetFps: framePlan.targetFps,
        targetFrameCount: framePlan.targetFrameCount,
        colorConfig: color,
      }), {
        signal,
        spawnImpl,
        label: 'Optical-flow cache encoding',
        onStderr: (chunk) => encodeParser.push(chunk),
      })
    } finally {
      encodeParser.end()
    }

    const stagedStat = await fsPromises.stat(paths.stagedOutputPath).catch(() => null)
    if (!stagedStat?.isFile?.() || stagedStat.size <= 0) {
      throw makeRifeError('FFmpeg did not produce a valid RIFE optical-flow cache.', 'OPTICAL_FLOW_OUTPUT_INVALID')
    }

    throwIfCancelled(signal)
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
      targetFps: framePlan.targetFps,
      expectedDuration: framePlan.durationSeconds,
      expectedFrameCount: framePlan.targetFrameCount,
      expectedColor: color,
    })
    const finalSourceStat = await fsPromises.stat(inputPath)
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
    emitProgress('complete', 1, {
      status: 'end',
      frame: framePlan.targetFrameCount,
      totalFrames: framePlan.targetFrameCount,
    })
    safeNotify(onPhase, 'complete')

    return {
      outputPath,
      engine: RIFE_ENGINE,
      engineVersion: RIFE_ENGINE_VERSION,
      modelName: runtime.modelName,
      jobId,
      source,
      generated,
      sourceStart: window.sourceStart,
      sourceEnd: window.sourceStart + framePlan.durationSeconds,
      sourceFps: target.sourceFps,
      requestedTargetFps: framePlan.requestedTargetFps,
      targetFps: framePlan.targetFps,
      multiplier: framePlan.multiplier,
      durationSeconds: framePlan.durationSeconds,
      sourceFrameCount,
      expectedFrameCount: framePlan.targetFrameCount,
      frameCount: generated.frameCount,
      maxFrames: window.maxFrames,
      resourceBudget,
      diskSpace,
      color,
      gpuId: normalizedGpuId,
      rifeThreads: normalizedThreads,
      uhdMode: uhdMode !== false,
      sceneCutThreshold: normalizedSceneThreshold,
      sceneCutSourceFrameIndices,
      sceneCutReplacementFrameCount: sceneCutReplacementPlan.length,
      staleWorkCleanup,
      cleanupWarning,
    }
  } catch (error) {
    preserveBackupForRecovery = Boolean(error?.recoveryPath)
    throw error
  } finally {
    if (workDirectoryCreated) {
      const cleanupError = await removeOwnedWorkDirectory({
        workRoot: paths.workRoot,
        outputDirectory: path.dirname(outputPath),
        fsPromises,
      })
      if (cleanupError) {
        console.warn(`[Optical Flow / RIFE] Could not remove scratch frames: ${cleanupError.message || cleanupError}`)
      }
    }
    const cleanupTargets = [paths.stagedOutputPath]
    if (!preserveBackupForRecovery) cleanupTargets.push(paths.backupOutputPath)
    for (const cleanupPath of cleanupTargets) {
      const cleanupError = await removeOwnedFile(fsPromises, cleanupPath)
      if (cleanupError) {
        console.warn(`[Optical Flow / RIFE] Could not remove ${cleanupPath}: ${cleanupError.message || cleanupError}`)
      }
    }
  }
}

module.exports = {
  DEFAULT_RIFE_GPU_ID,
  DEFAULT_RIFE_THREADS,
  DEFAULT_SCENE_CUT_THRESHOLD,
  PNG_BYTES_PER_PIXEL_ESTIMATE,
  RIFE_ENGINE,
  RIFE_ENGINE_VERSION,
  RIFE_WORK_MARKER,
  RIFE_WORK_SUFFIX,
  STALE_RIFE_WORK_AGE_MS,
  applySceneCutReplacementPlan,
  buildRifeArgs,
  buildRifeDecodeArgs,
  buildRifeEncodeArgs,
  buildSceneCutDetectionArgs,
  checkRifeDiskSpace,
  cleanupStaleRifeWorkDirectories,
  createFfmpegStageProgressParser,
  createOverallProgressEmitter,
  createRifeInterpolationCache,
  createRifeProgressParser,
  createRifeWorkPaths,
  createSceneCutParser,
  estimateRifeScratchBytes,
  getRifeSceneCutReplacementPlan,
  probeRifeRuntime,
  resolveRifeFramePlan,
  validateNumberedFrameDirectory,
  validateRifeRuntime,
}
