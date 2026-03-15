/**
 * MiniMax Cloud LLM Service
 * Handles communication with MiniMax's OpenAI-compatible API
 *
 * API documentation: https://platform.minimaxi.com/document/introduction
 * Base URL: https://api.minimax.io/v1
 */

const MINIMAX_BASE = 'https://api.minimax.io/v1'

const MINIMAX_MODELS = [
  { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', context_length: 204800 },
  { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax M2.5 Highspeed', context_length: 204800 },
]

class MiniMaxService {
  constructor() {
    this.baseUrl = MINIMAX_BASE
    this.apiKey = null
  }

  /**
   * Set API key for authentication
   */
  setApiKey(key) {
    this.apiKey = key
  }

  /**
   * Get headers for API requests
   */
  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    }
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }
    return headers
  }

  /**
   * Check if MiniMax API is reachable with the configured API key
   */
  async checkConnection() {
    if (!this.apiKey) return false
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: this.getHeaders(),
      })
      return response.ok
    } catch (error) {
      return false
    }
  }

  /**
   * List available MiniMax models
   */
  async listModels() {
    return MINIMAX_MODELS.map(m => ({
      id: m.id,
      type: 'cloud',
      state: 'loaded',
      max_context_length: m.context_length,
    }))
  }

  /**
   * Send a chat completion request
   * @param {string} modelId - Model identifier
   * @param {Array} messages - Array of {role, content} messages
   * @param {object} options - Generation options (temperature, max_tokens, etc.)
   */
  async chatCompletion(modelId, messages, options = {}) {
    try {
      let temperature = options.temperature ?? 0.7
      // MiniMax requires temperature in (0.0, 1.0] — zero is rejected
      if (temperature <= 0) temperature = 0.01

      const body = {
        model: modelId,
        messages,
        temperature,
        stream: false,
      }
      if (options.max_tokens && options.max_tokens > 0) {
        body.max_tokens = options.max_tokens
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Chat completion failed: ${errorText}`)
      }
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error in MiniMax chat completion:', error)
      throw error
    }
  }

  /**
   * Stream chat completion (for real-time responses)
   * @param {string} modelId - Model identifier
   * @param {Array} messages - Array of {role, content} messages
   * @param {Function} onChunk - Callback for each chunk
   * @param {object} options - Generation options
   */
  async streamChatCompletion(modelId, messages, onChunk, options = {}) {
    try {
      let temperature = options.temperature ?? 0.7
      if (temperature <= 0) temperature = 0.01

      const body = {
        model: modelId,
        messages,
        temperature,
        stream: true,
      }
      if (options.max_tokens && options.max_tokens > 0) {
        body.max_tokens = options.max_tokens
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Stream chat completion failed: ${errorText}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(line => line.trim() !== '')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              return
            }
            try {
              const json = JSON.parse(data)
              if (json.choices?.[0]?.delta?.content) {
                onChunk(json.choices[0].delta.content)
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('Error in MiniMax stream chat completion:', error)
      throw error
    }
  }
}

// Export singleton instance
const minimax = new MiniMaxService()
export default minimax
