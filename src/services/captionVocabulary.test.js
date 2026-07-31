import assert from 'node:assert/strict'
import test from 'node:test'

import { buildVocabularyHint } from './captionVocabulary.js'

test('joins parts comma-separated with normalized whitespace', () => {
  assert.equal(
    buildVocabularyHint(['Velorn', '  Seedance   shots ', 'ComfyUI']),
    'Velorn, Seedance shots, ComfyUI'
  )
})

test('drops empties, non-strings, and case-insensitive duplicates', () => {
  assert.equal(
    buildVocabularyHint(['Velorn', '', null, undefined, 'velorn', '  ', 'VELORN', 'Qwen']),
    'Velorn, Qwen'
  )
})

test('ignores default app-planted strings', () => {
  assert.equal(buildVocabularyHint(['Sample Text', 'Velorn']), 'Velorn')
  assert.equal(buildVocabularyHint(['sample   text']), '')
})

test('caps individual items', () => {
  const long = 'A'.repeat(200)
  const hint = buildVocabularyHint([long], { maxItemChars: 10 })
  assert.equal(hint, 'A'.repeat(10))
})

test('stops before the total budget overflows, earlier parts win', () => {
  const hint = buildVocabularyHint(['aaaa', 'bbbb', 'cccc'], { maxTotalChars: 10 })
  // 'aaaa' (4) + ', bbbb' (6) = 10 fits; ', cccc' would make 16.
  assert.equal(hint, 'aaaa, bbbb')
})

test('a single oversize part still respects the item cap under the total cap', () => {
  const hint = buildVocabularyHint(['x'.repeat(600), 'kept'], { maxItemChars: 80, maxTotalChars: 500 })
  assert.equal(hint, `${'x'.repeat(80)}, kept`)
})

test('empty and invalid inputs produce an empty hint', () => {
  assert.equal(buildVocabularyHint([]), '')
  assert.equal(buildVocabularyHint(null), '')
  assert.equal(buildVocabularyHint(undefined), '')
  assert.equal(buildVocabularyHint('not-an-array'), '')
})
