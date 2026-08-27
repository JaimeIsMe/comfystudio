const YOUTUBE_EMBED_APP_REFERER = 'https://com.comfystudio.app/'

const REQUEST_HEADER_REWRITE_URLS = Object.freeze([
  'http://127.0.0.1/*',
  'http://localhost/*',
  'ws://127.0.0.1/*',
  'ws://localhost/*',
  'https://www.youtube-nocookie.com/embed/*',
  'https://www.youtube.com/embed/*',
])

function setHeader(headers, name, value) {
  const existingKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())
  headers[existingKey || name] = value
}

function isLoopbackRequest(target) {
  return (
    (target.protocol === 'http:' || target.protocol === 'ws:')
    && (target.hostname === '127.0.0.1' || target.hostname === 'localhost')
  )
}

function isYouTubeEmbedRequest(target) {
  if (target.protocol !== 'https:') return false
  if (target.hostname !== 'www.youtube.com' && target.hostname !== 'www.youtube-nocookie.com') return false
  return target.pathname.startsWith('/embed/')
}

function rewriteAppRequestHeaders(details = {}) {
  const headers = { ...(details.requestHeaders || {}) }

  let target
  try {
    target = new URL(String(details.url || ''))
  } catch {
    return headers
  }

  if (isLoopbackRequest(target)) {
    // WebSocket handshakes carry an http(s) Origin, not ws(s).
    const scheme = target.protocol === 'ws:' ? 'http:' : target.protocol
    const originValue = `${scheme}//${target.host}`
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase()
      if (lower === 'origin') headers[key] = originValue
      else if (lower === 'sec-fetch-site') headers[key] = 'same-origin'
    }
  }

  if (isYouTubeEmbedRequest(target)) {
    // YouTube requires embedded desktop players to identify their API client
    // with an HTTPS Referer. Packaged Electron pages load from file:// and do
    // not produce one automatically, which otherwise yields player error 153.
    setHeader(headers, 'Referer', YOUTUBE_EMBED_APP_REFERER)
  }

  return headers
}

module.exports = {
  REQUEST_HEADER_REWRITE_URLS,
  YOUTUBE_EMBED_APP_REFERER,
  isLoopbackRequest,
  isYouTubeEmbedRequest,
  rewriteAppRequestHeaders,
}
