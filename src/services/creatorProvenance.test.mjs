import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  CREATOR_PROVENANCE_MAX_FRAGMENT_CHARACTERS,
  CREATOR_PROVENANCE_MAX_PAYLOAD_BYTES,
  PUBLIC_PROVENANCE_REVIEW_BASE_URL,
  canonicalizeCreatorProvenanceJson,
  createCreatorProvenanceReview,
  isProvenanceEligibleExport,
  parseCanonicalCreatorProvenanceRequestJson,
} from './creatorProvenance.mjs'

const MEDIA_SHA256 =
  'f24204e5f7a75d5d95a3f6b4357becf64b014e1f85cfc3bf3f9b19e2f3e8c573'
const NOW_MILLISECONDS = 1_788_091_200_000
const RANDOM_BYTES = Uint8Array.from([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
  0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
])
const EXPECTED_MANIFEST_SHA256 =
  'dedabc07ad217b1740a07466db5b06785cfbe614c452d5ef32ccabf890b9715f'
const EXPECTED_CANONICAL_REQUEST =
  '{"commitment":{"manifestSha256":"dedabc07ad217b1740a07466db5b06785cfbe614c452d5ef32ccabf890b9715f","mediaSha256":"f24204e5f7a75d5d95a3f6b4357becf64b014e1f85cfc3bf3f9b19e2f3e8c573","statementType":"creator_media_commitment_v1","version":1},"contract":"velorn.creator-provenance.request","manifest":{"contract":"velorn.creator-provenance.manifest","declaredAt":"2026-08-30T12:00:00.000Z","lifecycle":{"action":"issue","contract":"velorn.creator-provenance.lifecycle","version":1},"media":{"byteLength":"123","mimeType":"video/mp4"},"statement":"wallet_asserted_creator_relationship","version":1},"media":{"sha256":"f24204e5f7a75d5d95a3f6b4357becf64b014e1f85cfc3bf3f9b19e2f3e8c573"},"network":"devnet","requestId":"request_devnet_1788091200000_000102030405060708090a0b","version":1}'
const EXPECTED_FRAGMENT =
  '#issue/v1/eyJjb21taXRtZW50Ijp7Im1hbmlmZXN0U2hhMjU2IjoiZGVkYWJjMDdhZDIxN2IxNzQwYTA3NDY2ZGI1YjA2Nzg1Y2ZiZTYxNGM0NTJkNWVmMzJjY2FiZjg5MGI5NzE1ZiIsIm1lZGlhU2hhMjU2IjoiZjI0MjA0ZTVmN2E3NWQ1ZDk1YTNmNmI0MzU3YmVjZjY0YjAxNGUxZjg1Y2ZjM2JmM2Y5YjE5ZTJmM2U4YzU3MyIsInN0YXRlbWVudFR5cGUiOiJjcmVhdG9yX21lZGlhX2NvbW1pdG1lbnRfdjEiLCJ2ZXJzaW9uIjoxfSwiY29udHJhY3QiOiJ2ZWxvcm4uY3JlYXRvci1wcm92ZW5hbmNlLnJlcXVlc3QiLCJtYW5pZmVzdCI6eyJjb250cmFjdCI6InZlbG9ybi5jcmVhdG9yLXByb3ZlbmFuY2UubWFuaWZlc3QiLCJkZWNsYXJlZEF0IjoiMjAyNi0wOC0zMFQxMjowMDowMC4wMDBaIiwibGlmZWN5Y2xlIjp7ImFjdGlvbiI6Imlzc3VlIiwiY29udHJhY3QiOiJ2ZWxvcm4uY3JlYXRvci1wcm92ZW5hbmNlLmxpZmVjeWNsZSIsInZlcnNpb24iOjF9LCJtZWRpYSI6eyJieXRlTGVuZ3RoIjoiMTIzIiwibWltZVR5cGUiOiJ2aWRlby9tcDQifSwic3RhdGVtZW50Ijoid2FsbGV0X2Fzc2VydGVkX2NyZWF0b3JfcmVsYXRpb25zaGlwIiwidmVyc2lvbiI6MX0sIm1lZGlhIjp7InNoYTI1NiI6ImYyNDIwNGU1ZjdhNzVkNWQ5NWEzZjZiNDM1N2JlY2Y2NGIwMTRlMWY4NWNmYzNiZjNmOWIxOWUyZjNlOGM1NzMifSwibmV0d29yayI6ImRldm5ldCIsInJlcXVlc3RJZCI6InJlcXVlc3RfZGV2bmV0XzE3ODgwOTEyMDAwMDBfMDAwMTAyMDMwNDA1MDYwNzA4MDkwYTBiIiwidmVyc2lvbiI6MX0'

const createFixtureReview = () => createCreatorProvenanceReview({
  outputPath: '/exports/Velorn Fixture.mp4',
  format: 'mp4',
  byteLength: 123,
  mediaSha256: MEDIA_SHA256,
}, {
  nowMilliseconds: NOW_MILLISECONDS,
  randomBytes: RANDOM_BYTES,
})

test('matches the provenance repository v1 no-profile request and issue-link bytes', async () => {
  const review = await createFixtureReview()

  assert.equal(PUBLIC_PROVENANCE_REVIEW_BASE_URL, 'https://velornlabs.github.io/velorn-creator-provenance/')
  assert.equal(review.manifestSha256, EXPECTED_MANIFEST_SHA256)
  assert.equal(review.canonicalRequestJson, EXPECTED_CANONICAL_REQUEST)
  assert.equal(review.issueFragment, EXPECTED_FRAGMENT)
  assert.equal(review.issueUrl, `${PUBLIC_PROVENANCE_REVIEW_BASE_URL}${EXPECTED_FRAGMENT}`)
  assert.match(review.issueFragment, /^#issue\/v1\/[A-Za-z0-9_-]+$/)
  assert.doesNotMatch(review.issueFragment, /=/)
  assert.equal(Buffer.byteLength(review.canonicalRequestJson), 779)
  assert.equal(review.issueFragment.length, 1049)
  assert.equal(review.issueUrl.length, 1104)
  assert.equal(
    createHash('sha256').update(review.canonicalRequestJson).digest('hex'),
    'a79630dd9bca6052dfb064680095be8394982ab24bdb837a38472ba8f559a466'
  )
  assert.equal(
    createHash('sha256').update(review.issueFragment).digest('hex'),
    '406220c69e58c41efa4084c386b2c67b0625b7c4006f0f8c16c2ff0e3e0b4e40'
  )
})

test('returns the strict frozen no-profile public request without local export details', async () => {
  const review = await createFixtureReview()

  assert.deepEqual(review.request, {
    contract: 'velorn.creator-provenance.request',
    version: 1,
    requestId: 'request_devnet_1788091200000_000102030405060708090a0b',
    network: 'devnet',
    media: { sha256: MEDIA_SHA256 },
    manifest: {
      contract: 'velorn.creator-provenance.manifest',
      version: 1,
      statement: 'wallet_asserted_creator_relationship',
      declaredAt: '2026-08-30T12:00:00.000Z',
      media: { byteLength: '123', mimeType: 'video/mp4' },
      lifecycle: {
        contract: 'velorn.creator-provenance.lifecycle',
        version: 1,
        action: 'issue',
      },
    },
    commitment: {
      mediaSha256: MEDIA_SHA256,
      manifestSha256: EXPECTED_MANIFEST_SHA256,
      statementType: 'creator_media_commitment_v1',
      version: 1,
    },
  })
  assert.equal(Object.isFrozen(review), true)
  assert.equal(Object.isFrozen(review.request), true)
  assert.equal(Object.isFrozen(review.request.manifest.media), true)
  assert.doesNotMatch(
    review.canonicalRequestJson,
    /Velorn Fixture|\/exports|outputPath|file(?:name)?|localPath|project|prompt/i
  )
})

test('recognizes only finished single-file MP4 and ProRes MOV exports', () => {
  assert.equal(isProvenanceEligibleExport({ outputPath: '/exports/final.mp4', format: 'mp4' }), true)
  assert.equal(isProvenanceEligibleExport({ outputPath: 'C:\\Exports\\FINAL.MP4', format: 'mp4' }), true)
  assert.equal(isProvenanceEligibleExport({ outputPath: '/exports/master.MOV', format: 'prores' }), true)
  assert.equal(isProvenanceEligibleExport({ outputPath: '\\\\server\\share\\master.mov', format: 'prores' }), true)

  for (const value of [
    { outputPath: 'relative/final.mp4', format: 'mp4' },
    { outputPath: '/exports/final.mov', format: 'mp4' },
    { outputPath: '/exports/final.mp4', format: 'prores' },
    { outputPath: '/exports/final.mov', format: 'mov' },
    { outputPath: '/exports/final.webm', format: 'webm' },
    { outputPath: '/exports/final.gif', format: 'gif' },
    { outputPath: '/exports/frames', format: 'png-seq' },
    { outputPath: '/exports/audio.wav', format: 'audio' },
    { outputPath: ' /exports/final.mp4', format: 'mp4' },
    null,
  ]) {
    assert.equal(isProvenanceEligibleExport(value), false)
  }
})

test('accepts canonical decimal byte strings and derives the MOV MIME type', async () => {
  const review = await createCreatorProvenanceReview({
    outputPath: 'D:\\Exports\\Master.MOV',
    format: 'prores',
    byteLength: '18446744073709551615',
    mediaSha256: MEDIA_SHA256,
    mimeType: 'video/quicktime',
  }, {
    nowMilliseconds: NOW_MILLISECONDS,
    randomBytes: RANDOM_BYTES,
  })

  assert.equal(review.request.manifest.media.byteLength, '18446744073709551615')
  assert.equal(review.request.manifest.media.mimeType, 'video/quicktime')
})

test('strictly rejects malformed or privacy-expanding inspections', async () => {
  const base = {
    outputPath: '/exports/final.mp4',
    format: 'mp4',
    byteLength: 123,
    mediaSha256: MEDIA_SHA256,
  }
  const invalid = [
    { ...base, filename: 'final.mp4' },
    { ...base, localPath: '/private/project' },
    { ...base, project: 'secret project' },
    { ...base, prompt: 'private prompt' },
    { ...base, outputPath: 'relative.mp4' },
    { ...base, format: 'webm', outputPath: '/exports/final.webm' },
    { ...base, byteLength: 0 },
    { ...base, byteLength: 1.5 },
    { ...base, byteLength: '00123' },
    { ...base, byteLength: '18446744073709551616' },
    { ...base, mediaSha256: MEDIA_SHA256.toUpperCase() },
    { ...base, mimeType: 'video/quicktime' },
  ]

  for (const inspection of invalid) {
    await assert.rejects(
      createCreatorProvenanceReview(inspection, {
        nowMilliseconds: NOW_MILLISECONDS,
        randomBytes: RANDOM_BYTES,
      }),
      /Provenance|provenance/
    )
  }
})

test('strictly validates deterministic clock and entropy options', async () => {
  const inspection = {
    outputPath: '/exports/final.mp4',
    format: 'mp4',
    byteLength: 123,
    mediaSha256: MEDIA_SHA256,
  }
  for (const options of [
    { nowMilliseconds: 0, randomBytes: RANDOM_BYTES },
    { nowMilliseconds: NOW_MILLISECONDS + 0.5, randomBytes: RANDOM_BYTES },
    { nowMilliseconds: Number.MAX_SAFE_INTEGER, randomBytes: RANDOM_BYTES },
    { nowMilliseconds: NOW_MILLISECONDS, randomBytes: new Uint8Array(11) },
    { nowMilliseconds: NOW_MILLISECONDS, randomBytes: Array.from(RANDOM_BYTES) },
    { nowMilliseconds: NOW_MILLISECONDS, randomBytes: RANDOM_BYTES, prompt: 'no' },
  ]) {
    await assert.rejects(createCreatorProvenanceReview(inspection, options), /provenance/i)
  }
})

test('canonical parser rejects alternate bytes, tampering, and unsupported public fields', async () => {
  const review = await createFixtureReview()
  assert.deepEqual(
    await parseCanonicalCreatorProvenanceRequestJson(review.canonicalRequestJson),
    review.request
  )
  const reorderedRequestJson = JSON.stringify({
    contract: review.request.contract,
    version: review.request.version,
    requestId: review.request.requestId,
    network: review.request.network,
    media: review.request.media,
    manifest: review.request.manifest,
    commitment: review.request.commitment,
  })
  assert.notEqual(reorderedRequestJson, review.canonicalRequestJson)
  await assert.rejects(
    parseCanonicalCreatorProvenanceRequestJson(reorderedRequestJson),
    /canonical JSON/
  )
  await assert.rejects(
    parseCanonicalCreatorProvenanceRequestJson(`${review.canonicalRequestJson}\n`),
    /canonical JSON/
  )

  const tamperedHash = {
    ...review.request,
    commitment: { ...review.request.commitment, mediaSha256: '0'.repeat(64) },
  }
  await assert.rejects(
    parseCanonicalCreatorProvenanceRequestJson(
      canonicalizeCreatorProvenanceJson(tamperedHash)
    ),
    /media hash does not match/
  )

  const privateField = {
    ...review.request,
    manifest: { ...review.request.manifest, localPath: '/private/final.mp4' },
  }
  await assert.rejects(
    parseCanonicalCreatorProvenanceRequestJson(
      canonicalizeCreatorProvenanceJson(privateField)
    ),
    /unsupported property localPath/
  )

  const profileField = {
    ...review.request,
    manifest: {
      ...review.request.manifest,
      profile: {
        contract: 'velorn.creator-profile',
        version: 1,
        displayName: 'Not part of the first Velorn adapter',
      },
    },
  }
  await assert.rejects(
    parseCanonicalCreatorProvenanceRequestJson(
      canonicalizeCreatorProvenanceJson(profileField)
    ),
    /unsupported property profile/
  )

  for (const unsupportedHeader of [
    { ...review.request, network: 'mainnet' },
    { ...review.request, version: 2 },
  ]) {
    await assert.rejects(
      parseCanonicalCreatorProvenanceRequestJson(
        canonicalizeCreatorProvenanceJson(unsupportedHeader)
      ),
      /Devnet|unsupported contract or version/
    )
  }

  const changedManifest = {
    ...review.request,
    manifest: {
      ...review.request.manifest,
      media: { ...review.request.manifest.media, byteLength: '124' },
    },
  }
  await assert.rejects(
    parseCanonicalCreatorProvenanceRequestJson(
      canonicalizeCreatorProvenanceJson(changedManifest)
    ),
    /manifest hash does not match/
  )
})

test('keeps the independent v1 payload and fragment limits', async () => {
  assert.equal(CREATOR_PROVENANCE_MAX_PAYLOAD_BYTES, 6_000)
  assert.equal(CREATOR_PROVENANCE_MAX_FRAGMENT_CHARACTERS, 8_192)
  await assert.rejects(
    parseCanonicalCreatorProvenanceRequestJson(' '.repeat(6_001)),
    /exceeds 6000 bytes/
  )
})

test('canonicalizer is recursive, lexicographic, and rejects ambiguous objects', () => {
  assert.equal(
    canonicalizeCreatorProvenanceJson({ z: [3, { b: true, a: null }], a: 'first' }),
    '{"a":"first","z":[3,{"a":null,"b":true}]}'
  )
  assert.throws(
    () => canonicalizeCreatorProvenanceJson({ value: undefined }),
    /must not be undefined/
  )
  const cyclic = {}
  cyclic.self = cyclic
  assert.throws(() => canonicalizeCreatorProvenanceJson(cyclic), /must not be cyclic/)

  let accessorReads = 0
  const accessor = {}
  Object.defineProperty(accessor, 'secret', {
    enumerable: true,
    get() {
      accessorReads += 1
      return 'private'
    },
  })
  assert.throws(
    () => canonicalizeCreatorProvenanceJson(accessor),
    /enumerable data properties/
  )
  assert.equal(accessorReads, 0)
})
