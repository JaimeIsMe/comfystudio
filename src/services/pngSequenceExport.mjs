const WINDOWS_RESERVED_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/
const WINDOWS_UNC_PATH = /^\\\\[^\\/]+[\\/][^\\/]+/

const isAbsoluteDesktopPath = (value) => (
  value.startsWith('/')
  || WINDOWS_ABSOLUTE_PATH.test(value)
  || WINDOWS_UNC_PATH.test(value)
)

/**
 * Produce one portable filename stem for a rendered PNG sequence.
 *
 * The result is safe on Windows, macOS, and Linux while retaining ordinary
 * spaces and punctuation that are valid on every supported platform.
 */
export const sanitizePngSequenceBaseName = (value) => {
  let safeName = String(value || 'export')
    .normalize('NFKC')
    .replace(/\.png$/i, '')
    // Percent is legal in filenames, but it is a printf directive in the
    // sequence pattern reported to FFmpeg-compatible tools.
    .replace(/[<>:"/\\|?*%\u0000-\u001f]/g, '_')
    .trim()
    .replace(/^\.+$/, '')
    .replace(/^\.+/, '_')
    .replace(/[. ]+$/g, '')

  // Sixty Unicode code points leaves enough room for the frame suffix under
  // common 255-byte filesystem component limits, including four-byte UTF-8.
  safeName = Array.from(safeName).slice(0, 60).join('').replace(/[. ]+$/g, '')

  if (!safeName || safeName === '.' || safeName === '..') {
    safeName = 'export'
  }
  if (WINDOWS_RESERVED_BASENAME.test(safeName)) {
    safeName = `_${safeName}`
  }
  return safeName
}

export const getPngSequenceFrameFilename = (baseName, oneBasedFrameNumber) => {
  const frameNumber = Math.max(1, Math.floor(Number(oneBasedFrameNumber) || 1))
  return `${sanitizePngSequenceBaseName(baseName)}_${String(frameNumber).padStart(6, '0')}.png`
}

export const getPngSequenceFramePattern = (baseName) => (
  `${sanitizePngSequenceBaseName(baseName)}_%06d.png`
)

/** Pick a currently unused child name without creating it. The ownership
 * wrapper performs the exclusive mkdir later, closing the race safely. */
export const resolveAvailablePngSequenceFolder = async ({
  api,
  parentFolder,
  filename,
  maxAttempts = 10000,
}) => {
  if (!api?.pathJoin || !api?.exists) {
    throw new Error('PNG image sequence folder selection is unavailable. Restart Velorn and try again.')
  }
  if (typeof parentFolder !== 'string' || !isAbsoluteDesktopPath(parentFolder)) {
    throw new Error('Choose an absolute parent folder for the PNG image sequence.')
  }

  const folderBaseName = `${sanitizePngSequenceBaseName(filename)}_png`
  for (let index = 1; index <= maxAttempts; index += 1) {
    const folderName = index === 1 ? folderBaseName : `${folderBaseName}_${index}`
    const candidate = await api.pathJoin(parentFolder, folderName)
    if (!(await api.exists(candidate))) return candidate
  }

  throw new Error('Could not find an available PNG image sequence folder name. Choose another location.')
}

/**
 * Remove the internal scratch directory after all PNG frames are complete.
 * Housekeeping must never turn a successful render into destructive cleanup
 * of the finished sequence, so failures are returned as a warning.
 */
export const cleanupCompletedPngSequenceTemp = async ({ api, tempFolder }) => {
  try {
    const result = await api?.deleteDirectory?.(tempFolder, { recursive: true })
    if (result?.success) return null
    return result?.error || 'Unknown temporary-folder cleanup error'
  } catch (err) {
    return err?.message || String(err)
  }
}

/**
 * Run an export with ownership of one newly-created output directory.
 * Existing paths are rejected before creation and are never cleanup targets.
 * The caller-selected parent is not accepted separately, so cleanup can only
 * ever address the exact child path that this function successfully created.
 */
export const withOwnedPngSequenceOutput = async ({ api, outputPath, run }) => {
  if (!api?.exists || !api?.createDirectory || !api?.deleteDirectory) {
    throw new Error('PNG sequence export requires the Velorn desktop app.')
  }
  if (typeof run !== 'function') {
    throw new Error('PNG sequence export is missing its render operation.')
  }

  const exactOutputPath = typeof outputPath === 'string' ? outputPath : ''
  if (!exactOutputPath.trim()) {
    throw new Error('Choose an output folder for the PNG sequence.')
  }
  if (!isAbsoluteDesktopPath(exactOutputPath)) {
    throw new Error('The PNG sequence output folder must use an absolute desktop path.')
  }
  if (await api.exists(exactOutputPath)) {
    throw new Error('The PNG sequence output folder already exists. Choose another name or location.')
  }

  // recursive:false maps to an exclusive mkdir in Electron. If another
  // process creates the path after the exists check, mkdir fails with EEXIST
  // and we never claim ownership or run cleanup against it.
  const createResult = await api.createDirectory(exactOutputPath, { recursive: false })
  if (!createResult?.success) {
    throw new Error(createResult?.error || 'Failed to create the PNG sequence output folder.')
  }

  try {
    return await run(exactOutputPath)
  } catch (err) {
    let cleanupError = null
    try {
      const cleanupResult = await api.deleteDirectory(exactOutputPath, { recursive: true })
      if (!cleanupResult?.success) {
        cleanupError = cleanupResult?.error || 'Unknown cleanup error'
      }
    } catch (caughtCleanupError) {
      cleanupError = caughtCleanupError?.message || String(caughtCleanupError)
    }
    if (cleanupError) {
      console.warn('Failed to clean incomplete PNG sequence output:', cleanupError)
      const originalMessage = err?.message || String(err)
      throw new Error(
        `${originalMessage} Incomplete PNG sequence files remain at ${exactOutputPath} because cleanup failed: ${cleanupError}`
      )
    }
    throw err
  }
}
