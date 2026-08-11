import {
  RTX_VIDEO_UPSCALE_DEFAULTS,
  normalizeRtxUpscaleQuality,
  resolveRtx4kDimensions,
  resolveRtxNvencEncoder,
} from '../config/rtxVideoUpscaleConfig'

function createAbortError() {
  const error = new Error('RTX upscale cancelled')
  error.name = 'AbortError'
  return error
}

function createJobId() {
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `rtx-${token}`
}

export async function checkRtxVideoUpscaleReadiness() {
  if (!window.electronAPI?.checkRtxVideoUpscaleRuntime) {
    return {
      ready: false,
      installAvailable: false,
      error: 'RTX upscale is available only in the Velorn desktop app.',
    }
  }
  return await window.electronAPI.checkRtxVideoUpscaleRuntime()
}

export async function installRtxVideoUpscaleRuntime(options = {}) {
  const { onStatus = () => {} } = options
  if (!window.electronAPI?.installRtxVideoUpscaleRuntime) {
    throw new Error('The RTX runtime installer is unavailable. Restart Velorn and try again.')
  }
  const unsubscribe = window.electronAPI.onRtxVideoUpscaleSetupProgress?.((status) => onStatus(status))
  try {
    const result = await window.electronAPI.installRtxVideoUpscaleRuntime()
    if (!result?.success) throw new Error(result?.error || 'Could not install the NVIDIA RTX runtime.')
    return result
  } finally {
    unsubscribe?.()
  }
}

export async function runRtxVideoUpscale(options = {}) {
  const {
    inputPath = '',
    outputPath = '',
    sourceWidth = 1920,
    sourceHeight = 1080,
    videoCodec = 'h264',
    quality = RTX_VIDEO_UPSCALE_DEFAULTS.quality,
    signal = null,
    onStatus = () => {},
  } = options
  if (!window.electronAPI?.runRtxVideoUpscale) {
    throw new Error('Direct RTX upscaling is unavailable. Restart Velorn and try again.')
  }
  if (!inputPath) throw new Error('RTX upscale requires a source export path.')
  if (!outputPath) throw new Error('RTX upscale requires a final output path.')
  if (signal?.aborted) throw createAbortError()

  const target = resolveRtx4kDimensions(sourceWidth, sourceHeight)
  const jobId = createJobId()
  const unsubscribe = window.electronAPI.onRtxVideoUpscaleProgress?.((status) => {
    if (status?.jobId !== jobId) return
    if (status.event === 'progress') {
      onStatus({
        status: 'running',
        progress: Number(status.percent) || 0,
        frame: status.frame,
        totalFrames: status.totalFrames,
        fps: status.fps,
        etaSeconds: status.etaSeconds,
        statusMessage: `Upscaling to ${target.width}x${target.height} with NVIDIA RTX... ${Math.round(Number(status.percent) || 0)}%`,
      })
      return
    }
    if (status.event === 'start') {
      onStatus({
        status: 'running',
        progress: 0,
        frame: 0,
        totalFrames: status.totalFrames,
        statusMessage: `Starting direct NVIDIA RTX upscale to ${target.width}x${target.height}...`,
      })
    }
  })
  const abort = () => {
    window.electronAPI.cancelRtxVideoUpscale?.(jobId).catch(() => {})
  }

  try {
    signal?.addEventListener?.('abort', abort, { once: true })
    const result = await window.electronAPI.runRtxVideoUpscale({
      jobId,
      inputPath,
      outputPath,
      width: target.width,
      height: target.height,
      quality: normalizeRtxUpscaleQuality(quality),
      encoder: resolveRtxNvencEncoder(videoCodec),
      cq: 18,
    })
    if (signal?.aborted || result?.cancelled) throw createAbortError()
    if (!result?.success) throw new Error(result?.error || 'NVIDIA RTX upscale failed.')
    onStatus({
      status: 'complete',
      progress: 100,
      statusMessage: 'NVIDIA RTX 4K upscale complete.',
    })
    return {
      ...result,
      outputPath,
      sourcePath: inputPath,
      width: target.width,
      height: target.height,
      quality: normalizeRtxUpscaleQuality(quality),
      videoCodec: String(videoCodec || '').toLowerCase() === 'h265' ? 'h265' : 'h264',
      encoderUsed: 'NVIDIA RTX Video Super Resolution',
    }
  } finally {
    signal?.removeEventListener?.('abort', abort)
    unsubscribe?.()
  }
}
