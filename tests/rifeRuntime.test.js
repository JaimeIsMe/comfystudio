const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { resolveRifeRuntime } = require('../electron/rifeRuntime')

function createRuntime(root, platform = 'linux') {
  fs.mkdirSync(path.join(root, 'rife-v4.6'), { recursive: true })
  fs.writeFileSync(path.join(root, platform === 'win32' ? 'rife-ncnn-vulkan.exe' : 'rife-ncnn-vulkan'), 'binary')
  fs.writeFileSync(path.join(root, 'rife-v4.6', 'flownet.param'), 'model')
  fs.writeFileSync(path.join(root, 'rife-v4.6', 'flownet.bin'), 'weights')
}

test('resolves a complete development runtime', (t) => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-rife-runtime-'))
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }))
  const runtimeRoot = path.join(appRoot, '.runtime', 'rife')
  createRuntime(runtimeRoot)

  const result = resolveRifeRuntime({ appRoot, platform: 'linux' })
  assert.equal(result.available, true)
  assert.equal(result.executablePath, path.join(runtimeRoot, 'rife-ncnn-vulkan'))
  assert.equal(result.modelPath, path.join(runtimeRoot, 'rife-v4.6'))
})

test('uses the packaged Windows executable name, ignores overrides, and rejects an unproven runtime', (t) => {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-rife-resources-'))
  t.after(() => fs.rmSync(resourcesPath, { recursive: true, force: true }))
  const runtimeRoot = path.join(resourcesPath, 'bin', 'rife')
  createRuntime(runtimeRoot, 'win32')

  const result = resolveRifeRuntime({
    packaged: true,
    resourcesPath,
    platform: 'win32',
    environmentRoot: path.join(resourcesPath, 'untrusted-override'),
  })
  assert.equal(result.available, false)
  assert.equal(path.basename(result.executablePath), 'rife-ncnn-vulkan.exe')
  assert.equal(result.root, runtimeRoot)
  assert.match(result.error, /integrity check/i)
  assert.match(result.validationErrors[0], /provenance/i)
})

test('reports a missing model or executable without guessing another path', (t) => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-rife-missing-'))
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }))

  const result = resolveRifeRuntime({ appRoot, platform: 'linux' })
  assert.equal(result.available, false)
  assert.equal(result.missingPaths.length, 3)
  assert.match(result.error, /smooth-motion engine is missing/i)
})
