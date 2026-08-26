import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_EDITOR_HOTKEYS,
  EDITOR_HOTKEY_IDS,
  assignEditorHotkeyBinding,
  hotkeyEventToBinding,
  matchEditorHotkey,
  mergeEditorHotkeys,
} from './editorHotkeys.js'

function keyboardEvent({
  key,
  code = '',
  ctrlKey = false,
  metaKey = false,
  altKey = false,
  shiftKey = false,
} = {}) {
  return { key, code, ctrlKey, metaKey, altKey, shiftKey }
}

test('timeline view shortcuts default to frame all on 1 and zoom on 2/3', () => {
  assert.equal(DEFAULT_EDITOR_HOTKEYS[EDITOR_HOTKEY_IDS.FRAME_ALL], '1')
  assert.equal(DEFAULT_EDITOR_HOTKEYS[EDITOR_HOTKEY_IDS.ZOOM_OUT], '2')
  assert.equal(DEFAULT_EDITOR_HOTKEYS[EDITOR_HOTKEY_IDS.ZOOM_IN], '3')
})

test('legacy saved keymaps receive the new timeline view defaults', () => {
  const merged = mergeEditorHotkeys({
    [EDITOR_HOTKEY_IDS.ADD_MARKER]: 'G',
  })

  assert.equal(merged[EDITOR_HOTKEY_IDS.ADD_MARKER], 'G')
  assert.equal(merged[EDITOR_HOTKEY_IDS.FRAME_ALL], '1')
  assert.equal(merged[EDITOR_HOTKEY_IDS.ZOOM_OUT], '2')
  assert.equal(merged[EDITOR_HOTKEY_IDS.ZOOM_IN], '3')
})

test('legacy custom digit assignments win over newly introduced defaults', () => {
  const merged = mergeEditorHotkeys({
    [EDITOR_HOTKEY_IDS.ADD_MARKER]: '1',
    [EDITOR_HOTKEY_IDS.TOGGLE_SNAPPING]: '2',
  })

  assert.equal(merged[EDITOR_HOTKEY_IDS.ADD_MARKER], '1')
  assert.equal(merged[EDITOR_HOTKEY_IDS.TOGGLE_SNAPPING], '2')
  assert.equal(merged[EDITOR_HOTKEY_IDS.FRAME_ALL], '')
  assert.equal(merged[EDITOR_HOTKEY_IDS.ZOOM_OUT], '')
  assert.equal(merged[EDITOR_HOTKEY_IDS.ZOOM_IN], '3')
})

test('explicit timeline view assignments remain authoritative', () => {
  const merged = mergeEditorHotkeys({
    [EDITOR_HOTKEY_IDS.FRAME_ALL]: '4',
    [EDITOR_HOTKEY_IDS.ZOOM_OUT]: '',
    [EDITOR_HOTKEY_IDS.ZOOM_IN]: 'Ctrl+3',
  })

  assert.equal(merged[EDITOR_HOTKEY_IDS.FRAME_ALL], '4')
  assert.equal(merged[EDITOR_HOTKEY_IDS.ZOOM_OUT], '')
  assert.equal(merged[EDITOR_HOTKEY_IDS.ZOOM_IN], 'Ctrl+3')
})

test('assigning or restoring a binding clears the previous configurable owner', () => {
  const legacy = mergeEditorHotkeys({
    [EDITOR_HOTKEY_IDS.ADD_MARKER]: '1',
  })
  const reassigned = assignEditorHotkeyBinding(
    legacy,
    EDITOR_HOTKEY_IDS.FRAME_ALL,
    DEFAULT_EDITOR_HOTKEYS[EDITOR_HOTKEY_IDS.FRAME_ALL],
  )

  assert.equal(reassigned[EDITOR_HOTKEY_IDS.ADD_MARKER], '')
  assert.equal(reassigned[EDITOR_HOTKEY_IDS.FRAME_ALL], '1')
})

test('numeric bindings match top-row and numpad keys without modifiers', () => {
  assert.equal(matchEditorHotkey(keyboardEvent({ key: '3', code: 'Digit3' }), '3'), true)
  assert.equal(matchEditorHotkey(keyboardEvent({ key: '3', code: 'Numpad3' }), '3'), true)
  assert.equal(matchEditorHotkey(keyboardEvent({ key: '3', code: 'Digit3', shiftKey: true }), '3'), false)
})

test('physical number-row keys stay stable across keyboard layouts', () => {
  const nonUsDigitEvent = keyboardEvent({ key: '&', code: 'Digit1' })

  assert.equal(hotkeyEventToBinding(nonUsDigitEvent), '1')
  assert.equal(matchEditorHotkey(nonUsDigitEvent, '1'), true)
  assert.equal(matchEditorHotkey(nonUsDigitEvent, '&'), true)
})
