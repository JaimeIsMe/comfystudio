import assert from 'node:assert/strict'
import test from 'node:test'

import { trapDialogFocus } from './dialogFocus.mjs'

function makeElement(name) {
  return {
    name,
    getAttribute: () => null,
    getClientRects: () => [{}],
    focus() {
      globalThis.document.activeElement = this
    },
  }
}

function makeDialog(elements) {
  return {
    querySelectorAll: () => elements,
    contains: (element) => elements.includes(element),
    focus() {
      globalThis.document.activeElement = this
    },
  }
}

function makeTabEvent({ shiftKey = false } = {}) {
  return {
    key: 'Tab',
    shiftKey,
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
}

test.afterEach(() => {
  delete globalThis.document
})

test('wraps forward Tab from the last control to the first', () => {
  const first = makeElement('first')
  const last = makeElement('last')
  const dialog = makeDialog([first, last])
  globalThis.document = { activeElement: last }
  const event = makeTabEvent()

  assert.equal(trapDialogFocus(event, dialog), true)
  assert.equal(event.prevented, true)
  assert.equal(globalThis.document.activeElement, first)
})

test('wraps Shift+Tab from the first control to the last', () => {
  const first = makeElement('first')
  const last = makeElement('last')
  const dialog = makeDialog([first, last])
  globalThis.document = { activeElement: first }
  const event = makeTabEvent({ shiftKey: true })

  assert.equal(trapDialogFocus(event, dialog), true)
  assert.equal(globalThis.document.activeElement, last)
})

test('keeps focus on a dialog that has no focusable controls', () => {
  const dialog = makeDialog([])
  globalThis.document = { activeElement: null }
  const event = makeTabEvent()

  assert.equal(trapDialogFocus(event, dialog), true)
  assert.equal(globalThis.document.activeElement, dialog)
})
