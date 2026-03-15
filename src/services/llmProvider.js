/**
 * LLM Provider Manager
 * Manages switching between local (LM Studio) and cloud (MiniMax) LLM providers.
 *
 * Settings are stored in Electron settings (if available) with localStorage fallback.
 */

import lmstudio from './lmstudio'
import minimax from './minimax'

const LLM_PROVIDER_SETTING_KEY = 'llmProviderType'
const LLM_PROVIDER_LOCAL_KEY = 'comfystudio-llm-provider'
const MINIMAX_API_KEY_SETTING_KEY = 'minimaxApiKey'
const MINIMAX_API_KEY_LOCAL_KEY = 'comfystudio-minimax-api-key'
const MINIMAX_MODEL_LOCAL_KEY = 'comfystudio-minimax-model'

export const PROVIDERS = {
  LMSTUDIO: 'lmstudio',
  MINIMAX: 'minimax',
}

/**
 * Get the stored LLM provider type
 */
export function getProviderTypeSync() {
  try {
    return localStorage.getItem(LLM_PROVIDER_LOCAL_KEY) || PROVIDERS.LMSTUDIO
  } catch {
    return PROVIDERS.LMSTUDIO
  }
}

/**
 * Save the LLM provider type
 */
export async function saveProviderType(type) {
  try {
    if (window?.electronAPI?.setSetting) {
      await window.electronAPI.setSetting(LLM_PROVIDER_SETTING_KEY, type)
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LLM_PROVIDER_LOCAL_KEY, type)
    }
  } catch (err) {
    console.error('Failed to save LLM provider type:', err)
  }
}

/**
 * Get the stored MiniMax API key
 */
export async function getMiniMaxApiKey() {
  try {
    if (window?.electronAPI?.getSetting) {
      const key = await window.electronAPI.getSetting(MINIMAX_API_KEY_SETTING_KEY)
      if (key) return String(key)
    }
  } catch { /* fall through */ }
  try {
    return localStorage.getItem(MINIMAX_API_KEY_LOCAL_KEY) || ''
  } catch {
    return ''
  }
}

/**
 * Save the MiniMax API key
 */
export async function saveMiniMaxApiKey(key) {
  const normalized = String(key || '').trim()
  try {
    if (window?.electronAPI?.setSetting) {
      await window.electronAPI.setSetting(MINIMAX_API_KEY_SETTING_KEY, normalized)
    }
    if (typeof localStorage !== 'undefined') {
      if (normalized) {
        localStorage.setItem(MINIMAX_API_KEY_LOCAL_KEY, normalized)
      } else {
        localStorage.removeItem(MINIMAX_API_KEY_LOCAL_KEY)
      }
    }
  } catch (err) {
    console.error('Failed to save MiniMax API key:', err)
  }
}

/**
 * Get the stored MiniMax model selection
 */
export function getMiniMaxModelSync() {
  try {
    return localStorage.getItem(MINIMAX_MODEL_LOCAL_KEY) || 'MiniMax-M2.5'
  } catch {
    return 'MiniMax-M2.5'
  }
}

/**
 * Save the MiniMax model selection
 */
export function saveMiniMaxModel(modelId) {
  try {
    localStorage.setItem(MINIMAX_MODEL_LOCAL_KEY, modelId)
  } catch { /* ignore */ }
}

/**
 * Get the active LLM service instance based on the current provider type.
 * Initializes the service with stored credentials.
 */
export async function getActiveService(providerType) {
  const type = providerType || getProviderTypeSync()
  if (type === PROVIDERS.MINIMAX) {
    const apiKey = await getMiniMaxApiKey()
    minimax.setApiKey(apiKey)
    return minimax
  }
  return lmstudio
}

/**
 * Check whether a provider type requires model loading/unloading (local only)
 */
export function supportsModelManagement(providerType) {
  return providerType === PROVIDERS.LMSTUDIO
}
