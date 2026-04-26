const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'radio',
  'range',
  'reset',
  'submit',
])

export function isTextEditingElement(element) {
  if (!element) return false
  if (element.isContentEditable) return true

  const tagName = String(element.tagName || '').toUpperCase()
  if (tagName === 'TEXTAREA' || tagName === 'SELECT') return true

  if (tagName === 'INPUT') {
    const type = String(element.getAttribute('type') || 'text').toLowerCase()
    return !NON_TEXT_INPUT_TYPES.has(type)
  }

  return false
}
