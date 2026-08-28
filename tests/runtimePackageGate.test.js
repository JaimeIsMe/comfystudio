const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { createPackage, listPackage } = require('@electron/asar')

const {
  RIFE_WRAPPER_SOURCE_COMMIT,
  RIFE_SOURCE_PATCH_SHA256,
  RIFE_TRUSTED_SOURCE_COMMITS,
  assertLinuxSymbolCeiling,
  readBinaryArchitectures,
  readBinaryFormat,
  sha256File,
  validateRifeRuntime,
} = require('../electron/rifeRuntime')
const {
  NATIVE_MEDIA_RELEASE_FILES,
  packagedBinaryPaths,
  stagedRifeRoot,
  verifyNativeMedia,
  verifyNoPackagedNativeMediaDuplicates,
  verifyPackagedResources,
  verifyRifeExecutable,
} = require('../scripts/runtime-package-gate.cjs')

function binaryFixture(format, arch) {
  if (format === 'elf') {
    const buffer = Buffer.alloc(128)
    buffer.set([0x7f, 0x45, 0x4c, 0x46, 2, 1])
    buffer.writeUInt16LE(arch === 'arm64' ? 183 : 62, 18)
    return buffer
  }
  if (format === 'pe') {
    const buffer = Buffer.alloc(256)
    buffer.set([0x4d, 0x5a])
    buffer.writeUInt32LE(0x80, 0x3c)
    buffer.set([0x50, 0x45, 0, 0], 0x80)
    buffer.writeUInt16LE(arch === 'arm64' ? 0xaa64 : 0x8664, 0x84)
    return buffer
  }
  if (format === 'macho') {
    const buffer = Buffer.alloc(128)
    buffer.writeUInt32LE(0xfeedfacf, 0)
    buffer.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4)
    return buffer
  }
  throw new Error(`Unsupported fixture format: ${format}`)
}

function writeFile(root, relativePath, contents, mode) {
  const absolutePath = path.join(root, ...relativePath.split('/'))
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, contents)
  if (mode) fs.chmodSync(absolutePath, mode)
  return absolutePath
}

function hashRecord(filePath) {
  return {
    sha256: sha256File(filePath),
    size: fs.statSync(filePath).size,
  }
}

function createTrustedFixture(options = {}) {
  const platform = options.platform || 'linux'
  const arch = options.arch || 'x64'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-rife-package-gate-'))
  const format = platform === 'win32' ? 'pe' : platform === 'darwin' ? 'macho' : 'elf'
  const executableName = platform === 'win32' ? 'rife-ncnn-vulkan.exe' : 'rife-ncnn-vulkan'
  writeFile(root, executableName, binaryFixture(format, arch), platform === 'win32' ? undefined : 0o755)
  const modelContents = {
    'rife-v4.6/flownet.bin': Buffer.from('test model weights'),
    'rife-v4.6/flownet.param': Buffer.from('test model graph'),
  }
  for (const [relativePath, contents] of Object.entries(modelContents)) writeFile(root, relativePath, contents)
  const licenseFiles = [
    'licenses/LICENSE.rife-ncnn-vulkan.txt',
    'licenses/LICENSE.ncnn.txt',
    'licenses/LICENSE.glslang.txt',
    'licenses/LICENSE.stb.txt',
    'licenses/LICENSE.Practical-RIFE-models.txt',
    ...(platform === 'darwin' ? ['licenses/LICENSE.MoltenVK.txt'] : []),
  ]
  for (const relativePath of licenseFiles) writeFile(root, relativePath, `License for ${path.basename(relativePath)}\n`)

  const payloadFiles = [executableName, ...Object.keys(modelContents), ...licenseFiles].sort()
  const files = Object.fromEntries(payloadFiles.map((relativePath) => [
    relativePath,
    hashRecord(path.join(root, ...relativePath.split('/'))),
  ]))
  const provenance = {
    schemaVersion: 1,
    platform,
    arch,
    target: `${platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux'}-${arch}`,
    wrapper: { commit: RIFE_WRAPPER_SOURCE_COMMIT },
    sources: Object.fromEntries(Object.entries(RIFE_TRUSTED_SOURCE_COMMITS).map(([name, commit]) => [name, { commit }])),
    model: 'rife-v4.6',
    modelLicenseEvidence: {
      commit: RIFE_TRUSTED_SOURCE_COMMITS.practicalRife,
      path: 'README.md',
      sha256: 'b695ac5d4a69c2f551512678883f8234d784c286d805ca546f4873cb465959b4',
    },
    pngOnly: true,
    webpDisabled: true,
    openMpDisabled: true,
    binaryState: 'unsigned-source-build',
    sourcePatch: {
      path: 'scripts/rife-runtime/patches/0001-png-only.patch',
      sha256: RIFE_SOURCE_PATCH_SHA256,
      removedUpstreamFiles: ['src/FindWebP.cmake', 'src/webp_image.h'],
      unfetchedSubmodules: ['src/libwebp'],
    },
    licenseFiles,
    files,
  }
  fs.writeFileSync(path.join(root, 'PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`)
  return {
    root,
    executableName,
    provenance,
    expectedModelFiles: Object.fromEntries(Object.keys(modelContents).map((relativePath) => [relativePath, files[relativePath]])),
  }
}

test('validates a complete target-native runtime, licenses, provenance, and hashes', (t) => {
  const fixture = createTrustedFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))

  const result = validateRifeRuntime({
    root: fixture.root,
    platform: 'linux',
    arch: 'x64',
    expectedModelFiles: fixture.expectedModelFiles,
  })
  assert.equal(result.provenance.schemaVersion, 1)
  assert.equal(result.files.length, 8)
})

test('rejects a runtime whose executable architecture does not match its target', (t) => {
  const fixture = createTrustedFixture({ arch: 'arm64' })
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))

  assert.throws(() => validateRifeRuntime({
    root: fixture.root,
    platform: 'linux',
    arch: 'x64',
    expectedModelFiles: fixture.expectedModelFiles,
  }), /provenance targets linux\/arm64, expected linux\/x64/i)
})

test('rejects post-provenance payload tampering', (t) => {
  const fixture = createTrustedFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  fs.appendFileSync(path.join(fixture.root, 'rife-v4.6', 'flownet.param'), 'tampered')

  assert.throws(() => validateRifeRuntime({
    root: fixture.root,
    platform: 'linux',
    arch: 'x64',
    expectedModelFiles: fixture.expectedModelFiles,
  }), /size does not match provenance/i)
})

test('rejects an undeclared, empty, or missing license', (t) => {
  const fixture = createTrustedFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  const provenancePath = path.join(fixture.root, 'PROVENANCE.json')
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'))
  provenance.licenseFiles.pop()
  fs.writeFileSync(provenancePath, JSON.stringify(provenance))

  assert.throws(() => validateRifeRuntime({
    root: fixture.root,
    platform: 'linux',
    arch: 'x64',
    expectedModelFiles: fixture.expectedModelFiles,
  }), /does not declare the required linux license set/i)
})

test('post-sign validation relaxes only the executable hash and verifies its signature before execution', (t) => {
  const fixture = createTrustedFixture({ platform: 'darwin', arch: 'arm64' })
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  fs.appendFileSync(path.join(fixture.root, fixture.executableName), 'platform-signature')

  assert.throws(() => validateRifeRuntime({
    root: fixture.root,
    platform: 'darwin',
    arch: 'arm64',
    expectedModelFiles: fixture.expectedModelFiles,
  }), /file size does not match provenance.*rife-ncnn-vulkan/i)

  const calls = []
  const result = verifyRifeExecutable({
    root: fixture.root,
    platform: 'darwin',
    arch: 'arm64',
    expectedModelFiles: fixture.expectedModelFiles,
    signedPackage: true,
    signatureVerifier: () => calls.push('signature'),
    runBinaryImpl: () => {
      calls.push('execute')
      return {
        output: 'Usage: rife-ncnn-vulkan\nVelorn secure build: PNG input and output only; WebP is disabled.',
      }
    },
  })
  assert.equal(result.modelName, 'rife-v4.6')
  assert.deepEqual(calls, ['signature', 'execute'])

  fs.appendFileSync(path.join(fixture.root, 'rife-v4.6', 'flownet.param'), 'tampered model')
  assert.throws(() => verifyRifeExecutable({
    root: fixture.root,
    platform: 'darwin',
    arch: 'arm64',
    expectedModelFiles: fixture.expectedModelFiles,
    signedPackage: true,
    signatureVerifier: () => calls.push('unexpected signature'),
    runBinaryImpl: () => ({ output: '' }),
  }), /file size does not match provenance.*flownet\.param/i)
  assert.equal(calls.includes('unexpected signature'), false)
})

test('RIFE help probe accepts only the secure build success status', (t) => {
  const fixture = createTrustedFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  let allowedStatuses

  verifyRifeExecutable({
    root: fixture.root,
    platform: 'linux',
    arch: 'x64',
    expectedModelFiles: fixture.expectedModelFiles,
    runBinaryImpl: (_binaryPath, _args, _label, options) => {
      allowedStatuses = options.allowedStatuses
      return {
        status: 0,
        output: 'Usage: rife-ncnn-vulkan\nVelorn secure build: PNG input and output only; WebP is disabled.',
      }
    },
  })

  assert.deepEqual(allowedStatuses, [0])
})

test('identifies ELF, PE, and Mach-O target architectures without host tools', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-binary-headers-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const fixtures = [
    ['linux-x64', 'elf', 'x64'],
    ['windows-arm64', 'pe', 'arm64'],
    ['mac-x64', 'macho', 'x64'],
  ]
  for (const [name, format, arch] of fixtures) {
    const filePath = writeFile(root, name, binaryFixture(format, arch))
    assert.equal(readBinaryFormat(filePath), format)
    assert.deepEqual([...readBinaryArchitectures(filePath)], [arch])
  }
})

test('rejects Linux helpers above the Ubuntu 20.04 GLIBC and libstdc++ symbol ceilings', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-linux-symbol-ceiling-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const compatible = writeFile(root, 'compatible', Buffer.concat([
    binaryFixture('elf', 'x64'),
    Buffer.from('GLIBC_2.31\0GLIBCXX_3.4.28\0'),
  ]))
  const incompatible = writeFile(root, 'incompatible', Buffer.concat([
    binaryFixture('elf', 'x64'),
    Buffer.from('GLIBC_2.38\0GLIBCXX_3.4.32\0'),
  ]))

  assert.deepEqual(assertLinuxSymbolCeiling(compatible), { GLIBC: '2.31', GLIBCXX: '3.4.28' })
  assert.throws(() => assertLinuxSymbolCeiling(incompatible), /GLIBC_2\.38.*above.*GLIBC_2\.31/i)
})

test('uses per-target staging and direct packaged media paths', () => {
  assert.match(stagedRifeRoot('/project', 'darwin', 'arm64'), /build[\\/]rife-runtime[\\/]mac-arm64[\\/]rife$/)
  assert.deepEqual(packagedBinaryPaths('/resources', 'linux'), {
    ffmpegPath: path.resolve('/resources/bin/ffmpeg'),
    ffmpegReadmePath: path.resolve('/resources/bin/ffmpeg.README'),
    ffmpegLicensePath: path.resolve('/resources/bin/ffmpeg.LICENSE'),
    ffprobePath: path.resolve('/resources/bin/ffprobe'),
    ffprobeReadmePath: path.resolve('/resources/bin/ffprobe.README'),
    ffprobeLicensePath: path.resolve('/resources/bin/ffprobe.LICENSE'),
  })
})

test('package config keeps resolver metadata but excludes duplicate native dependency payloads', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'))
  assert.equal(packageJson.build.asarUnpack, undefined)
  assert.equal(packageJson.build.files.includes('!node_modules/ffmpeg-static/ffmpeg*'), true)
  assert.equal(packageJson.build.files.includes('!node_modules/@derhuerst/ffprobe-static/ffprobe*'), true)

  const ffmpegResource = packageJson.build.extraResources.find((entry) => entry.from === 'node_modules/ffmpeg-static')
  const ffprobeResource = packageJson.build.extraResources.find((entry) => entry.from === 'node_modules/@derhuerst/ffprobe-static')
  assert.deepEqual(ffmpegResource.filter, [
    'ffmpeg.exe',
    'ffmpeg',
    'ffmpeg.README',
    'ffmpeg.LICENSE',
    'ffmpeg.exe.README',
    'ffmpeg.exe.LICENSE',
  ])
  assert.deepEqual(ffprobeResource.filter, [
    'ffprobe.exe',
    'ffprobe',
    'ffprobe.README',
    'ffprobe.LICENSE',
    'ffprobe.exe.README',
    'ffprobe.exe.LICENSE',
  ])
})

test('package gate rejects duplicate FFmpeg or FFprobe payloads in app.asar locations', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-native-dedupe-gate-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  const resources = path.join(root, 'resources')
  const asarPath = path.join(resources, 'app.asar')
  fs.mkdirSync(resources, { recursive: true })
  for (const packagePath of ['node_modules/ffmpeg-static', 'node_modules/@derhuerst/ffprobe-static']) {
    writeFile(source, `${packagePath}/index.js`, 'module.exports = null\n')
    writeFile(source, `${packagePath}/package.json`, '{}\n')
    writeFile(source, `${packagePath}/README.md`, 'package readme\n')
    writeFile(source, `${packagePath}/LICENSE`, 'package license\n')
  }

  await createPackage(source, asarPath)
  const retainedEntries = listPackage(asarPath).map((entry) => entry.replace(/^\/+/, ''))
  assert.equal(retainedEntries.includes('node_modules/ffmpeg-static/index.js'), true)
  assert.equal(retainedEntries.includes('node_modules/ffmpeg-static/package.json'), true)
  assert.equal(retainedEntries.includes('node_modules/ffmpeg-static/README.md'), true)
  assert.equal(retainedEntries.includes('node_modules/ffmpeg-static/LICENSE'), true)
  assert.doesNotThrow(() => verifyNoPackagedNativeMediaDuplicates({ resourcesPath: resources }))

  writeFile(source, 'node_modules/ffmpeg-static/ffmpeg', 'duplicate native binary')
  fs.rmSync(asarPath)
  await createPackage(source, asarPath)
  assert.throws(
    () => verifyPackagedResources({ resourcesPath: resources, platform: 'linux', arch: 'x64' }),
    /duplicate FFmpeg\/FFprobe.*app\.asar:node_modules\/ffmpeg-static\/ffmpeg/i
  )

  fs.rmSync(path.join(source, 'node_modules', 'ffmpeg-static', 'ffmpeg'))
  fs.rmSync(asarPath)
  await createPackage(source, asarPath)
  writeFile(
    `${asarPath}.unpacked`,
    'node_modules/@derhuerst/ffprobe-static/ffprobe.exe.README',
    'duplicate sidecar'
  )
  assert.throws(
    () => verifyPackagedResources({ resourcesPath: resources, platform: 'linux', arch: 'x64' }),
    /app\.asar\.unpacked:node_modules\/@derhuerst\/ffprobe-static\/ffprobe\.exe\.README/i
  )
})

test('pins native media bytes and verifies signatures before signed helper execution', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-native-media-gate-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const ffmpegPath = writeFile(root, 'ffmpeg', Buffer.concat([binaryFixture('macho', 'arm64'), Buffer.from('ffmpeg')]), 0o755)
  const ffprobePath = writeFile(root, 'ffprobe', Buffer.concat([binaryFixture('macho', 'arm64'), Buffer.from('ffprobe')]), 0o755)
  const readmeContents = Buffer.from('release notice')
  const licenseContents = Buffer.from('release license')
  for (const binaryPath of [ffmpegPath, ffprobePath]) {
    fs.writeFileSync(`${binaryPath}.README`, readmeContents)
    fs.writeFileSync(`${binaryPath}.LICENSE`, licenseContents)
  }
  const expectedFiles = {
    ffmpeg: hashRecord(ffmpegPath),
    ffprobe: hashRecord(ffprobePath),
    readme: hashRecord(`${ffmpegPath}.README`),
    license: hashRecord(`${ffmpegPath}.LICENSE`),
  }
  const runBinaryImpl = (_binaryPath, args, label) => ({
    status: 0,
    output: args.includes('-filters')
      ? ' ... minterpolate       V->V       Frame rate conversion\n'
      : label.startsWith('FFmpeg') ? 'ffmpeg version test\n' : 'ffprobe version test\n',
  })

  verifyNativeMedia({ platform: 'darwin', arch: 'arm64', ffmpegPath, ffprobePath, expectedFiles, runBinaryImpl })
  fs.appendFileSync(ffmpegPath, 'signed mutation')
  assert.throws(() => verifyNativeMedia({
    platform: 'darwin',
    arch: 'arm64',
    ffmpegPath,
    ffprobePath,
    expectedFiles,
    runBinaryImpl,
  }), /FFmpeg executable size does not match the pinned release asset/i)

  const calls = []
  verifyNativeMedia({
    platform: 'darwin',
    arch: 'arm64',
    ffmpegPath,
    ffprobePath,
    expectedFiles,
    signedPackage: true,
    hostExecutablePath: '/Velorn.app/Contents/MacOS/Velorn',
    signatureVerifier: ({ executablePath }) => calls.push(`signature:${path.basename(executablePath)}`),
    runBinaryImpl: (...args) => {
      calls.push(`execute:${path.basename(args[0])}`)
      return runBinaryImpl(...args)
    },
  })
  assert.deepEqual(calls.slice(0, 2), ['signature:ffmpeg', 'signature:ffprobe'])
  assert.equal(calls.slice(2).every((entry) => entry.startsWith('execute:')), true)
})

test('installed native FFmpeg and FFprobe match this host and minterpolate is available', () => {
  const result = verifyNativeMedia({ projectRoot: path.resolve(__dirname, '..') })
  assert.match(path.basename(result.ffmpegPath), /^ffmpeg(?:\.exe)?$/)
  assert.match(path.basename(result.ffprobePath), /^ffprobe(?:\.exe)?$/)
  assert.equal(NATIVE_MEDIA_RELEASE_FILES['linux-x64'].ffmpeg.sha256, 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99')
})
