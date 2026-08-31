const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { mkdtemp, mkdir, rename, rm, symlink, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  ProvenanceExportError,
  inspectProvenanceExport,
  mimeTypeForExportPath,
  validatePublicProvenanceReviewUrl,
} = require('../electron/provenanceExport')

const EXPECTED_FIXTURE_SHA256 = 'f24204e5f7a75d5d95a3f6b4357becf64b014e1f85cfc3bf3f9b19e2f3e8c573'
const FIXTURE = Buffer.from(
  'Synthetic media fixture for the Velorn Creator Provenance Devnet proof.\n'
  + 'No user media or private project data is included.\n',
)

test('streams an exact hash and public media facts without returning a local path', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'velorn-provenance-export-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const exportPath = path.join(root, 'finished.mp4')
  await writeFile(exportPath, FIXTURE)

  const result = await inspectProvenanceExport(exportPath)
  assert.deepEqual(result, {
    sha256: EXPECTED_FIXTURE_SHA256,
    byteLength: '123',
    mimeType: 'video/mp4',
  })
  assert.equal(Object.hasOwn(result, 'path'), false)
  assert.equal(Object.hasOwn(result, 'filename'), false)
  assert.equal(Object.isFrozen(result), true)
})

test('streams a large finished export without returning its bytes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'velorn-provenance-large-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const exportPath = path.join(root, 'finished.mov')
  const chunk = Buffer.alloc(1024 * 1024, 0x5a)
  const mediaBytes = Buffer.concat(Array.from({ length: 12 }, () => chunk))
  await writeFile(exportPath, mediaBytes)

  const result = await inspectProvenanceExport(exportPath)
  assert.equal(result.sha256, crypto.createHash('sha256').update(mediaBytes).digest('hex'))
  assert.equal(result.byteLength, String(mediaBytes.byteLength))
  assert.equal(result.mimeType, 'video/quicktime')
  assert.deepEqual(Object.keys(result), ['sha256', 'byteLength', 'mimeType'])
})

test('supports only the first-slice MP4 and ProRes MOV containers', () => {
  const expected = new Map([
    ['movie.mp4', 'video/mp4'],
    ['movie.MOV', 'video/quicktime'],
  ])
  for (const [name, mimeType] of expected) {
    assert.equal(mimeTypeForExportPath(path.resolve(name)), mimeType)
  }
})

test('rejects directories, empty files, relative paths, and unsupported exports safely', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'velorn-provenance-reject-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const emptyPath = path.join(root, 'empty.mp4')
  const folderPath = path.join(root, 'frames.mp4')
  const missingPath = path.join(root, 'missing.mp4')
  await writeFile(emptyPath, Buffer.alloc(0))
  await mkdir(folderPath)

  await assert.rejects(() => inspectProvenanceExport(emptyPath), /non-empty regular media file/u)
  await assert.rejects(() => inspectProvenanceExport(folderPath), /non-empty regular media file/u)
  await assert.rejects(
    () => inspectProvenanceExport(missingPath),
    (error) => error instanceof ProvenanceExportError
      && error.message === 'Could not read the finished export for local hashing.'
      && !error.message.includes(missingPath),
  )
  assert.throws(() => mimeTypeForExportPath('relative.mp4'), /must be absolute/u)
  assert.throws(() => mimeTypeForExportPath(path.join(root, 'timeline.fcpxml')), /single-file media/u)
  for (const unsupported of ['movie.webm', 'preview.gif', 'mix.wav', 'mix.mp3', 'mix.m4a']) {
    assert.throws(
      () => mimeTypeForExportPath(path.join(root, unsupported)),
      /single-file media/u,
    )
  }
})

test('fails closed when the finished export changes during hashing', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'velorn-provenance-mutated-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const exportPath = path.join(root, 'finished.mp4')
  await writeFile(exportPath, FIXTURE)

  await assert.rejects(
    () => inspectProvenanceExport(exportPath, {
      beforeFinalStat: () => writeFile(exportPath, Buffer.concat([FIXTURE, Buffer.from('changed')])),
    }),
    /changed while it was being hashed/u,
  )
})

test('rejects symbolic links and path replacement during hashing', {
  skip: process.platform === 'win32' ? 'Windows locks an open export against path replacement.' : false,
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'velorn-provenance-path-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const originalPath = path.join(root, 'original.mp4')
  const replacementPath = path.join(root, 'replacement.mp4')
  const linkPath = path.join(root, 'linked.mp4')
  await writeFile(originalPath, FIXTURE)
  await writeFile(replacementPath, Buffer.concat([FIXTURE, Buffer.from('replacement')]))

  await symlink(originalPath, linkPath)
  await assert.rejects(
    () => inspectProvenanceExport(linkPath),
    /not a symbolic link/u,
  )

  await assert.rejects(
    () => inspectProvenanceExport(originalPath, {
      beforeFinalStat: () => rename(replacementPath, originalPath),
    }),
    /changed while it was being hashed/u,
  )
})

test('accepts only the fixed HTTPS issue route', () => {
  const encoded = Buffer.from('{"contract":"fixture"}', 'utf8').toString('base64url')
  const expected = `https://velornlabs.github.io/velorn-creator-provenance/#issue/v1/${encoded}`
  assert.equal(validatePublicProvenanceReviewUrl(expected), expected)

  for (const unsafe of [
    `http://velornlabs.github.io/velorn-creator-provenance/#issue/v1/${encoded}`,
    `https://example.com/velorn-creator-provenance/#issue/v1/${encoded}`,
    `https://velornlabs.github.io/other/#issue/v1/${encoded}`,
    `https://velornlabs.github.io/velorn-creator-provenance/?request=1#issue/v1/${encoded}`,
    `https://velornlabs.github.io/velorn-creator-provenance/#verify/v1/${encoded}`,
  ]) {
    assert.throws(
      () => validatePublicProvenanceReviewUrl(unsafe),
      (error) => error instanceof ProvenanceExportError && !error.message.includes(os.homedir()),
    )
  }
})
