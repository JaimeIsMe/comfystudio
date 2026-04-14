import { isElectron } from './fileSystem'

export const CAPTIONS_FOLDER_NAME = 'Captions'
export const CAPTION_SIDECAR_DIR = 'captions'

function sanitizeSegment(value, fallback = 'captions') {
  const normalized = String(value || fallback)
    .replace(/\.[^./\\]+$/, '')
    .replace(/[^a-zA-Z0-9_\-\s]/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim()

  return normalized || fallback
}

export function ensureCaptionsFolder(folders = [], addFolder) {
  const existing = (folders || []).find((folder) => folder?.name === CAPTIONS_FOLDER_NAME && !folder?.parentId)
  if (existing) return existing.id
  if (typeof addFolder !== 'function') return null
  const created = addFolder({ name: CAPTIONS_FOLDER_NAME, parentId: null })
  return created?.id || null
}

export function buildCaptionAssetName(sourceAsset, preset) {
  const sourceBase = sanitizeSegment(sourceAsset?.name || 'source_video', 'source_video')
  const presetBase = sanitizeSegment(preset?.name || 'captions', 'captions')
  return `${sourceBase}_${presetBase}_captions`
}

export async function saveCaptionSidecar(projectDir, sourceAsset, payload) {
  if (!isElectron() || typeof projectDir !== 'string') {
    throw new Error('Caption sidecars are only available in the desktop app with an open project.')
  }

  const fileBase = sanitizeSegment(sourceAsset?.name || 'captions', 'captions')
  const fileName = `${fileBase}_${Date.now()}.caption.json`
  const captionsDir = await window.electronAPI.pathJoin(projectDir, CAPTION_SIDECAR_DIR)
  await window.electronAPI.createDirectory(captionsDir)
  const absolutePath = await window.electronAPI.pathJoin(captionsDir, fileName)

  const result = await window.electronAPI.writeFile(
    absolutePath,
    JSON.stringify(payload, null, 2),
    { encoding: 'utf8' }
  )

  if (!result?.success) {
    throw new Error(result?.error || 'Could not write caption sidecar.')
  }

  return {
    path: `${CAPTION_SIDECAR_DIR}/${fileName}`,
    absolutePath,
  }
}

export async function loadCaptionSidecar(projectDir, relativePath) {
  if (!projectDir || !relativePath) return null

  const pathSegments = String(relativePath)
    .split(/[\\/]+/)
    .filter(Boolean)

  if (pathSegments.length === 0) return null

  if (isElectron() && typeof projectDir === 'string') {
    const absolutePath = await window.electronAPI.pathJoin(projectDir, ...pathSegments)
    const result = await window.electronAPI.readFile(absolutePath, { encoding: 'utf8' })
    if (!result?.success || !result?.data) return null
    return JSON.parse(result.data)
  }

  return null
}
