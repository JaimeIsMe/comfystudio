const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const repoRoot = path.resolve(__dirname, '..')
const scriptPath = path.join(repoRoot, 'scripts', 'rife-runtime', 'build.py')
const pinsPath = path.join(repoRoot, 'scripts', 'rife-runtime', 'pins.json')
const patchPath = path.join(repoRoot, 'scripts', 'rife-runtime', 'patches', '0001-png-only.patch')
const pins = JSON.parse(fs.readFileSync(pinsPath, 'utf8'))

function runBuilder(args) {
  return spawnSync('python3', [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function manifestFiles(stage) {
  const files = {}
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.name !== 'PROVENANCE.json') {
        const relative = path.relative(stage, absolute).split(path.sep).join('/')
        files[relative] = {
          sha256: hashFile(absolute),
          size: fs.statSync(absolute).size,
        }
      }
    }
  }
  visit(stage)
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
}

function requiredLicenseFiles(platform) {
  const names = [
    'LICENSE.rife-ncnn-vulkan.txt',
    'LICENSE.ncnn.txt',
    'LICENSE.glslang.txt',
    'LICENSE.stb.txt',
    'LICENSE.Practical-RIFE-models.txt',
  ]
  if (platform === 'darwin') names.push('LICENSE.MoltenVK.txt')
  return names.map((name) => `licenses/${name}`).sort()
}

function trustedProvenanceMetadata(platform = 'linux', arch = 'x64', target = 'linux-x64') {
  const sourceKeys = ['wrapper', 'ncnn', 'glslang', 'stb', 'practicalRife']
  if (platform === 'darwin') sourceKeys.push('moltenVk')
  const sources = Object.fromEntries(sourceKeys.map((key) => [key, {
    repository: pins.sources[key].repository,
    commit: pins.sources[key].commit,
  }]))
  const practicalRife = pins.sources.practicalRife
  const provenance = {
    schemaVersion: 1,
    platform,
    arch,
    target,
    wrapper: {
      repository: pins.sources.wrapper.repository,
      commit: pins.sources.wrapper.commit,
    },
    sources,
    model: pins.model.name,
    modelLicenseEvidence: {
      repository: practicalRife.repository,
      commit: practicalRife.commit,
      ...practicalRife.modelLicenseEvidence,
    },
    pngOnly: true,
    webpDisabled: true,
    openMpDisabled: true,
    binaryState: 'unsigned-source-build',
    licenseFiles: requiredLicenseFiles(platform),
    sourceDateEpoch: pins.runtime.sourceDateEpoch,
    sourcePatch: {
      path: 'scripts/rife-runtime/patches/0001-png-only.patch',
      sha256: hashFile(patchPath),
      removedUpstreamFiles: ['src/FindWebP.cmake', 'src/webp_image.h'],
      unfetchedSubmodules: ['src/libwebp'],
    },
    files: {},
  }
  if (platform === 'linux') {
    provenance.linuxAbiBaseline = {
      distribution: 'Ubuntu 20.04',
      glibcMax: '2.31',
      glibcxxMax: '3.4.28',
    }
  }
  if (platform === 'win32') provenance.windowsCrt = 'static'
  return provenance
}

test('secure RIFE inputs remain pinned to the audited revisions and hashes', () => {
  assert.equal(pins.schemaVersion, 1)
  assert.equal(pins.sources.wrapper.commit, 'a7532fc3f9f8f008cd6eecd6f2ffe2a9698e0cf7')
  assert.equal(pins.sources.ncnn.commit, 'b4ba207c18d3103d6df890c0e3a97b469b196b26')
  assert.equal(pins.sources.glslang.commit, '86ff4bca1ddc7e2262f119c16e7228d0efb67610')
  assert.equal(pins.sources.stb.commit, '2c980bb59875b0d32144a71867fbdebb2f77cd20')
  assert.equal(pins.sources.practicalRife.commit, 'bbfd2ea90910789a860ea3e2b32a240cd577b75e')
  assert.equal(pins.model.name, 'rife-v4.6')
  assert.equal(pins.model.files['flownet.bin'].sha256, 'f334ed2260149ce0188a6dcf049844e8b0cdd912e01cbcfb63553157d2508958')
  assert.equal(pins.model.files['flownet.param'].sha256, '724569596bcd1e7b9fa50455c604777ebed99746d2ef40aa86e31b5725f1053c')
  assert.equal(pins.runtime.pngOnly, true)
  assert.equal(pins.runtime.webpDisabled, true)
})

test('build plan uses the Electron target directory contract', () => {
  const targets = [
    ['linux', 'x64', 'linux-x64', 'rife-ncnn-vulkan'],
    ['win32', 'x64', 'win-x64', 'rife-ncnn-vulkan.exe'],
    ['darwin', 'x64', 'mac-x64', 'rife-ncnn-vulkan'],
    ['darwin', 'arm64', 'mac-arm64', 'rife-ncnn-vulkan'],
  ]

  for (const [platform, arch, target, executable] of targets) {
    const result = runBuilder(['plan', '--platform', platform, '--arch', arch])
    assert.equal(result.status, 0, result.stderr)
    const plan = JSON.parse(result.stdout)
    assert.equal(plan.target, target)
    assert.equal(plan.executable, executable)
    assert.equal(plan.pngOnly, true)
    assert.equal(plan.webpDisabled, true)
    assert.equal(plan.stage.endsWith(`/build/rife-runtime/${target}/rife`), true)
    if (platform === 'linux') {
      assert.deepEqual(plan.linuxAbiBaseline, {
        distribution: 'Ubuntu 20.04',
        glibcMax: '2.31',
        glibcxxMax: '3.4.28',
      })
    }
  }
})

test('source patch removes WebP linkage and exposes PNG-only stb paths', () => {
  const patch = fs.readFileSync(patchPath, 'utf8')
  assert.match(patch, /^-option\(USE_SYSTEM_WEBP/m)
  assert.match(patch, /^-\s+add_subdirectory\(libwebp\)/m)
  assert.match(patch, /^-set\(RIFE_LINK_LIBRARIES ncnn webp /m)
  assert.match(patch, /^\+set\(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded"\)/m)
  assert.match(patch, /^\+#include <objbase\.h>/m)
  assert.match(patch, /^\+#define STBI_ONLY_PNG/m)
  assert.match(patch, /^\+\s+int success = stbi_write_png_to_func\(/m)
  assert.match(patch, /^\+\s+if \(format != PATHSTR\("png"\)\)/m)
  assert.match(patch, /Velorn secure build: PNG input and output only; WebP is disabled\./)
  assert.match(patch, /case L'h':\n\+\s+print_usage\(\);\n\+\s+return 0;/)
  assert.match(patch, /case 'h':\n\+\s+print_usage\(\);\n\+\s+return 0;/)
})

test('Windows contract statically links the CRT and rejects helper DLL dependencies', () => {
  const result = runBuilder(['plan', '--platform', 'win32', '--arch', 'x64'])
  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.windowsCrt, 'static')
  for (const dependency of [
    'vcruntime', 'msvcp', 'ucrtbase', 'api-ms-win-crt', 'msvcrt.dll',
    'libgcc_s', 'libstdc++', 'libwinpthread',
  ]) {
    assert.equal(plan.forbiddenRuntimeDependencies.includes(dependency), true)
  }

  const source = fs.readFileSync(scriptPath, 'utf8')
  assert.match(source, /-DCMAKE_POLICY_DEFAULT_CMP0091=NEW/)
  assert.match(source, /-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded/)
  assert.match(source, /Windows runtime unexpectedly depends on redistributable CRT helpers/)
})

test('builder forces LF source checkouts instead of inheriting Windows autocrlf', () => {
  const source = fs.readFileSync(scriptPath, 'utf8')
  assert.match(source, /"config", "core\.autocrlf", "false"/)
  assert.match(source, /"config", "core\.eol", "lf"/)
  assert.doesNotMatch(source, /\b(?:str|Path) \| (?:str|Path|None)\b/)
})

test('builder canonicalizes a Windows CRLF checkout of the trusted patch', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-rife-crlf-patch-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const crlfPatch = path.join(temporary, 'source.patch')
  const canonical = fs.readFileSync(patchPath, 'utf8').replace(/\r?\n/g, '\r\n')
  fs.writeFileSync(crlfPatch, canonical, 'utf8')

  const probe = [
    'import importlib.util, pathlib, sys',
    'spec = importlib.util.spec_from_file_location("velorn_rife_builder", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(module.sha256_source_patch(pathlib.Path(sys.argv[2])))',
  ].join('; ')
  const result = spawnSync('python3', ['-c', probe, scriptPath, crlfPatch], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), hashFile(patchPath))
})

test('builder enables the pinned ncnn source on modern CMake releases', () => {
  const source = fs.readFileSync(scriptPath, 'utf8')
  assert.match(source, /-DCMAKE_POLICY_VERSION_MINIMUM=3\.5/)
})

test('macOS dependency audit ignores the inspected-file otool header', () => {
  const probe = [
    'import importlib.util, sys',
    'spec = importlib.util.spec_from_file_location("velorn_rife_builder", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(module.parse_macos_dependency_output(sys.argv[2]))',
  ].join('; ')
  const otoolOutput = [
    '/private/tmp/velorn-rife/cmake-build/rife-ncnn-vulkan:',
    '\t/usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 1800.65.0)',
  ].join('\n')
  const result = spawnSync('python3', ['-c', probe, scriptPath, otoolOutput], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), otoolOutput.split('\n')[1].trim())
})

test('Windows dependency audit ignores inspector headers and build paths', () => {
  const probe = [
    'import importlib.util, sys',
    'spec = importlib.util.spec_from_file_location("velorn_rife_builder", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(module.parse_windows_dependency_output(sys.argv[2]))',
  ].join('; ')
  const inspectorOutput = [
    'File: D:\\a\\_temp\\vrife\\cmake-build\\Release\\rife-ncnn-vulkan.exe',
    'NeededLibraries [',
    '  KERNEL32.dll',
    '  vulkan-1.dll',
    ']',
  ].join('\n')
  const result = spawnSync('python3', ['-c', probe, scriptPath, inspectorOutput], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), ['KERNEL32.dll', 'vulkan-1.dll'].join('\n'))
  assert.doesNotMatch(result.stdout, /vrife|cmake-build/i)
})

test('macOS plan resolves the pinned static MoltenVK archive layout', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-moltenvk-layout-test-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const sdk = path.join(temporary, 'MoltenVK', 'MoltenVK')
  const include = path.join(sdk, 'include', 'vulkan')
  const library = path.join(sdk, 'static', 'MoltenVK.xcframework', 'macos-arm64_x86_64')
  fs.mkdirSync(include, { recursive: true })
  fs.mkdirSync(library, { recursive: true })
  fs.writeFileSync(path.join(include, 'vulkan.h'), 'fixture')
  fs.writeFileSync(path.join(library, 'libMoltenVK.a'), 'fixture')

  const result = runBuilder([
    'plan', '--platform', 'darwin', '--arch', 'arm64', '--vulkan-sdk', temporary,
  ])
  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.staticMoltenVk, true)
  assert.equal(plan.requiredMoltenVkArchiveSha256, '2c498bf8c98b88ba1e84c1f153403d4c1a8490c122d9e2a3df238b25d4e10557')
  assert.equal(plan.vulkanInclude, path.join(sdk, 'include'))
  assert.equal(plan.vulkanLibrary, path.join(library, 'libMoltenVK.a'))
})

test('stage verifier rejects self-consistent provenance for untrusted model bytes', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-rife-stage-test-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const stage = path.join(temporary, 'linux-x64', 'rife')
  fs.mkdirSync(path.join(stage, 'rife-v4.6'), { recursive: true })
  fs.mkdirSync(path.join(stage, 'licenses'), { recursive: true })
  if (process.platform === 'linux' && fs.existsSync('/bin/true')) {
    fs.copyFileSync('/bin/true', path.join(stage, 'rife-ncnn-vulkan'))
    fs.appendFileSync(path.join(stage, 'rife-ncnn-vulkan'), '\nVelorn secure build: PNG input and output only; WebP is disabled.\n')
  } else {
    fs.writeFileSync(path.join(stage, 'rife-ncnn-vulkan'), Buffer.from('Velorn secure build: PNG input and output only; WebP is disabled.\n'))
  }
  fs.chmodSync(path.join(stage, 'rife-ncnn-vulkan'), 0o755)
  fs.writeFileSync(path.join(stage, 'rife-v4.6', 'flownet.bin'), Buffer.from('model-bin'))
  fs.writeFileSync(path.join(stage, 'rife-v4.6', 'flownet.param'), Buffer.from('model-param'))

  const licenseFiles = requiredLicenseFiles('linux')
  for (const relative of licenseFiles) {
    fs.writeFileSync(path.join(stage, relative), Buffer.from(`license for ${relative}\n`))
  }

  const provenance = {
    ...trustedProvenanceMetadata(),
    files: manifestFiles(stage),
  }
  fs.writeFileSync(path.join(stage, 'PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`)

  const invalid = runBuilder(['verify', stage])
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /Unexpected size for staged model\/flownet\.bin/)
})

test('stage verifier rejects tampered trusted provenance metadata', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-rife-provenance-test-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const stage = path.join(temporary, 'rife')
  fs.mkdirSync(stage)

  const cases = [
    {
      name: 'wrapper repository',
      mutate: (value) => { value.wrapper.repository = 'https://example.invalid/wrapper.git' },
      pattern: /wrapper repository or commit is not trusted/,
    },
    {
      name: 'ncnn commit',
      mutate: (value) => { value.sources.ncnn.commit = '0'.repeat(40) },
      pattern: /source repositories or commits are not trusted/,
    },
    {
      name: 'model license evidence',
      mutate: (value) => { value.modelLicenseEvidence.sha256 = '0'.repeat(64) },
      pattern: /model-license evidence is not trusted/,
    },
    {
      name: 'source patch hash',
      mutate: (value) => { value.sourcePatch.sha256 = '0'.repeat(64) },
      pattern: /source-patch metadata does not match the trusted patch/,
    },
    {
      name: 'target mapping',
      mutate: (value) => { value.target = 'win-x64' },
      pattern: /target does not match platform\/arch/,
    },
    {
      name: 'Linux ABI baseline',
      mutate: (value) => { value.linuxAbiBaseline.glibcMax = '9.99' },
      pattern: /Ubuntu 20\.04 GLIBC\/GLIBCXX compatibility baseline/,
    },
    {
      name: 'cross-platform runtime field',
      mutate: (value) => { value.windowsCrt = 'static' },
      pattern: /Windows CRT contract for a non-Windows target/,
    },
    {
      name: 'source epoch',
      mutate: (value) => { value.sourceDateEpoch += 1 },
      pattern: /sourceDateEpoch does not match the pinned build/,
    },
  ]

  for (const item of cases) {
    const provenance = JSON.parse(JSON.stringify(trustedProvenanceMetadata()))
    item.mutate(provenance)
    fs.writeFileSync(path.join(stage, 'PROVENANCE.json'), `${JSON.stringify(provenance)}\n`)
    const result = runBuilder(['verify', stage])
    assert.equal(result.status, 1, item.name)
    assert.match(result.stderr, item.pattern, item.name)
  }

  const windows = trustedProvenanceMetadata('win32', 'x64', 'win-x64')
  delete windows.windowsCrt
  fs.writeFileSync(path.join(stage, 'PROVENANCE.json'), `${JSON.stringify(windows)}\n`)
  const windowsResult = runBuilder(['verify', stage])
  assert.equal(windowsResult.status, 1)
  assert.match(windowsResult.stderr, /windowsCrt=static/)
})

test('stage verifier rejects a symlinked runtime root', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-rife-symlink-test-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const realStage = path.join(temporary, 'real-stage')
  const linkedStage = path.join(temporary, 'linked-stage')
  fs.mkdirSync(realStage)
  try {
    fs.symlinkSync(realStage, linkedStage, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    t.skip(`symlinks are unavailable in this environment: ${error.message}`)
    return
  }

  const result = runBuilder(['verify', linkedStage])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /regular directory, not a symlink/)
})

test('cross-build mode fails closed without an explicit toolchain', () => {
  let target
  if (process.platform === 'linux') target = ['darwin', 'arm64']
  else target = ['linux', 'x64']
  const result = runBuilder([
    'build', '--platform', target[0], '--arch', target[1], '--allow-cross',
  ])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Cross-builds require an explicit --toolchain-file/)
})
