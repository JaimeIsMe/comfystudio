/**
 * Image sequence → editing intermediate.
 *
 * Turns an ordered list of image frames into a normal video file the rest of
 * the app already understands (import, preview, cache, export). Frames are fed
 * to ffmpeg through a concat list with explicit per-frame durations, so gaps
 * hold the previous frame and the sequence keeps its true length.
 *
 * Self-contained on purpose: no Electron imports, binaries passed in — the
 * module can be exercised from plain node.
 */

const { spawn } = require('child_process')
const fs = require('fs/promises')
const path = require('path')

const ALPHA_PIX_FMT_HINTS = ['rgba', 'argb', 'bgra', 'abgr', 'yuva', 'gbrap', 'ya8', 'ya16']

function pixFmtHasAlpha(pixFmt) {
  const value = String(pixFmt || '').toLowerCase()
  return ALPHA_PIX_FMT_HINTS.some((hint) => value.includes(hint))
}

function runProcess(binary, args) {
  return new Promise((resolve) => {
    const proc = spawn(binary, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString().slice(-4000) })
    proc.on('error', (err) => resolve({ code: -1, stdout, stderr: err.message }))
    proc.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function probeImageStream(ffprobePath, filePath) {
  const { code, stdout } = await runProcess(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,pix_fmt',
    '-of', 'json',
    filePath,
  ])
  if (code !== 0) return null
  try {
    return JSON.parse(stdout)?.streams?.[0] || null
  } catch {
    return null
  }
}

// Concat-demuxer entry: single-quoted, `'` escaped, forward slashes (ffmpeg
// accepts them on Windows and they sidestep backslash-escape ambiguity).
function concatPathLine(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/').replace(/'/g, "'\\''")
  return `file '${normalized}'`
}

/**
 * @param {object} options
 * @param {string} options.ffmpegPath
 * @param {string} options.ffprobePath
 * @param {Array<{path: string, duration: number}>} options.entries ordered frames with hold durations
 * @param {number} options.fps
 * @param {string} options.outputDir
 * @param {string} options.baseName extensionless; the container (.mp4/.webm) follows the alpha decision
 * @param {boolean|'auto'} [options.alpha]
 * @param {string|null} [options.applyTrc] input transfer for linear sources (EXR): e.g. 'bt709'
 * @param {(progress: {frame: number, totalFrames: number}) => void} [options.onProgress]
 */
async function transcodeImageSequence({
  ffmpegPath,
  ffprobePath,
  entries,
  fps,
  outputDir,
  baseName,
  alpha = 'auto',
  applyTrc = null,
  onProgress,
}) {
  if (!ffmpegPath || !ffprobePath) {
    return { success: false, error: 'FFmpeg binaries not available.' }
  }
  const frames = Array.isArray(entries) ? entries.filter((e) => e && e.path) : []
  const safeFps = Number(fps)
  if (frames.length === 0) return { success: false, error: 'No sequence frames to transcode.' }
  if (!Number.isFinite(safeFps) || safeFps <= 0) return { success: false, error: 'Invalid sequence frame rate.' }
  if (!outputDir || !baseName) return { success: false, error: 'Missing sequence output location.' }

  let useAlpha = alpha === true
  if (alpha === 'auto') {
    const stream = await probeImageStream(ffprobePath, frames[0].path)
    useAlpha = pixFmtHasAlpha(stream?.pix_fmt)
  }

  const ext = useAlpha ? '.webm' : '.mp4'
  await fs.mkdir(outputDir, { recursive: true })
  let outputPath = path.join(outputDir, `${baseName}${ext}`)
  for (let n = 1; ; n++) {
    try {
      await fs.access(outputPath)
      outputPath = path.join(outputDir, `${baseName}_${n}${ext}`)
    } catch {
      break
    }
  }

  const totalDuration = frames.reduce((sum, e) => sum + (Number(e.duration) > 0 ? Number(e.duration) : 1 / safeFps), 0)
  const listLines = ['ffconcat version 1.0']
  for (const entry of frames) {
    listLines.push(concatPathLine(entry.path))
    listLines.push(`duration ${(Number(entry.duration) > 0 ? Number(entry.duration) : 1 / safeFps).toFixed(6)}`)
  }
  // Concat-demuxer quirk: the final duration directive is dropped unless the
  // last file appears once more; -t clamps the tail back to the exact length.
  listLines.push(concatPathLine(frames[frames.length - 1].path))

  const stamp = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`
  const listPath = path.join(outputDir, `.seqlist.${stamp}.txt`)
  const tempOutputPath = path.join(outputDir, `.${path.basename(outputPath)}.${stamp}.tmp${ext}`)
  await fs.writeFile(listPath, `${listLines.join('\n')}\n`, 'utf8')

  const args = [
    '-y',
    ...(applyTrc ? ['-apply_trc', String(applyTrc)] : []),
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    // The frames are RGB: without an explicit matrix swscale converts to YUV
    // with 601 coefficients while players tag-guess HD as 709 — a visible
    // shift. Pin the conversion AND the container tags to BT.709.
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-color_range', 'tv',
    '-r', String(safeFps),
    '-fps_mode', 'cfr',
    ...(useAlpha
      ? [
        // Quality-tier VP9 with alpha (unlike the realtime preview bakes):
        // this intermediate is the clip's editing master.
        '-c:v', 'libvpx-vp9',
        '-pix_fmt', 'yuva420p',
        '-crf', '12',
        '-b:v', '0',
        '-deadline', 'good',
        '-cpu-used', '2',
        '-row-mt', '1',
        '-auto-alt-ref', '0',
      ]
      : [
        // Match the pro-format import intermediate: visually transparent for
        // the 8-bit pipeline.
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '12',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
      ]),
    '-an', '-sn', '-dn',
    '-t', totalDuration.toFixed(6),
    tempOutputPath,
  ]

  const cleanup = async () => {
    try { await fs.unlink(listPath) } catch { /* ignore */ }
  }

  return await new Promise((resolve) => {
    const ffmpeg = spawn(ffmpegPath, args, { windowsHide: true })
    let stderrTail = ''
    let settled = false

    const finish = async (payload) => {
      if (settled) return
      settled = true
      await cleanup()
      if (!payload?.success) {
        try { await fs.unlink(tempOutputPath) } catch { /* ignore */ }
      }
      resolve(payload)
    }

    ffmpeg.stderr.on('data', (data) => {
      const text = data.toString()
      stderrTail = (stderrTail + text).slice(-4000)
      if (typeof onProgress === 'function') {
        const matches = text.match(/frame=\s*(\d+)/g)
        if (matches && matches.length > 0) {
          const frame = Number.parseInt(matches[matches.length - 1].replace(/\D+/g, ''), 10)
          if (Number.isFinite(frame)) {
            onProgress({
              frame: Math.min(frame, Math.round(totalDuration * safeFps)),
              totalFrames: Math.max(1, Math.round(totalDuration * safeFps)),
            })
          }
        }
      }
    })

    ffmpeg.on('error', (err) => {
      finish({ success: false, error: err.message })
    })

    ffmpeg.on('close', async (code) => {
      if (code !== 0) {
        await finish({ success: false, error: `Sequence transcode failed (${code}): ${stderrTail.slice(-600)}` })
        return
      }
      const stream = await probeImageStream(ffprobePath, tempOutputPath)
      if (!stream?.width || !stream?.height) {
        await finish({ success: false, error: 'Sequence intermediate failed validation.' })
        return
      }
      try {
        await fs.rename(tempOutputPath, outputPath)
      } catch (err) {
        await finish({ success: false, error: `Could not finalize sequence intermediate: ${err.message}` })
        return
      }
      await finish({
        success: true,
        outputPath,
        alpha: useAlpha,
        width: stream.width,
        height: stream.height,
        duration: totalDuration,
        encoder: useAlpha ? 'libvpx-vp9-alpha' : 'libx264',
      })
    })
  })
}

module.exports = { transcodeImageSequence, pixFmtHasAlpha }
