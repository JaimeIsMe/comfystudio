import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Bot, Loader2, Send, Copy, Check, Power, PowerOff, RefreshCw,
  AlertCircle, Sparkles, MessageSquare, X
} from 'lucide-react'
import lmstudio from '../services/lmstudio'

const SYSTEM_PROMPT = `You are an expert AI assistant specialized in helping users create high-quality prompts for AI video and image generation. 

Your role is to:
- Help users refine and improve their prompts for better results
- Suggest cinematography techniques, camera angles, lighting, and composition
- Provide creative ideas and variations
- Ensure prompts are clear, detailed, and effective for AI generation
- Consider technical aspects like resolution, aspect ratio, and style

When helping with prompts:
- Ask clarifying questions if needed
- Suggest specific improvements (e.g., "add more detail about lighting")
- Provide multiple variations when helpful
- Keep prompts concise but descriptive
- Consider the target output (video vs image) and adjust suggestions accordingly

Be creative, helpful, and focused on achieving the best possible generation results.`

function LLMAssistantWorkspace() {
  const [isConnected, setIsConnected] = useState(false)
  const [isCheckingConnection, setIsCheckingConnection] = useState(false)
  const [models, setModels] = useState([])
  const [selectedModelId, setSelectedModelId] = useState(() => {
    // Load last selected model from localStorage
    try {
      return localStorage.getItem('llm-assistant-selected-model') || null
    } catch (error) {
      return null
    }
  })
  const [loadedModelId, setLoadedModelId] = useState(null)

  // Persist selected model to localStorage
  useEffect(() => {
    if (selectedModelId) {
      try {
        localStorage.setItem('llm-assistant-selected-model', selectedModelId)
      } catch (error) {
        console.error('Failed to save selected model:', error)
      }
    }
  }, [selectedModelId])
  const [isLoadingModel, setIsLoadingModel] = useState(false)
  const [isUnloadingModel, setIsUnloadingModel] = useState(false)
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  // Chat state
  const [messages, setMessages] = useState(() => {
    // Load chat history from localStorage on mount
    try {
      const saved = localStorage.getItem('llm-assistant-chat-history')
      return saved ? JSON.parse(saved) : []
    } catch (error) {
      console.error('Failed to load chat history:', error)
      return []
    }
  })
  const [inputMessage, setInputMessage] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [currentResponse, setCurrentResponse] = useState('')
  const messagesEndRef = useRef(null)

  // Persist chat history to localStorage whenever messages change
  useEffect(() => {
    try {
      localStorage.setItem('llm-assistant-chat-history', JSON.stringify(messages))
    } catch (error) {
      console.error('Failed to save chat history:', error)
    }
  }, [messages])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentResponse])

  // Check connection on mount
  useEffect(() => {
    checkConnection()
  }, [])

  // Load models when connected
  useEffect(() => {
    if (isConnected) {
      loadModels()
    }
  }, [isConnected])

  const checkConnection = async () => {
    setIsCheckingConnection(true)
    try {
      const connected = await lmstudio.checkConnection()
      setIsConnected(connected)
      if (connected) {
        await loadModels()
      }
    } catch (error) {
      setIsConnected(false)
    } finally {
      setIsCheckingConnection(false)
    }
  }

  const loadModels = async () => {
    setIsLoadingModels(true)
    try {
      const modelList = await lmstudio.listModels()
      setModels(modelList)
      
      // Get current selectedModelId from state (may be from localStorage)
      setSelectedModelId(currentSelected => {
        // Find currently loaded model
        const loaded = modelList.find(m => m.state === 'loaded')
        if (loaded) {
          setLoadedModelId(loaded.id)
          // Prefer loaded model if one exists
          return loaded.id
        }
        
        // If we have a saved selection, verify it still exists
        if (currentSelected && modelList.find(m => m.id === currentSelected)) {
          return currentSelected
        }
        
        // Otherwise use first available model
        return modelList.length > 0 ? modelList[0].id : null
      })
    } catch (error) {
      console.error('Failed to load models:', error)
    } finally {
      setIsLoadingModels(false)
    }
  }

  const handleLoadModel = async () => {
    if (!selectedModelId) return
    
    setIsLoadingModel(true)
    try {
      const result = await lmstudio.loadModel(selectedModelId, {
        context_length: 4096, // Reasonable default
        flash_attention: true, // Optimize for speed
      })
      setLoadedModelId(selectedModelId)
      await loadModels() // Refresh model list to update state
    } catch (error) {
      alert(`Failed to load model: ${error.message}`)
    } finally {
      setIsLoadingModel(false)
    }
  }

  const handleUnloadModel = async () => {
    if (!loadedModelId) return
    
    setIsUnloadingModel(true)
    try {
      await lmstudio.unloadModel(loadedModelId)
      setLoadedModelId(null)
      await loadModels() // Refresh model list
    } catch (error) {
      alert(`Failed to unload model: ${error.message}`)
    } finally {
      setIsUnloadingModel(false)
    }
  }

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !loadedModelId || isGenerating) return

    const userMessage = inputMessage.trim()
    setInputMessage('')
    setCurrentResponse('')

    // Add user message to chat
    const newMessages = [...messages, { role: 'user', content: userMessage }]
    setMessages(newMessages)
    setIsGenerating(true)

    try {
      // Build message history with system prompt
      const chatMessages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...newMessages,
      ]

      let fullResponse = ''
      
      // Use streaming for better UX
      await lmstudio.streamChatCompletion(
        loadedModelId,
        chatMessages,
        (chunk) => {
          fullResponse += chunk
          setCurrentResponse(fullResponse)
        },
        {
          temperature: 0.7,
          max_tokens: -1,
        }
      )

      // Add assistant response to messages
      setMessages([...newMessages, { role: 'assistant', content: fullResponse }])
      setCurrentResponse('')
    } catch (error) {
      console.error('Chat error:', error)
      setMessages([...newMessages, {
        role: 'assistant',
        content: `Error: ${error.message}. Make sure LM Studio is running and the model is loaded.`,
      }])
      setCurrentResponse('')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopyPrompt = (text) => {
    navigator.clipboard.writeText(text)
  }

  const handleClearChat = () => {
    if (confirm('Clear chat history?')) {
      setMessages([])
      setCurrentResponse('')
      // Also clear from localStorage
      try {
        localStorage.removeItem('llm-assistant-chat-history')
      } catch (error) {
        console.error('Failed to clear chat history from storage:', error)
      }
    }
  }

  const selectedModel = models.find(m => m.id === selectedModelId)
  const loadedModel = models.find(m => m.id === loadedModelId)

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-sf-dark-950">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-sf-dark-700">
        <div className="flex items-center gap-3">
          <Bot className="w-4 h-4 text-sf-accent" />
          <span className="text-sm font-semibold text-sf-text-primary">LLM Assistant</span>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-3">
          <button
            onClick={checkConnection}
            disabled={isCheckingConnection}
            className="flex items-center gap-2 px-2 py-1 text-xs text-sf-text-muted hover:text-sf-text-primary transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${isCheckingConnection ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-[10px] text-sf-text-muted">
              {isConnected ? 'LM Studio Connected' : 'LM Studio Offline'}
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Left sidebar - Model management */}
        <div className="w-80 flex-shrink-0 border-r border-sf-dark-700 bg-sf-dark-900 flex flex-col">
          <div className="p-4 border-b border-sf-dark-700">
            <div className="text-[10px] text-sf-text-muted uppercase tracking-wider mb-3">Model Management</div>
            
            {!isConnected ? (
              <div className="p-3 bg-sf-dark-800/50 rounded-lg">
                <div className="flex items-start gap-2 text-xs text-sf-text-muted">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium text-sf-text-secondary mb-2">LM Studio API not connected</div>
                    <div className="text-[10px] space-y-1.5">
                      <div className="font-medium text-sf-text-primary">To enable the API:</div>
                      <ol className="list-decimal list-inside space-y-1 ml-1">
                        <li>Open LM Studio</li>
                        <li>Go to <strong>Settings</strong> → <strong>Developer</strong> tab</li>
                        <li>Find the <strong>"Local LLM Service (headless)"</strong> section</li>
                        <li>Check <strong>"Enable Local LLM Service"</strong></li>
                        <li>Alternatively, look for a <strong>"Start server"</strong> toggle/button</li>
                        <li>Click <strong>Refresh</strong> above to reconnect</li>
                      </ol>
                      <div className="mt-2 pt-2 border-t border-sf-dark-700 text-[9px] opacity-80">
                        The API server runs on <code className="bg-sf-dark-700 px-1 rounded">localhost:1234</code> by default
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Model selector */}
                <div className="mb-3">
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider mb-1 block">
                    Select Model
                  </label>
                  {isLoadingModels ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-4 h-4 animate-spin text-sf-accent" />
                    </div>
                  ) : (
                    <select
                      value={selectedModelId || ''}
                      onChange={(e) => setSelectedModelId(e.target.value)}
                      disabled={isLoadingModel || isUnloadingModel}
                      className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
                    >
                      <option value="">-- Select a model --</option>
                      {models.map(model => (
                        <option key={model.id} value={model.id}>
                          {model.id} {model.state === 'loaded' ? '(Loaded)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Model info */}
                {selectedModel && (
                  <div className="mb-3 p-2 bg-sf-dark-800/50 rounded text-[10px] text-sf-text-secondary">
                    <div><span className="text-sf-text-muted">Type:</span> {selectedModel.type}</div>
                    {selectedModel.quantization && (
                      <div><span className="text-sf-text-muted">Quantization:</span> {selectedModel.quantization}</div>
                    )}
                    {selectedModel.max_context_length && (
                      <div><span className="text-sf-text-muted">Max Context:</span> {selectedModel.max_context_length.toLocaleString()}</div>
                    )}
                    <div><span className="text-sf-text-muted">State:</span> {selectedModel.state}</div>
                  </div>
                )}

                {/* Load/Unload buttons */}
                <div className="flex gap-2">
                  {loadedModelId ? (
                    <>
                      <button
                        onClick={handleUnloadModel}
                        disabled={isUnloadingModel}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 rounded text-xs text-red-400 transition-colors disabled:opacity-50"
                      >
                        {isUnloadingModel ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <PowerOff className="w-3 h-3" />
                        )}
                        Unload Model
                      </button>
                      <div className="flex items-center gap-1 px-2 text-[10px] text-green-400">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                        Loaded
                      </div>
                    </>
                  ) : (
                    <button
                      onClick={handleLoadModel}
                      disabled={!selectedModelId || isLoadingModel}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-sf-accent hover:bg-sf-accent-hover rounded text-xs text-white transition-colors disabled:opacity-50"
                    >
                      {isLoadingModel ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Power className="w-3 h-3" />
                      )}
                      Load Model
                    </button>
                  )}
                </div>

                {loadedModel && (
                  <div className="mt-3 p-2 bg-green-500/10 border border-green-500/30 rounded text-[10px] text-green-400">
                    <div className="font-medium mb-1">Model Loaded</div>
                    <div className="text-[9px] opacity-80">
                      VRAM is being used. Unload when generating videos/images to free memory.
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Info panel */}
          <div className="flex-1 overflow-auto p-4">
            <div className="text-[10px] text-sf-text-muted uppercase tracking-wider mb-2">How to Use</div>
            <div className="space-y-2 text-[11px] text-sf-text-secondary">
              <div>
                <div className="font-medium text-sf-text-primary mb-1">1. Enable API Server</div>
                <div className="text-[10px]">
                  In LM Studio: <strong>Settings</strong> → <strong>Developer</strong> tab → 
                  Check <strong>"Enable Local LLM Service"</strong> or toggle <strong>"Start server"</strong>
                </div>
              </div>
              <div>
                <div className="font-medium text-sf-text-primary mb-1">2. Load a Model</div>
                <div className="text-[10px]">Select and load a model to use for prompt assistance</div>
              </div>
              <div>
                <div className="font-medium text-sf-text-primary mb-1">3. Chat & Refine</div>
                <div className="text-[10px]">Ask for help creating or improving prompts</div>
              </div>
              <div>
                <div className="font-medium text-sf-text-primary mb-1">4. Copy & Use</div>
                <div className="text-[10px]">Copy generated prompts to the Generate workspace</div>
              </div>
              <div className="pt-2 border-t border-sf-dark-700">
                <div className="font-medium text-yellow-400 mb-1">💡 Tip</div>
                <div className="text-[10px]">
                  Unload the model before generating videos/images to free VRAM for ComfyUI.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right - Chat interface */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat messages */}
          <div className="flex-1 overflow-auto p-4 space-y-4 select-text">
            {messages.length === 0 && !currentResponse && (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <MessageSquare className="w-12 h-12 text-sf-text-muted mx-auto mb-3 opacity-50" />
                  <div className="text-sm text-sf-text-secondary mb-1">Start a conversation</div>
                  <div className="text-xs text-sf-text-muted">
                    Ask for help creating or refining prompts for video/image generation
                  </div>
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-sf-accent/20 flex items-center justify-center">
                    <Bot className="w-3.5 h-3.5 text-sf-accent" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-xs select-text ${
                    msg.role === 'user'
                      ? 'bg-sf-accent text-white'
                      : 'bg-sf-dark-800 text-sf-text-primary'
                  }`}
                >
                  <div className="whitespace-pre-wrap select-text">{msg.content}</div>
                  {msg.role === 'assistant' && (
                    <button
                      onClick={() => handleCopyPrompt(msg.content)}
                      className="mt-2 flex items-center gap-1 text-[10px] text-sf-text-muted hover:text-sf-accent transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      Copy prompt
                    </button>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-sf-dark-700 flex items-center justify-center">
                    <Sparkles className="w-3.5 h-3.5 text-sf-text-muted" />
                  </div>
                )}
              </div>
            ))}

            {/* Streaming response */}
            {currentResponse && (
              <div className="flex gap-3 justify-start">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-sf-accent/20 flex items-center justify-center">
                  <Bot className="w-3.5 h-3.5 text-sf-accent" />
                </div>
                <div className="max-w-[80%] rounded-lg px-3 py-2 text-xs bg-sf-dark-800 text-sf-text-primary select-text">
                  <div className="whitespace-pre-wrap select-text">{currentResponse}</div>
                  {isGenerating && (
                    <div className="mt-2">
                      <Loader2 className="w-3 h-3 animate-spin text-sf-accent inline" />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-sf-dark-700 p-4">
            {messages.length > 0 && (
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-sf-text-muted">{messages.length} messages</span>
                <button
                  onClick={handleClearChat}
                  className="text-[10px] text-sf-text-muted hover:text-sf-error transition-colors flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Clear chat
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
                placeholder={loadedModelId ? "Ask for help with prompts..." : "Load a model first..."}
                disabled={!loadedModelId || isGenerating}
                rows={3}
                className="flex-1 bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-none disabled:opacity-50"
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputMessage.trim() || !loadedModelId || isGenerating}
                className="px-4 py-2 bg-sf-accent hover:bg-sf-accent-hover text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isGenerating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
            {!loadedModelId && (
              <div className="mt-2 text-[10px] text-yellow-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Load a model in the left panel to start chatting
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default LLMAssistantWorkspace
