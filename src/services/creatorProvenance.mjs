export const PUBLIC_PROVENANCE_REVIEW_BASE_URL =
  'https://velornlabs.github.io/velorn-creator-provenance/'

export const CREATOR_PROVENANCE_REQUEST_VERSION = 1
export const CREATOR_PROVENANCE_MAX_PAYLOAD_BYTES = 6_000
export const CREATOR_PROVENANCE_MAX_FRAGMENT_CHARACTERS = 8_192

const PROVENANCE_REQUEST_CONTRACT = 'velorn.creator-provenance.request'
const PROVENANCE_MANIFEST_CONTRACT = 'velorn.creator-provenance.manifest'
const PROVENANCE_LIFECYCLE_CONTRACT = 'velorn.creator-provenance.lifecycle'
const CREATOR_RELATIONSHIP_STATEMENT = 'wallet_asserted_creator_relationship'
const COMMITMENT_STATEMENT_TYPE = 'creator_media_commitment_v1'
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{11,127}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const MIME_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/
const ISO_UTC_MILLISECONDS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const UINT64_MAX = 18_446_744_073_709_551_615n
const REQUEST_ENTROPY_BYTES = 12
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/
const WINDOWS_UNC_PATH = /^\\\\[^\\/]+[\\/][^\\/]+/
const textEncoder = new TextEncoder()

const EXPORT_FORMATS = Object.freeze({
  mp4: Object.freeze({ extension: '.mp4', mimeType: 'video/mp4' }),
  prores: Object.freeze({ extension: '.mov', mimeType: 'video/quicktime' }),
})

function fail(message) {
  throw new TypeError(message)
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertPlainDataRecord(value, field) {
  if (!isPlainObject(value)) fail(`${field} must be a plain object`)

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail(`${field} must not contain symbol properties`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || descriptor.enumerable !== true || !('value' in descriptor)) {
      fail(`${field} must contain only enumerable data properties`)
    }
  }
}

function assertExactKeys(value, required, optional, field) {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${field} contains unsupported property ${key}`)
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail(`${field} is missing required property ${key}`)
    }
  }
}

function canonicalArrayEntries(value) {
  const entries = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || descriptor.enumerable !== true || !('value' in descriptor)) {
      fail('Provenance arrays must contain one enumerable data value at every index')
    }
    entries.push(descriptor.value)
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail('Provenance arrays must not contain symbol properties')
    if (key === 'length' || /^(0|[1-9]\d*)$/.test(key)) continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor?.enumerable === true) {
      fail('Provenance arrays must not contain extra enumerable properties')
    }
  }
  return entries
}

function canonicalObjectEntries(value) {
  const entries = []
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail('Provenance objects must not contain symbol properties')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || descriptor.enumerable !== true) continue
    if (!('value' in descriptor)) {
      fail('Provenance objects must contain only enumerable data properties')
    }
    entries.push([key, descriptor.value])
  }
  return entries.sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ))
}

function canonicalizeValue(value, ancestors) {
  if (value === null) return 'null'

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Provenance numbers must be finite')
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) fail('Provenance JSON must not be cyclic')
    ancestors.add(value)
    const result = `[${canonicalArrayEntries(value)
      .map(entry => canonicalizeValue(entry, ancestors))
      .join(',')}]`
    ancestors.delete(value)
    return result
  }

  if (typeof value === 'object') {
    if (!isPlainObject(value)) {
      fail('Provenance JSON must contain only JSON objects, arrays, and primitives')
    }
    if (ancestors.has(value)) fail('Provenance JSON must not be cyclic')
    ancestors.add(value)
    const result = `{${canonicalObjectEntries(value)
      .map(([key, entry]) => {
        if (entry === undefined) fail(`Provenance property ${key} must not be undefined`)
        return `${JSON.stringify(key)}:${canonicalizeValue(entry, ancestors)}`
      })
      .join(',')}}`
    ancestors.delete(value)
    return result
  }

  fail(`Unsupported provenance value: ${typeof value}`)
}

export function canonicalizeCreatorProvenanceJson(value) {
  return canonicalizeValue(value, new Set())
}

async function sha256HexUtf8(value) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle || typeof subtle.digest !== 'function') {
    throw new Error('Secure browser hashing is unavailable in this environment.')
  }
  const digest = await subtle.digest('SHA-256', textEncoder.encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function normalizeByteLength(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      fail('Provenance inspection byteLength must be a positive safe integer or decimal string')
    }
    return String(value)
  }
  if (typeof value !== 'string' || value.length > 20 || !/^[1-9]\d*$/.test(value)) {
    fail('Provenance inspection byteLength must be a positive safe integer or decimal string')
  }
  if (BigInt(value) > UINT64_MAX) {
    fail('Provenance inspection byteLength exceeds the unsigned 64-bit range')
  }
  return value
}

function absoluteDesktopPath(value) {
  return value.startsWith('/') || WINDOWS_ABSOLUTE_PATH.test(value) || WINDOWS_UNC_PATH.test(value)
}

function dataProperty(record, key) {
  const descriptor = isPlainObject(record)
    ? Object.getOwnPropertyDescriptor(record, key)
    : undefined
  return descriptor?.enumerable === true && 'value' in descriptor
    ? descriptor.value
    : undefined
}

export function isProvenanceEligibleExport(value) {
  const outputPath = dataProperty(value, 'outputPath')
  const format = dataProperty(value, 'format')
  if (
    typeof outputPath !== 'string'
    || outputPath.length === 0
    || outputPath !== outputPath.trim()
    || /[\u0000-\u001f\u007f]/.test(outputPath)
    || !absoluteDesktopPath(outputPath)
  ) {
    return false
  }

  const formatPolicy = typeof format === 'string' ? EXPORT_FORMATS[format] : undefined
  return Boolean(formatPolicy && outputPath.toLowerCase().endsWith(formatPolicy.extension))
}

function assertInspection(inspection) {
  assertPlainDataRecord(inspection, 'Provenance inspection')
  assertExactKeys(
    inspection,
    ['outputPath', 'format', 'byteLength', 'mediaSha256'],
    ['mimeType'],
    'Provenance inspection'
  )
  if (!isProvenanceEligibleExport(inspection)) {
    fail('Provenance inspection is not an eligible finished MP4 or ProRes MOV export')
  }
  if (typeof inspection.mediaSha256 !== 'string' || !SHA256_PATTERN.test(inspection.mediaSha256)) {
    fail('Provenance inspection mediaSha256 must be a lowercase SHA-256 digest')
  }

  const formatPolicy = EXPORT_FORMATS[inspection.format]
  if (Object.prototype.hasOwnProperty.call(inspection, 'mimeType')) {
    if (inspection.mimeType !== formatPolicy.mimeType) {
      fail(`Provenance inspection mimeType must be ${formatPolicy.mimeType} for ${inspection.format}`)
    }
  }

  return Object.freeze({
    byteLength: normalizeByteLength(inspection.byteLength),
    mediaSha256: inspection.mediaSha256,
    mimeType: formatPolicy.mimeType,
  })
}

function assertCanonicalUtcMilliseconds(value, field) {
  if (
    typeof value !== 'string'
    || !ISO_UTC_MILLISECONDS_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    fail(`${field} must be a canonical UTC ISO date-time`)
  }
}

function assertSha256(value, field) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(`${field} must be a lowercase SHA-256 digest`)
  }
}

function assertRequestStructure(request) {
  assertPlainDataRecord(request, 'Creator provenance request')
  assertExactKeys(
    request,
    ['contract', 'version', 'requestId', 'network', 'media', 'manifest', 'commitment'],
    [],
    'Creator provenance request'
  )
  if (
    request.contract !== PROVENANCE_REQUEST_CONTRACT
    || request.version !== CREATOR_PROVENANCE_REQUEST_VERSION
  ) {
    fail('Creator provenance request uses an unsupported contract or version')
  }
  if (typeof request.requestId !== 'string' || !REQUEST_ID_PATTERN.test(request.requestId)) {
    fail('Creator provenance request requestId must be 12-128 URL-safe characters')
  }
  if (request.network !== 'devnet') fail('Creator provenance request must target Devnet')

  assertPlainDataRecord(request.media, 'Creator provenance requested media')
  assertExactKeys(request.media, ['sha256'], [], 'Creator provenance requested media')
  assertSha256(request.media.sha256, 'Creator provenance requested media sha256')

  const manifest = request.manifest
  assertPlainDataRecord(manifest, 'Creator provenance manifest')
  assertExactKeys(
    manifest,
    ['contract', 'version', 'statement', 'declaredAt', 'media', 'lifecycle'],
    [],
    'Creator provenance manifest'
  )
  if (
    manifest.contract !== PROVENANCE_MANIFEST_CONTRACT
    || manifest.version !== CREATOR_PROVENANCE_REQUEST_VERSION
    || manifest.statement !== CREATOR_RELATIONSHIP_STATEMENT
  ) {
    fail('Creator provenance manifest uses an unsupported contract, version, or statement')
  }
  assertCanonicalUtcMilliseconds(manifest.declaredAt, 'Creator provenance manifest declaredAt')

  assertPlainDataRecord(manifest.media, 'Creator provenance media metadata')
  assertExactKeys(
    manifest.media,
    ['byteLength'],
    ['mimeType'],
    'Creator provenance media metadata'
  )
  normalizeByteLength(manifest.media.byteLength)
  if (Object.prototype.hasOwnProperty.call(manifest.media, 'mimeType')) {
    if (
      typeof manifest.media.mimeType !== 'string'
      || manifest.media.mimeType.length > 127
      || !MIME_TYPE_PATTERN.test(manifest.media.mimeType)
    ) {
      fail('Creator provenance media mimeType must be lowercase and omit parameters')
    }
  }

  assertPlainDataRecord(manifest.lifecycle, 'Creator provenance lifecycle')
  assertExactKeys(
    manifest.lifecycle,
    ['contract', 'version', 'action'],
    [],
    'Creator provenance lifecycle'
  )
  if (
    manifest.lifecycle.contract !== PROVENANCE_LIFECYCLE_CONTRACT
    || manifest.lifecycle.version !== CREATOR_PROVENANCE_REQUEST_VERSION
    || manifest.lifecycle.action !== 'issue'
  ) {
    fail('Creator provenance lifecycle must be the v1 issue declaration')
  }

  assertPlainDataRecord(request.commitment, 'Creator provenance commitment')
  assertExactKeys(
    request.commitment,
    ['mediaSha256', 'manifestSha256', 'statementType', 'version'],
    [],
    'Creator provenance commitment'
  )
  assertSha256(request.commitment.mediaSha256, 'Creator provenance commitment mediaSha256')
  assertSha256(request.commitment.manifestSha256, 'Creator provenance commitment manifestSha256')
  if (
    request.commitment.statementType !== COMMITMENT_STATEMENT_TYPE
    || request.commitment.version !== CREATOR_PROVENANCE_REQUEST_VERSION
  ) {
    fail('Creator provenance commitment uses an unsupported statement or version')
  }
  if (request.media.sha256 !== request.commitment.mediaSha256) {
    fail('Creator provenance media hash does not match its commitment')
  }
}

async function assertRequestManifestHash(request) {
  const actual = await sha256HexUtf8(canonicalizeCreatorProvenanceJson(request.manifest))
  if (actual !== request.commitment.manifestSha256) {
    fail('Creator provenance manifest hash does not match its commitment')
  }
}

function deepFreezeJson(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const entry of Object.values(value)) deepFreezeJson(entry)
  return Object.freeze(value)
}

export async function parseCanonicalCreatorProvenanceRequestJson(canonicalRequestJson) {
  if (typeof canonicalRequestJson !== 'string') {
    fail('Creator provenance request JSON must be a string')
  }
  if (textEncoder.encode(canonicalRequestJson).byteLength > CREATOR_PROVENANCE_MAX_PAYLOAD_BYTES) {
    fail(`Creator provenance request exceeds ${CREATOR_PROVENANCE_MAX_PAYLOAD_BYTES} bytes`)
  }

  let request
  try {
    request = JSON.parse(canonicalRequestJson)
  } catch {
    fail('Creator provenance request JSON is not valid JSON')
  }
  assertRequestStructure(request)
  if (canonicalizeCreatorProvenanceJson(request) !== canonicalRequestJson) {
    fail('Creator provenance request must use canonical JSON')
  }
  await assertRequestManifestHash(request)
  return deepFreezeJson(request)
}

function assertCreationOptions(options) {
  assertPlainDataRecord(options, 'Creator provenance options')
  assertExactKeys(options, [], ['nowMilliseconds', 'randomBytes'], 'Creator provenance options')

  const nowMilliseconds = Object.prototype.hasOwnProperty.call(options, 'nowMilliseconds')
    ? options.nowMilliseconds
    : Date.now()
  if (!Number.isSafeInteger(nowMilliseconds) || nowMilliseconds <= 0) {
    fail('Creator provenance nowMilliseconds must be a positive safe integer')
  }
  const now = new Date(nowMilliseconds)
  if (Number.isNaN(now.getTime())) {
    fail('Creator provenance nowMilliseconds must identify a valid date')
  }
  const declaredAt = now.toISOString()

  let randomBytes
  if (Object.prototype.hasOwnProperty.call(options, 'randomBytes')) {
    if (!(options.randomBytes instanceof Uint8Array)) {
      fail('Creator provenance randomBytes must be a Uint8Array')
    }
    randomBytes = Uint8Array.from(options.randomBytes)
  } else {
    if (typeof globalThis.crypto?.getRandomValues !== 'function') {
      throw new Error('Secure browser randomness is unavailable in this environment.')
    }
    randomBytes = new Uint8Array(REQUEST_ENTROPY_BYTES)
    globalThis.crypto.getRandomValues(randomBytes)
  }
  if (randomBytes.byteLength !== REQUEST_ENTROPY_BYTES) {
    fail(`Creator provenance randomBytes must contain exactly ${REQUEST_ENTROPY_BYTES} bytes`)
  }

  const suffix = Array.from(
    randomBytes,
    byte => byte.toString(16).padStart(2, '0')
  ).join('')
  return Object.freeze({
    declaredAt,
    requestId: `request_devnet_${nowMilliseconds}_${suffix}`,
  })
}

function base64UrlUtf8(value) {
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('Browser-safe provenance link encoding is unavailable in this environment.')
  }
  const bytes = textEncoder.encode(value)
  let binary = ''
  const blockSize = 0x8000
  for (let offset = 0; offset < bytes.byteLength; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize))
  }
  return globalThis.btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function issueFragment(canonicalRequestJson) {
  const payloadBytes = textEncoder.encode(canonicalRequestJson).byteLength
  if (payloadBytes > CREATOR_PROVENANCE_MAX_PAYLOAD_BYTES) {
    fail(`Creator provenance request exceeds ${CREATOR_PROVENANCE_MAX_PAYLOAD_BYTES} bytes`)
  }
  const fragment = `#issue/v1/${base64UrlUtf8(canonicalRequestJson)}`
  if (fragment.length > CREATOR_PROVENANCE_MAX_FRAGMENT_CHARACTERS) {
    fail(`Creator provenance fragment exceeds ${CREATOR_PROVENANCE_MAX_FRAGMENT_CHARACTERS} characters`)
  }
  return fragment
}

export async function createCreatorProvenanceReview(inspection, options = {}) {
  const safeInspection = assertInspection(inspection)
  const identity = assertCreationOptions(options)
  const manifest = {
    contract: PROVENANCE_MANIFEST_CONTRACT,
    version: CREATOR_PROVENANCE_REQUEST_VERSION,
    statement: CREATOR_RELATIONSHIP_STATEMENT,
    declaredAt: identity.declaredAt,
    media: {
      byteLength: safeInspection.byteLength,
      mimeType: safeInspection.mimeType,
    },
    lifecycle: {
      contract: PROVENANCE_LIFECYCLE_CONTRACT,
      version: CREATOR_PROVENANCE_REQUEST_VERSION,
      action: 'issue',
    },
  }
  const manifestSha256 = await sha256HexUtf8(canonicalizeCreatorProvenanceJson(manifest))
  const request = {
    contract: PROVENANCE_REQUEST_CONTRACT,
    version: CREATOR_PROVENANCE_REQUEST_VERSION,
    requestId: identity.requestId,
    network: 'devnet',
    media: { sha256: safeInspection.mediaSha256 },
    manifest,
    commitment: {
      mediaSha256: safeInspection.mediaSha256,
      manifestSha256,
      statementType: COMMITMENT_STATEMENT_TYPE,
      version: CREATOR_PROVENANCE_REQUEST_VERSION,
    },
  }
  const canonicalRequestJson = canonicalizeCreatorProvenanceJson(request)
  const validatedRequest = await parseCanonicalCreatorProvenanceRequestJson(canonicalRequestJson)
  const fragment = issueFragment(canonicalRequestJson)

  return Object.freeze({
    request: validatedRequest,
    canonicalRequestJson,
    manifestSha256,
    issueFragment: fragment,
    issueUrl: new URL(fragment, PUBLIC_PROVENANCE_REVIEW_BASE_URL).href,
  })
}
