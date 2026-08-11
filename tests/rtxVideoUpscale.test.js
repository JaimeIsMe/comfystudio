const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')

const {
  RUNTIME_PACKAGES,
  RUNTIME_WHEELS,
  buildRtxHelperArgs,
  getComfyPythonCandidates,
  getManagedRuntimePaths,
  getRuntimeCandidates,
  normalizeQuality,
} = require('../electron/rtxVideoUpscale')

test('pins and verifies every standalone RTX runtime wheel', () => {
  assert.deepEqual(RUNTIME_PACKAGES, [
    'numpy==2.2.6',
    'fastrlock==0.8.3',
    'cupy-cuda12x==13.6.0',
    'nvidia-vfx==0.1.0.1',
  ])
  assert.equal(RUNTIME_WHEELS.filter((wheel) => wheel.bootstrap).length, 1)
  assert.ok(RUNTIME_WHEELS.some((wheel) => wheel.package === 'nvidia-vfx'))
  for (const wheel of RUNTIME_WHEELS) {
    assert.match(wheel.url, /^https:\/\//)
    assert.match(wheel.sha256, /^[a-f0-9]{64}$/)
    assert.ok(wheel.size > 0)
  }
})

test('normalizes supported RTX quality values', () => {
  assert.equal(normalizeQuality('ultra'), 'ULTRA')
  assert.equal(normalizeQuality('unexpected'), 'HIGH')
})

test('keeps the standalone runtime ahead of compatible local fallbacks', () => {
  const candidates = getRuntimeCandidates({
    userDataPath: 'C:\\VelornData',
    comfyRootPath: 'D:\\ComfyUI_windows_portable\\ComfyUI',
  })
  assert.equal(candidates[0].kind, 'managed')
  assert.equal(candidates[0].pythonPath, path.join('C:\\VelornData', 'rtx-runtime-v1', 'python', 'python.exe'))
  assert.ok(candidates.some((entry) => (
    entry.pythonPath === path.join('D:\\ComfyUI_windows_portable', 'python_embeded', 'python.exe')
  )))
})

test('finds common portable ComfyUI Python layouts as compatibility fallbacks', () => {
  const candidates = getComfyPythonCandidates('D:\\Apps\\ComfyUI_windows_portable\\ComfyUI')
  assert.ok(candidates.includes(path.join('D:\\Apps\\ComfyUI_windows_portable', 'python_embeded', 'python.exe')))
  assert.ok(candidates.includes(path.join('D:\\Apps\\ComfyUI_windows_portable', 'python_embedded', 'python.exe')))
})

test('builds a bounded direct helper command', () => {
  const args = buildRtxHelperArgs({
    helperPath: 'C:\\Velorn\\rtx_vsr_stream.py',
    inputPath: 'C:\\Renders\\source.mp4',
    outputPath: 'C:\\Renders\\final.mp4',
    width: 2160,
    height: 3840,
    quality: 'medium',
    ffmpegPath: 'C:\\Velorn\\ffmpeg.exe',
    ffprobePath: 'C:\\Velorn\\ffprobe.exe',
  })
  assert.deepEqual(args.slice(0, 11), [
    'C:\\Velorn\\rtx_vsr_stream.py',
    '--input', 'C:\\Renders\\source.mp4',
    '--output', 'C:\\Renders\\final.mp4',
    '--width', '2160',
    '--height', '3840',
    '--quality', 'MEDIUM',
  ])
})

test('returns stable managed runtime paths', () => {
  const runtime = getManagedRuntimePaths('C:\\Users\\Editor\\AppData\\Roaming\\Velorn')
  assert.equal(runtime.pythonPath, path.join(runtime.root, 'python', 'python.exe'))
  assert.equal(runtime.manifestPath, path.join(runtime.root, 'runtime.json'))
})
