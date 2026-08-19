const test = require('node:test')
const assert = require('node:assert/strict')
const { createLlmAgent } = require('../electron/llmAgents')

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

test('OpenAI-compatible agents use the first discovered model and Responses by default', async () => {
  const originalFetch = global.fetch
  const calls = []
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/models')) return jsonResponse(200, { data: [{ id: 'first-model' }, { id: 'second-model' }] })
    if (url.endsWith('/responses')) return jsonResponse(200, { output_text: 'Velorn agent connection OK' })
    throw new Error(`Unexpected URL: ${url}`)
  }
  try {
    const result = await createLlmAgent({ baseUrl: 'http://agent.test/v1', provider: 'openai-compatible' }).test()
    assert.equal(result.model, 'first-model')
    assert.equal(result.endpoint, 'responses')
    assert.deepEqual(calls.map((call) => call.url), ['http://agent.test/v1/models', 'http://agent.test/v1/responses'])
  } finally {
    global.fetch = originalFetch
  }
})

test('OpenAI-compatible agents fall back to Chat Completions only if Responses is unsupported', async () => {
  const originalFetch = global.fetch
  const calls = []
  global.fetch = async (url) => {
    calls.push(url)
    if (url.endsWith('/models')) return jsonResponse(200, { data: [{ id: 'local-model' }] })
    if (url.endsWith('/responses')) return jsonResponse(404, { error: { message: 'Responses endpoint not supported.' } })
    if (url.endsWith('/chat/completions')) return jsonResponse(200, { choices: [{ message: { content: 'Velorn agent connection OK' } }] })
    throw new Error(`Unexpected URL: ${url}`)
  }
  try {
    const result = await createLlmAgent({ baseUrl: 'http://agent.test/v1', provider: 'lmstudio' }).test()
    assert.equal(result.model, 'local-model')
    assert.equal(result.endpoint, 'chat-completions')
    assert.deepEqual(calls, ['http://agent.test/v1/models', 'http://agent.test/v1/responses', 'http://agent.test/v1/chat/completions'])
  } finally {
    global.fetch = originalFetch
  }
})

test('OpenAI-compatible completion carries the supplied Canvas Chat instructions and history', async () => {
  const originalFetch = global.fetch
  const calls = []
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/models')) return jsonResponse(200, { data: [{ id: 'canvas-model' }] })
    if (url.endsWith('/responses')) return jsonResponse(200, { output_text: 'I can see the Canvas.' })
    throw new Error(`Unexpected URL: ${url}`)
  }
  try {
    const result = await createLlmAgent({ baseUrl: 'http://agent.test/v1' }).complete({
      systemPrompt: 'Canvas context with available block capabilities.',
      messages: [{ role: 'user', content: 'What shots exist?' }, { role: 'assistant', content: 'I will inspect them.' }, { role: 'user', content: 'Continue.' }],
    })
    const request = JSON.parse(calls[1].options.body)
    assert.equal(result.answer, 'I can see the Canvas.')
    assert.equal(request.instructions, 'Canvas context with available block capabilities.')
    assert.deepEqual(request.input.map((message) => message.role), ['user', 'assistant', 'user'])
  } finally {
    global.fetch = originalFetch
  }
})
