import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LLM_AGENTS,
  DEFAULT_LLM_AGENT_SETTINGS,
  getEnabledLlmAgents,
  normalizeLlmAgentSettings,
  resolveLlmAgent,
  normalizeLlmAgentConfiguration,
} from './llmAgents.js'

test('LLM agent defaults provide LM Studio and Codex profiles', () => {
  const agents = normalizeLlmAgentSettings()
  assert.deepEqual(agents.map((agent) => agent.id), ['lmstudio', 'codex'])
  assert.equal(agents[0].baseUrl, 'http://127.0.0.1:1234/v1')
  assert.equal(agents[1].baseUrl, 'https://api.openai.com/v1')
  assert.equal(agents[1].model, '')
  assert.equal(agents[1].apiMode, 'auto')
  assert.equal(DEFAULT_LLM_AGENTS[1].enabled, false)
  assert.equal(normalizeLlmAgentConfiguration(DEFAULT_LLM_AGENT_SETTINGS).canvasAgentId, 'lmstudio')
})

test('Canvas selection is application configuration, not part of a Canvas document', () => {
  const configuration = normalizeLlmAgentConfiguration({ agents: [{ id: 'custom', model: 'local' }], canvasAgentId: 'custom' })
  assert.equal(configuration.canvasAgentId, 'custom')
})

test('agent settings normalize URLs and remove duplicate IDs', () => {
  const agents = normalizeLlmAgentSettings([
    { id: 'one', label: 'One', baseUrl: 'http://localhost:1///', model: 'x' },
    { id: 'one', label: 'Duplicate', baseUrl: 'http://localhost:2', model: 'y' },
  ])
  assert.equal(agents.length, 1)
  assert.equal(agents[0].baseUrl, 'http://localhost:1')
  assert.equal(getEnabledLlmAgents([{ id: 'one', enabled: false }]).length, 0)
  assert.equal(resolveLlmAgent(agents, 'one').model, 'x')
})

test('the original Codex preset model migrates to automatic discovery', () => {
  const [agent] = normalizeLlmAgentSettings([{ id: 'codex', provider: 'codex', model: 'gpt-5.3-codex' }])
  assert.equal(agent.model, '')
})
