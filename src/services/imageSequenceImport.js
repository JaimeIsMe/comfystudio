/**
 * Image sequence import orchestration (Electron only).
 *
 * Detection is pure (utils/imageSequenceDetection); this service adds the
 * filesystem-aware parts: expanding a folder drop or a single dropped frame
 * into its sibling frames, running the main-process transcode, and turning
 * the resulting intermediate into a normal project video asset that carries
 * its sequence provenance in settings.sequenceSource.
 */

import { importAsset, isElectron, getProjectFileUrl } from './fileSystem'
import {
  detectImageSequences,
  parseSequenceFileName,
  buildSequenceEntries,
  sequenceBaseName,
  MIN_SEQUENCE_FRAMES,
} from '../utils/imageSequenceDetection'

export function canImportImageSequences() {
  return isElectron()
    && Boolean(window.electronAPI?.transcodeImageSequence)
    && Boolean(window.electronAPI?.listDirectory)
}

async function listImageFiles(dirPath) {
  const result = await window.electronAPI.listDirectory(dirPath)
  if (!result?.success) return null
  return (result.items || [])
    .filter((item) => item.isFile)
    .map((item) => ({ name: item.name, path: item.path }))
}

/**
 * Build the sequence-import plan for a set of dropped/picked File objects.
 *
 * - one directory → detect sequences among the images inside it
 * - one numbered frame → offer the whole sibling run from its folder
 * - several files → group the dropped set itself
 *
 * Returns null when nothing sequence-shaped is present (caller falls back to
 * the normal import path). `leftoverFiles` are dropped File objects that
 * joined no sequence and should import as usual.
 */
export async function buildSequenceImportPlan(files) {
  if (!canImportImageSequences()) return null
  const fileList = (files || []).filter(Boolean)
  if (fileList.length === 0) return null

  // Electron's File objects carry absolute paths; without them we cannot
  // reach the frames from the main process.
  if (!fileList.every((f) => typeof f.path === 'string' && f.path)) return null

  // Single directory drop: sequences live inside it.
  if (fileList.length === 1 && !parseSequenceFileName(fileList[0].name) && !fileList[0].type && fileList[0].size === 0) {
    const inside = await listImageFiles(fileList[0].path)
    if (!inside) return null
    const { sequences } = detectImageSequences(inside)
    if (sequences.length === 0) return null
    return { sequences, leftoverFiles: [], expandedFrom: 'folder' }
  }

  // Single numbered frame: offer its sibling run (the Flame reflex — drop one
  // frame, mean the shot). Only the matched run is proposed; nothing else in
  // the folder imports.
  if (fileList.length === 1) {
    const parsed = parseSequenceFileName(fileList[0].name)
    if (!parsed || !window.electronAPI?.pathDirname) return null
    const dirPath = await window.electronAPI.pathDirname(fileList[0].path)
    const siblings = await listImageFiles(dirPath)
    if (!siblings) return null
    const { sequences } = detectImageSequences(siblings)
    const match = sequences.find((seq) => (
      seq.prefix.toLowerCase() === parsed.prefix.toLowerCase() && seq.ext === parsed.ext
    ))
    if (!match || match.count < MIN_SEQUENCE_FRAMES) return null
    return { sequences: [match], leftoverFiles: [], expandedFrom: 'sibling', droppedFiles: fileList }
  }

  // Multiple files: group exactly what was dropped.
  const { sequences, leftovers } = detectImageSequences(
    fileList.map((f) => ({ name: f.name, path: f.path, file: f }))
  )
  if (sequences.length === 0) return null
  const leftoverFiles = leftovers.map((entry) => entry.file || entry).filter((f) => f instanceof File)
  return { sequences, leftoverFiles, expandedFrom: 'files' }
}

/**
 * Transcode one detected sequence and register the intermediate as a project
 * video asset. Returns the payload for assets-store `addAsset`.
 */
export async function importImageSequenceAsAsset({ projectDir, sequence, fps, jobId }) {
  if (!canImportImageSequences()) throw new Error('Image sequence import needs the desktop app.')
  if (typeof projectDir !== 'string' || !projectDir) throw new Error('Open a saved project before importing sequences.')

  const safeFps = Number(fps) > 0 ? Number(fps) : 24
  const entries = buildSequenceEntries(sequence, safeFps)
  if (entries.some((entry) => !entry.path)) throw new Error('Sequence frames are missing file paths.')

  const cacheDir = await window.electronAPI.pathJoin(projectDir, 'cache')
  await window.electronAPI.createDirectory(cacheDir)

  const isExr = sequence.ext === '.exr'
  const result = await window.electronAPI.transcodeImageSequence({
    entries,
    fps: safeFps,
    outputDir: cacheDir,
    baseName: sequenceBaseName(sequence),
    alpha: 'auto',
    // Linear EXR baked to display through the standard curve; experimental
    // until Velorn does real color management.
    applyTrc: isExr ? 'bt709' : null,
    jobId: jobId || null,
  })
  if (!result?.success || !result.outputPath) {
    throw new Error(result?.error || 'Sequence transcode failed.')
  }

  // importAsset copies the intermediate into assets/video/ with unique naming
  // and probes duration/dimensions/fps — the same path every video import
  // takes. The cache copy is deleted afterwards.
  let assetInfo
  try {
    assetInfo = await importAsset(projectDir, result.outputPath, 'video')
  } finally {
    try { await window.electronAPI.deleteFile(result.outputPath) } catch { /* best-effort */ }
  }

  const url = await getProjectFileUrl(projectDir, assetInfo.path)
  return {
    ...assetInfo,
    url,
    settings: {
      duration: assetInfo.duration,
      fps: assetInfo.fps || safeFps,
      // The provenance tag: everything needed to re-interpret or regenerate
      // this sequence later (different fps, better transform) from the
      // original frames on disk.
      sequenceSource: {
        version: 1,
        dir: sequence.frames[0]?.path
          ? sequence.frames[0].path.slice(0, sequence.frames[0].path.length - sequence.frames[0].name.length).replace(/[\\/]+$/, '')
          : null,
        pattern: sequence.pattern,
        ext: sequence.ext,
        start: sequence.start,
        end: sequence.end,
        count: sequence.count,
        missing: sequence.missing,
        holdMissing: true,
        fps: safeFps,
        alpha: Boolean(result.alpha),
        colorTransform: isExr ? 'linear-to-bt709' : null,
        importedAt: new Date().toISOString(),
      },
    },
  }
}
