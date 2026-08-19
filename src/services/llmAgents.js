export const LLM_AGENTS_SETTING_KEY = 'llmAgents'

export const LLM_AGENT_PROVIDER_PRESETS = Object.freeze({
  lmstudio: Object.freeze({
    provider: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: '',
  }),
  codex: Object.freeze({
    provider: 'codex',
    label: 'Codex / OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
  }),
})

export const DEFAULT_LLM_AGENTS = Object.freeze([
  { id: 'lmstudio', ...LLM_AGENT_PROVIDER_PRESETS.lmstudio, apiKey: '', enabled: true },
  { id: 'codex', ...LLM_AGENT_PROVIDER_PRESETS.codex, apiKey: '', enabled: false },
])

export const DEFAULT_LLM_AGENT_SETTINGS = Object.freeze({
  agents: DEFAULT_LLM_AGENTS,
  canvasAgentId: 'lmstudio',
})

export function normalizeLlmAgent(agent, index = 0) {
  const preset = LLM_AGENT_PROVIDER_PRESETS[agent?.provider] || {}
  // The first Codex preset used this value before model discovery existed.
  // It was never a user choice, so migrate it back to automatic discovery.
  const legacyDefaultModel = agent?.provider === 'codex' && agent?.model === 'gpt-5.3-codex'
  return {
    id: String(agent?.id || `agent-${index + 1}`),
    provider: String(agent?.provider || 'openai-compatible'),
    label: String(agent?.label || preset.label || `Agent ${index + 1}`),
    baseUrl: String(agent?.baseUrl || preset.baseUrl || 'http://127.0.0.1:1234/v1').replace(/\/+$/, ''),
    model: legacyDefaultModel ? '' : String(agent?.model || preset.model || ''),
    apiMode: ['auto', 'responses', 'chat-completions'].includes(agent?.apiMode) ? agent.apiMode : 'auto',
    apiKey: String(agent?.apiKey || ''),
    enabled: agent?.enabled !== false,
  }
}

export function normalizeLlmAgentSettings(value) {
  const sourceAgents = Array.isArray(value) ? value : value?.agents
  const agents = Array.isArray(sourceAgents) && sourceAgents.length
    ? sourceAgents.map(normalizeLlmAgent)
    : DEFAULT_LLM_AGENTS.map(normalizeLlmAgent)
  const unique = []
  const ids = new Set()
  for (const agent of agents) {
    if (ids.has(agent.id)) continue
    ids.add(agent.id)
    unique.push(agent)
  }
  return unique
}

export function normalizeLlmAgentConfiguration(value) {
  const agents = normalizeLlmAgentSettings(value)
  const requestedId = String(value?.canvasAgentId || '')
  return {
    agents,
    canvasAgentId: agents.some((agent) => agent.id === requestedId)
      ? requestedId
      : (agents.find((agent) => agent.enabled)?.id || agents[0]?.id || ''),
  }
}

export function getEnabledLlmAgents(value) {
  return normalizeLlmAgentSettings(value).filter((agent) => agent.enabled)
}

export function resolveLlmAgent(value, id) {
  return normalizeLlmAgentSettings(value).find((agent) => agent.id === id) || null
}
