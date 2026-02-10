/**
 * Pexels API key storage – works in Electron (settings) and web (localStorage).
 */
const PEXELS_KEY_STORAGE = 'comfystudio-pexels-api-key'

export async function getPexelsApiKey() {
  if (typeof window !== 'undefined' && window.electronAPI?.getSetting) {
    return await window.electronAPI.getSetting('pexelsApiKey')
  }
  return localStorage.getItem(PEXELS_KEY_STORAGE) || null
}

export async function setPexelsApiKey(value) {
  if (typeof window !== 'undefined' && window.electronAPI?.setSetting) {
    await window.electronAPI.setSetting('pexelsApiKey', value || '')
  } else {
    localStorage.setItem(PEXELS_KEY_STORAGE, value || '')
  }
}
