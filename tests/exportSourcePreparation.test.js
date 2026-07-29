const assert = require('node:assert/strict')
const fs = require('fs').promises
const os = require('os')
const path = require('path')
const test = require('node:test')

const { inspectIsoBmffLayout } = require('../electron/exportSourcePreparation')

const makeBox = (type, payloadBytes = 0) => {
  const buffer = Buffer.alloc(8 + payloadBytes)
  buffer.writeUInt32BE(buffer.length, 0)
  buffer.write(type, 4, 4, 'ascii')
  return buffer
}

const withIsoFile = async (boxes, callback) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'velorn-export-source-'))
  const filePath = path.join(directory, 'source.mp4')
  try {
    await fs.writeFile(filePath, Buffer.concat(boxes))
    await callback(filePath)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

test('recognizes a fast-start source when moov precedes mdat', async () => {
  await withIsoFile([
    makeBox('ftyp', 8),
    makeBox('moov', 16),
    makeBox('mdat', 32),
  ], async (filePath) => {
    const layout = await inspectIsoBmffLayout(filePath)
    assert.equal(layout.recognized, true)
    assert.equal(layout.streamable, true)
    assert.ok(layout.moovOffset < layout.mdatOffset)
  })
})

test('marks a source for preparation when mdat precedes moov', async () => {
  await withIsoFile([
    makeBox('ftyp', 8),
    makeBox('mdat', 32),
    makeBox('moov', 16),
  ], async (filePath) => {
    const layout = await inspectIsoBmffLayout(filePath)
    assert.equal(layout.recognized, true)
    assert.equal(layout.streamable, false)
    assert.ok(layout.mdatOffset < layout.moovOffset)
  })
})

test('marks a front-indexed source for preparation when its headers exceed the renderer limit', async () => {
  await withIsoFile([
    makeBox('ftyp', 8),
    makeBox('moov', 16),
    makeBox('mdat', 32),
  ], async (filePath) => {
    const layout = await inspectIsoBmffLayout(filePath, { maxHeaderBytes: 24 })
    assert.equal(layout.recognized, true)
    assert.equal(layout.streamable, false)
  })
})

test('does not classify arbitrary data as an ISO media container', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'velorn-export-source-'))
  const filePath = path.join(directory, 'source.bin')
  try {
    await fs.writeFile(filePath, Buffer.from('not a media container'))
    const layout = await inspectIsoBmffLayout(filePath)
    assert.equal(layout.recognized, false)
    assert.equal(layout.streamable, false)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
