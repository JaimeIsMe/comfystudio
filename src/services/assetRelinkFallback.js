/**
 * Auto-relink fallback for moved projects.
 *
 * Projects that travel between machines keep absolute media paths from the
 * old machine, so every imported/generated asset shows up missing even when
 * the files came along inside the project's own assets/ tree. On open, when
 * a recorded absolute path is dead, we look for the same assets/-relative
 * suffix under the current project root and quietly relink to it.
 *
 * Pure path logic lives here (no window/electron access) so it can be unit
 * tested; callers inject an `exists` check.
 */

const URL_LIKE_PATTERN = /^(https?|blob|data|file):/i

const splitPathSegments = (value) => String(value || '').split(/[\\/]+/).filter(Boolean)

/**
 * Convert a current-machine path under the open project into the portable
 * forward-slash path stored in project files.
 */
export const getProjectRelativeAssetPath = (filePath, projectPath) => {
  const fileSegments = splitPathSegments(filePath)
  const projectSegments = splitPathSegments(projectPath)
  if (fileSegments.length <= projectSegments.length || projectSegments.length === 0) return ''

  const isUnderProject = projectSegments.every((segment, index) => (
    segment.toLowerCase() === fileSegments[index]?.toLowerCase()
  ))
  if (!isUnderProject) return ''
  return fileSegments.slice(projectSegments.length).join('/')
}

/**
 * Absolute in any of the shapes we record: drive-letter (C:\ or C:/),
 * UNC (\\server\share), or POSIX root (/Users/...).
 */
export const isAbsoluteRecordedPath = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return false
  if (/^[a-zA-Z]:[\\/]/.test(raw)) return true
  if (/^[\\/]/.test(raw)) return true
  return false
}

/**
 * The absolute path an asset record claims its media lives at, or '' when
 * the asset only carries a project-relative path (those already resolve
 * against the current project and need no fallback).
 */
export const getRecordedAbsolutePath = (asset = {}) => {
  const candidates = [asset.absolutePath, asset.path, asset.settings?.sourcePath]
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim()
    if (!raw || URL_LIKE_PATTERN.test(raw)) continue
    if (isAbsoluteRecordedPath(raw)) return raw
  }
  return ''
}

/**
 * Candidate current-machine paths for an asset whose recorded paths are
 * dead, ordered most-faithful first. For each recorded path:
 * - relative paths resolve directly against the project root;
 * - absolute paths contribute one candidate per `assets` segment, keeping
 *   everything from that segment on (longest suffix first, so nested
 *   assets/ trees keep their structure).
 * Candidates identical to a recorded path are skipped — if the recorded
 * path were alive we would not be here.
 */
export const buildMovedAssetPathCandidates = (asset = {}, projectPath = '') => {
  const projectRoot = String(projectPath || '').trim().replace(/[\\/]+$/, '')
  if (!projectRoot) return []
  const sep = projectRoot.includes('\\') ? '\\' : '/'

  const recordedPaths = [asset.absolutePath, asset.path, asset.settings?.sourcePath]
    .map((value) => String(value || '').trim())
    .filter((value) => value && !URL_LIKE_PATTERN.test(value))
  const recordedKeys = new Set(
    recordedPaths.map((value) => splitPathSegments(value).join('/').toLowerCase())
  )

  const candidates = []
  const seen = new Set()
  const pushCandidate = (segments) => {
    const key = `${splitPathSegments(projectRoot).join('/')}/${segments.join('/')}`.toLowerCase()
    if (seen.has(key) || recordedKeys.has(key)) return
    seen.add(key)
    candidates.push(`${projectRoot}${sep}${segments.join(sep)}`)
  }

  for (const recorded of recordedPaths) {
    const segments = splitPathSegments(recorded)
    if (!isAbsoluteRecordedPath(recorded)) {
      if (segments.length > 0) pushCandidate(segments)
      continue
    }
    for (let index = 0; index < segments.length; index += 1) {
      if (segments[index].toLowerCase() !== 'assets') continue
      const suffix = segments.slice(index)
      if (suffix.length < 2) continue
      pushCandidate(suffix)
    }
  }

  return candidates
}

/**
 * Resolve where a moved asset's media actually lives now.
 *
 * @param {object} asset - Asset record from the project file.
 * @param {string} projectPath - Absolute path of the currently open project.
 * @param {(path: string) => Promise<boolean>} exists - Existence check.
 * @returns {Promise<{fromPath: string, toPath: string}|null>} null when the
 *   recorded path is fine (or absent), or nothing better was found.
 */
export const resolveMovedAssetPath = async (asset, projectPath, exists) => {
  if (typeof exists !== 'function') return null
  const recordedAbsolute = getRecordedAbsolutePath(asset)
  if (!recordedAbsolute) return null
  if (await exists(recordedAbsolute)) return null

  for (const candidate of buildMovedAssetPathCandidates(asset, projectPath)) {
    if (await exists(candidate)) {
      return { fromPath: recordedAbsolute, toPath: candidate }
    }
  }
  return null
}
