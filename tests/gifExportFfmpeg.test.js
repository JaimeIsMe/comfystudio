const assert = require('node:assert/strict')
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { spawnSync } = require('node:child_process')

const ffmpegPath = require('ffmpeg-static')
const ffprobePackage = require('ffprobe-static')
const ffprobePath = ffprobePackage?.path || ffprobePackage
const {
  GIF_DITHER_FILTER,
  GIF_PALETTE_FILTER,
  buildGifEncodeArgs,
  buildGifPaletteArgs,
  createGifExportPaths,
  encodeGifFromPngSequence,
} = require('../electron/gifExportFfmpeg')

const runSync = (binaryPath, args) => {
  const result = spawnSync(binaryPath, args, { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout || `${binaryPath} failed`)
  return result.stdout
}

const makeFakeChild = ({ onKill } = {}) => {
  const child = new EventEmitter()
  child.stderr = new PassThrough()
  child.kill = () => {
    onKill?.()
    setImmediate(() => child.emit('close', null, 'SIGKILL'))
    return true
  }
  return child
}

test('GIF FFmpeg arguments use a global 256-color palette and optimized infinite loop', () => {
  const paletteArgs = buildGifPaletteArgs({
    framePattern: '/tmp/frames/frame_%06d.png',
    fps: 15,
    palettePath: '/tmp/frames/palette.png',
  })
  assert.deepEqual(paletteArgs.slice(paletteArgs.indexOf('-vf'), paletteArgs.indexOf('-vf') + 2), [
    '-vf',
    GIF_PALETTE_FILTER,
  ])
  assert.match(GIF_PALETTE_FILTER, /max_colors=256/)
  assert.match(GIF_PALETTE_FILTER, /reserve_transparent=0/)
  assert.deepEqual(paletteArgs.slice(paletteArgs.indexOf('-start_number'), paletteArgs.indexOf('-start_number') + 2), [
    '-start_number',
    '1',
  ])

  const encodeArgs = buildGifEncodeArgs({
    framePattern: '/tmp/frames/frame_%06d.png',
    fps: 15,
    palettePath: '/tmp/frames/palette.png',
    stagedOutputPath: '/tmp/export.tmp.gif',
  })
  assert.equal(encodeArgs[encodeArgs.indexOf('-filter_complex') + 1], `[0:v][1:v]${GIF_DITHER_FILTER}`)
  assert.deepEqual(encodeArgs.slice(encodeArgs.indexOf('-loop'), encodeArgs.indexOf('-loop') + 2), ['-loop', '0'])
  assert.ok(encodeArgs.includes('-an'))
  assert.ok(!encodeArgs.includes('libx264'))
  assert.ok(!encodeArgs.includes('yuv420p'))
})

test('GIF argument builder rejects invalid frame rates', () => {
  assert.throws(() => buildGifPaletteArgs({
    framePattern: '/tmp/frame_%06d.png',
    fps: 0,
    palettePath: '/tmp/palette.png',
  }), /frame rate/i)
  assert.throws(() => buildGifEncodeArgs({
    framePattern: '/tmp/frame_%06d.png',
    fps: Number.NaN,
    palettePath: '/tmp/palette.png',
    stagedOutputPath: '/tmp/out.gif',
  }), /frame rate/i)
})

test('bundled FFmpeg creates a multi-frame looping GIF and replaces only after success', async (t) => {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath) || !ffprobePath || !fs.existsSync(ffprobePath)) {
    t.skip('Bundled FFmpeg/FFprobe is unavailable on this platform.')
    return
  }

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-gif-export-'))
  const framesDirectory = path.join(directory, 'frames')
  const framePattern = path.join(framesDirectory, 'frame_%06d.png')
  const outputPath = path.join(directory, 'delivery.gif')
  await fsp.mkdir(framesDirectory)

  try {
    runSync(ffmpegPath, [
      '-v', 'error',
      '-f', 'lavfi',
      '-i', 'testsrc2=size=64x48:rate=5:duration=0.8',
      '-start_number', '1',
      framePattern,
    ])
    await fsp.writeFile(outputPath, 'previous destination')

    const result = await encodeGifFromPngSequence({
      ffmpegPath,
      framePattern,
      fps: 5,
      outputPath,
      sessionId: 'integration',
    })

    assert.equal(result.outputPath, outputPath)
    assert.equal(result.encoderUsed, 'gif-palette')
    const gifBytes = await fsp.readFile(outputPath)
    assert.match(gifBytes.subarray(0, 6).toString('ascii'), /^GIF8[79]a$/)
    assert.notEqual(gifBytes.indexOf(Buffer.from('NETSCAPE2.0', 'ascii')), -1, 'infinite-loop application extension is present')

    const probe = JSON.parse(runSync(ffprobePath, [
      '-v', 'error',
      '-count_frames',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,nb_read_frames',
      '-of', 'json',
      outputPath,
    ]))
    assert.equal(probe.streams?.[0]?.codec_name, 'gif')
    assert.equal(probe.streams?.[0]?.width, 64)
    assert.equal(probe.streams?.[0]?.height, 48)
    assert.ok(Number(probe.streams?.[0]?.nb_read_frames) >= 3)

    const paths = createGifExportPaths({ framePattern, outputPath, sessionId: 'integration' })
    assert.equal(fs.existsSync(paths.palettePath), false)
    assert.equal(fs.existsSync(paths.stagedOutputPath), false)
    assert.equal(fs.existsSync(paths.backupOutputPath), false)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('cancellation kills the active FFmpeg pass, cleans scratch, and preserves destination', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-gif-cancel-'))
  const framePattern = path.join(directory, 'frame_%06d.png')
  const outputPath = path.join(directory, 'delivery.gif')
  const controller = new AbortController()
  let killCount = 0

  await fsp.writeFile(outputPath, 'keep me')
  try {
    const promise = encodeGifFromPngSequence({
      ffmpegPath: '/fake/ffmpeg',
      framePattern,
      fps: 15,
      outputPath,
      sessionId: 'cancel-pass',
      signal: controller.signal,
      spawnImpl: () => makeFakeChild({ onKill: () => { killCount += 1 } }),
      onPhase: (phase) => {
        if (phase === 'palette') setImmediate(() => controller.abort())
      },
    })

    await assert.rejects(promise, error => (
      error?.message === 'Export cancelled' && error?.code === 'EXPORT_CANCELLED'
    ))
    assert.equal(killCount, 1)
    assert.equal(await fsp.readFile(outputPath, 'utf8'), 'keep me')

    const paths = createGifExportPaths({ framePattern, outputPath, sessionId: 'cancel-pass' })
    assert.equal(fs.existsSync(paths.palettePath), false)
    assert.equal(fs.existsSync(paths.stagedOutputPath), false)
    assert.equal(fs.existsSync(paths.backupOutputPath), false)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('cancellation between palette and encode passes never starts the second FFmpeg process', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-gif-between-'))
  const framePattern = path.join(directory, 'frame_%06d.png')
  const outputPath = path.join(directory, 'delivery.gif')
  const controller = new AbortController()
  let spawnCount = 0

  await fsp.writeFile(outputPath, 'keep me')
  try {
    await assert.rejects(encodeGifFromPngSequence({
      ffmpegPath: '/fake/ffmpeg',
      framePattern,
      fps: 15,
      outputPath,
      sessionId: 'between-passes',
      signal: controller.signal,
      spawnImpl: (_binary, args) => {
        spawnCount += 1
        const child = makeFakeChild()
        setImmediate(async () => {
          await fsp.writeFile(args.at(-1), 'palette')
          child.emit('close', 0)
        })
        return child
      },
      onPhase: (phase) => {
        if (phase === 'encode') controller.abort()
      },
    }), /Export cancelled/)

    assert.equal(spawnCount, 1)
    assert.equal(await fsp.readFile(outputPath, 'utf8'), 'keep me')
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('an encode failure removes a partial staged GIF and preserves destination', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-gif-failure-'))
  const framePattern = path.join(directory, 'frame_%06d.png')
  const outputPath = path.join(directory, 'delivery.gif')
  let spawnCount = 0

  await fsp.writeFile(outputPath, 'keep me')
  try {
    await assert.rejects(encodeGifFromPngSequence({
      ffmpegPath: '/fake/ffmpeg',
      framePattern,
      fps: 15,
      outputPath,
      sessionId: 'failed-encode',
      spawnImpl: (_binary, args) => {
        spawnCount += 1
        const child = makeFakeChild()
        setImmediate(async () => {
          await fsp.writeFile(args.at(-1), spawnCount === 1 ? 'palette' : 'partial gif')
          if (spawnCount === 2) child.stderr.write('simulated encoder failure')
          child.emit('close', spawnCount === 1 ? 0 : 1)
        })
        return child
      },
    }), /simulated encoder failure/)

    assert.equal(spawnCount, 2)
    assert.equal(await fsp.readFile(outputPath, 'utf8'), 'keep me')
    const paths = createGifExportPaths({ framePattern, outputPath, sessionId: 'failed-encode' })
    assert.equal(fs.existsSync(paths.palettePath), false)
    assert.equal(fs.existsSync(paths.stagedOutputPath), false)
    assert.equal(fs.existsSync(paths.backupOutputPath), false)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('a final output rename failure restores the previous destination', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-gif-finalize-'))
  const framePattern = path.join(directory, 'frame_%06d.png')
  const outputPath = path.join(directory, 'delivery.gif')
  let spawnCount = 0

  const fsPromises = {
    access: (...args) => fsp.access(...args),
    unlink: (...args) => fsp.unlink(...args),
    rename: async (sourcePath, destinationPath) => {
      if (sourcePath.endsWith('.tmp.gif') && destinationPath === outputPath) {
        throw new Error('simulated final rename failure')
      }
      return fsp.rename(sourcePath, destinationPath)
    },
  }

  await fsp.writeFile(outputPath, 'keep me')
  try {
    await assert.rejects(encodeGifFromPngSequence({
      ffmpegPath: '/fake/ffmpeg',
      framePattern,
      fps: 15,
      outputPath,
      sessionId: 'failed-finalize',
      fsPromises,
      spawnImpl: (_binary, args) => {
        spawnCount += 1
        const child = makeFakeChild()
        setImmediate(async () => {
          await fsp.writeFile(args.at(-1), spawnCount === 1 ? 'palette' : 'complete staged gif')
          child.emit('close', 0)
        })
        return child
      },
    }), /simulated final rename failure/)

    assert.equal(spawnCount, 2)
    assert.equal(await fsp.readFile(outputPath, 'utf8'), 'keep me')
    const paths = createGifExportPaths({ framePattern, outputPath, sessionId: 'failed-finalize' })
    assert.equal(fs.existsSync(paths.palettePath), false)
    assert.equal(fs.existsSync(paths.stagedOutputPath), false)
    assert.equal(fs.existsSync(paths.backupOutputPath), false)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('cancellation before atomic finalization leaves the previous destination untouched', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-gif-cancel-finalize-'))
  const framePattern = path.join(directory, 'frame_%06d.png')
  const outputPath = path.join(directory, 'delivery.gif')
  const controller = new AbortController()
  let spawnCount = 0

  await fsp.writeFile(outputPath, 'keep me')
  try {
    await assert.rejects(encodeGifFromPngSequence({
      ffmpegPath: '/fake/ffmpeg',
      framePattern,
      fps: 15,
      outputPath,
      sessionId: 'cancel-finalize',
      signal: controller.signal,
      spawnImpl: (_binary, args) => {
        spawnCount += 1
        const child = makeFakeChild()
        setImmediate(async () => {
          await fsp.writeFile(args.at(-1), spawnCount === 1 ? 'palette' : 'complete staged gif')
          child.emit('close', 0)
        })
        return child
      },
      onPhase: (phase) => {
        if (phase === 'finalize') controller.abort()
      },
    }), error => (
      error?.message === 'Export cancelled' && error?.code === 'EXPORT_CANCELLED'
    ))

    assert.equal(spawnCount, 2)
    assert.equal(await fsp.readFile(outputPath, 'utf8'), 'keep me')
    const paths = createGifExportPaths({ framePattern, outputPath, sessionId: 'cancel-finalize' })
    assert.equal(fs.existsSync(paths.palettePath), false)
    assert.equal(fs.existsSync(paths.stagedOutputPath), false)
    assert.equal(fs.existsSync(paths.backupOutputPath), false)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})
