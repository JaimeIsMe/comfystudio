const { URL } = require('url')

const TEST_PROMPT = 'Reply with exactly: Velorn agent connection OK'
const API_MODES = new Set(['auto', 'responses', 'chat-completions'])
const MAX_CONVERSATION_MESSAGES = 16
const MAX_MESSAGE_CHARS = 12000

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function normalizeConfig(value) {
  const baseUrl = cleanBaseUrl(value?.baseUrl)
  if (!baseUrl) throw new Error('Agent base URL is required.')
  new URL(`${baseUrl}/models`)
  return {
    baseUrl,
    model: String(value?.model || '').trim(),
    apiKey: String(value?.apiKey || '').trim(),
    apiMode: API_MODES.has(value?.apiMode) ? value.apiMode : 'auto',
  }
}

function normalizeConversation(request = {}) {
  const messages = Array.isArray(request.messages) ? request.messages : []
  return {
    systemPrompt: String(request.systemPrompt || '').trim().slice(0, 500000),
    messages: messages
      .filter((message) => ['user', 'assistant'].includes(message?.role) && String(message?.content || '').trim())
      .slice(-MAX_CONVERSATION_MESSAGES)
      .map((message) => ({ role: message.role, content: String(message.content).trim().slice(0, MAX_MESSAGE_CHARS) })),
    maxOutputTokens: Math.min(1600, Math.max(32, Number(request.maxOutputTokens) || 800)),
  }
}

function requestHeaders(config, json = false) {
  const headers = json ? { 'Content-Type': 'application/json' } : {}
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  return headers
}

async function parseResponse(response) {
  const text = await response.text()
  try {
    return { text, payload: text ? JSON.parse(text) : null }
  } catch {
    return { text, payload: null }
  }
}

function responseError(response, result, fallback) {
  return result?.payload?.error?.message || result?.payload?.message || result?.text || fallback || `Agent returned HTTP ${response?.status || 'unknown'}.`
}

function endpointIsUnsupported(response, result) {
  if ([404, 405, 501].includes(response.status)) return true
  const message = responseError(response, result, '').toLowerCase()
  return /(?:endpoint|route|api).*(?:not found|unsupported|not supported)|(?:not found|unsupported|not supported).*(?:endpoint|route|api)|does not support.*(?:responses|chat)/.test(message)
}

async function listOpenAICompatibleModels(config, { signal } = {}) {
  const response = await fetch(`${config.baseUrl}/models`, { headers: requestHeaders(config), signal })
  const result = await parseResponse(response)
  if (!response.ok) throw new Error(responseError(response, result, `Could not discover agent models (HTTP ${response.status}).`))
  const models = Array.isArray(result.payload?.data)
    ? result.payload.data.map((entry) => String(entry?.id || '')).filter(Boolean)
    : []
  if (!models.length) throw new Error('No model is loaded or available at this agent endpoint.')
  return models
}

function extractResponsesText(payload) {
  return payload?.output_text
    || payload?.output?.flatMap((item) => item?.content || [])
      .map((content) => content?.text || content?.value || '')
      .filter(Boolean)
      .join('\n')
    || ''
}

function extractChatText(payload) {
  const content = payload?.choices?.[0]?.message?.content
  if (Array.isArray(content)) return content.map((part) => part?.text || '').filter(Boolean).join('\n')
  return String(content || '')
}

async function requestResponses(config, model, conversation, { signal } = {}) {
  const response = await fetch(`${config.baseUrl}/responses`, {
    method: 'POST',
    headers: requestHeaders(config, true),
    signal,
    body: JSON.stringify({
      model,
      ...(conversation.systemPrompt ? { instructions: conversation.systemPrompt } : {}),
      input: conversation.messages.map((message) => ({ role: message.role, content: message.content })),
      max_output_tokens: conversation.maxOutputTokens,
    }),
  })
  const result = await parseResponse(response)
  if (!response.ok) return { ok: false, response, result }
  const answer = extractResponsesText(result.payload)
  if (!answer) throw new Error('Agent returned no assistant message.')
  return { ok: true, answer, endpoint: 'responses' }
}

async function requestChatCompletions(config, model, conversation, { signal } = {}) {
  const messages = [
    ...(conversation.systemPrompt ? [{ role: 'system', content: conversation.systemPrompt }] : []),
    ...conversation.messages,
  ]
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: requestHeaders(config, true),
    signal,
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
      max_tokens: conversation.maxOutputTokens,
    }),
  })
  const result = await parseResponse(response)
  if (!response.ok) return { ok: false, response, result }
  const answer = extractChatText(result.payload)
  if (!answer) throw new Error('Agent returned no assistant message.')
  return { ok: true, answer, endpoint: 'chat-completions' }
}

async function completeOpenAICompatibleAgent(agent, request = {}, { signal } = {}) {
  const config = normalizeConfig(agent)
  const conversation = normalizeConversation(request)
  if (!conversation.messages.length) throw new Error('A user message is required.')
  const models = await listOpenAICompatibleModels(config, { signal })
  const model = config.model || models[0]
  const modes = config.apiMode === 'auto' ? ['responses', 'chat-completions'] : [config.apiMode]
  let lastFailure = null

  for (const mode of modes) {
    const attempt = mode === 'responses'
      ? await requestResponses(config, model, conversation, { signal })
      : await requestChatCompletions(config, model, conversation, { signal })
    if (attempt.ok) return { answer: attempt.answer, model, endpoint: attempt.endpoint, models }
    lastFailure = attempt
    if (config.apiMode !== 'auto' || !endpointIsUnsupported(attempt.response, attempt.result)) break
  }

  throw new Error(responseError(lastFailure?.response, lastFailure?.result, 'Agent request failed.'))
}

async function testOpenAICompatibleAgent(agent, options = {}) {
  return completeOpenAICompatibleAgent(agent, { messages: [{ role: 'user', content: TEST_PROMPT }], maxOutputTokens: 32 }, options)
}

function createOpenAICompatibleAgent(agent) {
  return Object.freeze({
    provider: 'openai-compatible',
    listModels: (options) => listOpenAICompatibleModels(normalizeConfig(agent), options),
    test: (options) => testOpenAICompatibleAgent(agent, options),
    complete: (request, options) => completeOpenAICompatibleAgent(agent, request, options),
  })
}

const LLM_AGENT_FACTORIES = Object.freeze({
  lmstudio: createOpenAICompatibleAgent,
  codex: createOpenAICompatibleAgent,
  'openai-compatible': createOpenAICompatibleAgent,
})

function createLlmAgent(agent) {
  const factory = LLM_AGENT_FACTORIES[agent?.provider] || LLM_AGENT_FACTORIES['openai-compatible']
  return factory(agent)
}

module.exports = {
  createLlmAgent,
  createOpenAICompatibleAgent,
  listOpenAICompatibleModels,
  completeOpenAICompatibleAgent,
  testOpenAICompatibleAgent,
}
