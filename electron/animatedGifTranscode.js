/**
 * Animated GIF import support.
 *
 * GIF structure is parsed directly instead of asking a browser or ffprobe
 * whether the file is animated. That makes the static/animated decision
 * deterministic and also gives us the source delays, loop metadata, and
 * transparency flag before any transcode starts.
 *
 * Animated GIFs become ordinary project-owned video assets. The transcode
 * keeps the GIF's centisecond timestamps as VFR presentation timestamps so
 * long frame holds do not expand into hundreds of duplicate video frames.
 */

const { spawn } = require('child_process')
const { randomUUID } = require('crypto')
const fs = require('fs/promises')
const path = require('path')

const MAX_GIF_BYTES = 128 * 1024 * 1024
const MAX_GIF_DIMENSION = 8192
const MAX_GIF_PIXELS = 7680 * 4320
const MAX_GIF_DECODE_PIXELS = 1 * 1000 * 1000 * 1000
const MAX_GIF_FRAMES = 10000
const MAX_GIF_DURATION_SECONDS = 60 * 60
const MAX_GIF_STRUCTURE_BLOCKS = 1000000
const DEFAULT_GIF_DELAY_CENTISECONDS = 10

function gifParseError(message) {
  return new Error(`Invalid GIF: ${message}`)
}

function normalizeGifDelayCentiseconds(value) {
  const delay = Number(value)
  // A zero delay is unspecified; FFmpeg's GIF demuxer holds it for 100 ms.
  // Positive centisecond delays, including 1 cs, are preserved by the
  // transcode and therefore remain source-of-truth timing.
  if (!Number.isFinite(delay) || delay <= 0) return DEFAULT_GIF_DELAY_CENTISECONDS
  return Math.min(65535, Math.round(delay))
}

function consumeStructureBlock(structureBudget) {
  structureBudget.count += 1
  if (structureBudget.count > MAX_GIF_STRUCTURE_BLOCKS) {
    throw gifParseError(`structure exceeds ${MAX_GIF_STRUCTURE_BLOCKS.toLocaleString('en-US')} blocks`)
  }
}

function readSubBlocks(buffer, startOffset, maxCollectedBlocks = 0, structureBudget = { count: 0 }) {
  const blocks = []
  let offset = startOffset
  while (offset < buffer.length) {
    consumeStructureBlock(structureBudget)
    const size = buffer[offset]
    offset += 1
    if (size === 0) return { offset, blocks }
    if (offset + size > buffer.length) throw gifParseError('truncated data sub-block')
    // Application data is untrusted and may contain millions of one-byte
    // blocks. Retain only the fixed prefix a caller actually needs while
    // still scanning every block to validate the stream boundary.
    if (blocks.length < maxCollectedBlocks) {
      blocks.push(buffer.subarray(offset, offset + size))
    }
    offset += size
  }
  throw gifParseError('missing data sub-block terminator')
}

function parseApplicationLoopCount(blocks) {
  if (!Array.isArray(blocks) || blocks.length < 2) return null
  const identifier = blocks[0].toString('ascii')
  if (identifier !== 'NETSCAPE2.0' && identifier !== 'ANIMEXTS1.0') return null
  for (const block of blocks.slice(1)) {
    if (block.length >= 3 && block[0] === 1) return block.readUInt16LE(1)
  }
  return null
}

function parseGifBuffer(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || [])
  if (buffer.length < 13) throw gifParseError('file is too short')
  const signature = buffer.toString('ascii', 0, 6)
  if (signature !== 'GIF87a' && signature !== 'GIF89a') {
    throw gifParseError('missing GIF87a/GIF89a signature')
  }

  const width = buffer.readUInt16LE(6)
  const height = buffer.readUInt16LE(8)
  if (!width || !height) throw gifParseError('logical screen has zero width or height')
  if (width > MAX_GIF_DIMENSION || height > MAX_GIF_DIMENSION) {
    throw gifParseError(`logical screen exceeds the ${MAX_GIF_DIMENSION} px dimension limit`)
  }
  if (width * height > MAX_GIF_PIXELS) {
    throw gifParseError(`logical screen exceeds the ${Math.round(MAX_GIF_PIXELS / 1000000)} megapixel limit`)
  }

  const logicalPacked = buffer[10]
  const hasGlobalColorTable = (logicalPacked & 0x80) !== 0
  const globalColorTableBytes = hasGlobalColorTable
    ? 3 * (2 ** ((logicalPacked & 0x07) + 1))
    : 0
  let offset = 13 + globalColorTableBytes
  if (offset > buffer.length) throw gifParseError('truncated global color table')

  const rawDelaysCentiseconds = []
  const delaysCentiseconds = []
  let pendingDelay = 0
  let pendingTransparency = false
  let hasTransparency = false
  let loopCount = null
  let sawTrailer = false
  const structureBudget = { count: 0 }

  while (offset < buffer.length) {
    consumeStructureBlock(structureBudget)
    const marker = buffer[offset]
    offset += 1

    if (marker === 0x3b) {
      sawTrailer = true
      break
    }

    if (marker === 0x21) {
      if (offset >= buffer.length) throw gifParseError('truncated extension label')
      const label = buffer[offset]
      offset += 1

      if (label === 0xf9) {
        if (offset >= buffer.length) throw gifParseError('truncated graphics control extension')
        const blockSize = buffer[offset]
        offset += 1
        if (blockSize < 4 || offset + blockSize >= buffer.length) {
          throw gifParseError('malformed graphics control extension')
        }
        const packed = buffer[offset]
        pendingDelay = buffer.readUInt16LE(offset + 1)
        pendingTransparency = (packed & 0x01) !== 0
        offset += blockSize
        if (buffer[offset] !== 0) throw gifParseError('graphics control extension is not terminated')
        offset += 1
        continue
      }

      // A loop application extension needs only its identifier and first
      // payload block. Never mirror the whole extension into JS objects.
      const subBlocks = readSubBlocks(buffer, offset, label === 0xff ? 2 : 0, structureBudget)
      offset = subBlocks.offset
      if (label === 0xff) {
        const parsedLoopCount = parseApplicationLoopCount(subBlocks.blocks)
        if (parsedLoopCount !== null) loopCount = parsedLoopCount
      }
      continue
    }

    if (marker === 0x2c) {
      if (offset + 9 > buffer.length) throw gifParseError('truncated image descriptor')
      const frameLeft = buffer.readUInt16LE(offset)
      const frameTop = buffer.readUInt16LE(offset + 2)
      const frameWidth = buffer.readUInt16LE(offset + 4)
      const frameHeight = buffer.readUInt16LE(offset + 6)
      if (!frameWidth || !frameHeight) throw gifParseError('image frame has zero width or height')
      if (frameWidth > MAX_GIF_DIMENSION || frameHeight > MAX_GIF_DIMENSION || frameWidth * frameHeight > MAX_GIF_PIXELS) {
        throw gifParseError('image frame exceeds the safe decode dimensions')
      }
      if (frameLeft + frameWidth > width || frameTop + frameHeight > height) {
        throw gifParseError('image frame extends outside the logical screen')
      }
      const imagePacked = buffer[offset + 8]
      offset += 9
      if ((imagePacked & 0x80) !== 0) {
        const localColorTableBytes = 3 * (2 ** ((imagePacked & 0x07) + 1))
        offset += localColorTableBytes
        if (offset > buffer.length) throw gifParseError('truncated local color table')
      }
      if (offset >= buffer.length) throw gifParseError('missing LZW minimum code size')
      offset += 1
      offset = readSubBlocks(buffer, offset, 0, structureBudget).offset

      rawDelaysCentiseconds.push(pendingDelay)
      delaysCentiseconds.push(normalizeGifDelayCentiseconds(pendingDelay))
      hasTransparency = hasTransparency || pendingTransparency
      pendingDelay = 0
      pendingTransparency = false
      if (delaysCentiseconds.length > MAX_GIF_FRAMES) {
        throw gifParseError(`frame count exceeds ${MAX_GIF_FRAMES}`)
      }
      continue
    }

    throw gifParseError(`unexpected block marker 0x${marker.toString(16).padStart(2, '0')}`)
  }

  if (delaysCentiseconds.length === 0) throw gifParseError('contains no image frames')
  if (!sawTrailer) throw gifParseError('missing trailer')

  const durationCentiseconds = delaysCentiseconds.reduce((sum, delay) => sum + delay, 0)
  const duration = durationCentiseconds / 100
  const frameCount = delaysCentiseconds.length
  if (duration > MAX_GIF_DURATION_SECONDS) {
    throw gifParseError('one animation cycle exceeds the 1 hour duration limit')
  }
  if (width * height * frameCount > MAX_GIF_DECODE_PIXELS) {
    throw gifParseError('decoded animation is too large to import safely')
  }
  return {
    version: signature.slice(3),
    width,
    height,
    frameCount,
    animated: frameCount > 1,
    hasTransparency,
    loopCount,
    rawDelaysCentiseconds,
    delaysCentiseconds,
    duration,
    fps: duration > 0 ? frameCount / duration : null,
  }
}

async function probeGifFile(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return { success: false, error: 'Missing GIF input path.' }
  }
  try {
    const stat = await fs.stat(inputPath)
    if (!stat.isFile()) return { success: false, error: 'GIF input is not a file.' }
    if (stat.size > MAX_GIF_BYTES) {
      return { success: false, error: `GIF is larger than the ${Math.round(MAX_GIF_BYTES / 1024 / 1024)} MB import limit.` }
    }
    const buffer = await fs.readFile(inputPath)
    if (buffer.length > MAX_GIF_BYTES) {
      return { success: false, error: `GIF is larger than the ${Math.round(MAX_GIF_BYTES / 1024 / 1024)} MB import limit.` }
    }
    return { success: true, ...parseGifBuffer(buffer), size: stat.size }
  } catch (error) {
    return { success: false, error: error?.message || String(error) }
  }
}

function sanitizeBaseName(value) {
  const cleaned = String(value || 'animated_gif')
    .replace(/\.gif$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  return cleaned || 'animated_gif'
}

function uniqueOutputPath(outputDir, baseName, extension) {
  const safeBaseName = sanitizeBaseName(baseName)
  // Generated imports may complete concurrently with the same source name.
  // A UUID makes the destination unique by construction; check-then-use
  // suffix selection can race during the long encode and overwrite a peer.
  return path.join(outputDir, `${safeBaseName}_gif_${randomUUID()}${extension}`)
}

function runProcess(binary, args, {
  timeoutMs = 5 * 60 * 1000,
  postKillWaitMs = 5000,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve) => {
    let child = null
    let settled = false
    let timeout = null
    let postKillTimeout = null
    let timeoutMessage = ''
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      if (postKillTimeout) clearTimeout(postKillTimeout)
      resolve(result)
    }
    try {
      child = spawnImpl(binary, args, { windowsHide: true })
    } catch (error) {
      finish({ code: -1, stdout: '', stderr: error.message })
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => { stdout += data.toString() })
    child.stderr.on('data', (data) => { stderr = `${stderr}${data.toString()}`.slice(-12000) })
    child.on('error', (error) => finish({
      code: -1,
      stdout,
      stderr: timeoutMessage || error.message,
    }))
    child.on('close', (code) => finish(timeoutMessage
      ? { code: -1, stdout, stderr: timeoutMessage }
      : { code, stdout, stderr }))
    timeout = setTimeout(() => {
      timeoutMessage = `Animated GIF processing timed out after ${Math.round(timeoutMs / 1000)} seconds.`
      // Wait for close/error so Windows has a chance to release the output
      // handle before caller cleanup runs. The fallback keeps a wedged child
      // from holding the IPC request forever.
      postKillTimeout = setTimeout(() => {
        finish({ code: -1, stdout, stderr: timeoutMessage })
      }, postKillWaitMs)
      try { child.kill('SIGKILL') } catch { /* already exited */ }
    }, timeoutMs)
  })
}

async function probeVideoOutput(ffprobePath, outputPath) {
  const result = await runProcess(ffprobePath, [
    '-v', 'error',
    '-count_packets',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_packets:format=duration',
    '-of', 'json',
    outputPath,
  ], { timeoutMs: 30000 })
  if (result.code !== 0) return null
  try {
    const parsed = JSON.parse(result.stdout)
    const stream = parsed?.streams?.[0]
    const duration = Number(parsed?.format?.duration)
    if (!stream?.width || !stream?.height || !Number.isFinite(duration) || duration <= 0) return null
    return {
      codec: stream.codec_name || null,
      width: Number(stream.width),
      height: Number(stream.height),
      duration,
      encodedFrameCount: Number(stream.nb_read_packets) || null,
    }
  } catch {
    return null
  }
}

/**
 * Convert a multi-frame GIF into a normal, project-importable video file.
 * The file is always re-probed here. Renderer-supplied summaries are not a
 * trust boundary and must never be able to bypass the parser's safety limits.
 */
async function transcodeAnimatedGif({
  ffmpegPath,
  ffprobePath,
  inputPath,
  outputDir,
  baseName,
}) {
  if (!ffmpegPath || !ffprobePath) return { success: false, error: 'FFmpeg binaries are not available.' }
  if (!inputPath || !outputDir) return { success: false, error: 'Missing animated GIF transcode paths.' }

  const gifInfo = await probeGifFile(inputPath)
  if (!gifInfo?.success) return { success: false, error: gifInfo?.error || 'GIF probe failed.' }
  if (!gifInfo.animated) return { success: false, static: true, error: 'GIF contains only one image frame.' }

  const useAlpha = gifInfo.hasTransparency === true
  const extension = useAlpha ? '.webm' : '.mp4'
  await fs.mkdir(outputDir, { recursive: true })
  const outputPath = uniqueOutputPath(outputDir, baseName || path.basename(inputPath, path.extname(inputPath)), extension)
  const stamp = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`
  const tempOutputPath = path.join(outputDir, `.${path.basename(outputPath)}.${stamp}.tmp${extension}`)

  const evenPad = `pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:color=${useAlpha ? 'black@0' : 'black'}`
  const args = [
    '-y',
    // Import exactly one animation cycle even when NETSCAPE loop metadata
    // requests infinite playback.
    '-ignore_loop', '1',
    '-i', inputPath,
    '-map', '0:v:0',
    '-vf', useAlpha ? evenPad : `${evenPad},scale=out_color_matrix=bt709:out_range=tv`,
    // A GIF time base is one centisecond. Passing those PTS through keeps
    // variable frame holds exact instead of baking them into a guessed CFR.
    '-fps_mode', 'passthrough',
    '-enc_time_base', '1/100',
    ...(useAlpha
      ? [
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
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '12',
        '-pix_fmt', 'yuv420p',
        '-bf', '0',
        '-g', '12',
        '-keyint_min', '1',
        '-colorspace', 'bt709',
        '-color_primaries', 'bt709',
        '-color_trc', 'bt709',
        '-color_range', 'tv',
        '-video_track_timescale', '100',
        '-movflags', '+faststart',
      ]),
    '-an', '-sn', '-dn',
    tempOutputPath,
  ]

  try {
    const encode = await runProcess(ffmpegPath, args)
    if (encode.code !== 0) {
      return { success: false, error: `Animated GIF transcode failed (${encode.code}): ${encode.stderr.slice(-800)}` }
    }
    const outputInfo = await probeVideoOutput(ffprobePath, tempOutputPath)
    if (!outputInfo) return { success: false, error: 'Animated GIF intermediate failed validation.' }
    if (outputInfo.encodedFrameCount !== gifInfo.frameCount) {
      return {
        success: false,
        error: `Animated GIF frame count changed during transcode (${gifInfo.frameCount} to ${outputInfo.encodedFrameCount || 0}).`,
      }
    }

    const durationTolerance = Math.max(0.03, gifInfo.duration * 0.03)
    if (Math.abs(outputInfo.duration - gifInfo.duration) > durationTolerance) {
      return {
        success: false,
        error: `Animated GIF duration changed during transcode (${gifInfo.duration.toFixed(3)}s to ${outputInfo.duration.toFixed(3)}s).`,
      }
    }

    await fs.rename(tempOutputPath, outputPath)
    return {
      success: true,
      outputPath,
      alpha: useAlpha,
      codec: outputInfo.codec,
      width: outputInfo.width,
      height: outputInfo.height,
      sourceWidth: gifInfo.width,
      sourceHeight: gifInfo.height,
      duration: outputInfo.duration,
      fps: gifInfo.frameCount / outputInfo.duration,
      frameCount: gifInfo.frameCount,
      loopCount: gifInfo.loopCount,
    }
  } catch (error) {
    return { success: false, error: error?.message || String(error) }
  } finally {
    try { await fs.unlink(tempOutputPath) } catch { /* output was renamed or never created */ }
  }
}

module.exports = {
  DEFAULT_GIF_DELAY_CENTISECONDS,
  MAX_GIF_BYTES,
  MAX_GIF_DECODE_PIXELS,
  MAX_GIF_DIMENSION,
  MAX_GIF_DURATION_SECONDS,
  MAX_GIF_FRAMES,
  MAX_GIF_PIXELS,
  MAX_GIF_STRUCTURE_BLOCKS,
  normalizeGifDelayCentiseconds,
  parseGifBuffer,
  probeGifFile,
  readSubBlocks,
  runProcess,
  sanitizeBaseName,
  transcodeAnimatedGif,
}
