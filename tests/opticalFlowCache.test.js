const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { spawnSync } = require('node:child_process')

const bundledFfmpegPath = require('ffmpeg-static')
const bundledFfprobePath = require('@derhuerst/ffprobe-static')
const {
  MAX_OPTICAL_FLOW_FPS,
  MAX_OPTICAL_FLOW_PIXEL_FRAMES,
  OPTICAL_FLOW_CANCELLED_MESSAGE,
  STALE_OPTICAL_FLOW_TEMP_AGE_MS,
  buildOpticalFlowArgs,
  buildOpticalFlowColorPipeline,
  checkOpticalFlowDiskSpace,
  cleanupStaleOpticalFlowTemps,
  createFfmpegProgressParser,
  createOpticalFlowCache,
  createOpticalFlowCachePaths,
  finalizeOpticalFlowOutput,
  probeMinterpolateSupport,
  resolveOpticalFlowTarget,
  resolveOpticalFlowColorConfig,
  resolveOpticalFlowWindow,
  validateGeneratedMetadata,
  validateOpticalFlowPaths,
  validateOpticalFlowResourceBudget,
  validateOpticalFlowSourceCompatibility,
} = require('../electron/opticalFlowCache')

function runSync(binaryPath, args) {
  const result = spawnSync(binaryPath, args, { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout || `${binaryPath} failed`)
  return result.stdout
}

function runSyncBuffer(binaryPath, args) {
  const result = spawnSync(binaryPath, args, { maxBuffer: 16 * 1024 * 1024 })
  assert.equal(
    result.status,
    0,
    result.stderr?.toString?.() || result.stdout?.toString?.() || `${binaryPath} failed`
  )
  return result.stdout
}

function rgbPsnr(first, second) {
  assert.equal(first.length, second.length)
  let squaredError = 0
  for (let index = 0; index < first.length; index += 1) {
    const difference = first[index] - second[index]
    squaredError += difference * difference
  }
  if (squaredError === 0) return Number.POSITIVE_INFINITY
  const mse = squaredError / first.length
  return 10 * Math.log10((255 * 255) / mse)
}

function makeFakeChild({ onKill } = {}) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => {
    onKill?.()
    setImmediate(() => child.emit('close', null, 'SIGKILL'))
    return true
  }
  return child
}

const sourceMetadata = {
  codec: 'h264',
  pixelFormat: 'yuv420p',
  width: 64,
  height: 48,
  durationSeconds: 1,
  fps: 12,
  avgFrameRate: 12,
  realFrameRate: 12,
  hasAudio: false,
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
}

const generatedMetadata = {
  ...sourceMetadata,
  durationSeconds: 1,
  fps: 24,
  avgFrameRate: 24,
  realFrameRate: 24,
  frameCount: 24,
}

test('target normalization supports a bounded target FPS or multiplier', () => {
  assert.deepEqual(resolveOpticalFlowTarget({ sourceFps: 24, multiplier: 2 }), {
    sourceFps: 24,
    targetFps: 48,
    multiplier: 2,
  })
  assert.deepEqual(resolveOpticalFlowTarget({ sourceFps: 23.976, targetFps: 60 }), {
    sourceFps: 23.976,
    targetFps: 60,
    multiplier: 2.502503,
  })
  assert.throws(
    () => resolveOpticalFlowTarget({ sourceFps: 24, multiplier: 1 }),
    /greater than 1/i
  )
  assert.throws(
    () => resolveOpticalFlowTarget({ sourceFps: 24, multiplier: 5 }),
    /no more than 4/i
  )
  assert.throws(
    () => resolveOpticalFlowTarget({ sourceFps: 120, multiplier: 3 }),
    new RegExp(`${MAX_OPTICAL_FLOW_FPS}`)
  )
  assert.throws(
    () => resolveOpticalFlowTarget({ sourceFps: 24, targetFps: 60, multiplier: 2 }),
    /either.*target frame rate.*multiplier/i
  )
})

test('source-window validation enforces timing and frame-budget bounds', () => {
  assert.deepEqual(resolveOpticalFlowWindow({
    sourceStart: 1.25,
    sourceEnd: 3.75,
    expectedDuration: 2.5,
    sourceDuration: 10,
    sourceFps: 24,
    targetFps: 60,
    maxFrames: 200,
  }), {
    requestedSourceStart: 1.25,
    requestedSourceEnd: 3.75,
    sourceStart: 1.25,
    sourceEnd: 3.75,
    durationSeconds: 2.5,
    expectedDuration: 2.5,
    expectedFrameCount: 150,
    maxFrames: 200,
  })
  const expanded = resolveOpticalFlowWindow({
    sourceStart: 1.1,
    sourceEnd: 1.6,
    expectedDuration: 0.5,
    sourceDuration: 10,
    sourceFps: 12,
    targetFps: 24,
    maxFrames: 100,
  })
  assert.ok(Math.abs(expanded.sourceStart - (13 / 12)) < 0.000001)
  assert.ok(Math.abs(expanded.sourceEnd - (20 / 12)) < 0.000001)
  assert.ok(Math.abs(expanded.durationSeconds - (7 / 12)) < 0.000001)
  assert.equal(expanded.expectedFrameCount, 14)
  assert.throws(() => resolveOpticalFlowWindow({
    sourceStart: 2,
    sourceEnd: 3,
    expectedDuration: 0.5,
    sourceDuration: 10,
    sourceFps: 24,
    targetFps: 60,
    maxFrames: 100,
  }), /must match sourceEnd - sourceStart/i)
  assert.throws(() => resolveOpticalFlowWindow({
    sourceStart: 2,
    sourceEnd: 5,
    expectedDuration: 3,
    sourceDuration: 10,
    sourceFps: 24,
    targetFps: 60,
    maxFrames: 100,
  }), error => error?.code === 'OPTICAL_FLOW_RESOURCE_LIMIT')
})

test('source preflight rejects alpha, high-bit-depth, HDR, and VFR media', () => {
  assert.throws(
    () => validateOpticalFlowSourceCompatibility({ pixelFormat: 'yuva420p' }),
    error => error?.code === 'OPTICAL_FLOW_UNSUPPORTED_SOURCE' && error?.details?.reason === 'alpha'
  )
  assert.throws(
    () => validateOpticalFlowSourceCompatibility({ pixelFormat: 'yuv420p', alphaMode: '1' }),
    error => error?.details?.reason === 'alpha' && error?.details?.alphaMode === '1'
  )
  assert.throws(
    () => validateOpticalFlowSourceCompatibility({ pixelFormat: 'yuv420p10le' }),
    error => error?.details?.reason === 'bit-depth'
  )
  assert.throws(
    () => validateOpticalFlowSourceCompatibility({ pixelFormat: 'yuv420p', colorTransfer: 'smpte2084' }),
    error => error?.details?.reason === 'hdr'
  )
  assert.throws(
    () => validateOpticalFlowSourceCompatibility({
      pixelFormat: 'yuv420p',
      variableFrameRate: true,
      avgFrameRate: 27,
      realFrameRate: 30,
    }),
    error => error?.details?.reason === 'variable-frame-rate'
  )
  assert.throws(
    () => validateOpticalFlowSourceCompatibility({ pixelFormat: 'yuv420p', startTime: 5 }),
    error => error?.details?.reason === 'nonzero-start-time'
  )
})

test('color configuration converts tagged full range and preserves limited or unspecified SDR safely', () => {
  const full = resolveOpticalFlowColorConfig({
    pixelFormat: 'yuvj420p',
    colorRange: 'pc',
    colorSpace: 'bt709',
    colorPrimaries: 'bt709',
    colorTransfer: 'bt709',
  })
  assert.deepEqual(full, {
    sourceRange: 'pc',
    inputRange: 'full',
    outputRange: 'tv',
    convertsFullRange: true,
    colorSpace: 'bt709',
    colorPrimaries: 'bt709',
    colorTransfer: 'bt709',
    scaleColorMatrix: 'bt709',
  })
  const fullPipeline = buildOpticalFlowColorPipeline(full)
  assert.match(fullPipeline.preFilters[0], /in_range=full:out_range=limited/)
  assert.match(fullPipeline.preFilters[0], /in_color_matrix=bt709:out_color_matrix=bt709/)
  assert.deepEqual(fullPipeline.postFilters, [
    'setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
  ])
  assert.deepEqual(fullPipeline.outputArgs, [
    '-color_range', 'tv',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
  ])

  const limited = resolveOpticalFlowColorConfig({
    pixelFormat: 'yuv420p',
    colorRange: 'tv',
    colorSpace: 'bt709',
    colorPrimaries: 'bt709',
    colorTransfer: 'bt709',
  })
  assert.equal(limited.inputRange, 'limited')
  assert.equal(limited.convertsFullRange, false)
  assert.deepEqual(buildOpticalFlowColorPipeline(limited).preFilters, [])
  assert.match(buildOpticalFlowColorPipeline(limited).postFilters[0], /^setparams=range=limited/)

  const unspecified = resolveOpticalFlowColorConfig({ pixelFormat: 'yuv420p' })
  assert.equal(unspecified.inputRange, 'unspecified')
  assert.equal(unspecified.outputRange, null)
  assert.deepEqual(buildOpticalFlowColorPipeline(unspecified).preFilters, [])
  assert.deepEqual(buildOpticalFlowColorPipeline(unspecified).postFilters, [])
  assert.deepEqual(buildOpticalFlowColorPipeline(unspecified).outputArgs, [])

  const untrusted = buildOpticalFlowColorPipeline({
    inputRange: 'full',
    colorSpace: 'bt709;movie=bad',
    colorPrimaries: 'bad',
    colorTransfer: 'bad',
  })
  assert.equal(untrusted.color.colorSpace, null)
  assert.deepEqual(untrusted.outputArgs, ['-color_range', 'tv'])
})

test('decoded pixel-frame budget bounds high-resolution optical-flow work before encode', () => {
  const accepted = validateOpticalFlowResourceBudget({
    displayWidth: 3840,
    displayHeight: 2160,
    expectedFrameCount: 964,
  })
  assert.equal(accepted.pixelFrameCount, 7_995_801_600)
  assert.equal(accepted.maxPixelFrames, MAX_OPTICAL_FLOW_PIXEL_FRAMES)

  assert.throws(() => validateOpticalFlowResourceBudget({
    displayWidth: 3840,
    displayHeight: 2160,
    expectedFrameCount: 965,
  }), error => (
    error?.code === 'OPTICAL_FLOW_RESOURCE_LIMIT'
    && error?.details?.displayWidth === 3840
    && error?.details?.displayHeight === 2160
    && error?.details?.expectedFrameCount === 965
    && /3840×2160/.test(error.message)
    && /965 frames/.test(error.message)
  ))
})

test('disk-space preflight rejects a known-low filesystem and skips unsupported runtimes', async () => {
  await assert.rejects(checkOpticalFlowDiskSpace({
    outputPath: path.join(os.tmpdir(), 'cache.mp4'),
    pixelFrameCount: 1_000_000_000,
    fsPromises: {
      statfs: async () => ({ bavail: 1, bsize: 4096 }),
    },
  }), error => (
    error?.code === 'OPTICAL_FLOW_INSUFFICIENT_DISK_SPACE'
    && error?.details?.freeBytes === 4096
  ))

  const skipped = await checkOpticalFlowDiskSpace({
    outputPath: path.join(os.tmpdir(), 'cache.mp4'),
    pixelFrameCount: 1000,
    fsPromises: {},
  })
  assert.equal(skipped.checked, false)
  assert.equal(skipped.reason, 'statfs-unavailable')
})

test('generated-cache validation uses autorotated display dimensions', () => {
  assert.doesNotThrow(() => validateGeneratedMetadata({
    source: {
      width: 160,
      height: 90,
      displayWidth: 90,
      displayHeight: 160,
      rotation: 90,
    },
    generated: {
      codec: 'h264',
      hasAudio: false,
      width: 90,
      height: 160,
      fps: 48,
      durationSeconds: 1,
      frameCount: 48,
    },
    targetFps: 48,
    expectedDuration: 1,
    expectedFrameCount: 48,
  }))
})

test('generated-cache validation requires normalized range and propagated safe color tags', () => {
  const source = { width: 64, height: 48 }
  const generated = {
    codec: 'h264',
    hasAudio: false,
    width: 64,
    height: 48,
    fps: 24,
    durationSeconds: 1,
    frameCount: 24,
    colorRange: 'tv',
    colorSpace: 'bt709',
    colorPrimaries: 'bt709',
    colorTransfer: 'bt709',
  }
  const expectedColor = resolveOpticalFlowColorConfig({
    pixelFormat: 'yuvj420p',
    colorRange: 'pc',
    colorSpace: 'bt709',
    colorPrimaries: 'bt709',
    colorTransfer: 'bt709',
  })
  assert.doesNotThrow(() => validateGeneratedMetadata({
    source,
    generated,
    targetFps: 24,
    expectedDuration: 1,
    expectedFrameCount: 24,
    expectedColor,
  }))
  assert.throws(() => validateGeneratedMetadata({
    source,
    generated: { ...generated, colorSpace: null },
    targetFps: 24,
    expectedDuration: 1,
    expectedFrameCount: 24,
    expectedColor,
  }), error => (
    error?.code === 'OPTICAL_FLOW_OUTPUT_INVALID'
    && error?.details?.property === 'colorSpace'
  ))
  assert.throws(() => validateGeneratedMetadata({
    source,
    generated: { ...generated, colorRange: 'pc' },
    targetFps: 24,
    expectedDuration: 1,
    expectedFrameCount: 24,
    expectedColor,
  }), /not normalized to limited range/i)
})

test('path preflight constrains cache writes to an allowed project root', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-optical-flow-root-'))
  const allowedRoot = path.join(directory, 'project-cache')
  const inputPath = path.join(directory, 'source.mp4')
  await fsp.mkdir(allowedRoot)
  await fsp.writeFile(inputPath, 'source')
  try {
    await validateOpticalFlowPaths({
      ffmpegPath: process.execPath,
      ffprobePath: process.execPath,
      inputPath,
      outputPath: path.join(allowedRoot, 'nested', 'cache.mp4'),
      allowedOutputRoot: allowedRoot,
    })
    await assert.rejects(validateOpticalFlowPaths({
      ffmpegPath: process.execPath,
      ffprobePath: process.execPath,
      inputPath,
      outputPath: path.join(directory, 'outside', 'cache.mp4'),
      allowedOutputRoot: allowedRoot,
    }), /outside the allowed project cache/i)
    assert.equal(fs.existsSync(path.join(directory, 'outside')), false)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('stale-temp cleanup removes only old direct Optical Flow staged files', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-optical-flow-stale-'))
  const nowMs = Date.now()
  const oldDate = new Date(nowMs - STALE_OPTICAL_FLOW_TEMP_AGE_MS - 1000)
  const freshDate = new Date(nowMs - STALE_OPTICAL_FLOW_TEMP_AGE_MS + 1000)
  const oldTempName = '.clip.velorn-optical-flow-old.tmp.mp4'
  const freshTempName = '.clip.velorn-optical-flow-fresh.tmp.mp4'
  const backupName = '.clip.velorn-optical-flow-old.backup.mp4'
  const unrelatedName = '.unrelated-old.tmp.mp4'
  const nestedDirectory = path.join(directory, '.nested.velorn-optical-flow-old.tmp.mp4')
  const nestedTempPath = path.join(nestedDirectory, '.clip.velorn-optical-flow-old.tmp.mp4')

  try {
    await Promise.all([
      fsp.writeFile(path.join(directory, oldTempName), 'old staged cache'),
      fsp.writeFile(path.join(directory, freshTempName), 'fresh staged cache'),
      fsp.writeFile(path.join(directory, backupName), 'recovery backup'),
      fsp.writeFile(path.join(directory, unrelatedName), 'unrelated'),
      fsp.mkdir(nestedDirectory),
    ])
    await fsp.writeFile(nestedTempPath, 'nested staged cache')
    await Promise.all([
      fsp.utimes(path.join(directory, oldTempName), oldDate, oldDate),
      fsp.utimes(path.join(directory, freshTempName), freshDate, freshDate),
      fsp.utimes(path.join(directory, backupName), oldDate, oldDate),
      fsp.utimes(path.join(directory, unrelatedName), oldDate, oldDate),
      fsp.utimes(nestedTempPath, oldDate, oldDate),
    ])

    const result = await cleanupStaleOpticalFlowTemps({
      cacheRoot: directory,
      nowMs,
    })
    assert.equal(result.removedCount, 1)
    assert.deepEqual(result.removedNames, [oldTempName])
    assert.equal(fs.existsSync(path.join(directory, oldTempName)), false)
    assert.equal(fs.existsSync(path.join(directory, freshTempName)), true)
    assert.equal(fs.existsSync(path.join(directory, backupName)), true)
    assert.equal(fs.existsSync(path.join(directory, unrelatedName)), true)
    assert.equal(fs.existsSync(nestedDirectory), true)
    assert.equal(fs.existsSync(nestedTempPath), true)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('stale-temp cleanup never stats or removes a matching symlink entry', async () => {
  let lstatCalls = 0
  let unlinkCalls = 0
  const result = await cleanupStaleOpticalFlowTemps({
    cacheRoot: path.resolve('/virtual/project/cache'),
    nowMs: STALE_OPTICAL_FLOW_TEMP_AGE_MS * 2,
    fsPromises: {
      readdir: async () => [{
        name: '.clip.velorn-optical-flow-link.tmp.mp4',
        isSymbolicLink: () => true,
      }],
      lstat: async () => {
        lstatCalls += 1
        throw new Error('must not stat symlink')
      },
      unlink: async () => {
        unlinkCalls += 1
      },
    },
  })
  assert.equal(result.removedCount, 0)
  assert.equal(lstatCalls, 0)
  assert.equal(unlinkCalls, 0)
})

test('FFmpeg arguments use motion compensation, preserve timing, remove audio, and never invoke a shell', () => {
  const inputPath = path.join('/tmp', 'source with spaces;still-one-argument.mov')
  const stagedOutputPath = path.join('/tmp', 'cache with spaces.mp4')
  const args = buildOpticalFlowArgs({
    inputPath,
    stagedOutputPath,
    sourceStart: 1.5,
    sourceEnd: 4.75,
    sourceFps: 24,
    targetFps: 60,
    colorConfig: resolveOpticalFlowColorConfig({
      pixelFormat: 'yuvj420p',
      colorRange: 'pc',
      colorSpace: 'bt709',
      colorPrimaries: 'bt709',
      colorTransfer: 'bt709',
    }),
  })
  assert.equal(args[args.indexOf('-i') + 1], inputPath)
  assert.equal(args.at(-1), stagedOutputPath)
  assert.equal(args[args.indexOf('-r') + 1], '60')
  assert.equal(args[args.indexOf('-ss') + 1], '1.5')
  assert.equal(args[args.indexOf('-t') + 1], '3.25')
  assert.ok(args.includes('-an'))
  assert.ok(args.includes('libx264'))
  assert.ok(args.includes('yuv420p'))
  const filter = args[args.indexOf('-vf') + 1]
  assert.match(filter, /minterpolate=fps=60/)
  assert.match(filter, /mi_mode=mci/)
  assert.match(filter, /mc_mode=aobmc/)
  assert.match(filter, /me_mode=bidir/)
  assert.match(filter, /scd=fdiff/)
  assert.match(filter, /^setpts=PTS-STARTPTS,scale=.*in_range=full:out_range=limited/)
  assert.ok(filter.indexOf('scale=') < filter.indexOf('minterpolate='))
  assert.ok(filter.indexOf('setparams=range=limited') > filter.indexOf('format=yuv420p'))
  assert.equal(args[args.indexOf('-color_range') + 1], 'tv')
  assert.equal(args[args.indexOf('-colorspace') + 1], 'bt709')
  assert.match(filter, /trim=duration=3\.25/)
  assert.match(filter, /setpts=PTS-STARTPTS/)
})

test('progress parser handles split records and clamps the reported ratio', () => {
  const updates = []
  const parser = createFfmpegProgressParser({
    durationSeconds: 4,
    onProgress: (progress) => updates.push(progress),
  })
  parser.push('frame=10\nout_time=00:00:01.')
  parser.push('500000\nfps=8.5\nspeed=0.25x\nprogress=continue\r\n')
  parser.push('frame=40\nout_time_us=5000000\nprogress=end\n')
  parser.end()

  assert.equal(updates.length, 2)
  assert.equal(updates[0].processedSeconds, 1.5)
  assert.equal(updates[0].ratio, 0.375)
  assert.equal(updates[0].progress, 37.5)
  assert.equal(updates[0].percent, 37.5)
  assert.equal(updates[0].frame, 10)
  assert.equal(updates[0].fps, 8.5)
  assert.equal(updates[0].speed, '0.25x')
  assert.equal(updates[1].processedSeconds, 5)
  assert.equal(updates[1].ratio, 1)
  assert.equal(updates[1].status, 'end')
})

test('bundled FFmpeg exposes the minterpolate filter', async (t) => {
  if (!bundledFfmpegPath || !fs.existsSync(bundledFfmpegPath)) {
    t.skip('Bundled FFmpeg is unavailable on this platform.')
    return
  }
  const result = await probeMinterpolateSupport({ ffmpegPath: bundledFfmpegPath })
  assert.equal(result.available, true)
  assert.equal(result.engine, 'ffmpeg-minterpolate')
})

test('bundled FFmpeg creates a same-duration high-FPS H.264 cache without audio', { timeout: 30000 }, async (t) => {
  if (
    !bundledFfmpegPath
    || !fs.existsSync(bundledFfmpegPath)
    || !bundledFfprobePath
    || !fs.existsSync(bundledFfprobePath)
  ) {
    t.skip('Bundled FFmpeg/FFprobe is unavailable on this platform.')
    return
  }

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-optical-flow-'))
  const unrotatedInputPath = path.join(directory, 'unrotated source.mp4')
  const inputPath = path.join(directory, 'source clip.mp4')
  const outputPath = path.join(directory, 'cache', 'source.oflow.mp4')
  const phases = []
  const progress = []
  try {
    runSync(bundledFfmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', 'testsrc2=size=64x48:rate=12:duration=1',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-color_range', 'tv',
      '-colorspace', 'bt709',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-c:a', 'aac',
      '-shortest',
      unrotatedInputPath,
    ])
    // Display-matrix rotation is baked by FFmpeg's default autorotation. The
    // backend must validate against display, rather than coded, dimensions.
    runSync(bundledFfmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-display_rotation:v:0', '90',
      '-i', unrotatedInputPath,
      '-map', '0',
      '-c', 'copy',
      inputPath,
    ])
    await fsp.mkdir(path.dirname(outputPath), { recursive: true })
    await fsp.writeFile(outputPath, 'previous cache destination')

    const result = await createOpticalFlowCache({
      ffmpegPath: bundledFfmpegPath,
      ffprobePath: bundledFfprobePath,
      inputPath,
      outputPath,
      allowedOutputRoot: path.dirname(outputPath),
      sourceStart: 0.1,
      sourceEnd: 0.6,
      expectedDuration: 0.5,
      multiplier: 2,
      maxFrames: 100,
      jobId: 'integration',
      onPhase: (phase) => phases.push(phase),
      onProgress: (update) => progress.push(update),
    })

    assert.equal(result.outputPath, outputPath)
    assert.equal(result.engine, 'ffmpeg-minterpolate')
    assert.equal(result.source.hasAudio, true)
    assert.equal(result.source.colorRange, 'tv')
    assert.equal(result.color.inputRange, 'limited')
    assert.equal(result.color.convertsFullRange, false)
    assert.equal(result.source.rotation, 90)
    assert.equal(result.source.displayWidth, 48)
    assert.equal(result.source.displayHeight, 64)
    assert.equal(result.generated.codec, 'h264')
    assert.equal(result.generated.hasAudio, false)
    assert.equal(result.generated.width, 48)
    assert.equal(result.generated.height, 64)
    assert.equal(result.generated.colorRange, 'tv')
    assert.equal(result.generated.colorSpace, 'bt709')
    assert.equal(result.targetFps, 24)
    assert.equal(result.multiplier, 2)
    assert.ok(Math.abs(result.sourceStart - (1 / 12)) < 0.000001)
    assert.ok(Math.abs(result.sourceEnd - (8 / 12)) < 0.000001)
    assert.ok(Math.abs(result.durationSeconds - (7 / 12)) < 0.000001)
    assert.equal(result.expectedFrameCount, 14)
    assert.equal(result.resourceBudget.pixelFrameCount, 48 * 64 * 14)
    assert.equal(result.diskSpace.checked, true)
    assert.equal(result.staleTempCleanup.removedCount, 0)
    assert.ok(Math.abs(result.generated.durationSeconds - (7 / 12)) <= 0.046)
    assert.deepEqual(phases, [
      'validating',
      'cleaning-stale-cache',
      'checking-support',
      'probing-source',
      'checking-disk-space',
      'interpolating',
      'verifying',
      'finalizing',
      'complete',
    ])
    assert.ok(progress.some((update) => update.ratio === 0))
    assert.ok(progress.some((update) => update.ratio === 1))

    const probe = JSON.parse(runSync(bundledFfprobePath, [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,avg_frame_rate:format=duration',
      '-of', 'json',
      outputPath,
    ]))
    assert.deepEqual(probe.streams.map((stream) => stream.codec_type), ['video'])
    assert.equal(probe.streams[0].codec_name, 'h264')
    assert.equal(probe.streams[0].avg_frame_rate, '24/1')

    const paths = createOpticalFlowCachePaths({ outputPath, jobId: 'integration' })
    assert.equal(fs.existsSync(paths.stagedOutputPath), false)
    assert.equal(fs.existsSync(paths.backupOutputPath), false)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('bundled FFmpeg normalizes full-range BT.709 to tagged limited range without washing out color', { timeout: 30000 }, async (t) => {
  if (
    !bundledFfmpegPath
    || !fs.existsSync(bundledFfmpegPath)
    || !bundledFfprobePath
    || !fs.existsSync(bundledFfprobePath)
  ) {
    t.skip('Bundled FFmpeg/FFprobe is unavailable on this platform.')
    return
  }

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-optical-flow-range-'))
  const inputPath = path.join(directory, 'full-range-bt709.mp4')
  const cacheRoot = path.join(directory, 'cache')
  const outputPath = path.join(cacheRoot, 'limited-cache.mp4')
  await fsp.mkdir(cacheRoot)
  try {
    runSync(bundledFfmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', 'testsrc2=size=64x48:rate=12:duration=0.5',
      '-vf', 'scale=iw:ih:in_range=tv:out_range=pc,format=yuvj420p',
      '-an',
      '-c:v', 'libx264',
      '-crf', '12',
      '-pix_fmt', 'yuvj420p',
      '-color_range', 'pc',
      '-colorspace', 'bt709',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      inputPath,
    ])

    const result = await createOpticalFlowCache({
      ffmpegPath: bundledFfmpegPath,
      ffprobePath: bundledFfprobePath,
      inputPath,
      outputPath,
      allowedOutputRoot: cacheRoot,
      sourceStart: 0,
      sourceEnd: 0.5,
      expectedDuration: 0.5,
      targetFps: 24,
      maxFrames: 100,
      jobId: 'full-range-bt709',
    })

    assert.equal(result.source.pixelFormat, 'yuvj420p')
    assert.equal(result.source.colorRange, 'pc')
    assert.equal(result.color.inputRange, 'full')
    assert.equal(result.color.convertsFullRange, true)
    assert.equal(result.generated.pixelFormat, 'yuv420p')
    assert.equal(result.generated.colorRange, 'tv')
    assert.equal(result.generated.colorSpace, 'bt709')
    assert.equal(result.generated.colorPrimaries, 'bt709')
    assert.equal(result.generated.colorTransfer, 'bt709')

    const sourceRgb = runSyncBuffer(bundledFfmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-i', inputPath,
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      'pipe:1',
    ])
    const outputRgb = runSyncBuffer(bundledFfmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-i', outputPath,
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      'pipe:1',
    ])
    const psnr = rgbPsnr(sourceRgb, outputRgb)
    assert.ok(psnr >= 38, `first-frame RGB PSNR was ${psnr.toFixed(2)} dB`)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('cancellation kills interpolation, cleans staged output, and preserves an existing cache', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-optical-flow-cancel-'))
  const inputPath = path.join(directory, 'source.mp4')
  const outputPath = path.join(directory, 'cache.mp4')
  const controller = new AbortController()
  let killCount = 0
  await fsp.writeFile(inputPath, 'source')
  await fsp.writeFile(outputPath, 'keep this cache')

  try {
    await assert.rejects(createOpticalFlowCache({
      ffmpegPath: process.execPath,
      ffprobePath: process.execPath,
      inputPath,
      outputPath,
      sourceStart: 0,
      sourceEnd: 1,
      expectedDuration: 1,
      multiplier: 2,
      maxFrames: 100,
      jobId: 'cancel',
      signal: controller.signal,
      probeSupportImpl: async () => ({ available: true }),
      probeMetadataImpl: async () => sourceMetadata,
      spawnImpl: (_binary, args, options) => {
        assert.equal(options.shell, false)
        assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe'])
        const child = makeFakeChild({ onKill: () => { killCount += 1 } })
        setImmediate(async () => {
          await fsp.writeFile(args.at(-1), 'partial derivative')
          controller.abort()
        })
        return child
      },
    }), error => (
      error?.code === 'OPTICAL_FLOW_CANCELLED'
      && error?.message === OPTICAL_FLOW_CANCELLED_MESSAGE
    ))

    assert.equal(killCount, 1)
    assert.equal(await fsp.readFile(outputPath, 'utf8'), 'keep this cache')
    const paths = createOpticalFlowCachePaths({ outputPath, jobId: 'cancel' })
    assert.equal(fs.existsSync(paths.stagedOutputPath), false)
    assert.equal(fs.existsSync(paths.backupOutputPath), false)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('decoded pixel-frame limit rejects a large cache before FFmpeg starts', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-optical-flow-pixel-limit-'))
  const inputPath = path.join(directory, 'source.mp4')
  const outputPath = path.join(directory, 'cache.mp4')
  let spawnCount = 0
  await fsp.writeFile(inputPath, 'source')
  await fsp.writeFile(outputPath, 'keep this cache')
  try {
    await assert.rejects(createOpticalFlowCache({
      ffmpegPath: process.execPath,
      ffprobePath: process.execPath,
      inputPath,
      outputPath,
      sourceStart: 0,
      sourceEnd: 21,
      expectedDuration: 21,
      targetFps: 48,
      maxFrames: 18000,
      jobId: 'pixel-limit',
      probeSupportImpl: async () => ({ available: true }),
      probeMetadataImpl: async () => ({
        ...sourceMetadata,
        width: 3840,
        height: 2160,
        displayWidth: 3840,
        displayHeight: 2160,
        durationSeconds: 30,
        fps: 24,
        avgFrameRate: 24,
        realFrameRate: 24,
      }),
      spawnImpl: () => {
        spawnCount += 1
        return makeFakeChild()
      },
    }), error => (
      error?.code === 'OPTICAL_FLOW_RESOURCE_LIMIT'
      && error?.details?.displayWidth === 3840
      && error?.details?.expectedFrameCount === 1008
    ))
    assert.equal(spawnCount, 0)
    assert.equal(await fsp.readFile(outputPath, 'utf8'), 'keep this cache')
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('an encoder failure removes a partial derivative and preserves the destination', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-optical-flow-failure-'))
  const inputPath = path.join(directory, 'source.mp4')
  const outputPath = path.join(directory, 'cache.mp4')
  await fsp.writeFile(inputPath, 'source')
  await fsp.writeFile(outputPath, 'keep this cache')

  try {
    await assert.rejects(createOpticalFlowCache({
      ffmpegPath: process.execPath,
      ffprobePath: process.execPath,
      inputPath,
      outputPath,
      sourceStart: 0,
      sourceEnd: 1,
      expectedDuration: 1,
      targetFps: 24,
      maxFrames: 100,
      jobId: 'failed',
      probeSupportImpl: async () => ({ available: true }),
      probeMetadataImpl: async () => sourceMetadata,
      spawnImpl: (_binary, args) => {
        const child = makeFakeChild()
        setImmediate(async () => {
          await fsp.writeFile(args.at(-1), 'partial derivative')
          child.stderr.write('simulated optical-flow failure')
          child.emit('close', 1)
        })
        return child
      },
    }), /simulated optical-flow failure/)

    assert.equal(await fsp.readFile(outputPath, 'utf8'), 'keep this cache')
    const paths = createOpticalFlowCachePaths({ outputPath, jobId: 'failed' })
    assert.equal(fs.existsSync(paths.stagedOutputPath), false)
    assert.equal(fs.existsSync(paths.backupOutputPath), false)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('a source mutation during interpolation discards the derivative and preserves the destination', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-optical-flow-source-change-'))
  const inputPath = path.join(directory, 'source.mp4')
  const outputPath = path.join(directory, 'cache.mp4')
  await fsp.writeFile(inputPath, 'source')
  await fsp.writeFile(outputPath, 'keep this cache')

  try {
    await assert.rejects(createOpticalFlowCache({
      ffmpegPath: process.execPath,
      ffprobePath: process.execPath,
      inputPath,
      outputPath,
      sourceStart: 0,
      sourceEnd: 1,
      expectedDuration: 1,
      targetFps: 24,
      maxFrames: 100,
      jobId: 'source-change',
      probeSupportImpl: async () => ({ available: true }),
      probeMetadataImpl: async ({ inputPath: probedPath }) => (
        probedPath === inputPath ? sourceMetadata : generatedMetadata
      ),
      spawnImpl: (_binary, args) => {
        const child = makeFakeChild()
        setImmediate(async () => {
          await fsp.writeFile(args.at(-1), 'complete derivative')
          await new Promise((resolve) => setTimeout(resolve, 5))
          await fsp.appendFile(inputPath, ' changed')
          child.emit('close', 0)
        })
        return child
      },
    }), error => error?.code === 'OPTICAL_FLOW_SOURCE_CHANGED')

    assert.equal(await fsp.readFile(outputPath, 'utf8'), 'keep this cache')
    const paths = createOpticalFlowCachePaths({ outputPath, jobId: 'source-change' })
    assert.equal(fs.existsSync(paths.stagedOutputPath), false)
    assert.equal(fs.existsSync(paths.backupOutputPath), false)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('a final rename failure restores the previous destination', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-optical-flow-finalize-'))
  const outputPath = path.join(directory, 'cache.mp4')
  const paths = createOpticalFlowCachePaths({ outputPath, sessionId: 'finalize' })
  await fsp.writeFile(outputPath, 'previous cache')
  await fsp.writeFile(paths.stagedOutputPath, 'verified new cache')

  const fsPromises = {
    access: (...args) => fsp.access(...args),
    unlink: (...args) => fsp.unlink(...args),
    rename: async (sourcePath, destinationPath) => {
      if (sourcePath === paths.stagedOutputPath && destinationPath === outputPath) {
        throw new Error('simulated atomic rename failure')
      }
      return fsp.rename(sourcePath, destinationPath)
    },
  }

  try {
    await assert.rejects(finalizeOpticalFlowOutput({
      fsPromises,
      stagedOutputPath: paths.stagedOutputPath,
      outputPath,
      backupOutputPath: paths.backupOutputPath,
      signal: null,
    }), /simulated atomic rename failure/)
    assert.equal(await fsp.readFile(outputPath, 'utf8'), 'previous cache')
    assert.equal(fs.existsSync(paths.backupOutputPath), false)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('an unavailable minterpolate filter fails before interpolation and preserves the cache', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-optical-flow-unavailable-'))
  const inputPath = path.join(directory, 'source.mp4')
  const outputPath = path.join(directory, 'cache.mp4')
  let spawnCount = 0
  await fsp.writeFile(inputPath, 'source')
  await fsp.writeFile(outputPath, 'keep this cache')
  try {
    await assert.rejects(createOpticalFlowCache({
      ffmpegPath: process.execPath,
      ffprobePath: process.execPath,
      inputPath,
      outputPath,
      sourceStart: 0,
      sourceEnd: 1,
      expectedDuration: 1,
      maxFrames: 100,
      jobId: 'unavailable',
      probeSupportImpl: async () => ({ available: false }),
      probeMetadataImpl: async () => sourceMetadata,
      spawnImpl: () => {
        spawnCount += 1
        return makeFakeChild()
      },
    }), error => error?.code === 'OPTICAL_FLOW_UNAVAILABLE')
    assert.equal(spawnCount, 0)
    assert.equal(await fsp.readFile(outputPath, 'utf8'), 'keep this cache')
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})
