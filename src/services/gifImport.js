/**
 * Shared renderer-side GIF import orchestration.
 *
 * A selected File is staged in the project cache because modern Electron no
 * longer guarantees a renderer-visible absolute File.path. Static GIFs then
 * use the ordinary image import path. Animated GIFs are normalized once in
 * the main process and the resulting video becomes the portable project
 * asset; temporary GIF/intermediate files are always removed.
 */

import { getProjectFileUrl, importAsset, isElectron } from './fileSystem'

const GIF_IMPORT_MAX_BYTES = 128 * 1024 * 1024

export function isGifFilename(value) {
  return /\.gif$/i.test(String(value || '').trim())
}

export function canImportGifMedia() {
  return isElectron()
    && Boolean(window.electronAPI?.probeGif)
    && Boolean(window.electronAPI?.transcodeAnimatedGif)
    && Boolean(window.electronAPI?.writeFileFromArrayBuffer)
    && Boolean(window.electronAPI?.deleteFile)
}

function safeBaseName(value) {
  const base = String(value || 'animated_gif')
    .replace(/\.gif$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  return base || 'animated_gif'
}

function buildGifSourceMetadata({ name, size, probe, animated, transcode = null }) {
  return {
    version: 1,
    originalName: name,
    originalSize: Number(size) || Number(probe?.size) || null,
    animated: Boolean(animated),
    frameCount: Number(probe?.frameCount) || 1,
    duration: animated ? (Number(transcode?.duration) || Number(probe?.duration) || null) : null,
    averageFps: animated ? (Number(transcode?.fps) || Number(probe?.fps) || null) : null,
    width: Number(probe?.width) || null,
    height: Number(probe?.height) || null,
    loopCount: probe?.loopCount ?? null,
    hasTransparency: probe?.hasTransparency === true,
    importedAt: new Date().toISOString(),
  }
}

async function removeTemporaryFile(filePath) {
  if (!filePath) return
  try {
    await window.electronAPI.deleteFile(filePath)
  } catch {
    // Best effort: a failed import should still report its original error.
  }
}

async function getInputName(file) {
  if (typeof file !== 'string') return String(file?.name || 'import.gif')
  return await window.electronAPI.pathBasename(file)
}

async function stageGifFile(projectDir, file, originalName) {
  if (typeof file === 'string') return { inputPath: file, stagedPath: null }
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new Error('The selected GIF could not be read.')
  }
  if (Number(file.size) > GIF_IMPORT_MAX_BYTES) {
    throw new Error(`GIF is larger than the ${Math.round(GIF_IMPORT_MAX_BYTES / 1024 / 1024)} MB import limit.`)
  }
  const cacheDir = await window.electronAPI.pathJoin(projectDir, 'cache')
  await window.electronAPI.createDirectory(cacheDir)
  const stamp = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
  const stagedPath = await window.electronAPI.pathJoin(
    cacheDir,
    `.gif_import_${safeBaseName(originalName)}_${stamp}.gif`
  )
  try {
    const contents = await file.arrayBuffer()
    if (contents.byteLength > GIF_IMPORT_MAX_BYTES) {
      throw new Error(`GIF is larger than the ${Math.round(GIF_IMPORT_MAX_BYTES / 1024 / 1024)} MB import limit.`)
    }
    const writeResult = await window.electronAPI.writeFileFromArrayBuffer(stagedPath, contents)
    if (!writeResult?.success) {
      throw new Error(writeResult?.error || 'Could not stage the GIF for import.')
    }
    return { inputPath: stagedPath, stagedPath }
  } catch (error) {
    // The write IPC can reject after creating a partial file. Clean it here
    // because the outer importer does not receive stagedPath until success.
    await removeTemporaryFile(stagedPath)
    throw error
  }
}

/**
 * Import a GIF into a saved Electron project.
 *
 * Returns the same asset payload shape as importAsset. Callers do not need a
 * separate GIF asset type: static files return `image`; animations return a
 * normal `video` whose source is the project-owned normalized intermediate.
 */
export async function importGifAsset(projectDir, file) {
  if (!canImportGifMedia()) throw new Error('GIF import requires the Velorn desktop app.')
  if (typeof projectDir !== 'string' || !projectDir) {
    throw new Error('Open a saved project before importing a GIF.')
  }

  const originalName = await getInputName(file)
  if (!isGifFilename(originalName)) throw new Error('The selected file is not a GIF.')

  let stagedPath = null
  let intermediatePath = null
  try {
    const staged = await stageGifFile(projectDir, file, originalName)
    stagedPath = staged.stagedPath
    const probe = await window.electronAPI.probeGif({ inputPath: staged.inputPath })
    if (!probe?.success) throw new Error(probe?.error || 'Could not inspect the GIF.')

    if (!probe.animated) {
      const imported = await importAsset(projectDir, file, 'images')
      const url = await getProjectFileUrl(projectDir, imported.path)
      return {
        ...imported,
        type: 'image',
        url,
        width: imported.width || probe.width || null,
        height: imported.height || probe.height || null,
        sourceFormat: 'gif',
        settings: {
          ...(imported.settings || {}),
          gifSource: buildGifSourceMetadata({
            name: originalName,
            size: typeof file === 'string' ? probe.size : file?.size,
            probe,
            animated: false,
          }),
        },
      }
    }

    const cacheDir = await window.electronAPI.pathJoin(projectDir, 'cache')
    await window.electronAPI.createDirectory(cacheDir)
    const transcode = await window.electronAPI.transcodeAnimatedGif({
      inputPath: staged.inputPath,
      outputDir: cacheDir,
      baseName: safeBaseName(originalName),
    })
    if (!transcode?.success || !transcode.outputPath) {
      throw new Error(transcode?.error || 'Could not convert the animated GIF for editing.')
    }
    intermediatePath = transcode.outputPath

    const imported = await importAsset(projectDir, intermediatePath, 'video')
    const url = await getProjectFileUrl(projectDir, imported.path)
    const duration = Number(transcode.duration) || Number(imported.duration) || null
    const fps = Number(transcode.fps) || Number(imported.fps) || null
    const hasAlpha = transcode.alpha === true
    return {
      ...imported,
      name: originalName,
      url,
      type: 'video',
      duration,
      fps,
      width: Number(transcode.width) || Number(imported.width) || null,
      height: Number(transcode.height) || Number(imported.height) || null,
      videoCodec: transcode.codec || imported.videoCodec || null,
      hasAudio: false,
      audioEnabled: false,
      sourceFormat: 'gif',
      mimeType: hasAlpha ? 'video/webm' : 'video/mp4',
      settings: {
        ...(imported.settings || {}),
        duration,
        fps,
        width: Number(transcode.width) || Number(imported.width) || null,
        height: Number(transcode.height) || Number(imported.height) || null,
        hasAlpha,
        gifSource: buildGifSourceMetadata({
          name: originalName,
          size: typeof file === 'string' ? probe.size : file?.size,
          probe,
          animated: true,
          transcode,
        }),
      },
    }
  } finally {
    await removeTemporaryFile(intermediatePath)
    await removeTemporaryFile(stagedPath)
  }
}
