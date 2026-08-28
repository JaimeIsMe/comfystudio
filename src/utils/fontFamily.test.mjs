import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeFontFamilyName, quoteCssFontFamily } from './fontFamily.js'

test('quotes installed family names containing numeric CSS tokens', () => {
  assert.equal(quoteCssFontFamily('Courier 10 Pitch'), '"Courier 10 Pitch"')
})

test('normalizes pasted outer quotes and control characters', () => {
  assert.equal(normalizeFontFamilyName('  "Avenir Next"\n'), 'Avenir Next')
})

test('escapes quotes and backslashes inside a family name', () => {
  assert.equal(quoteCssFontFamily('A "Quoted" \\ Font'), '"A \\"Quoted\\" \\\\ Font"')
})

test('uses a stable fallback for empty family names', () => {
  assert.equal(quoteCssFontFamily(''), '"Inter"')
})
