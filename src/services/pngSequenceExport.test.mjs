import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  cleanupCompletedPngSequenceTemp,
  getPngSequenceFrameFilename,
  getPngSequenceFramePattern,
  resolveAvailablePngSequenceFolder,
  sanitizePngSequenceBaseName,
  withOwnedPngSequenceOutput,
} from './pngSequenceExport.mjs'
import {
  classifyExportWorkerEvent,
  createExportWorkerJobId,
  isCleanExportCancellation,
  isMatchingExportWorkerEvent,
} from './exportWorkerLifecycle.mjs'

test('clean cancellation classification does not hide cleanup or path diagnostics', () => {
  assert.equal(isCleanExportCancellation(new Error('Export cancelled')), true)
  assert.equal(isCleanExportCancellation('Export cancelled.'), true)
  assert.equal(isCleanExportCancellation(new Error('RTX upscale cancelled')), true)
  assert.equal(
    isCleanExportCancellation(
      new Error('Export cancelled Incomplete PNG sequence files remain at /exports/cancelled edit because cleanup failed: File is locked')
    ),
    false
  )
  assert.equal(
    isCleanExportCancellation(new Error('PNG write failed at /exports/cancelled edit/frame.png')),
    false
  )
})

test('worker lifecycle accepts only events for the active UI export job', () => {
  const jobId = createExportWorkerJobId()
  assert.match(jobId, /^export-[a-zA-Z0-9._:-]+$/)
  assert.equal(isMatchingExportWorkerEvent(jobId, { jobId }), true)
  assert.equal(isMatchingExportWorkerEvent(jobId, { jobId: 'export-unrelated-mcp-job' }), false)
  assert.equal(isMatchingExportWorkerEvent(jobId, undefined), false)
  assert.equal(isMatchingExportWorkerEvent('', { jobId }), false)
  assert.equal(classifyExportWorkerEvent(jobId, { jobId }), 'active')
  assert.equal(classifyExportWorkerEvent(jobId, { jobId: 'export-unrelated-mcp-job' }), 'external')
  assert.equal(classifyExportWorkerEvent('', { jobId: 'export-mcp-job' }), 'external')
})

test('sanitizePngSequenceBaseName keeps a readable portable stem', () => {
  assert.equal(sanitizePngSequenceBaseName('My Finished Edit.png'), 'My Finished Edit')
  assert.equal(sanitizePngSequenceBaseName('scene: one / final?'), 'scene_ one _ final_')
  assert.equal(sanitizePngSequenceBaseName('100% Final'), '100_ Final')
})

test('sanitizePngSequenceBaseName handles empty and Windows-reserved names', () => {
  assert.equal(sanitizePngSequenceBaseName('  ...  '), 'export')
  assert.equal(sanitizePngSequenceBaseName('CON'), '_CON')
  assert.equal(sanitizePngSequenceBaseName('LPT9.png'), '_LPT9')
  assert.equal(sanitizePngSequenceBaseName('.hidden'), '_hidden')
  assert.equal(Array.from(sanitizePngSequenceBaseName('🎬'.repeat(80))).length, 60)
})

test('PNG sequence names are one-based and six-digit padded', () => {
  assert.equal(getPngSequenceFrameFilename('Launch Cut', 1), 'Launch Cut_000001.png')
  assert.equal(getPngSequenceFrameFilename('Launch Cut', 42), 'Launch Cut_000042.png')
  assert.equal(getPngSequenceFramePattern('Launch Cut'), 'Launch Cut_%06d.png')
})

test('available output folder advances without creating or overwriting', async () => {
  const checked = []
  const api = {
    pathJoin: async (parent, child) => `${parent}/${child}`,
    exists: async path => {
      checked.push(path)
      return path.endsWith('/Launch Cut_png') || path.endsWith('/Launch Cut_png_2')
    },
  }

  const result = await resolveAvailablePngSequenceFolder({
    api,
    parentFolder: '/selected',
    filename: 'Launch Cut',
  })

  assert.equal(result, '/selected/Launch Cut_png_3')
  assert.deepEqual(checked, [
    '/selected/Launch Cut_png',
    '/selected/Launch Cut_png_2',
    '/selected/Launch Cut_png_3',
  ])
})

test('owned output keeps a successful fresh directory', async () => {
  const calls = []
  const api = {
    exists: async path => (calls.push(['exists', path]), false),
    createDirectory: async (path, options) => (calls.push(['create', path, options]), { success: true }),
    deleteDirectory: async path => (calls.push(['delete', path]), { success: true }),
  }

  const result = await withOwnedPngSequenceOutput({
    api,
    outputPath: '/selected/My Edit_png',
    run: async path => ({ outputPath: path }),
  })

  assert.deepEqual(result, { outputPath: '/selected/My Edit_png' })
  assert.deepEqual(calls, [
    ['exists', '/selected/My Edit_png'],
    ['create', '/selected/My Edit_png', { recursive: false }],
  ])
})

test('owned output removes exactly its fresh child after render failure', async () => {
  const deleted = []
  const api = {
    exists: async () => false,
    createDirectory: async () => ({ success: true }),
    deleteDirectory: async (path, options) => {
      deleted.push([path, options])
      return { success: true }
    },
  }

  await assert.rejects(
    withOwnedPngSequenceOutput({
      api,
      outputPath: '/selected/My Edit_png',
      run: async () => { throw new Error('Export cancelled') },
    }),
    /Export cancelled/
  )
  assert.deepEqual(deleted, [['/selected/My Edit_png', { recursive: true }]])
})

test('owned output never creates or deletes a preexisting path', async () => {
  let created = false
  let deleted = false
  const api = {
    exists: async () => true,
    createDirectory: async () => (created = true, { success: true }),
    deleteDirectory: async () => (deleted = true, { success: true }),
  }

  await assert.rejects(
    withOwnedPngSequenceOutput({ api, outputPath: '/selected', run: async () => null }),
    /already exists/
  )
  assert.equal(created, false)
  assert.equal(deleted, false)
})

test('owned output rejects relative cleanup targets', async () => {
  let created = false
  let deleted = false
  const api = {
    exists: async () => false,
    createDirectory: async () => (created = true, { success: true }),
    deleteDirectory: async () => (deleted = true, { success: true }),
  }

  await assert.rejects(
    withOwnedPngSequenceOutput({ api, outputPath: 'relative/output', run: async () => null }),
    /absolute desktop path/
  )
  assert.equal(created, false)
  assert.equal(deleted, false)
})

test('owned output accepts absolute Windows drive and UNC paths', async () => {
  const created = []
  const api = {
    exists: async () => false,
    createDirectory: async path => (created.push(path), { success: true }),
    deleteDirectory: async () => ({ success: true }),
  }

  await withOwnedPngSequenceOutput({
    api,
    outputPath: 'D:\\Exports\\My Edit_png',
    run: async path => path,
  })
  await withOwnedPngSequenceOutput({
    api,
    outputPath: '\\\\server\\share\\My Edit_png',
    run: async path => path,
  })

  assert.deepEqual(created, [
    'D:\\Exports\\My Edit_png',
    '\\\\server\\share\\My Edit_png',
  ])
})

test('owned output does not claim or delete a directory when exclusive creation fails', async () => {
  let deleted = false
  const api = {
    exists: async () => false,
    createDirectory: async () => ({ success: false, error: 'EEXIST' }),
    deleteDirectory: async () => (deleted = true, { success: true }),
  }

  await assert.rejects(
    withOwnedPngSequenceOutput({ api, outputPath: '/selected/My Edit_png', run: async () => null }),
    /EEXIST/
  )
  assert.equal(deleted, false)
})

test('incomplete-output cleanup failure surfaces the retained folder path', async () => {
  const api = {
    exists: async () => false,
    createDirectory: async () => ({ success: true }),
    deleteDirectory: async () => ({ success: false, error: 'File is locked' }),
  }

  const originalWarn = console.warn
  console.warn = () => {}
  try {
    await assert.rejects(
      withOwnedPngSequenceOutput({
        api,
        outputPath: '/selected/My Edit_png',
        run: async () => { throw new Error('PNG write failed') },
      }),
      /PNG write failed.*\/selected\/My Edit_png.*File is locked/
    )
  } finally {
    console.warn = originalWarn
  }
})

test('completed-output temp cleanup returns a warning instead of throwing', async () => {
  const warning = await cleanupCompletedPngSequenceTemp({
    api: {
      deleteDirectory: async () => ({ success: false, error: 'Antivirus lock' }),
    },
    tempFolder: '/selected/My Edit_png/.velorn-export-temp',
  })

  assert.equal(warning, 'Antivirus lock')
})

test('owned output works against a real fresh filesystem directory', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'velorn-png-sequence-'))
  const outputPath = join(parent, 'Real Export_png')
  const api = {
    exists: async path => {
      try {
        await access(path)
        return true
      } catch {
        return false
      }
    },
    createDirectory: async (path, options = {}) => {
      try {
        await mkdir(path, { recursive: options.recursive !== false })
        return { success: true }
      } catch (err) {
        return { success: false, error: err.message }
      }
    },
    deleteDirectory: async path => {
      try {
        await rm(path, { recursive: true, force: true })
        return { success: true }
      } catch (err) {
        return { success: false, error: err.message }
      }
    },
  }

  try {
    const result = await withOwnedPngSequenceOutput({
      api,
      outputPath,
      run: async ownedPath => {
        const framePath = join(ownedPath, getPngSequenceFrameFilename('Real Export', 1))
        await writeFile(framePath, 'png-placeholder')
        return { outputPath: ownedPath, framePath }
      },
    })

    assert.equal(result.outputPath, outputPath)
    await access(result.framePath)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('exported filenames round-trip through Velorn image-sequence detection', async () => {
  // The production detector is an ESM .js file in a legacy CommonJS package.
  // Loading its source as a data module keeps this test compatible with the
  // Node 20 release builder without changing the Electron package type.
  const detectorSource = await readFile(
    new URL('../utils/imageSequenceDetection.js', import.meta.url),
    'utf8'
  )
  const detectorModuleUrl = `data:text/javascript;base64,${Buffer.from(detectorSource).toString('base64')}`
  const { detectImageSequences } = await import(detectorModuleUrl)
  const files = [1, 2, 3].map(frame => ({
    name: getPngSequenceFrameFilename('Round Trip', frame),
    path: `/frames/${getPngSequenceFrameFilename('Round Trip', frame)}`,
  }))

  const detected = detectImageSequences(files)
  assert.equal(detected.sequences.length, 1)
  assert.equal(detected.sequences[0].count, 3)
  assert.equal(detected.sequences[0].pattern, 'Round Trip_%06d.png')
  assert.deepEqual(detected.leftovers, [])
})
