import { comfyui } from './comfyui'
import { getBundledWorkflowPath } from '../config/workflowRegistry'
import { isElectron } from './fileSystem'

const CAPTION_WORKFLOW_PATH = getBundledWorkflowPath('caption_qwen_asr_transcription.json')
const VIDEO_INPUT_NODE_ID = '18'
const POLL_INTERVAL_MS = 3000
const MAX_POLL_ATTEMPTS = 300

function createCue(start, end, text, index) {
  return {
    id: `cue-${index + 1}`,
    start: Math.round(start * 100) / 100,
    end: Math.round((end > start ? end : start + 0.4) * 100) / 100,
    text: String(text || '').trim(),
    words: [],
  }
}

function parseTimestampToSeconds(value) {
  const match = String(value || '').trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/)
  if (!match) return null
  const [, hh, mm, ss, ms] = match
  return (
    Number(hh) * 3600
    + Number(mm) * 60
    + Number(ss)
    + Number(ms) / 1000
  )
}

function parseLegacyQwenSubtitleLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed) return null

  const match = trimmed.match(/^([\d.]+)\s*-\s*([\d.]+)\s*:\s*(.+)$/)
  if (!match) return null

  const start = parseFloat(match[1])
  const end = parseFloat(match[2])
  const text = match[3].trim()

  if (!Number.isFinite(start) || !Number.isFinite(end) || !text) return null
  return { start, end, text }
}

function parseLegacyQwenSubtitles(rawText) {
  const lines = String(rawText || '').split('\n')
  const cues = []

  for (const line of lines) {
    const parsed = parseLegacyQwenSubtitleLine(line)
    if (!parsed) continue
    cues.push(createCue(parsed.start, parsed.end, parsed.text, cues.length))
  }

  return cues
}

function parseSrtSubtitles(rawText) {
  const blocks = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)

  const cues = []

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    if (lines.length < 2) continue

    const timeLineIndex = lines[0].includes('-->') ? 0 : 1
    const timeLine = lines[timeLineIndex]
    const timeMatch = timeLine.match(/^(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})$/)
    if (!timeMatch) continue

    const start = parseTimestampToSeconds(timeMatch[1])
    const end = parseTimestampToSeconds(timeMatch[2])
    const textLines = lines.slice(timeLineIndex + 1)
    const text = textLines.join(' ').replace(/\s+/g, ' ').trim()

    if (!Number.isFinite(start) || !Number.isFinite(end) || !text) continue
    cues.push(createCue(start, end, text, cues.length))
  }

  return cues
}

export function parseCaptionSubtitles(rawText) {
  const text = String(rawText || '').trim()
  if (!text) return []

  if (text.includes('-->')) {
    const srtCues = parseSrtSubtitles(text)
    if (srtCues.length > 0) return srtCues
  }

  return parseLegacyQwenSubtitles(text)
}

async function loadCaptionWorkflow() {
  const response = await fetch(CAPTION_WORKFLOW_PATH)
  if (!response.ok) {
    throw new Error(`Could not load caption workflow: ${response.status}`)
  }
  return await response.json()
}

function buildCaptionWorkflow(baseWorkflow, uploadedVideoFilename) {
  const workflow = JSON.parse(JSON.stringify(baseWorkflow))

  if (workflow[VIDEO_INPUT_NODE_ID]) {
    workflow[VIDEO_INPUT_NODE_ID].inputs.video = uploadedVideoFilename
  }

  return workflow
}

function extractSubtitleTextFromHistory(history, promptId) {
  const promptHistory = history?.[promptId]
  if (!promptHistory) return null

  const outputs = promptHistory.outputs || {}

  for (const nodeId of Object.keys(outputs)) {
    const nodeOutput = outputs[nodeId]
    if (!nodeOutput) continue

    for (const key of ['SUBTITLES', 'subtitles', 'TEXT', 'text', 'STRING', 'string', 'srt', 'SRT']) {
      const value = nodeOutput[key]

      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }

      if (Array.isArray(value)) {
        const joined = value
          .map((item) => (typeof item === 'string' ? item : ''))
          .join('\n')
          .trim()
        if (joined) return joined
      }
    }

    for (const key of Object.keys(nodeOutput)) {
      const value = nodeOutput[key]
      if (typeof value === 'string' && value.includes('-') && value.includes(':') && value.length > 10) {
        return value.trim()
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && item.includes('-') && item.includes(':') && item.length > 10) {
            return item.trim()
          }
        }
      }
    }
  }

  return null
}

async function uploadVideoToComfy(asset) {
  let fileToUpload = null
  const safeName = String(asset.name || `caption_source_${Date.now()}`)
    .replace(/[^a-zA-Z0-9_\-.\s]/g, '_')

  if (isElectron() && asset.absolutePath && window.electronAPI?.readFileAsBuffer) {
    const bufferResult = await window.electronAPI.readFileAsBuffer(asset.absolutePath)
    if (bufferResult?.success && bufferResult?.data) {
      const mimeType = asset.mimeType || 'video/mp4'
      fileToUpload = new File([bufferResult.data], safeName, { type: mimeType })
    }
  }

  if (!fileToUpload && asset.url) {
    const response = await fetch(asset.url)
    if (response.ok) {
      const blob = await response.blob()
      fileToUpload = new File([blob], safeName, { type: blob.type || 'video/mp4' })
    }
  }

  if (!fileToUpload) {
    throw new Error('Could not read the source video for upload to ComfyUI.')
  }

  const uploadResult = await comfyui.uploadFile(fileToUpload, safeName)
  return uploadResult.name || safeName
}

async function pollForCompletion(promptId, onProgress) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

    try {
      const history = await comfyui.getHistory(promptId)
      const promptHistory = history?.[promptId]

      if (promptHistory) {
        if (promptHistory.status?.status_str === 'error') {
          const errorMsg = promptHistory.status?.messages
            ?.map((m) => (Array.isArray(m) ? m.join(': ') : String(m)))
            ?.join(' | ')
          throw new Error(`ComfyUI caption workflow failed: ${errorMsg || 'unknown error'}`)
        }

        const outputs = promptHistory.outputs
        if (outputs && Object.keys(outputs).length > 0) {
          return history
        }
      }
    } catch (error) {
      if (error.message?.includes('failed')) throw error
    }

    if (typeof onProgress === 'function') {
      const elapsed = Math.round((attempt + 1) * POLL_INTERVAL_MS / 1000)
      onProgress({
        stage: 'transcribe',
        message: `Transcribing with Qwen3-ASR... (${elapsed}s)`,
      })
    }
  }

  throw new Error('Caption transcription timed out waiting for ComfyUI.')
}

export async function transcribeWithComfyUI(asset, { onProgress } = {}) {
  if (!asset) {
    throw new Error('A source video is required to generate captions.')
  }

  const connected = await comfyui.checkConnection()
  if (!connected) {
    throw new Error('ComfyUI is not connected. Start ComfyUI and try again.')
  }

  if (typeof onProgress === 'function') {
    onProgress({ stage: 'upload', message: 'Uploading video to ComfyUI...' })
  }

  const uploadedFilename = await uploadVideoToComfy(asset)

  if (typeof onProgress === 'function') {
    onProgress({ stage: 'workflow', message: 'Loading caption workflow...' })
  }

  const baseWorkflow = await loadCaptionWorkflow()
  const workflow = buildCaptionWorkflow(baseWorkflow, uploadedFilename)

  if (typeof onProgress === 'function') {
    onProgress({ stage: 'queue', message: 'Queuing transcription on ComfyUI...' })
  }

  const promptId = await comfyui.queuePrompt(workflow)
  if (!promptId) {
    throw new Error('ComfyUI did not return a prompt ID for the caption workflow.')
  }

  if (typeof onProgress === 'function') {
    onProgress({ stage: 'transcribe', message: 'Transcribing with Qwen3-ASR...' })
  }

  const history = await pollForCompletion(promptId, onProgress)
  const subtitleText = extractSubtitleTextFromHistory(history, promptId)

  if (!subtitleText) {
    throw new Error(
      'ComfyUI completed the caption workflow but no subtitle text was found in the output. '
      + 'Make sure the Subtitle (QwenASR) node is installed and working in your ComfyUI.'
    )
  }

  const cues = parseCaptionSubtitles(subtitleText)
  if (cues.length === 0) {
    throw new Error('The caption workflow produced output but no timed cues could be parsed from:\n' + subtitleText.slice(0, 200))
  }

  const audioDuration = Number(asset.duration)
    || Number(asset.settings?.duration)
    || Math.max(...cues.map((cue) => cue.end), 0)
    || null

  const transcriptText = cues.map((cue) => cue.text).join(' ').replace(/\s+/g, ' ').trim()

  return {
    modelId: 'Qwen/Qwen3-ASR-0.6B',
    transcriptText,
    words: [],
    cues,
    audioDuration,
    source: 'comfyui',
  }
}
