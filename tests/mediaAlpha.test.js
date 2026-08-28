const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const ffmpegPath = require('ffmpeg-static')
const ffprobePackage = require('ffprobe-static')
const ffprobePath = ffprobePackage?.path || ffprobePackage

const {
  appendAlphaCacheEncoderArgs,
  appendVp9AlphaArgs,
  getAlphaExportError,
  getExportVideoPixelFormat,
  probeStreamHasAlpha,
} = require('../electron/mediaAlpha')

test('detects alpha pixel formats and VP9 alpha metadata', () => {
  assert.equal(probeStreamHasAlpha({ codec_name: 'vp9', pix_fmt: 'yuva420p' }), true)
  assert.equal(probeStreamHasAlpha({ codec_name: 'vp9', pix_fmt: 'yuv420p', tags: { alpha_mode: '1' } }), true)
  assert.equal(probeStreamHasAlpha({ codec_name: 'prores', pix_fmt: 'yuva444p10le' }), true)
  assert.equal(probeStreamHasAlpha({ codec_name: 'prores', pix_fmt: 'yuv444p10le', profile: '4444' }), true)
  assert.equal(probeStreamHasAlpha({ codec_name: 'h264', pix_fmt: 'yuv420p' }), false)
})

test('selects alpha-capable delivery pixel formats and disables VP9 alt-ref', () => {
  assert.equal(getExportVideoPixelFormat({ codec: 'vp9', alpha: true }), 'yuva420p')
  assert.equal(getExportVideoPixelFormat({ codec: 'vp9', alpha: false }), 'yuv420p')
  assert.equal(getExportVideoPixelFormat({ codec: 'prores', proresProfile: '4', alpha: true }), 'yuva444p10le')
  assert.equal(getExportVideoPixelFormat({ codec: 'prores', proresProfile: '3', alpha: false }), 'yuv422p10le')
  assert.deepEqual(appendVp9AlphaArgs([], true), ['-auto-alt-ref', '0'])
  assert.deepEqual(appendVp9AlphaArgs([], false), [])
  assert.deepEqual(appendAlphaCacheEncoderArgs([]), [
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuva420p',
    '-deadline', 'realtime',
    '-cpu-used', '8',
    '-row-mt', '1',
    '-crf', '30',
    '-b:v', '0',
    '-auto-alt-ref', '0',
  ])
})

test('allows transparency only for supported delivery codecs', () => {
  assert.equal(getAlphaExportError({ alpha: true, format: 'webm', videoCodec: 'vp9' }), null)
  assert.equal(getAlphaExportError({ alpha: true, format: 'mov', videoCodec: 'prores', proresProfile: '4' }), null)
  assert.match(getAlphaExportError({ alpha: true, format: 'mp4', videoCodec: 'h264' }), /requires WebM/i)
  assert.match(getAlphaExportError({ alpha: true, format: 'mov', videoCodec: 'prores', proresProfile: '3' }), /ProRes 4444/i)
  assert.equal(getAlphaExportError({ alpha: false, format: 'mp4', videoCodec: 'h264' }), null)
})

test('bundled FFmpeg preserves alpha in WebM and ProRes 4444 deliveries', async (t) => {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath) || !ffprobePath || !fs.existsSync(ffprobePath)) {
    t.skip('Bundled FFmpeg/FFprobe is unavailable on this platform.')
    return
  }

  const tempDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-alpha-export-'))
  const width = 64
  const height = 48
  const frame = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const opaque = x >= 8 && x < 32 && y >= 8 && y < 32
      frame[offset] = opaque ? 255 : 0
      frame[offset + 1] = 0
      frame[offset + 2] = 0
      frame[offset + 3] = opaque ? 255 : 0
    }
  }
  const rgbaFrames = Buffer.concat([frame, frame])

  const encode = (outputPath, codecArgs) => spawnSync(ffmpegPath, [
    '-v', 'error',
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-video_size', `${width}x${height}`,
    '-framerate', '5',
    '-i', 'pipe:0',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-color_range', 'tv',
    ...codecArgs,
    outputPath,
  ], { input: rgbaFrames, maxBuffer: 16 * 1024 * 1024 })

  const probe = (outputPath) => {
    const result = spawnSync(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'stream=codec_name,profile,pix_fmt:stream_tags=alpha_mode',
      '-of', 'json',
      outputPath,
    ], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout).streams[0]
  }

  const decodeAlpha = (outputPath, decoderArgs = []) => {
    const result = spawnSync(ffmpegPath, [
      '-v', 'error',
      ...decoderArgs,
      '-i', outputPath,
      '-vf', 'alphaextract',
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'gray',
      'pipe:1',
    ], { maxBuffer: 16 * 1024 * 1024 })
    assert.equal(result.status, 0, result.stderr?.toString())
    return result.stdout
  }

  try {
    const webmPath = path.join(tempDirectory, 'alpha.webm')
    const webmArgs = [
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', getExportVideoPixelFormat({ codec: 'vp9', alpha: true }),
      '-row-mt', '1',
      '-cpu-used', '3',
      '-crf', '18',
      '-b:v', '0',
    ]
    appendVp9AlphaArgs(webmArgs, true)
    const webmEncode = encode(webmPath, webmArgs)
    assert.equal(webmEncode.status, 0, webmEncode.stderr?.toString())
    assert.equal(probeStreamHasAlpha(probe(webmPath)), true)

    const vp9Alpha = decodeAlpha(webmPath, ['-c:v', 'libvpx-vp9'])
    assert.equal(vp9Alpha.length, width * height)
    assert.ok(vp9Alpha.some((value) => value < 16), 'VP9 alpha should retain transparent pixels')
    assert.ok(vp9Alpha.some((value) => value > 240), 'VP9 alpha should retain opaque pixels')

    const proresPath = path.join(tempDirectory, 'alpha.mov')
    const proresEncode = encode(proresPath, [
      '-c:v', 'prores_ks',
      '-profile:v', '4',
      '-pix_fmt', getExportVideoPixelFormat({ codec: 'prores', proresProfile: '4', alpha: true }),
    ])
    assert.equal(proresEncode.status, 0, proresEncode.stderr?.toString())
    assert.equal(probeStreamHasAlpha(probe(proresPath)), true)

    const proresAlpha = decodeAlpha(proresPath)
    assert.equal(proresAlpha.length, width * height)
    assert.ok(proresAlpha.some((value) => value < 16), 'ProRes alpha should retain transparent pixels')
    assert.ok(proresAlpha.some((value) => value > 240), 'ProRes alpha should retain opaque pixels')
  } finally {
    await fsp.rm(tempDirectory, { recursive: true, force: true })
  }
})
