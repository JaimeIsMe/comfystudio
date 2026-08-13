import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { interpolate, normalizeLocale, resolveLanguage, translate } from './core.js'

function leafKeys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return child && typeof child === 'object' ? leafKeys(child, path) : [path]
  })
}

function placeholders(message) {
  return [...String(message).matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].map((match) => match[1]).sort()
}

test('normalizes browser locales and the jp alias', () => {
  assert.equal(normalizeLocale('ja-JP'), 'ja')
  assert.equal(normalizeLocale('jp'), 'ja')
  assert.equal(normalizeLocale('pt_BR'), 'pt')
})

test('falls back to English for unavailable languages and missing messages', () => {
  const languages = [{ code: 'en' }, { code: 'ja' }]
  assert.equal(resolveLanguage('fr-FR', languages), 'en')
  assert.equal(translate({ en: { action: 'Save' }, ja: {} }, 'ja', 'action'), 'Save')
})

test('interpolates named values without removing unknown placeholders', () => {
  assert.equal(interpolate('Hello {{name}} {{missing}}', { name: 'Velorn' }), 'Hello Velorn {{missing}}')
})

test('Japanese dictionary has the same keys and placeholders as English', () => {
  const english = JSON.parse(readFileSync(new URL('../../public/lang/lang_en.json', import.meta.url), 'utf8'))
  const japanese = JSON.parse(readFileSync(new URL('../../public/lang/lang_jp.json', import.meta.url), 'utf8'))
  const englishKeys = leafKeys(english).sort()
  const japaneseKeys = leafKeys(japanese).sort()
  assert.deepEqual(japaneseKeys, englishKeys)
  for (const key of englishKeys) {
    assert.deepEqual(placeholders(getNestedValueForTest(japanese, key)), placeholders(getNestedValueForTest(english, key)), key)
  }
})

test('ComfyUI workflow names and categories remain in English', () => {
  const english = JSON.parse(readFileSync(new URL('../../public/lang/lang_en.json', import.meta.url), 'utf8'))
  const japanese = JSON.parse(readFileSync(new URL('../../public/lang/lang_jp.json', import.meta.url), 'utf8'))
  const protectedPaths = [
    'workflowsPanel.categories.ImagetoVideo',
    'workflowsPanel.categories.TexttoImage',
    'workflowsPanel.categories.ImagetoImage',
    ...Object.keys(english.workflowsPanel.items).map((id) => `workflowsPanel.items.${id}.name`),
  ]
  for (const path of protectedPaths) {
    assert.equal(getNestedValueForTest(japanese, path), getNestedValueForTest(english, path), path)
  }
})

test('Effects GUI dictionaries cover stable transition and effect ids', () => {
  const english = JSON.parse(readFileSync(new URL('../../public/lang/lang_en.json', import.meta.url), 'utf8'))
  const transitionSource = readFileSync(new URL('../constants/transitions.js', import.meta.url), 'utf8')
  const effectSource = readFileSync(new URL('../utils/effects.js', import.meta.url), 'utf8')

  const transitionIds = [...transitionSource.matchAll(/\{ id: '([^']+)', name:/g)]
    .map((match) => match[1])
    .sort()
  assert.deepEqual(Object.keys(english.effectsPanel.transitions.items).sort(), transitionIds)

  const pickerDefinitionSource = effectSource
    .split('const EFFECT_PICKER_CATEGORY_DEFINITIONS')[1]
    .split('export const EFFECT_PICKER_GROUPS')[0]
  const pickerEffectIds = [...pickerDefinitionSource.matchAll(/effectIds:\s*\[([^\]]+)\]/g)]
    .flatMap((match) => [...match[1].matchAll(/'([^']+)'/g)].map((idMatch) => idMatch[1]))
    .sort()
  assert.deepEqual(Object.keys(english.effectsPanel.catalog).sort(), pickerEffectIds)
})

test('Effects product and film-stock preset names remain unchanged', () => {
  const english = JSON.parse(readFileSync(new URL('../../public/lang/lang_en.json', import.meta.url), 'utf8'))
  const japanese = JSON.parse(readFileSync(new URL('../../public/lang/lang_jp.json', import.meta.url), 'utf8'))
  const protectedPaths = [
    'effectsPanel.catalog.glslFilmGrain.presets.fine5245',
    'effectsPanel.catalog.glslFilmGrain.presets.vision500t',
    'effectsPanel.catalog.glslFilmLook.presets.kodak2395',
    'effectsPanel.catalog.glslFilmLook.presets.agfa1978',
    'effectsPanel.catalog.glslFilmLook.presets.polaroid',
  ]
  for (const path of protectedPaths) {
    assert.equal(getNestedValueForTest(japanese, path), getNestedValueForTest(english, path), path)
  }
})

test('ComfyUI launcher technical values remain literal and outside translations', () => {
  const source = readFileSync(new URL('../components/ComfyLauncherSettingsSection.jsx', import.meta.url), 'utf8')
  assert.match(source, /placeholder="e\.g\. --listen 127\.0\.0\.1 --port 8188"/)
  assert.match(source, />--disable-auto-launch</)
  assert.match(source, />\/system_stats</)
  assert.match(source, /'http:\/\/127\.0\.0\.1:8188'/)
})

test('Hotkey action dictionaries cover stable ids without translating bindings', () => {
  const english = JSON.parse(readFileSync(new URL('../../public/lang/lang_en.json', import.meta.url), 'utf8'))
  const source = readFileSync(new URL('../services/editorHotkeys.js', import.meta.url), 'utf8')
  const idEntries = [...source.matchAll(/^\s+([A-Z_]+): '([^']+)',?$/gm)]
  for (const [, , id] of idEntries) {
    assert.equal(typeof getNestedValueForTest(english.settings.hotkeys.actions, id), 'string', id)
  }
  assert.match(source, /defaultBinding: 'Ctrl\+Shift\+M'/)
  assert.match(source, /defaultBinding: 'Shift\+ArrowDown'/)
})

function getNestedValueForTest(dictionary, key) {
  return key.split('.').reduce((value, part) => value[part], dictionary)
}
