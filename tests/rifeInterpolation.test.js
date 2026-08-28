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
  DEFAULT_RIFE_THREADS,
  RIFE_ENGINE,
  STALE_RIFE_WORK_AGE_MS,
  buildRifeArgs,
  buildRifeDecodeArgs,
  buildRifeEncodeArgs,
  buildSceneCutDetectionArgs,
  cleanupStaleRifeWorkDirectories,
  createOverallProgressEmitter,
  createRifeInterpolationCache,
  createRifeProgressParser,
  createRifeWorkPaths,
  createSceneCutParser,
  estimateRifeScratchBytes,
  getRifeSceneCutReplacementPlan,
  probeRifeRuntime,
  resolveRifeFramePlan,
  validateRifeRuntime,
} = require('../electron/rifeInterpolation')

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

async function createFixture(prefix = 'velorn-rife-test-') {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), prefix))
  const cacheRoot = path.join(directory, 'cache')
  const inputPath = path.join(directory, 'source.mp4')
  const outputPath = path.join(cacheRoot, 'cache.mp4')
  const rifeExecutablePath = path.join(directory, process.platform === 'win32' ? 'rife-ncnn-vulkan.exe' : 'rife-ncnn-vulkan')
  const modelPath = path.join(directory, 'rife-v4.6')
  await fsp.mkdir(cacheRoot)
  await fsp.mkdir(modelPath)
  await Promise.all([
    fsp.writeFile(inputPath, 'source video'),
    fsp.writeFile(rifeExecutablePath, 'fake executable'),
    fsp.writeFile(path.join(modelPath, 'flownet.param'), 'model parameters'),
    fsp.writeFile(path.join(modelPath, 'flownet.bin'), 'model weights'),
  ])
  if (process.platform !== 'win32') await fsp.chmod(rifeExecutablePath, 0o700)
  return { directory, cacheRoot, inputPath, outputPath, rifeExecutablePath, modelPath }
}

const sourceMetadata = {
  codec: 'h264',
  pixelFormat: 'yuv420p',
  width: 64,
  height: 48,
  displayWidth: 64,
  displayHeight: 48,
  rotation: 0,
  startTime: 0,
  durationSeconds: 1,
  fps: 12,
  avgFrameRate: 12,
  realFrameRate: 12,
  variableFrameRate: false,
  hasAudio: false,
  colorRange: null,
  colorSpace: null,
  colorPrimaries: null,
  colorTransfer: null,
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

function getArg(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : null
}

function makeSuccessfulPipelineSpawn({
  rifeExecutablePath,
  inputPath,
  sourcePathToMutate = null,
  onProtectedFrame = null,
} = {}) {
  return (binaryPath, args, options) => {
    assert.equal(options.shell, false)
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe'])
    const child = makeFakeChild()
    setImmediate(async () => {
      try {
        if (binaryPath === rifeExecutablePath) {
          const inputFramesPath = getArg(args, '-i')
          const outputFramesPath = getArg(args, '-o')
          const count = Number(getArg(args, '-n'))
          assert.equal(getArg(args, '-j'), DEFAULT_RIFE_THREADS)
          assert.equal(args.includes('-g'), false)
          assert.equal(getArg(args, '-m'), 'rife-v4.6')
          assert.equal(options.cwd, path.dirname(inputPath))
          assert.ok(args.includes('-u'))
          for (let frame = 1; frame <= count; frame += 1) {
            const name = `${String(frame).padStart(8, '0')}.png`
            await fsp.writeFile(path.join(outputFramesPath, name), `rife-${frame}`)
            child.stderr.write(
              `${path.join(inputFramesPath, '00000001.png')} ${path.join(inputFramesPath, '00000002.png')} 0.5 -> ${path.join(outputFramesPath, name)} done\n`
            )
          }
        } else if (args.at(-1) === '-') {
          child.stderr.write('[Parsed_showinfo_1] n: 0 pts: 6 pts_time:0.5 duration:1\n')
        } else if (String(args.at(-1)).endsWith('%08d.png')) {
          const framePattern = args.at(-1)
          const count = Number(getArg(args, '-frames:v'))
          for (let frame = 1; frame <= count; frame += 1) {
            await fsp.writeFile(
              framePattern.replace('%08d', String(frame).padStart(8, '0')),
              `input-${frame}`
            )
          }
          child.stderr.write(`frame=${count}\nout_time_us=1000000\nprogress=end\n`)
        } else {
          const outputFramePattern = getArg(args, '-i')
          const protectedFramePath = outputFramePattern.replace('%08d', '00000012')
          onProtectedFrame?.(await fsp.readFile(protectedFramePath, 'utf8'))
          await fsp.writeFile(args.at(-1), 'encoded optical-flow cache')
          if (sourcePathToMutate) await fsp.appendFile(sourcePathToMutate, ' changed')
          child.stderr.write('frame=24\nout_time_us=1000000\nprogress=end\n')
        }
        child.emit('close', 0)
      } catch (error) {
        child.stderr.write(error.stack || error.message)
        child.emit('close', 1)
      }
    })
    return child
  }
}

test('RIFE arguments use ncnn discrete-first GPU auto-selection and preserve explicit device injection', () => {
  const args = buildRifeArgs({
    inputFramesPath: '/tmp/input frames',
    outputFramesPath: '/tmp/output frames',
    modelPath: '/tmp/rife-v4.6',
    targetFrameCount: 452,
  })
  assert.deepEqual(args, [
    '-i', '/tmp/input frames',
    '-o', '/tmp/output frames',
    '-n', '452',
    '-m', '/tmp/rife-v4.6',
    '-j', '2:4:2',
    '-f', '%08d.png',
    '-v',
    '-u',
  ])
  const explicitGpuArgs = buildRifeArgs({
    inputFramesPath: '/tmp/in',
    outputFramesPath: '/tmp/out',
    modelPath: '/tmp/rife-v4.6',
    targetFrameCount: 2,
    gpuId: 3,
  })
  assert.equal(getArg(explicitGpuArgs, '-g'), '3')
  assert.throws(() => buildRifeArgs({
    inputFramesPath: '/tmp/in',
    outputFramesPath: '/tmp/out',
    modelPath: '/tmp/rife-v4.6',
    targetFrameCount: 2,
    gpuId: -1,
  }), /GPU id/i)
})

test('decode, scene detection, and encode arguments use exact frame counts and no shell quoting', () => {
  const decode = buildRifeDecodeArgs({
    inputPath: '/media/source with spaces.mp4',
    inputFramePattern: '/cache/input/%08d.png',
    sourceStart: 1.25,
    durationSeconds: 2.5,
    sourceFrameCount: 60,
  })
  assert.equal(getArg(decode, '-ss'), '1.25')
  assert.equal(getArg(decode, '-t'), '2.5')
  assert.equal(getArg(decode, '-frames:v'), '60')
  assert.equal(decode.at(-1), '/cache/input/%08d.png')
  assert.ok(decode.includes('setpts=PTS-STARTPTS,format=rgb24'))

  const cuts = buildSceneCutDetectionArgs({
    inputFramePattern: '/cache/input/%08d.png',
    sourceFps: 24,
    threshold: 0.25,
  })
  assert.ok(cuts.includes("select='gt(scene,0.25)',showinfo"))

  const encode = buildRifeEncodeArgs({
    outputFramePattern: '/cache/output/%08d.png',
    stagedOutputPath: '/cache/.cache.tmp.mp4',
    targetFps: 48,
    targetFrameCount: 120,
    colorConfig: { inputRange: 'limited', colorSpace: 'bt709' },
  })
  assert.equal(getArg(encode, '-framerate'), '48')
  assert.equal(getArg(encode, '-frames:v'), '120')
  assert.equal(getArg(encode, '-r'), '48')
  assert.ok(getArg(encode, '-vf').includes('out_color_matrix=bt709'))
  assert.equal(encode.at(-1), '/cache/.cache.tmp.mp4')
})

test('scene-cut replacement mapping mirrors RIFE directory-mode t=i*N/M behavior', () => {
  assert.deepEqual(getRifeSceneCutReplacementPlan({
    sourceFrameCount: 4,
    targetFrameCount: 8,
    cutSourceFrameIndices: [2],
  }), [{
    outputFrameNumber: 4,
    sourceFrameNumber: 2,
    cutSourceFrameIndex: 2,
    fraction: 0.5,
  }])

  assert.deepEqual(getRifeSceneCutReplacementPlan({
    sourceFrameCount: 4,
    targetFrameCount: 10,
    cutSourceFrameIndices: [2],
  }).map(({ outputFrameNumber, sourceFrameNumber }) => ({ outputFrameNumber, sourceFrameNumber })), [
    { outputFrameNumber: 4, sourceFrameNumber: 2 },
    { outputFrameNumber: 5, sourceFrameNumber: 2 },
  ])
})

test('frame planning derives target count from decoded N and preserves exact CFR duration', () => {
  const plan = resolveRifeFramePlan({
    durationSeconds: 10 / 23.976,
    sourceFps: 23.976,
    requestedTargetFps: 60,
    maxFrames: 100,
  })
  assert.equal(plan.sourceFrameCount, 10)
  assert.equal(plan.targetFrameCount, 26)
  assert.equal(plan.targetFps, 62.3376)
  assert.equal(plan.multiplier, 2.6)
  assert.ok(Math.abs(plan.durationSeconds - (10 / 23.976)) < 0.000001)

  const shortPlan = resolveRifeFramePlan({
    durationSeconds: 3 / 24,
    sourceFps: 24,
    requestedTargetFps: 50,
    maxFrames: 100,
  })
  assert.equal(shortPlan.sourceFrameCount, 3)
  assert.equal(shortPlan.targetFrameCount, 7)
  assert.ok(shortPlan.targetFps >= 50)

  assert.throws(() => resolveRifeFramePlan({
    durationSeconds: 2 / 23.976,
    sourceFps: 23.976,
    requestedTargetFps: 23.976,
    maxFrames: 100,
  }), /too short.*add a frame/i)
})

test('RIFE and scene-cut progress parsers handle fragmented subprocess output', () => {
  const progress = []
  const emitProgress = createOverallProgressEmitter({
    jobId: 'progress',
    onProgress: (event) => progress.push(event),
  })
  const rife = createRifeProgressParser({ targetFrameCount: 2, emitProgress })
  rife.push('/in/1.png /in/2.png 0.0 -> /out/1')
  rife.push('.png done\n/in/1.png /in/2.png 1.0 -> /out/2.png done\n')
  rife.end()
  assert.equal(rife.completedFrames, 2)
  assert.equal(progress.at(-1).phase, 'interpolating')
  assert.equal(progress.at(-1).progress, 85)

  const cuts = createSceneCutParser({ sourceFps: 24, sourceFrameCount: 100 })
  cuts.push('[Parsed_showinfo_1] n:0 pts:24 pts_time:')
  cuts.push('1.0 duration:1\n')
  assert.deepEqual(cuts.end(), [24])
})

test('runtime validation requires a readable executable and a contained v4 model', async () => {
  const fixture = await createFixture('velorn-rife-runtime-')
  try {
    const runtime = await validateRifeRuntime(fixture)
    assert.equal(runtime.modelName, 'rife-v4.6')
    assert.ok(runtime.modelFiles['flownet.bin'].size > 0)

    await assert.rejects(validateRifeRuntime({
      ...fixture,
      modelPath: path.join(fixture.directory, 'renamed-model'),
    }), /folder whose name contains "rife-v4"/i)
  } finally {
    await fsp.rm(fixture.directory, { recursive: true, force: true })
  }
})

test('trusted RIFE probes require a zero exit and the PNG-only secure-build marker', async () => {
  const spawnHelp = ({ output, exitCode }) => () => {
    const child = makeFakeChild()
    setImmediate(() => {
      child.stderr.write(output)
      child.emit('close', exitCode)
    })
    return child
  }
  const legacyHelp = 'Usage: rife-ncnn-vulkan -i indir -o outdir\n  -n num-frame\n'
  const secureHelp = `${legacyHelp}  Velorn secure build: PNG input and output only; WebP is disabled.\n`

  const legacyDevelopment = await probeRifeRuntime({
    rifeExecutablePath: '/development/rife-ncnn-vulkan',
    spawnImpl: spawnHelp({ output: legacyHelp, exitCode: 255 }),
  })
  assert.equal(legacyDevelopment.available, true)

  await assert.rejects(probeRifeRuntime({
    rifeExecutablePath: '/packaged/rife-ncnn-vulkan',
    requireSecureBuild: true,
    spawnImpl: spawnHelp({ output: legacyHelp, exitCode: 255 }),
  }), error => (
    error?.code === 'OPTICAL_FLOW_UNAVAILABLE'
    && /secure startup check/i.test(error.message)
  ))

  await assert.rejects(probeRifeRuntime({
    rifeExecutablePath: '/packaged/rife-ncnn-vulkan',
    requireSecureBuild: true,
    spawnImpl: spawnHelp({ output: legacyHelp, exitCode: 0 }),
  }), error => (
    error?.code === 'OPTICAL_FLOW_UNAVAILABLE'
    && /secure-build marker/i.test(error.message)
  ))

  const trusted = await probeRifeRuntime({
    rifeExecutablePath: '/packaged/rife-ncnn-vulkan',
    requireSecureBuild: true,
    spawnImpl: spawnHelp({ output: secureHelp, exitCode: 0 }),
  })
  assert.equal(trusted.available, true)
})

test('pipeline rejects a cache destination outside the allowed project root before spawning', async () => {
  const fixture = await createFixture('velorn-rife-root-')
  let probeCount = 0
  try {
    await assert.rejects(createRifeInterpolationCache({
      ffmpegPath: process.execPath,
      ffprobePath: process.execPath,
      ...fixture,
      outputPath: path.join(fixture.directory, 'outside', 'cache.mp4'),
      allowedOutputRoot: fixture.cacheRoot,
      sourceStart: 0,
      sourceEnd: 1,
      expectedDuration: 1,
      targetFps: 24,
      maxFrames: 100,
      jobId: 'outside-root',
      probeRuntimeImpl: async () => {
        probeCount += 1
        return { available: true }
      },
    }), /outside the allowed project cache/i)
    assert.equal(probeCount, 0)
    assert.equal(fs.existsSync(path.join(fixture.directory, 'outside')), false)
  } finally {
    await fsp.rm(fixture.directory, { recursive: true, force: true })
  }
})

test('scratch estimate accounts for both decoded and interpolated lossless PNG frames', () => {
  assert.equal(estimateRifeScratchBytes({
    width: 64,
    height: 48,
    sourceFrameCount: 12,
    targetFrameCount: 24,
  }), Math.ceil(64 * 48 * 36 * 3.1))
})

test('stale cleanup removes only old direct owned RIFE work directories', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-rife-stale-'))
  const oldName = '.cache.velorn-rife-old.work'
  const freshName = '.cache.velorn-rife-fresh.work'
  const unrelatedName = '.cache.other.work'
  try {
    await Promise.all([
      fsp.mkdir(path.join(directory, oldName)),
      fsp.mkdir(path.join(directory, freshName)),
      fsp.mkdir(path.join(directory, unrelatedName)),
    ])
    const oldTime = new Date(Date.now() - STALE_RIFE_WORK_AGE_MS - 1000)
    await fsp.utimes(path.join(directory, oldName), oldTime, oldTime)
    const result = await cleanupStaleRifeWorkDirectories({ cacheRoot: directory })
    assert.equal(result.removedCount, 1)
    assert.deepEqual(result.removedNames, [oldName])
    assert.equal(fs.existsSync(path.join(directory, oldName)), false)
    assert.equal(fs.existsSync(path.join(directory, freshName)), true)
    assert.equal(fs.existsSync(path.join(directory, unrelatedName)), true)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('pipeline validates counts, protects a scene cut, atomically replaces output, and cleans scratch', async () => {
  const fixture = await createFixture('velorn-rife-success-')
  const phases = []
  const progress = []
  let protectedFrame = null
  await fsp.writeFile(fixture.outputPath, 'previous cache')
  try {
    const result = await createRifeInterpolationCache({
      ffmpegPath: process.execPath,
      ffprobePath: process.execPath,
      ...fixture,
      allowedOutputRoot: fixture.cacheRoot,
      sourceStart: 0,
      sourceEnd: 1,
      expectedDuration: 1,
      targetFps: 24,
      maxFrames: 100,
      jobId: 'successful-rife',
      onPhase: (phase) => phases.push(phase),
      onProgress: (event) => progress.push(event),
      probeRuntimeImpl: async () => ({ available: true }),
      probeMetadataImpl: async ({ inputPath: probedPath }) => (
        probedPath === fixture.inputPath ? sourceMetadata : generatedMetadata
      ),
      spawnImpl: makeSuccessfulPipelineSpawn({
        rifeExecutablePath: fixture.rifeExecutablePath,
        inputPath: fixture.inputPath,
        onProtectedFrame: (value) => { protectedFrame = value },
      }),
    })

    assert.equal(result.engine, RIFE_ENGINE)
    assert.equal(result.modelName, 'rife-v4.6')
    assert.equal(result.sourceFrameCount, 12)
    assert.equal(result.frameCount, 24)
    assert.deepEqual(result.sceneCutSourceFrameIndices, [6])
    assert.equal(result.sceneCutReplacementFrameCount, 1)
    assert.equal(protectedFrame, 'input-6')
    assert.equal(await fsp.readFile(fixture.outputPath, 'utf8'), 'encoded optical-flow cache')
    assert.ok(phases.includes('decoding'))
    assert.ok(phases.includes('detecting-scenes'))
    assert.ok(phases.includes('interpolating'))
    assert.ok(phases.includes('protecting-scene-cuts'))
    assert.ok(phases.includes('encoding'))
    assert.equal(phases.at(-1), 'complete')
    assert.equal(progress.at(-1).progress, 100)
    for (let index = 1; index < progress.length; index += 1) {
      assert.ok(progress[index].progress >= progress[index - 1].progress)
    }
    const paths = createRifeWorkPaths({ outputPath: fixture.outputPath, jobId: 'successful-rife' })
    assert.equal(fs.existsSync(paths.workRoot), false)
    assert.equal(fs.existsSync(paths.stagedOutputPath), false)
    assert.equal(fs.existsSync(paths.backupOutputPath), false)
  } finally {
    await fsp.rm(fixture.directory, { recursive: true, force: true })
  }
})

test('cancellation kills RIFE, cleans scratch, and preserves an existing destination', async () => {
  const fixture = await createFixture('velorn-rife-cancel-')
  const controller = new AbortController()
  let killCount = 0
  await fsp.writeFile(fixture.outputPath, 'keep this cache')
  try {
    const normalSpawn = makeSuccessfulPipelineSpawn({
      rifeExecutablePath: '__never_match__',
      inputPath: fixture.inputPath,
    })
    await assert.rejects(createRifeInterpolationCache({
      ffmpegPath: process.execPath,
      ffprobePath: process.execPath,
      ...fixture,
      allowedOutputRoot: fixture.cacheRoot,
      sourceStart: 0,
      sourceEnd: 1,
      expectedDuration: 1,
      targetFps: 24,
      maxFrames: 100,
      jobId: 'cancelled-rife',
      signal: controller.signal,
      probeRuntimeImpl: async () => ({ available: true }),
      probeMetadataImpl: async () => sourceMetadata,
      spawnImpl: (binaryPath, args, options) => {
        if (binaryPath !== fixture.rifeExecutablePath) return normalSpawn(binaryPath, args, options)
        const child = makeFakeChild({ onKill: () => { killCount += 1 } })
        setImmediate(() => controller.abort())
        return child
      },
    }), error => error?.code === 'OPTICAL_FLOW_CANCELLED')

    assert.equal(killCount, 1)
    assert.equal(await fsp.readFile(fixture.outputPath, 'utf8'), 'keep this cache')
    const paths = createRifeWorkPaths({ outputPath: fixture.outputPath, jobId: 'cancelled-rife' })
    assert.equal(fs.existsSync(paths.workRoot), false)
    assert.equal(fs.existsSync(paths.stagedOutputPath), false)
  } finally {
    await fsp.rm(fixture.directory, { recursive: true, force: true })
  }
})

test('source mutation before commit discards the derivative and preserves the destination', async () => {
  const fixture = await createFixture('velorn-rife-source-change-')
  await fsp.writeFile(fixture.outputPath, 'keep this cache')
  try {
    await assert.rejects(createRifeInterpolationCache({
      ffmpegPath: process.execPath,
      ffprobePath: process.execPath,
      ...fixture,
      allowedOutputRoot: fixture.cacheRoot,
      sourceStart: 0,
      sourceEnd: 1,
      expectedDuration: 1,
      targetFps: 24,
      maxFrames: 100,
      jobId: 'changed-source-rife',
      probeRuntimeImpl: async () => ({ available: true }),
      probeMetadataImpl: async ({ inputPath: probedPath }) => (
        probedPath === fixture.inputPath ? sourceMetadata : generatedMetadata
      ),
      spawnImpl: makeSuccessfulPipelineSpawn({
        rifeExecutablePath: fixture.rifeExecutablePath,
        inputPath: fixture.inputPath,
        sourcePathToMutate: fixture.inputPath,
      }),
    }), error => error?.code === 'OPTICAL_FLOW_SOURCE_CHANGED')
    assert.equal(await fsp.readFile(fixture.outputPath, 'utf8'), 'keep this cache')
  } finally {
    await fsp.rm(fixture.directory, { recursive: true, force: true })
  }
})

const realRifeExecutablePath = process.env.VELORN_RIFE_TEST_EXECUTABLE
const realRifeModelPath = process.env.VELORN_RIFE_TEST_MODEL
const runRealRifeSmoke = process.platform === 'linux'
  && Boolean(realRifeExecutablePath)
  && Boolean(realRifeModelPath)

test('real Linux portable RIFE smoke creates an exact same-duration 2x cache', {
  skip: runRealRifeSmoke ? false : 'set VELORN_RIFE_TEST_EXECUTABLE and VELORN_RIFE_TEST_MODEL',
  timeout: 60000,
}, async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-rife-real-'))
  const cacheRoot = path.join(directory, 'cache')
  const inputPath = path.join(directory, 'source.mp4')
  const outputPath = path.join(cacheRoot, 'cache.mp4')
  await fsp.mkdir(cacheRoot)
  try {
    const generated = spawnSync(bundledFfmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', 'color=red:size=64x48:rate=12:duration=0.25',
      '-f', 'lavfi',
      '-i', 'color=blue:size=64x48:rate=12:duration=0.25',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0',
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-color_range', 'tv',
      '-colorspace', 'bt709',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      inputPath,
    ], { encoding: 'utf8' })
    assert.equal(generated.status, 0, generated.stderr)

    const result = await createRifeInterpolationCache({
      ffmpegPath: bundledFfmpegPath,
      ffprobePath: bundledFfprobePath,
      rifeExecutablePath: realRifeExecutablePath,
      modelPath: realRifeModelPath,
      inputPath,
      outputPath,
      allowedOutputRoot: cacheRoot,
      sourceStart: 0,
      sourceEnd: 0.5,
      expectedDuration: 0.5,
      targetFps: 24,
      maxFrames: 100,
      jobId: 'real-linux-smoke',
    })
    assert.equal(result.engine, RIFE_ENGINE)
    assert.equal(result.sourceFrameCount, 6)
    assert.equal(result.frameCount, 12)
    assert.equal(result.generated.fps, 24)
    assert.equal(result.generated.colorRange, 'tv')
    assert.equal(result.generated.colorSpace, 'bt709')
    assert.equal(result.generated.colorPrimaries, 'bt709')
    assert.equal(result.generated.colorTransfer, 'bt709')
    assert.deepEqual(result.sceneCutSourceFrameIndices, [3])
    assert.equal(result.sceneCutReplacementFrameCount, 1)
    assert.ok(Math.abs(result.generated.durationSeconds - 0.5) < 0.01)
    assert.equal(fs.existsSync(outputPath), true)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})
