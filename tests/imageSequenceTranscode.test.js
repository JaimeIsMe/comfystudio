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
const { transcodeImageSequence } = require('../electron/imageSequenceTranscode')
const { probeStreamHasAlpha } = require('../electron/mediaAlpha')

const run = (binary, args) => {
  const result = spawnSync(binary, args, { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

test('transparent PNG sequences become alpha-flagged VP9 WebM masters', async (t) => {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath) || !ffprobePath || !fs.existsSync(ffprobePath)) {
    t.skip('Bundled FFmpeg/FFprobe is unavailable on this platform.')
    return
  }

  const tempDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-alpha-sequence-'))
  const framePattern = path.join(tempDirectory, 'frame_%02d.png')
  try {
    run(ffmpegPath, [
      '-v', 'error',
      '-f', 'lavfi',
      '-i', 'color=c=black@0.0:s=64x48:r=2:d=1,format=rgba,drawbox=x=8:y=8:w=24:h=24:color=red@1:t=fill',
      '-frames:v', '2',
      framePattern,
    ])

    const result = await transcodeImageSequence({
      ffmpegPath,
      ffprobePath,
      entries: [0, 1].map((index) => ({
        path: path.join(tempDirectory, `frame_${String(index + 1).padStart(2, '0')}.png`),
        duration: 0.5,
      })),
      fps: 2,
      outputDir: tempDirectory,
      baseName: 'transparent_sequence',
      alpha: 'auto',
    })

    assert.equal(result.success, true, result.error)
    assert.equal(result.alpha, true)
    assert.equal(path.extname(result.outputPath), '.webm')

    const probe = JSON.parse(run(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'stream=codec_name,profile,pix_fmt,color_space,color_transfer,color_primaries,color_range:stream_tags=alpha_mode',
      '-of', 'json',
      result.outputPath,
    ])).streams[0]
    assert.equal(probe.codec_name, 'vp9')
    assert.equal(probeStreamHasAlpha(probe), true)
    assert.equal(probe.color_space, 'bt709')
    assert.equal(probe.color_transfer, 'bt709')
    assert.equal(probe.color_primaries, 'bt709')
    assert.equal(probe.color_range, 'tv')
  } finally {
    await fsp.rm(tempDirectory, { recursive: true, force: true })
  }
})
