const CLOUD_CREDIT_DISPLAY_STORAGE_KEY = 'velorn-show-cloud-credit-balance'

export const CLOUD_CREDIT_DISPLAY_CHANGED_EVENT = 'velorn-cloud-credit-display-changed'

export function getShowCloudCreditBalance() {
  if (typeof localStorage === 'undefined') return true
  try {
    return localStorage.getItem(CLOUD_CREDIT_DISPLAY_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setShowCloudCreditBalance(show) {
  const next = Boolean(show)
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(CLOUD_CREDIT_DISPLAY_STORAGE_KEY, String(next))
    } catch (_) {}
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CLOUD_CREDIT_DISPLAY_CHANGED_EVENT, {
      detail: { show: next },
    }))
  }
  return next
}
