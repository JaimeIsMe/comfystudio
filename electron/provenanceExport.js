const crypto = require('crypto')
const path = require('path')
const { lstat, open } = require('fs/promises')

const PUBLIC_PROVENANCE_ORIGIN = 'https://velornlabs.github.io'
const PUBLIC_PROVENANCE_PATH = '/velorn-creator-provenance/'
const MAX_ISSUE_FRAGMENT_CHARACTERS = 8_192
const UINT64_MAX = 18_446_744_073_709_551_615n

const EXPORT_MIME_TYPES = Object.freeze({
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
})

class ProvenanceExportError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProvenanceExportError'
  }
}

function mimeTypeForExportPath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() !== filePath || !path.isAbsolute(filePath)) {
    throw new ProvenanceExportError('Finished export path must be absolute.')
  }
  const mimeType = EXPORT_MIME_TYPES[path.extname(filePath).toLowerCase()]
  if (!mimeType) {
    throw new ProvenanceExportError('Creator provenance currently supports finished single-file media exports only.')
  }
  return mimeType
}

function sameFileSnapshot(before, after) {
  return before.size === after.size
    && before.dev === after.dev
    && before.ino === after.ino
    && before.mtimeNs === after.mtimeNs
    && before.ctimeNs === after.ctimeNs
}

async function inspectProvenanceExport(filePath, testHooks = undefined) {
  const mimeType = mimeTypeForExportPath(filePath)
  let handle
  try {
    const pathBefore = await lstat(filePath, { bigint: true })
    if (pathBefore.isSymbolicLink() || !pathBefore.isFile()) {
      throw new ProvenanceExportError('Finished export must be a non-empty regular media file, not a symbolic link.')
    }
    handle = await open(filePath, 'r')
    const before = await handle.stat({ bigint: true })
    if (
      !before.isFile()
      || before.size <= 0n
      || before.size > UINT64_MAX
      || !sameFileSnapshot(pathBefore, before)
    ) {
      throw new ProvenanceExportError('Finished export must be a non-empty regular media file.')
    }

    const hash = crypto.createHash('sha256')
    const stream = handle.createReadStream({ autoClose: false })
    for await (const chunk of stream) hash.update(chunk)

    // This hook is never exposed through preload or IPC. It exists solely so
    // the focused test can deterministically prove that a file replacement or
    // rewrite during hashing fails closed.
    await testHooks?.beforeFinalStat?.()

    const after = await handle.stat({ bigint: true })
    const pathAfter = await lstat(filePath, { bigint: true })
    if (
      pathAfter.isSymbolicLink()
      || !sameFileSnapshot(before, after)
      || !sameFileSnapshot(after, pathAfter)
    ) {
      throw new ProvenanceExportError('Finished export changed while it was being hashed. Prepare the review again.')
    }

    return Object.freeze({
      sha256: hash.digest('hex'),
      byteLength: before.size.toString(10),
      mimeType,
    })
  } catch (error) {
    if (error instanceof ProvenanceExportError) throw error
    throw new ProvenanceExportError('Could not read the finished export for local hashing.')
  } finally {
    if (handle) {
      try {
        await handle.close()
      } catch {
        // The hash result is already discarded if reading failed. A close
        // failure must not expose the user's absolute path through IPC.
      }
    }
  }
}

function validatePublicProvenanceReviewUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProvenanceExportError('Public provenance review URL is missing.')
  }
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new ProvenanceExportError('Public provenance review URL is invalid.')
  }

  if (
    parsed.origin !== PUBLIC_PROVENANCE_ORIGIN
    || parsed.pathname !== PUBLIC_PROVENANCE_PATH
    || parsed.search !== ''
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.hash.length > MAX_ISSUE_FRAGMENT_CHARACTERS
    || !/^#issue\/v1\/[A-Za-z0-9_-]+$/u.test(parsed.hash)
  ) {
    throw new ProvenanceExportError('Public provenance review URL is outside the fixed Velorn review site.')
  }
  return parsed.href
}

module.exports = {
  EXPORT_MIME_TYPES,
  MAX_ISSUE_FRAGMENT_CHARACTERS,
  PUBLIC_PROVENANCE_ORIGIN,
  PUBLIC_PROVENANCE_PATH,
  ProvenanceExportError,
  inspectProvenanceExport,
  mimeTypeForExportPath,
  validatePublicProvenanceReviewUrl,
}
