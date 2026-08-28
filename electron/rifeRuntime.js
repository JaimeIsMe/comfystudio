const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const RIFE_RUNTIME_ENV_KEY = 'VELORN_RIFE_RUNTIME_DIR'
const RIFE_MODEL_NAME = 'rife-v4.6'
const RIFE_PROVENANCE_SCHEMA_VERSION = 1
const RIFE_WRAPPER_SOURCE_COMMIT = 'a7532fc3f9f8f008cd6eecd6f2ffe2a9698e0cf7'
const RIFE_SOURCE_PATCH_SHA256 = 'e1ae09c53f199d2675b9c58a9b470bdb493ab065b2768c7192d566e6acbcebb4'
const RIFE_TRUSTED_SOURCE_COMMITS = Object.freeze({
  wrapper: RIFE_WRAPPER_SOURCE_COMMIT,
  ncnn: 'b4ba207c18d3103d6df890c0e3a97b469b196b26',
  glslang: '86ff4bca1ddc7e2262f119c16e7228d0efb67610',
  stb: '2c980bb59875b0d32144a71867fbdebb2f77cd20',
  practicalRife: 'bbfd2ea90910789a860ea3e2b32a240cd577b75e',
  moltenVk: 'db445ff2042d9ce348c439ad8451112f354b8d2a',
})
const RIFE_MODEL_LICENSE_EVIDENCE = Object.freeze({
  commit: RIFE_TRUSTED_SOURCE_COMMITS.practicalRife,
  path: 'README.md',
  sha256: 'b695ac5d4a69c2f551512678883f8234d784c286d805ca546f4873cb465959b4',
})
const RIFE_LINUX_SYMBOL_CEILINGS = Object.freeze({
  GLIBC: '2.31',
  GLIBCXX: '3.4.28',
})
const RIFE_MODEL_FILES = Object.freeze({
  'rife-v4.6/flownet.bin': Object.freeze({
    sha256: 'f334ed2260149ce0188a6dcf049844e8b0cdd912e01cbcfb63553157d2508958',
    size: 10614320,
  }),
  'rife-v4.6/flownet.param': Object.freeze({
    sha256: '724569596bcd1e7b9fa50455c604777ebed99746d2ef40aa86e31b5725f1053c',
    size: 16532,
  }),
})

function normalizePlatform(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'windows' || normalized === 'win') return 'win32'
  if (normalized === 'mac' || normalized === 'macos' || normalized === 'osx') return 'darwin'
  return normalized
}

function normalizeArch(value) {
  const builderArch = typeof value === 'number'
    ? ({ 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' })[value]
    : value
  const normalized = String(builderArch || '').trim().toLowerCase()
  if (normalized === 'amd64' || normalized === 'x86_64' || normalized === 'x86-64') return 'x64'
  if (normalized === 'aarch64') return 'arm64'
  return normalized
}

function toPortablePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead = 0
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

function collectRuntimeFiles(root) {
  const files = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name)
      const relativePath = toPortablePath(path.relative(root, absolutePath))
      const stat = fs.lstatSync(absolutePath)
      if (stat.isSymbolicLink()) {
        throw new Error(`RIFE runtime contains a symbolic link: ${relativePath}`)
      }
      if (stat.isDirectory()) {
        visit(absolutePath)
      } else if (stat.isFile()) {
        files.push(relativePath)
      } else {
        throw new Error(`RIFE runtime contains an unsupported entry: ${relativePath}`)
      }
    }
  }
  visit(root)
  return files.sort()
}

function readBinaryArchitectures(filePath) {
  const fd = fs.openSync(filePath, 'r')
  const header = Buffer.alloc(16 * 1024)
  let bytesRead
  try {
    bytesRead = fs.readSync(fd, header, 0, header.length, 0)
  } finally {
    fs.closeSync(fd)
  }
  const data = header.subarray(0, bytesRead)
  if (data.length < 20) throw new Error(`Executable is too small to identify: ${filePath}`)

  // ELF
  if (data[0] === 0x7f && data[1] === 0x45 && data[2] === 0x4c && data[3] === 0x46) {
    const littleEndian = data[5] === 1
    const machine = littleEndian ? data.readUInt16LE(18) : data.readUInt16BE(18)
    if (machine === 62) return new Set(['x64'])
    if (machine === 183) return new Set(['arm64'])
    return new Set([`elf-machine-${machine}`])
  }

  // Portable Executable (PE/COFF)
  if (data[0] === 0x4d && data[1] === 0x5a && data.length >= 64) {
    const peOffset = data.readUInt32LE(0x3c)
    const peHeader = Buffer.alloc(8)
    const peFd = fs.openSync(filePath, 'r')
    try {
      if (fs.readSync(peFd, peHeader, 0, peHeader.length, peOffset) !== peHeader.length) {
        throw new Error(`Invalid PE header: ${filePath}`)
      }
    } finally {
      fs.closeSync(peFd)
    }
    if (!peHeader.subarray(0, 4).equals(Buffer.from([0x50, 0x45, 0, 0]))) {
      throw new Error(`Invalid PE signature: ${filePath}`)
    }
    const machine = peHeader.readUInt16LE(4)
    if (machine === 0x8664) return new Set(['x64'])
    if (machine === 0xaa64) return new Set(['arm64'])
    return new Set([`pe-machine-${machine}`])
  }

  const cpuTypeToArch = (cpuType) => {
    if (cpuType === 0x01000007) return 'x64'
    if (cpuType === 0x0100000c) return 'arm64'
    return `macho-cpu-${cpuType}`
  }
  const magicBE = data.readUInt32BE(0)
  const magicLE = data.readUInt32LE(0)

  // Thin Mach-O
  if (magicLE === 0xfeedfacf || magicLE === 0xfeedface) {
    return new Set([cpuTypeToArch(data.readUInt32LE(4))])
  }
  if (magicBE === 0xfeedfacf || magicBE === 0xfeedface) {
    return new Set([cpuTypeToArch(data.readUInt32BE(4))])
  }

  // Universal Mach-O, including the 64-bit fat-header variant.
  const fatBigEndian = magicBE === 0xcafebabe || magicBE === 0xcafebabf
  const fatLittleEndian = magicLE === 0xcafebabe || magicLE === 0xcafebabf
  if (fatBigEndian || fatLittleEndian) {
    const readUInt32 = fatBigEndian
      ? (offset) => data.readUInt32BE(offset)
      : (offset) => data.readUInt32LE(offset)
    const is64BitFat = (fatBigEndian ? magicBE : magicLE) === 0xcafebabf
    const entrySize = is64BitFat ? 32 : 20
    const count = readUInt32(4)
    if (count < 1 || count > 32 || 8 + count * entrySize > data.length) {
      throw new Error(`Invalid universal Mach-O header: ${filePath}`)
    }
    const architectures = new Set()
    for (let index = 0; index < count; index += 1) {
      architectures.add(cpuTypeToArch(readUInt32(8 + index * entrySize)))
    }
    return architectures
  }

  throw new Error(`Unsupported executable format: ${filePath}`)
}

function readBinaryFormat(filePath) {
  const fd = fs.openSync(filePath, 'r')
  const header = Buffer.alloc(4)
  try {
    if (fs.readSync(fd, header, 0, header.length, 0) !== header.length) return 'unknown'
  } finally {
    fs.closeSync(fd)
  }
  if (header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46) return 'elf'
  if (header[0] === 0x4d && header[1] === 0x5a) return 'pe'
  const magicBE = header.readUInt32BE(0)
  const magicLE = header.readUInt32LE(0)
  const machMagics = new Set([0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcafebabf])
  if (machMagics.has(magicBE) || machMagics.has(magicLE)) return 'macho'
  return 'unknown'
}

function assertBinaryTarget(filePath, platform, arch) {
  const normalizedPlatform = normalizePlatform(platform)
  const normalizedArch = normalizeArch(arch)
  const format = readBinaryFormat(filePath)
  const expectedFormat = ({ win32: 'pe', linux: 'elf', darwin: 'macho' })[normalizedPlatform]
  if (format !== expectedFormat) {
    throw new Error(`${path.basename(filePath)} is ${format}, expected ${expectedFormat} for ${normalizedPlatform}`)
  }
  const architectures = readBinaryArchitectures(filePath)
  if (!architectures.has(normalizedArch)) {
    throw new Error(
      `${path.basename(filePath)} targets ${[...architectures].join(', ')}, expected ${normalizedPlatform}/${normalizedArch}`
    )
  }

  const stat = fs.statSync(filePath)
  if (!stat.isFile() || stat.size === 0) throw new Error(`Executable is missing or empty: ${filePath}`)
  if (normalizedPlatform !== 'win32' && (stat.mode & 0o111) === 0) {
    throw new Error(`Executable permission is missing: ${filePath}`)
  }
  return architectures
}

function compareNumericVersions(left, right) {
  const leftParts = String(left).split('.').map(Number)
  const rightParts = String(right).split('.').map(Number)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (difference !== 0) return difference
  }
  return 0
}

function assertLinuxSymbolCeiling(filePath, ceilings = RIFE_LINUX_SYMBOL_CEILINGS) {
  const binaryText = fs.readFileSync(filePath).toString('latin1')
  const requirements = {
    GLIBC: [...binaryText.matchAll(/GLIBC_(\d+\.\d+(?:\.\d+)?)/g)].map((match) => match[1]),
    GLIBCXX: [...binaryText.matchAll(/GLIBCXX_(\d+\.\d+(?:\.\d+)?)/g)].map((match) => match[1]),
  }
  const maxima = {}
  for (const [family, ceiling] of Object.entries(ceilings)) {
    const versions = [...new Set(requirements[family] || [])]
      .sort(compareNumericVersions)
    const maximum = versions.at(-1) || null
    maxima[family] = maximum
    if (maximum && compareNumericVersions(maximum, ceiling) > 0) {
      throw new Error(`${path.basename(filePath)} requires ${family}_${maximum}, above the ${family}_${ceiling} release ceiling`)
    }
  }
  return maxima
}

function runSignatureTool(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: options.env || process.env,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30000,
    windowsHide: true,
  })
  if (result.error) throw new Error(`Could not verify the RIFE platform signature: ${result.error.message}`)
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(0, 800)
    throw new Error(`RIFE platform signature verification failed${detail ? `: ${detail}` : ''}`)
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`
}

function readMacSigningIdentity(filePath) {
  runSignatureTool('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', filePath])
  const details = runSignatureTool('/usr/bin/codesign', ['--display', '--verbose=4', filePath])
  const teamIdentifier = details.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim()
  const identifier = details.match(/^Identifier=(.+)$/m)?.[1]?.trim()
  if (!teamIdentifier || teamIdentifier === 'not set') {
    throw new Error(`RIFE platform signature does not have an Apple team identifier: ${filePath}`)
  }
  return { teamIdentifier, identifier }
}

function readWindowsSigningIdentities(targetPath, hostExecutablePath) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'function Read-Signature([string]$Path) {',
    '  $signature = Get-AuthenticodeSignature -LiteralPath $Path',
    '  [pscustomobject]@{',
    '    status = [string]$signature.Status',
    '    subject = [string]$signature.SignerCertificate.Subject',
    '    issuer = [string]$signature.SignerCertificate.Issuer',
    '  }',
    '}',
    '$result = [pscustomobject]@{ target = Read-Signature $env:VELORN_RIFE_SIGNATURE_TARGET }',
    'if ($env:VELORN_RIFE_SIGNATURE_HOST) {',
    '  $result | Add-Member -NotePropertyName host -NotePropertyValue (Read-Signature $env:VELORN_RIFE_SIGNATURE_HOST)',
    '}',
    '$result | ConvertTo-Json -Compress -Depth 4',
  ].join('\n')
  const output = runSignatureTool('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command', script,
  ], {
    env: {
      ...process.env,
      VELORN_RIFE_SIGNATURE_TARGET: targetPath,
      VELORN_RIFE_SIGNATURE_HOST: hostExecutablePath || '',
    },
  })
  try {
    return JSON.parse(output.trim())
  } catch (error) {
    throw new Error(`Could not parse Windows signature verification: ${error.message}`)
  }
}

function verifyPlatformSignature(options = {}) {
  const platform = normalizePlatform(options.platform || process.platform)
  const executablePath = path.resolve(options.executablePath || '')
  const hostExecutablePath = options.hostExecutablePath ? path.resolve(options.hostExecutablePath) : ''
  if (platform === 'darwin') {
    const target = readMacSigningIdentity(executablePath)
    if (hostExecutablePath) {
      const host = readMacSigningIdentity(hostExecutablePath)
      if (target.teamIdentifier !== host.teamIdentifier) {
        throw new Error('RIFE Apple team identifier does not match the signed Velorn application')
      }
    }
    return target
  }
  if (platform === 'win32') {
    const identities = readWindowsSigningIdentities(executablePath, hostExecutablePath)
    if (identities.target?.status !== 'Valid' || !identities.target?.subject || !identities.target?.issuer) {
      throw new Error('RIFE Authenticode signature is not valid')
    }
    if (hostExecutablePath) {
      if (identities.host?.status !== 'Valid') throw new Error('Velorn host Authenticode signature is not valid')
      if (identities.target.subject !== identities.host.subject || identities.target.issuer !== identities.host.issuer) {
        throw new Error('RIFE Authenticode signer does not match the signed Velorn application')
      }
    }
    return identities.target
  }
  throw new Error(`Platform-signature validation is unsupported on ${platform}`)
}

function normalizeManifestFiles(provenance) {
  const result = new Map()
  if (Array.isArray(provenance.files)) {
    for (const entry of provenance.files) {
      if (!entry || typeof entry !== 'object') throw new Error('PROVENANCE.json contains an invalid file record')
      const portablePath = toPortablePath(entry.path)
      if (!portablePath) throw new Error('PROVENANCE.json contains a file record without a path')
      result.set(portablePath, entry)
    }
  } else if (provenance.files && typeof provenance.files === 'object') {
    for (const [filePath, entry] of Object.entries(provenance.files)) {
      result.set(toPortablePath(filePath), entry)
    }
  } else {
    throw new Error('PROVENANCE.json must contain a files manifest')
  }
  return result
}

function provenanceValue(provenance, paths) {
  for (const segments of paths) {
    let current = provenance
    for (const segment of segments) current = current && current[segment]
    if (current !== undefined && current !== null) return current
  }
  return undefined
}

function validateRifeRuntime(options = {}) {
  const root = path.resolve(options.root || '')
  const platform = normalizePlatform(options.platform || process.platform)
  const arch = normalizeArch(options.arch || process.arch)
  if (!['win32', 'linux', 'darwin'].includes(platform)) throw new Error(`Unsupported RIFE platform: ${platform}`)
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported RIFE architecture: ${arch}`)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`RIFE runtime directory is missing: ${root}`)
  }

  const executableName = platform === 'win32' ? 'rife-ncnn-vulkan.exe' : 'rife-ncnn-vulkan'
  const executablePath = path.join(root, executableName)
  const provenancePath = path.join(root, 'PROVENANCE.json')
  const licensesPath = path.join(root, 'licenses')
  for (const requiredPath of [
    executablePath,
    path.join(root, RIFE_MODEL_NAME, 'flownet.param'),
    path.join(root, RIFE_MODEL_NAME, 'flownet.bin'),
    provenancePath,
  ]) {
    if (!fs.existsSync(requiredPath) || !fs.statSync(requiredPath).isFile()) {
      throw new Error(`Required RIFE runtime file is missing: ${requiredPath}`)
    }
  }
  if (!fs.existsSync(licensesPath) || !fs.statSync(licensesPath).isDirectory()) {
    throw new Error(`RIFE license directory is missing: ${licensesPath}`)
  }

  let provenance
  try {
    provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'))
  } catch (error) {
    throw new Error(`RIFE provenance is not valid JSON: ${error.message}`)
  }
  if (provenance.schemaVersion !== RIFE_PROVENANCE_SCHEMA_VERSION) {
    throw new Error(`Unsupported RIFE provenance schema: ${provenance.schemaVersion}`)
  }

  const provenancePlatform = normalizePlatform(provenanceValue(provenance, [
    ['target', 'platform'],
    ['platform'],
  ]))
  const provenanceArch = normalizeArch(provenanceValue(provenance, [
    ['target', 'arch'],
    ['arch'],
  ]))
  if (provenancePlatform !== platform || provenanceArch !== arch) {
    throw new Error(
      `RIFE provenance targets ${provenancePlatform || 'unknown'}/${provenanceArch || 'unknown'}, expected ${platform}/${arch}`
    )
  }

  const wrapperCommit = String(provenanceValue(provenance, [
    ['sources', 'wrapper', 'commit'],
    ['source', 'commit'],
    ['wrapperSourceCommit'],
  ]) || '').toLowerCase()
  if (wrapperCommit !== RIFE_WRAPPER_SOURCE_COMMIT) {
    throw new Error('RIFE provenance does not contain the trusted wrapper source commit')
  }
  const modelName = provenanceValue(provenance, [
    ['model', 'name'],
    ['modelName'],
    ['model'],
  ])
  if (modelName !== RIFE_MODEL_NAME) throw new Error(`Unexpected RIFE model in provenance: ${modelName}`)
  const pngOnly = provenanceValue(provenance, [
    ['security', 'pngOnly'],
    ['runtime', 'pngOnly'],
    ['pngOnly'],
  ])
  const webpDisabled = provenanceValue(provenance, [
    ['security', 'webpDisabled'],
    ['runtime', 'webpDisabled'],
    ['webpDisabled'],
  ])
  if (pngOnly !== true || webpDisabled !== true) {
    throw new Error('RIFE provenance must attest PNG-only input and disabled WebP support')
  }
  if (provenance.openMpDisabled !== true) {
    throw new Error('RIFE provenance must attest that OpenMP runtime linkage is disabled')
  }
  if (provenance.binaryState !== 'unsigned-source-build') {
    throw new Error('RIFE provenance must describe the unsigned source-build binary state')
  }
  const expectedTarget = `${({ win32: 'win', linux: 'linux', darwin: 'mac' })[platform]}-${arch}`
  if (provenance.target !== expectedTarget) {
    throw new Error(`RIFE provenance target ID is ${provenance.target || 'missing'}, expected ${expectedTarget}`)
  }
  const requiredSourceCommits = Object.entries(RIFE_TRUSTED_SOURCE_COMMITS)
    .filter(([sourceName]) => sourceName !== 'moltenVk' || platform === 'darwin')
  for (const [sourceName, expectedCommit] of requiredSourceCommits) {
    const actualCommit = String(provenance.sources?.[sourceName]?.commit || '').toLowerCase()
    if (actualCommit !== expectedCommit) {
      throw new Error(`RIFE provenance contains an untrusted ${sourceName} source commit`)
    }
  }
  const modelEvidence = provenance.modelLicenseEvidence || {}
  for (const [field, expected] of Object.entries(RIFE_MODEL_LICENSE_EVIDENCE)) {
    if (modelEvidence[field] !== expected) {
      throw new Error(`RIFE provenance contains invalid model-license evidence: ${field}`)
    }
  }
  const sourcePatch = provenance.sourcePatch || {}
  if (sourcePatch.path !== 'scripts/rife-runtime/patches/0001-png-only.patch'
    || sourcePatch.sha256 !== RIFE_SOURCE_PATCH_SHA256
    || !Array.isArray(sourcePatch.removedUpstreamFiles)
    || !sourcePatch.removedUpstreamFiles.includes('src/FindWebP.cmake')
    || !sourcePatch.removedUpstreamFiles.includes('src/webp_image.h')
    || !Array.isArray(sourcePatch.unfetchedSubmodules)
    || !sourcePatch.unfetchedSubmodules.includes('src/libwebp')) {
    throw new Error('RIFE provenance does not describe the trusted PNG-only source patch')
  }

  const allFiles = collectRuntimeFiles(root)
  const shippedFiles = allFiles.filter((filePath) => filePath !== 'PROVENANCE.json')
  const licenseFiles = shippedFiles.filter((filePath) => filePath.startsWith('licenses/'))
  if (licenseFiles.length === 0) throw new Error('RIFE runtime does not contain any license files')
  for (const licenseFile of licenseFiles) {
    if (fs.statSync(path.join(root, licenseFile)).size === 0) throw new Error(`RIFE license is empty: ${licenseFile}`)
  }

  const declaredLicenseFiles = provenance.licenseFiles
  if (!Array.isArray(declaredLicenseFiles) || declaredLicenseFiles.length === 0) {
    throw new Error('RIFE provenance must declare its licenseFiles')
  }
  const declaredLicenses = new Set(declaredLicenseFiles.map(toPortablePath))
  const expectedLicenseFiles = new Set([
    'licenses/LICENSE.rife-ncnn-vulkan.txt',
    'licenses/LICENSE.ncnn.txt',
    'licenses/LICENSE.glslang.txt',
    'licenses/LICENSE.stb.txt',
    'licenses/LICENSE.Practical-RIFE-models.txt',
    ...(platform === 'darwin' ? ['licenses/LICENSE.MoltenVK.txt'] : []),
  ])
  if (declaredLicenses.size !== expectedLicenseFiles.size
    || [...expectedLicenseFiles].some((filePath) => !declaredLicenses.has(filePath))) {
    throw new Error(`RIFE provenance does not declare the required ${platform} license set`)
  }
  for (const filePath of licenseFiles) {
    if (!declaredLicenses.has(filePath)) throw new Error(`RIFE license is not declared in provenance: ${filePath}`)
  }
  for (const filePath of declaredLicenses) {
    if (!licenseFiles.includes(filePath)) throw new Error(`Declared RIFE license is missing: ${filePath}`)
  }

  const manifest = normalizeManifestFiles(provenance)
  if (manifest.size !== shippedFiles.length) {
    throw new Error(`RIFE file manifest has ${manifest.size} entries, but ${shippedFiles.length} files are shipped`)
  }
  for (const filePath of shippedFiles) {
    const record = manifest.get(filePath)
    if (!record) throw new Error(`RIFE file is not covered by provenance: ${filePath}`)
    const absolutePath = path.join(root, ...filePath.split('/'))
    const stat = fs.statSync(absolutePath)
    const signedExecutableMutation = options.allowSignedExecutableMutation === true && filePath === executableName
    if (!Number.isSafeInteger(record.size) || record.size <= 0) {
      throw new Error(`RIFE provenance contains an invalid file size: ${filePath}`)
    }
    if (!signedExecutableMutation && record.size !== stat.size) {
      throw new Error(`RIFE file size does not match provenance: ${filePath}`)
    }
    if (!/^[a-f0-9]{64}$/i.test(record.sha256 || '')) {
      throw new Error(`RIFE provenance contains an invalid file hash: ${filePath}`)
    }
    const actualHash = signedExecutableMutation ? null : sha256File(absolutePath)
    if (!signedExecutableMutation && actualHash !== String(record.sha256).toLowerCase()) {
      throw new Error(`RIFE file hash does not match provenance: ${filePath}`)
    }
  }
  for (const filePath of manifest.keys()) {
    if (!shippedFiles.includes(filePath)) throw new Error(`RIFE provenance references an unshipped file: ${filePath}`)
  }

  const expectedModelFiles = options.expectedModelFiles || RIFE_MODEL_FILES
  for (const [filePath, expected] of Object.entries(expectedModelFiles)) {
    const absolutePath = path.join(root, ...filePath.split('/'))
    const actual = manifest.get(filePath)
    if (!actual || actual.size !== expected.size || String(actual.sha256).toLowerCase() !== expected.sha256) {
      throw new Error(`RIFE model is not the pinned ${RIFE_MODEL_NAME} model: ${filePath}`)
    }
    // The full manifest check above verifies that the declared pinned hash is also the on-disk hash.
    if (!fs.existsSync(absolutePath)) throw new Error(`Pinned RIFE model file is missing: ${filePath}`)
  }

  assertBinaryTarget(executablePath, platform, arch)
  const linuxSymbols = platform === 'linux' ? assertLinuxSymbolCeiling(executablePath) : null
  return {
    root,
    executablePath,
    modelPath: path.join(root, RIFE_MODEL_NAME),
    modelName: RIFE_MODEL_NAME,
    provenancePath,
    provenance,
    files: shippedFiles,
    linuxSymbols,
  }
}

function resolveRifeRuntime(options = {}) {
  const platform = normalizePlatform(options.platform || process.platform)
  const arch = normalizeArch(options.arch || process.arch)
  const packaged = options.packaged === true
  const appRoot = path.resolve(options.appRoot || path.join(__dirname, '..'))
  const resourcesPath = path.resolve(options.resourcesPath || process.resourcesPath || appRoot)
  const requestedEnvironmentRoot = typeof options.environmentRoot === 'string'
    ? options.environmentRoot.trim()
    : String(process.env[RIFE_RUNTIME_ENV_KEY] || '').trim()
  const environmentRoot = packaged ? '' : requestedEnvironmentRoot
  const root = path.resolve(
    environmentRoot
      || (packaged ? path.join(resourcesPath, 'bin', 'rife') : path.join(appRoot, '.runtime', 'rife'))
  )
  const executablePath = path.join(root, platform === 'win32' ? 'rife-ncnn-vulkan.exe' : 'rife-ncnn-vulkan')
  const modelPath = path.join(root, RIFE_MODEL_NAME)
  const requiredPaths = [
    executablePath,
    path.join(modelPath, 'flownet.param'),
    path.join(modelPath, 'flownet.bin'),
  ]
  const missingPaths = requiredPaths.filter((candidate) => {
    try {
      return !fs.statSync(candidate).isFile()
    } catch {
      return true
    }
  })
  const provenancePath = path.join(root, 'PROVENANCE.json')
  const shouldVerifyTrustedRuntime = packaged || fs.existsSync(provenancePath)
  const validationErrors = []
  let provenance = null
  if (missingPaths.length === 0 && shouldVerifyTrustedRuntime) {
    try {
      const signedExecutableMutation = packaged && (platform === 'win32' || platform === 'darwin')
      const validation = validateRifeRuntime({
        root,
        platform,
        arch,
        allowSignedExecutableMutation: signedExecutableMutation,
      })
      if (signedExecutableMutation) {
        const signatureVerifier = options.signatureVerifier || verifyPlatformSignature
        signatureVerifier({
          executablePath: validation.executablePath,
          hostExecutablePath: options.hostExecutablePath || process.execPath,
          platform,
        })
      }
      provenance = validation.provenance
    } catch (error) {
      validationErrors.push(error.message)
    }
  }
  const available = missingPaths.length === 0 && validationErrors.length === 0

  return {
    available,
    trusted: shouldVerifyTrustedRuntime && validationErrors.length === 0 && missingPaths.length === 0,
    root,
    executablePath,
    modelPath,
    modelName: RIFE_MODEL_NAME,
    provenancePath,
    provenance,
    missingPaths,
    validationErrors,
    error: available
      ? null
      : packaged || validationErrors.length > 0
        ? 'Velorn\'s smooth-motion engine failed its integrity check. Reinstall Velorn to restore it.'
        : 'Velorn\'s smooth-motion engine is missing. Reinstall Velorn to restore it.',
  }
}

module.exports = {
  RIFE_MODEL_FILES,
  RIFE_LINUX_SYMBOL_CEILINGS,
  RIFE_MODEL_NAME,
  RIFE_PROVENANCE_SCHEMA_VERSION,
  RIFE_RUNTIME_ENV_KEY,
  RIFE_SOURCE_PATCH_SHA256,
  RIFE_TRUSTED_SOURCE_COMMITS,
  RIFE_WRAPPER_SOURCE_COMMIT,
  assertBinaryTarget,
  assertLinuxSymbolCeiling,
  normalizeArch,
  normalizePlatform,
  readBinaryArchitectures,
  readBinaryFormat,
  resolveRifeRuntime,
  sha256File,
  validateRifeRuntime,
  verifyPlatformSignature,
}
