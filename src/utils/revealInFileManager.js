import { getRecordedAbsolutePath } from '../services/assetRelinkFallback'

// "Reveal in Finder" / "Reveal in File Explorer": Electron's
// shell.showItemInFolder opens the platform file manager with the file
// selected. Only meaningful in the desktop app for assets that record an
// absolute path (imported media); generated blob/data assets have no disk
// home, so callers hide the action when canRevealAssetInFileManager is false.

export const getRevealInFileManagerLabel = () => {
  const platform = String(
    (typeof navigator !== 'undefined' && (navigator.userAgentData?.platform || navigator.platform)) || ''
  ).toLowerCase()
  if (platform.includes('mac')) return 'Reveal in Finder'
  if (platform.includes('win')) return 'Reveal in File Explorer'
  return 'Reveal in File Manager'
}

export const canRevealAssetInFileManager = (asset) => Boolean(
  typeof window !== 'undefined'
  && window?.electronAPI?.showItemInFolder
  && getRecordedAbsolutePath(asset)
)

export const revealAssetInFileManager = async (asset) => {
  const target = getRecordedAbsolutePath(asset)
  if (!target || !window?.electronAPI?.showItemInFolder) {
    return { success: false, error: 'Reveal is only available in the desktop app for files on disk.' }
  }
  try {
    const result = await window.electronAPI.showItemInFolder(target)
    if (result && result.success === false) {
      console.warn('[reveal-in-file-manager] failed:', result.error, 'path=', target)
    }
    return result || { success: true }
  } catch (error) {
    console.warn('[reveal-in-file-manager] threw:', error?.message || error)
    return { success: false, error: error?.message || 'Failed to reveal the file.' }
  }
}
