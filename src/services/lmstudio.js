/**
 * LM Studio API Service
 * Handles communication with LM Studio local LLM server
 * 
 * LM Studio runs on localhost:1234 by default
 * API documentation: https://lmstudio.ai/docs/developer/rest
 */

const isDev = import.meta.env.DEV
const LMSTUDIO_BASE = isDev ? 'http://localhost:1234' : 'http://localhost:1234'

class LMStudioService {
  constructor() {
    this.baseUrl = LMSTUDIO_BASE
    this.apiToken = null // LM Studio may use API tokens, but often works without
  }

  /**
   * Set API token (optional, LM Studio may work without)
   */
  setApiToken(token) {
    this.apiToken = token
  }

  /**
   * Get headers for API requests
   */
  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    }
    if (this.apiToken) {
      headers['Authorization'] = `Bearer ${this.apiToken}`
    }
    return headers
  }

  /**
   * Check if LM Studio server is running
   */
  async checkConnection() {
    try {
      // Try v1 first, fallback to v0 for compatibility
      const response = await fetch(`${this.baseUrl}/api/v1/models/list`, {
        method: 'GET',
        headers: this.getHeaders(),
      })
      if (!response.ok) {
        // Try v0 endpoint as fallback
        const v0Response = await fetch(`${this.baseUrl}/api/v0/models`, {
          method: 'GET',
          headers: this.getHeaders(),
        })
        return v0Response.ok
      }
      return response.ok
    } catch (error) {
      return false
    }
  }

  /**
   * List all available models (both loaded and unloaded)
   */
  async listModels() {
    try {
      // Try v1 first
      let response = await fetch(`${this.baseUrl}/api/v1/models/list`, {
        method: 'GET',
        headers: this.getHeaders(),
      })
      
      // Fallback to v0 if v1 fails
      if (!response.ok) {
        response = await fetch(`${this.baseUrl}/api/v0/models`, {
          method: 'GET',
          headers: this.getHeaders(),
        })
      }
      
      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.statusText}`)
      }
      
      const data = await response.json()
      // v1 returns { data: [...] }, v0 returns { data: [...] } or just [...]
      return data.data || data || []
    } catch (error) {
      console.error('Error listing models:', error)
      throw error
    }
  }

  /**
   * Load a model into memory
   * @param {string} modelId - Model identifier
   * @param {object} options - Load options (context_length, flash_attention, etc.)
   */
  async loadModel(modelId, options = {}) {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/models/load`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: modelId,
          ...options,
        }),
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to load model: ${errorText}`)
      }
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error loading model:', error)
      throw error
    }
  }

  /**
   * Unload a model from memory
   * @param {string} instanceId - Model instance ID (usually same as model ID)
   */
  async unloadModel(instanceId) {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/models/unload`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          instance_id: instanceId,
        }),
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to unload model: ${errorText}`)
      }
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error unloading model:', error)
      throw error
    }
  }

  /**
   * Send a chat completion request
   * Uses OpenAI-compatible endpoint for better compatibility
   * @param {string} modelId - Model identifier
   * @param {Array} messages - Array of {role, content} messages
   * @param {object} options - Generation options (temperature, max_tokens, etc.)
   */
  async chatCompletion(modelId, messages, options = {}) {
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: modelId,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.max_tokens ?? -1, // -1 means no limit
          stream: options.stream ?? false,
          ...options,
        }),
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Chat completion failed: ${errorText}`)
      }
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error in chat completion:', error)
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
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: modelId,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.max_tokens ?? -1,
          stream: true,
          ...options,
        }),
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
      console.error('Error in stream chat completion:', error)
      throw error
    }
  }
}

// Export singleton instance
const lmstudio = new LMStudioService()
export default lmstudio
