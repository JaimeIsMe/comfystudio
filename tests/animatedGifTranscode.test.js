const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { EventEmitter } = require('node:events')

const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('@derhuerst/ffprobe-static')
const {
  MAX_GIF_DECODE_PIXELS,
  MAX_GIF_FRAMES,
  MAX_GIF_STRUCTURE_BLOCKS,
  normalizeGifDelayCentiseconds,
  parseGifBuffer,
  probeGifFile,
  readSubBlocks,
  runProcess,
  transcodeAnimatedGif,
} = require('../electron/animatedGifTranscode')

function runBinary(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function uint16(value) {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value)
  return buffer
}

function makeGif({
  width = 1,
  height = 1,
  frames = [{ delay: 10, transparent: false }],
  loopCount = null,
  trailer = true,
} = {}) {
  const logicalScreen = Buffer.concat([
    Buffer.from('GIF89a', 'ascii'),
    uint16(width),
    uint16(height),
    // Global two-entry color table, background index, pixel aspect.
    Buffer.from([0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff]),
  ])
  const blocks = [logicalScreen]
  if (loopCount !== null) {
    blocks.push(Buffer.concat([
      Buffer.from([0x21, 0xff, 0x0b]),
      Buffer.from('NETSCAPE2.0', 'ascii'),
      Buffer.from([0x03, 0x01]),
      uint16(loopCount),
      Buffer.from([0x00]),
    ]))
  }
  for (const frame of frames) {
    const delay = Math.max(0, Math.min(65535, Number(frame.delay) || 0))
    blocks.push(Buffer.concat([
      // Graphics control extension.
      Buffer.from([0x21, 0xf9, 0x04, frame.transparent ? 0x01 : 0x00]),
      uint16(delay),
      Buffer.from([0x00, 0x00]),
      // Full 1x1 image descriptor and one LZW data sub-block. 0x44 selects
      // transparent palette index 0; 0x4c selects opaque palette index 1.
      Buffer.from([
        0x2c,
        0x00, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x00,
        0x00,
        0x02, 0x01, frame.transparent ? 0x44 : 0x4c, 0x00,
      ]),
    ]))
  }
  if (trailer) blocks.push(Buffer.from([0x3b]))
  return Buffer.concat(blocks)
}

function addApplicationPadding(gif, blockCount) {
  const padding = Buffer.alloc(blockCount * 2)
  for (let offset = 0; offset < padding.length; offset += 2) {
    padding[offset] = 1
    padding[offset + 1] = 0x41
  }
  const extension = Buffer.concat([
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from('PADDING0000', 'ascii'),
    padding,
    Buffer.from([0x00]),
  ])
  // Header + logical screen descriptor + two-entry global color table.
  return Buffer.concat([gif.subarray(0, 19), extension, gif.subarray(19)])
}

test('parseGifBuffer deterministically distinguishes static and animated GIFs', () => {
  const still = parseGifBuffer(makeGif({ frames: [{ delay: 5 }] }))
  assert.equal(still.animated, false)
  assert.equal(still.frameCount, 1)
  assert.equal(still.width, 1)
  assert.equal(still.height, 1)
  assert.equal(still.duration, 0.05)

  const animated = parseGifBuffer(makeGif({
    loopCount: 0,
    frames: [
      { delay: 10, transparent: true },
      { delay: 20, transparent: false },
    ],
  }))
  assert.equal(animated.animated, true)
  assert.equal(animated.frameCount, 2)
  assert.deepEqual(animated.delaysCentiseconds, [10, 20])
  assert.equal(animated.duration, 0.3)
  assert.ok(Math.abs(animated.fps - (2 / 0.3)) < 0.000001)
  assert.equal(animated.hasTransparency, true)
  assert.equal(animated.loopCount, 0)
})

test('parseGifBuffer normalizes unspecified delays consistently', () => {
  assert.equal(normalizeGifDelayCentiseconds(0), 10)
  assert.equal(normalizeGifDelayCentiseconds(1), 1)
  assert.equal(normalizeGifDelayCentiseconds(2), 2)
  const parsed = parseGifBuffer(makeGif({ frames: [{ delay: 0 }, { delay: 1 }] }))
  assert.deepEqual(parsed.rawDelaysCentiseconds, [0, 1])
  assert.deepEqual(parsed.delaysCentiseconds, [10, 1])
  assert.equal(parsed.duration, 0.11)
})

test('parseGifBuffer rejects a missing trailer and decompression-risk inputs', () => {
  assert.throws(
    () => parseGifBuffer(makeGif({ trailer: false })),
    /missing trailer/i
  )
  assert.throws(
    () => parseGifBuffer(makeGif({ width: 9000, height: 1 })),
    /dimension limit/i
  )
  const oversizedFrame = makeGif()
  const imageDescriptorOffset = oversizedFrame.indexOf(0x2c, 13)
  oversizedFrame.writeUInt16LE(2, imageDescriptorOffset + 5)
  assert.throws(
    () => parseGifBuffer(oversizedFrame),
    /outside the logical screen/i
  )
  assert.throws(
    () => parseGifBuffer(makeGif({
      frames: Array.from({ length: 6 }, () => ({ delay: 65535 })),
    })),
    /1 hour duration limit/i
  )
  assert.throws(
    () => parseGifBuffer(makeGif({
      width: 4000,
      height: 4000,
      frames: Array.from({ length: Math.floor(MAX_GIF_DECODE_PIXELS / (4000 * 4000)) + 1 }, () => ({ delay: 2 })),
    })),
    /too large to import safely/i
  )
  assert.throws(
    () => parseGifBuffer(makeGif({
      frames: Array.from({ length: MAX_GIF_FRAMES + 1 }, () => ({ delay: 2 })),
    })),
    /frame count exceeds/i
  )
})

test('application extensions retain only a fixed sub-block prefix', () => {
  const blockCount = 250000
  const rawBlocks = Buffer.alloc((blockCount * 2) + 1)
  for (let offset = 0; offset < blockCount * 2; offset += 2) {
    rawBlocks[offset] = 1
    rawBlocks[offset + 1] = 0x41
  }
  const scanned = readSubBlocks(rawBlocks, 0, 2)
  assert.equal(scanned.blocks.length, 2)
  assert.equal(scanned.offset, rawBlocks.length)

  const parsed = parseGifBuffer(addApplicationPadding(makeGif(), blockCount))
  assert.equal(parsed.frameCount, 1)
  assert.equal(parsed.animated, false)
})

test('parseGifBuffer bounds total structural work', () => {
  assert.throws(
    () => parseGifBuffer(addApplicationPadding(makeGif(), MAX_GIF_STRUCTURE_BLOCKS + 10)),
    /structure exceeds/i
  )
})

test('probeGifFile reports readable validation errors', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'velorn-gif-probe-'))
  try {
    const inputPath = path.join(tempDir, 'not-a-gif.gif')
    await fs.writeFile(inputPath, Buffer.from('not a gif'))
    const result = await probeGifFile(inputPath)
    assert.equal(result.success, false)
    assert.match(result.error, /invalid gif|too short/i)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('transcodeAnimatedGif rejects unsafe structure before spawning FFmpeg', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'velorn-gif-preflight-'))
  const missingBinary = path.join(tempDir, 'ffmpeg-must-not-run')
  try {
    const oversizedPath = path.join(tempDir, 'oversized.gif')
    await fs.writeFile(oversizedPath, makeGif({
      width: 9000,
      frames: [{ delay: 10 }, { delay: 10 }],
    }))
    const oversized = await transcodeAnimatedGif({
      ffmpegPath: missingBinary,
      ffprobePath: missingBinary,
      inputPath: oversizedPath,
      outputDir: tempDir,
    })
    assert.equal(oversized.success, false)
    assert.match(oversized.error, /dimension limit/i)

    const longPath = path.join(tempDir, 'too-long.gif')
    await fs.writeFile(longPath, makeGif({
      frames: Array.from({ length: 6 }, () => ({ delay: 65535 })),
    }))
    const tooLong = await transcodeAnimatedGif({
      ffmpegPath: missingBinary,
      ffprobePath: missingBinary,
      inputPath: longPath,
      outputDir: tempDir,
    })
    assert.equal(tooLong.success, false)
    assert.match(tooLong.error, /1 hour duration limit/i)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('runProcess waits for a timed-out child to close before settling', async () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  let killed = false
  let closed = false
  child.kill = () => {
    killed = true
    setTimeout(() => {
      closed = true
      child.emit('close', null)
    }, 20)
    return true
  }

  const result = await runProcess('unused', [], {
    timeoutMs: 5,
    postKillWaitMs: 100,
    spawnImpl: () => child,
  })
  assert.equal(killed, true)
  assert.equal(closed, true)
  assert.equal(result.code, -1)
  assert.match(result.stderr, /timed out/i)
})

test('transcodeAnimatedGif imports one finite loop with timing and no audio', { timeout: 30000 }, async (t) => {
  if (!ffmpegPath || !ffprobePath) {
    t.skip('Bundled FFmpeg binaries are unavailable.')
    return
  }
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'velorn-gif-transcode-'))
  try {
    const inputPath = path.join(tempDir, 'infinite-loop.gif')
    await fs.writeFile(inputPath, makeGif({
      loopCount: 0,
      frames: [{ delay: 10 }, { delay: 20 }],
    }))
    const result = await transcodeAnimatedGif({
      ffmpegPath,
      ffprobePath,
      inputPath,
      outputDir: tempDir,
      baseName: 'timing test',
    })
    assert.equal(result.success, true, result.error)
    assert.equal(path.extname(result.outputPath), '.mp4')
    assert.equal(result.alpha, false)
    assert.equal(result.codec, 'h264')
    assert.equal(result.frameCount, 2)
    assert.ok(Math.abs(result.duration - 0.3) <= 0.03, `duration was ${result.duration}`)
    assert.ok(Math.abs(result.fps - (2 / 0.3)) <= 0.1, `fps was ${result.fps}`)
    assert.equal(result.width, 2)
    assert.equal(result.height, 2)
    await fs.access(result.outputPath)
    const streamProbe = await runBinary(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'stream=codec_type',
      '-of', 'json',
      result.outputPath,
    ])
    const streamTypes = JSON.parse(streamProbe.stdout).streams.map((stream) => stream.codec_type)
    assert.deepEqual(streamTypes, ['video'])
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('transcodeAnimatedGif uses a VP9 WebM master for transparent animation', { timeout: 30000 }, async (t) => {
  if (!ffmpegPath || !ffprobePath) {
    t.skip('Bundled FFmpeg binaries are unavailable.')
    return
  }
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'velorn-gif-alpha-'))
  try {
    const inputPath = path.join(tempDir, 'transparent.gif')
    await fs.writeFile(inputPath, makeGif({
      loopCount: 0,
      frames: [
        { delay: 10, transparent: true },
        { delay: 10, transparent: true },
      ],
    }))
    const result = await transcodeAnimatedGif({
      ffmpegPath,
      ffprobePath,
      inputPath,
      outputDir: tempDir,
      baseName: 'alpha',
    })
    assert.equal(result.success, true, result.error)
    assert.equal(path.extname(result.outputPath), '.webm')
    assert.equal(result.alpha, true)
    assert.equal(result.codec, 'vp9')
    assert.ok(Math.abs(result.duration - 0.2) <= 0.03, `duration was ${result.duration}`)
    const decoded = await runBinary(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-c:v', 'libvpx-vp9',
      '-i', result.outputPath,
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      'pipe:1',
    ], { encoding: 'buffer', maxBuffer: 1024 * 1024 })
    assert.equal(decoded.stdout[3], 0, 'the transparent GIF pixel should retain zero alpha')
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('transcodeAnimatedGif matches normalized zero/one-centisecond frame holds', { timeout: 30000 }, async (t) => {
  if (!ffmpegPath || !ffprobePath) {
    t.skip('Bundled FFmpeg binaries are unavailable.')
    return
  }
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'velorn-gif-fast-delay-'))
  try {
    const inputPath = path.join(tempDir, 'fast.gif')
    await fs.writeFile(inputPath, makeGif({ frames: [{ delay: 0 }, { delay: 1 }] }))
    const result = await transcodeAnimatedGif({
      ffmpegPath,
      ffprobePath,
      inputPath,
      outputDir: tempDir,
      baseName: 'fast',
    })
    assert.equal(result.success, true, result.error)
    assert.ok(Math.abs(result.duration - 0.11) <= 0.03, `duration was ${result.duration}`)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('concurrent same-name GIF transcodes use distinct valid intermediates', { timeout: 30000 }, async (t) => {
  if (!ffmpegPath || !ffprobePath) {
    t.skip('Bundled FFmpeg binaries are unavailable.')
    return
  }
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'velorn-gif-concurrent-'))
  try {
    const inputPath = path.join(tempDir, 'shared.gif')
    await fs.writeFile(inputPath, makeGif({ frames: [{ delay: 10 }, { delay: 20 }] }))
    const options = {
      ffmpegPath,
      ffprobePath,
      inputPath,
      outputDir: tempDir,
      baseName: 'same-name',
    }
    const [first, second] = await Promise.all([
      transcodeAnimatedGif(options),
      transcodeAnimatedGif(options),
    ])
    assert.equal(first.success, true, first.error)
    assert.equal(second.success, true, second.error)
    assert.notEqual(first.outputPath, second.outputPath)
    await Promise.all([fs.access(first.outputPath), fs.access(second.outputPath)])
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
