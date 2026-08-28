#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { listPackage, uncache } = require('@electron/asar')

const {
  assertBinaryTarget,
  normalizeArch,
  normalizePlatform,
  sha256File,
  validateRifeRuntime,
  verifyPlatformSignature,
} = require('../electron/rifeRuntime')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const NATIVE_MEDIA_RELEASE_FILES = Object.freeze({
  'linux-x64': Object.freeze({
    ffmpeg: Object.freeze({ size: 79826272, sha256: 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99' }),
    ffprobe: Object.freeze({ size: 79665792, sha256: '4f231a1960d83e403d08f7971e271707bec278a9ae18e21b8b5b03186668450d' }),
    readme: Object.freeze({ size: 2235, sha256: '72f4b1b06d419d22ace6e7cc75f06826f90737345aa0b1736158929f4aacc537' }),
    license: Object.freeze({ size: 35147, sha256: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903' }),
  }),
  'win32-x64': Object.freeze({
    ffmpeg: Object.freeze({ size: 82797568, sha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00' }),
    ffprobe: Object.freeze({ size: 82668032, sha256: '3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4' }),
    readme: Object.freeze({ size: 39494, sha256: 'a636a7183c58006351acbaf35303c0ed85c6e1320fd4e80de453ba6157de6311' }),
    license: Object.freeze({ size: 35147, sha256: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903' }),
  }),
  'darwin-x64': Object.freeze({
    ffmpeg: Object.freeze({ size: 78862176, sha256: 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894' }),
    ffprobe: Object.freeze({ size: 78780408, sha256: 'fa3add0ce901f7241abe0dfc0155d958fc834aca3f8ce61f87cc712ae669c1e0' }),
    readme: Object.freeze({ size: 6227, sha256: 'e88a0325f8e5b75210355e37341824f074d3cd82def2125be54c914b62848a36' }),
    license: Object.freeze({ size: 4346, sha256: '2e1d16c72fd74e12063776371da757322f8b77589386532f4fd8634bde7de1af' }),
  }),
  'darwin-arm64': Object.freeze({
    ffmpeg: Object.freeze({ size: 45568216, sha256: 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584' }),
    ffprobe: Object.freeze({ size: 45528808, sha256: 'bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64' }),
    readme: Object.freeze({ size: 1810, sha256: '05ba4b92c96605434b1aaae3eedf5a2c280c9607bf78ffca9a5b536d9af2dc6a' }),
    license: Object.freeze({ size: 4376, sha256: 'cb48bf09a11f5fb576cddb0431c8f5ed0a60157a9ec942adffc13907cbe083f2' }),
  }),
})
const NATIVE_MEDIA_DEPENDENCY_PAYLOADS = Object.freeze([
  Object.freeze({ packagePath: 'node_modules/ffmpeg-static', prefix: 'ffmpeg' }),
  Object.freeze({ packagePath: 'node_modules/@derhuerst/ffprobe-static', prefix: 'ffprobe' }),
])

function stagePlatformName(platform) {
  return ({ win32: 'win', linux: 'linux', darwin: 'mac' })[normalizePlatform(platform)]
}

function stagedRifeRoot(projectRoot, platform, arch) {
  const stagePlatform = stagePlatformName(platform)
  if (!stagePlatform) throw new Error(`Unsupported staging platform: ${platform}`)
  return path.join(path.resolve(projectRoot), 'build', 'rife-runtime', `${stagePlatform}-${normalizeArch(arch)}`, 'rife')
}

function resolveDependencyBinary(projectRoot, packageName) {
  const requireFromProject = require('module').createRequire(path.join(path.resolve(projectRoot), 'package.json'))
  let resolved
  try {
    resolved = requireFromProject(packageName)
  } catch (error) {
    throw new Error(`Cannot resolve ${packageName}: ${error.message}`)
  }
  const binaryPath = typeof resolved === 'string' ? resolved : resolved?.path
  if (!binaryPath || !fs.existsSync(binaryPath)) throw new Error(`${packageName} did not resolve an installed binary`)
  return path.resolve(binaryPath)
}

function runBinary(binaryPath, args, label, options = {}) {
  const result = spawnSync(binaryPath, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env || process.env,
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeout || 30000,
    windowsHide: true,
  })
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`)
  const allowedStatuses = options.allowedStatuses || [0]
  if (!allowedStatuses.includes(result.status)) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(0, 800)
    throw new Error(`${label} exited with status ${result.status}${detail ? `: ${detail}` : ''}`)
  }
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
  }
}

function verifyPinnedFile(filePath, expected, label) {
  let stat
  try {
    stat = fs.lstatSync(filePath)
  } catch {
    throw new Error(`${label} is missing: ${filePath}`)
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file: ${filePath}`)
  if (stat.size !== expected.size) {
    throw new Error(`${label} size does not match the pinned release asset: expected ${expected.size}, got ${stat.size}`)
  }
  const actualHash = sha256File(filePath)
  if (actualHash !== expected.sha256) {
    throw new Error(`${label} hash does not match the pinned release asset`)
  }
}

function verifyNativeMedia(options = {}) {
  const platform = normalizePlatform(options.platform || process.platform)
  const arch = normalizeArch(options.arch || process.arch)
  const target = `${platform}-${arch}`
  const expected = options.expectedFiles || NATIVE_MEDIA_RELEASE_FILES[target]
  if (!expected) throw new Error(`No trusted native media release pins exist for ${target}`)
  const ffmpegPath = path.resolve(options.ffmpegPath || resolveDependencyBinary(options.projectRoot || PROJECT_ROOT, 'ffmpeg-static'))
  const ffprobePath = path.resolve(
    options.ffprobePath || resolveDependencyBinary(options.projectRoot || PROJECT_ROOT, '@derhuerst/ffprobe-static')
  )
  const notices = {
    ffmpegReadmePath: path.resolve(options.ffmpegReadmePath || `${ffmpegPath}.README`),
    ffmpegLicensePath: path.resolve(options.ffmpegLicensePath || `${ffmpegPath}.LICENSE`),
    ffprobeReadmePath: path.resolve(options.ffprobeReadmePath || `${ffprobePath}.README`),
    ffprobeLicensePath: path.resolve(options.ffprobeLicensePath || `${ffprobePath}.LICENSE`),
  }

  verifyPinnedFile(notices.ffmpegReadmePath, expected.readme, 'FFmpeg release notice')
  verifyPinnedFile(notices.ffmpegLicensePath, expected.license, 'FFmpeg release license')
  verifyPinnedFile(notices.ffprobeReadmePath, expected.readme, 'FFprobe release notice')
  verifyPinnedFile(notices.ffprobeLicensePath, expected.license, 'FFprobe release license')

  assertBinaryTarget(ffmpegPath, platform, arch)
  assertBinaryTarget(ffprobePath, platform, arch)
  const signedPackage = options.signedPackage === true
  if (signedPackage) {
    if (platform !== 'win32' && platform !== 'darwin') {
      throw new Error(`Signed native media mutation is unsupported on ${platform}`)
    }
    const signatureVerifier = options.signatureVerifier || verifyPlatformSignature
    for (const executablePath of [ffmpegPath, ffprobePath]) {
      signatureVerifier({
        executablePath,
        hostExecutablePath: options.hostExecutablePath,
        platform,
      })
    }
  } else {
    verifyPinnedFile(ffmpegPath, expected.ffmpeg, 'FFmpeg executable')
    verifyPinnedFile(ffprobePath, expected.ffprobe, 'FFprobe executable')
  }

  const runBinaryImpl = options.runBinaryImpl || runBinary
  const ffmpegVersion = runBinaryImpl(ffmpegPath, ['-hide_banner', '-version'], 'FFmpeg version probe')
  if (!/\bffmpeg version\b/i.test(ffmpegVersion.output)) throw new Error('FFmpeg version probe returned unexpected output')
  const ffprobeVersion = runBinaryImpl(ffprobePath, ['-hide_banner', '-version'], 'FFprobe version probe')
  if (!/\bffprobe version\b/i.test(ffprobeVersion.output)) throw new Error('FFprobe version probe returned unexpected output')
  const filters = runBinaryImpl(ffmpegPath, ['-hide_banner', '-filters'], 'FFmpeg filter probe')
  if (!/^\s*[.A-Z|]{3}\s+minterpolate\s/im.test(filters.output)) {
    throw new Error('Bundled FFmpeg does not provide the required minterpolate filter')
  }

  return { ffmpegPath, ffprobePath, ...notices }
}

function verifyRifeExecutable(options = {}) {
  const signedPackage = options.signedPackage === true
  const validation = validateRifeRuntime({
    ...options,
    allowSignedExecutableMutation: signedPackage,
  })
  if (signedPackage) {
    const signatureVerifier = options.signatureVerifier || verifyPlatformSignature
    signatureVerifier({
      executablePath: validation.executablePath,
      hostExecutablePath: options.hostExecutablePath,
      platform: options.platform,
    })
  }
  const runBinaryImpl = options.runBinaryImpl || runBinary
  const help = runBinaryImpl(validation.executablePath, ['-h'], 'RIFE executable probe', {
    cwd: validation.root,
    allowedStatuses: [0],
  })
  if (!/Usage:\s*rife-ncnn-vulkan/i.test(help.output)) throw new Error('RIFE executable did not print its expected help')
  if (!/Velorn secure build:\s*PNG input and output only; WebP is disabled\./i.test(help.output)) {
    throw new Error('RIFE executable is not the Velorn PNG-only/WebP-disabled build')
  }
  return validation
}

function writeSmokeFrame(ffmpegPath, outputPath, color) {
  runBinary(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', `color=c=${color}:s=32x32:d=0.04`,
    '-frames:v', '1',
    '-y',
    outputPath,
  ], `FFmpeg ${color} smoke-frame generation`)
}

function smokeRifeInterpolation(options = {}) {
  const validation = verifyRifeExecutable(options)
  const ffmpegPath = path.resolve(options.ffmpegPath || resolveDependencyBinary(options.projectRoot || PROJECT_ROOT, 'ffmpeg-static'))
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-rife-package-smoke-'))
  const inputPath = path.join(scratchRoot, 'input')
  const outputPath = path.join(scratchRoot, 'output')
  fs.mkdirSync(inputPath)
  fs.mkdirSync(outputPath)
  try {
    writeSmokeFrame(ffmpegPath, path.join(inputPath, '00000000.png'), 'red')
    writeSmokeFrame(ffmpegPath, path.join(inputPath, '00000001.png'), 'blue')
    runBinary(validation.executablePath, [
      '-i', inputPath,
      '-o', outputPath,
      '-n', '3',
      '-m', validation.modelPath,
      '-g', '0',
      '-j', '1:1:1',
      '-f', '%08d.png',
    ], 'RIFE interpolation smoke', {
      cwd: validation.root,
      timeout: options.timeout || 120000,
    })
    const frames = fs.readdirSync(outputPath).filter((name) => /^\d{8}\.png$/i.test(name)).sort()
    if (frames.length !== 3) throw new Error(`RIFE interpolation smoke produced ${frames.length} frames, expected 3`)
    for (const frame of frames) {
      const signature = fs.readFileSync(path.join(outputPath, frame)).subarray(0, 8)
      if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error(`RIFE interpolation smoke produced an invalid PNG: ${frame}`)
      }
    }
    return { frames: frames.length }
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  }
}

function packagedResourcesPath(context) {
  if (normalizePlatform(context.electronPlatformName) === 'darwin') {
    const productFilename = context.packager?.appInfo?.productFilename || 'Velorn'
    return path.join(context.appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
  }
  return path.join(context.appOutDir, 'resources')
}

function packagedBinaryPaths(resourcesPath, platform) {
  const windows = normalizePlatform(platform) === 'win32'
  const ffmpegName = windows ? 'ffmpeg.exe' : 'ffmpeg'
  const ffprobeName = windows ? 'ffprobe.exe' : 'ffprobe'
  return {
    ffmpegPath: path.join(resourcesPath, 'bin', ffmpegName),
    ffmpegReadmePath: path.join(resourcesPath, 'bin', `${ffmpegName}.README`),
    ffmpegLicensePath: path.join(resourcesPath, 'bin', `${ffmpegName}.LICENSE`),
    ffprobePath: path.join(resourcesPath, 'bin', ffprobeName),
    ffprobeReadmePath: path.join(resourcesPath, 'bin', `${ffprobeName}.README`),
    ffprobeLicensePath: path.join(resourcesPath, 'bin', `${ffprobeName}.LICENSE`),
  }
}

function normalizeArchivePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

function nativeMediaDependencyPayload(entryPath) {
  const normalized = normalizeArchivePath(entryPath)
  return NATIVE_MEDIA_DEPENDENCY_PAYLOADS.some(({ packagePath, prefix }) => {
    const parent = `${packagePath}/`
    if (!normalized.startsWith(parent)) return false
    const filename = normalized.slice(parent.length)
    return !filename.includes('/') && filename.startsWith(prefix)
  })
}

function listUnpackedNativeMediaPayloads(unpackedRoot) {
  if (!fs.existsSync(unpackedRoot)) return []
  const rootStat = fs.lstatSync(unpackedRoot)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Packaged app.asar.unpacked must be a regular directory: ${unpackedRoot}`)
  }
  const duplicates = []
  for (const { packagePath, prefix } of NATIVE_MEDIA_DEPENDENCY_PAYLOADS) {
    const packageDirectory = path.join(unpackedRoot, ...packagePath.split('/'))
    if (!fs.existsSync(packageDirectory)) continue
    const packageStat = fs.lstatSync(packageDirectory)
    if (packageStat.isSymbolicLink() || !packageStat.isDirectory()) {
      throw new Error(`Packaged native dependency path must be a regular directory: ${packageDirectory}`)
    }
    for (const entry of fs.readdirSync(packageDirectory, { withFileTypes: true })) {
      if (entry.name.startsWith(prefix)) duplicates.push(`${packagePath}/${entry.name}`)
    }
  }
  return duplicates
}

function verifyNoPackagedNativeMediaDuplicates(options = {}) {
  const resourcesPath = path.resolve(options.resourcesPath)
  const asarPath = path.resolve(options.asarPath || path.join(resourcesPath, 'app.asar'))
  let archiveEntries
  try {
    if (!options.archiveEntries) uncache(asarPath)
    archiveEntries = options.archiveEntries || listPackage(asarPath)
  } catch (error) {
    throw new Error(`Could not inspect packaged app.asar for duplicate native media: ${error.message}`)
  }
  const archiveDuplicates = archiveEntries
    .map(normalizeArchivePath)
    .filter(nativeMediaDependencyPayload)
  const unpackedPath = path.resolve(options.unpackedPath || `${asarPath}.unpacked`)
  const unpackedDuplicates = listUnpackedNativeMediaPayloads(unpackedPath)
  const duplicates = [
    ...archiveDuplicates.map((entry) => `app.asar:${entry}`),
    ...unpackedDuplicates.map((entry) => `app.asar.unpacked:${entry}`),
  ]
  if (duplicates.length > 0) {
    throw new Error(
      `Packaged app contains duplicate FFmpeg/FFprobe dependency payloads outside resources/bin: ${duplicates.join(', ')}`
    )
  }
  return { asarPath, unpackedPath, archiveEntries: archiveEntries.length }
}

function verifyStagedReleaseInputs(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT)
  const platform = normalizePlatform(options.platform || process.platform)
  const arch = normalizeArch(options.arch || process.arch)
  const root = path.resolve(options.rifeRoot || stagedRifeRoot(projectRoot, platform, arch))
  const media = verifyNativeMedia({ projectRoot, platform, arch })
  const rife = options.smokeRife
    ? smokeRifeInterpolation({ root, platform, arch, projectRoot, ffmpegPath: media.ffmpegPath })
    : verifyRifeExecutable({ root, platform, arch })
  return { root, media, rife }
}

function verifyPackagedResources(options = {}) {
  const resourcesPath = path.resolve(options.resourcesPath)
  const platform = normalizePlatform(options.platform || process.platform)
  const arch = normalizeArch(options.arch || process.arch)
  verifyNoPackagedNativeMediaDuplicates({ resourcesPath })
  const binaries = packagedBinaryPaths(resourcesPath, platform)
  const root = path.join(resourcesPath, 'bin', 'rife')
  const verifyOnce = (signedPackage) => {
    const media = verifyNativeMedia({
      platform,
      arch,
      ...binaries,
      signedPackage,
      hostExecutablePath: options.hostExecutablePath,
    })
    const verifyOptions = {
      root,
      platform,
      arch,
      ffmpegPath: media.ffmpegPath,
      signedPackage,
      hostExecutablePath: options.hostExecutablePath,
    }
    const rife = options.smokeRife
      ? smokeRifeInterpolation(verifyOptions)
      : verifyRifeExecutable(verifyOptions)
    return { root, media, rife }
  }

  if (options.signedPackage === true) return verifyOnce(true)
  try {
    return verifyOnce(false)
  } catch (error) {
    const canRetrySigned = options.allowSignedPackageFallback === true
      && (platform === 'win32' || platform === 'darwin')
      && /(?:RIFE file (?:size|hash) does not match provenance:\s*rife-ncnn-vulkan(?:\.exe)?|(?:FFmpeg|FFprobe) executable (?:size|hash) does not match the pinned release asset)/i.test(error.message)
    if (!canRetrySigned) throw error
    return verifyOnce(true)
  }
}

function parseArgs(argv) {
  const parsed = {
    command: argv[0] || '',
    allowSignedPackageFallback: false,
    signedPackage: false,
    smokeRife: false,
  }
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--smoke-rife') {
      parsed.smokeRife = true
      continue
    }
    if (value === '--signed-package') {
      parsed.signedPackage = true
      continue
    }
    if (value === '--allow-signed-package-fallback') {
      parsed.allowSignedPackageFallback = true
      continue
    }
    if (!value.startsWith('--') || index + 1 >= argv.length) throw new Error(`Unknown or incomplete argument: ${value}`)
    const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    parsed[key] = argv[index + 1]
    index += 1
  }
  return parsed
}

function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const common = {
    projectRoot: options.projectRoot || PROJECT_ROOT,
    platform: options.platform || process.platform,
    arch: options.arch || process.arch,
    allowSignedPackageFallback: options.allowSignedPackageFallback,
    hostExecutablePath: options.hostExecutable,
    signedPackage: options.signedPackage,
    smokeRife: options.smokeRife,
  }
  let result
  if (options.command === 'staged') {
    result = verifyStagedReleaseInputs({ ...common, rifeRoot: options.rifeRoot })
  } else if (options.command === 'packaged') {
    if (!options.resources) throw new Error('The packaged command requires --resources')
    result = verifyPackagedResources({ ...common, resourcesPath: options.resources })
  } else if (options.command === 'native') {
    result = verifyNativeMedia(common)
  } else if (options.command === 'rife') {
    const root = options.rifeRoot || stagedRifeRoot(common.projectRoot, common.platform, common.arch)
    result = options.smokeRife
      ? smokeRifeInterpolation({ ...common, root })
      : verifyRifeExecutable({ ...common, root })
  } else {
    throw new Error('Usage: runtime-package-gate.cjs <staged|packaged|native|rife> [options]')
  }
  process.stdout.write(`Runtime package gate passed for ${normalizePlatform(common.platform)}/${normalizeArch(common.arch)}.\n`)
  return result
}

if (require.main === module) {
  try {
    runCli()
  } catch (error) {
    process.stderr.write(`Runtime package gate failed: ${error.message}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  NATIVE_MEDIA_RELEASE_FILES,
  packagedBinaryPaths,
  packagedResourcesPath,
  parseArgs,
  resolveDependencyBinary,
  runBinary,
  runCli,
  smokeRifeInterpolation,
  stagePlatformName,
  stagedRifeRoot,
  verifyNativeMedia,
  verifyNoPackagedNativeMediaDuplicates,
  verifyPinnedFile,
  verifyPackagedResources,
  verifyRifeExecutable,
  verifyStagedReleaseInputs,
}
