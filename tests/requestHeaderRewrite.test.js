const assert = require('node:assert/strict')
const test = require('node:test')

const {
  YOUTUBE_EMBED_APP_REFERER,
  rewriteAppRequestHeaders,
} = require('../electron/requestHeaderRewrite')

test('keeps the existing loopback ComfyUI header rewrite', () => {
  const headers = rewriteAppRequestHeaders({
    url: 'ws://127.0.0.1:8188/ws',
    requestHeaders: {
      Origin: 'file://',
      'Sec-Fetch-Site': 'cross-site',
      Accept: '*/*',
    },
  })

  assert.equal(headers.Origin, 'http://127.0.0.1:8188')
  assert.equal(headers['Sec-Fetch-Site'], 'same-origin')
  assert.equal(headers.Accept, '*/*')
})

test('adds the required app Referer only to YouTube embed documents', () => {
  const headers = rewriteAppRequestHeaders({
    url: 'https://www.youtube-nocookie.com/embed/RVuGlRZheps?autoplay=0',
    requestHeaders: { Accept: 'text/html' },
  })

  assert.equal(headers.Referer, YOUTUBE_EMBED_APP_REFERER)
  assert.equal(headers.Accept, 'text/html')
})

test('replaces a case-insensitive existing YouTube Referer', () => {
  const headers = rewriteAppRequestHeaders({
    url: 'https://www.youtube.com/embed/RVuGlRZheps',
    requestHeaders: { referer: 'file://' },
  })

  assert.deepEqual(headers, { referer: YOUTUBE_EMBED_APP_REFERER })
})

test('does not add identity headers to unrelated remote requests', () => {
  const original = { Accept: 'application/json' }
  const headers = rewriteAppRequestHeaders({
    url: 'https://velorn.ai/discover/catalog.json',
    requestHeaders: original,
  })

  assert.deepEqual(headers, original)
  assert.notEqual(headers, original)
})

test('leaves malformed request URLs unchanged', () => {
  assert.deepEqual(
    rewriteAppRequestHeaders({ url: 'not a URL', requestHeaders: { Accept: '*/*' } }),
    { Accept: '*/*' }
  )
})
