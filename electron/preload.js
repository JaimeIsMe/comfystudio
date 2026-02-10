const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  platform: process.platform,
  isElectron: true,
  
  // ============================================
  // Dialog Operations
  // ============================================
  
  /**
   * Open a directory picker dialog
   * @param {Object} options - { title, defaultPath }
   * @returns {Promise<string|null>} Selected directory path or null if cancelled
   */
  selectDirectory: (options) => ipcRenderer.invoke('dialog:selectDirectory', options),
  
  /**
   * Open a file picker dialog
   * @param {Object} options - { title, defaultPath, filters, multiple }
   * @returns {Promise<string|string[]|null>} Selected file path(s) or null if cancelled
   */
  selectFile: (options) => ipcRenderer.invoke('dialog:selectFile', options),
  
  /**
   * Open a save file dialog
   * @param {Object} options - { title, defaultPath, filters }
   * @returns {Promise<string|null>} Save path or null if cancelled
   */
  saveFileDialog: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  
  // ============================================
  // File System Operations
  // ============================================
  
  /**
   * Check if a file or directory exists
   * @param {string} filePath 
   * @returns {Promise<boolean>}
   */
  exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
  
  /**
   * Check if path is a directory
   * @param {string} filePath 
   * @returns {Promise<boolean>}
   */
  isDirectory: (filePath) => ipcRenderer.invoke('fs:isDirectory', filePath),
  
  /**
   * Create a directory (recursive by default)
   * @param {string} dirPath 
   * @param {Object} options - { recursive }
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  createDirectory: (dirPath, options) => ipcRenderer.invoke('fs:createDirectory', dirPath, options),
  
  /**
   * Read a file
   * @param {string} filePath 
   * @param {Object} options - { encoding } - null for binary (returns base64)
   * @returns {Promise<{success: boolean, data?: string, encoding?: string, error?: string}>}
   */
  readFile: (filePath, options) => ipcRenderer.invoke('fs:readFile', filePath, options),
  
  /**
   * Read a file as ArrayBuffer
   * @param {string} filePath 
   * @returns {Promise<{success: boolean, data?: ArrayBuffer, error?: string}>}
   */
  readFileAsBuffer: (filePath) => ipcRenderer.invoke('fs:readFileAsBuffer', filePath),
  
  /**
   * Write a file
   * @param {string} filePath 
   * @param {string|Object} data - String, JSON object, or base64 string
   * @param {Object} options - { encoding } - 'base64' for binary data
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  writeFile: (filePath, data, options) => ipcRenderer.invoke('fs:writeFile', filePath, data, options),
  
  /**
   * Write a file from ArrayBuffer (for binary files like videos, images)
   * @param {string} filePath 
   * @param {ArrayBuffer} arrayBuffer 
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  writeFileFromArrayBuffer: (filePath, arrayBuffer) => ipcRenderer.invoke('fs:writeFileFromArrayBuffer', filePath, arrayBuffer),

  // ============================================
  // Export Operations
  // ============================================

  /**
   * Encode a frame sequence into a video file
   * @param {Object} options - { framePattern, fps, outputPath, audioPath, format }
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  encodeVideo: (options) => ipcRenderer.invoke('export:encodeVideo', options),

  /**
   * Check if FFmpeg supports NVIDIA NVENC encoders
   * @returns {Promise<{available: boolean, h264: boolean, h265: boolean, error?: string}>}
   */
  checkNvenc: () => ipcRenderer.invoke('export:checkNvenc'),

  /**
   * Transcode video for playback cache (same resolution, H.264, keyframe every 6, no B-frames)
   * @param {{ inputPath: string, outputPath: string }}
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  transcodeForPlayback: (options) => ipcRenderer.invoke('playback:transcode', options),
  
  /**
   * Delete a file
   * @param {string} filePath 
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  deleteFile: (filePath) => ipcRenderer.invoke('fs:deleteFile', filePath),
  
  /**
   * Delete a directory
   * @param {string} dirPath 
   * @param {Object} options - { recursive }
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  deleteDirectory: (dirPath, options) => ipcRenderer.invoke('fs:deleteDirectory', dirPath, options),
  
  /**
   * Copy a file
   * @param {string} srcPath 
   * @param {string} destPath 
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  copyFile: (srcPath, destPath) => ipcRenderer.invoke('fs:copyFile', srcPath, destPath),
  
  /**
   * Move/rename a file
   * @param {string} srcPath 
   * @param {string} destPath 
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  moveFile: (srcPath, destPath) => ipcRenderer.invoke('fs:moveFile', srcPath, destPath),
  
  /**
   * List directory contents
   * @param {string} dirPath 
   * @param {Object} options - { includeStats }
   * @returns {Promise<{success: boolean, items: Array, error?: string}>}
   */
  listDirectory: (dirPath, options) => ipcRenderer.invoke('fs:listDirectory', dirPath, options),
  
  /**
   * Get file info (stats)
   * @param {string} filePath 
   * @returns {Promise<{success: boolean, info?: Object, error?: string}>}
   */
  getFileInfo: (filePath) => ipcRenderer.invoke('fs:getFileInfo', filePath),
  
  // ============================================
  // Path Operations
  // ============================================
  
  /**
   * Join path segments
   * @param {...string} parts 
   * @returns {Promise<string>}
   */
  pathJoin: (...parts) => ipcRenderer.invoke('path:join', ...parts),
  
  /**
   * Get directory name from path
   * @param {string} filePath 
   * @returns {Promise<string>}
   */
  pathDirname: (filePath) => ipcRenderer.invoke('path:dirname', filePath),
  
  /**
   * Get base name from path
   * @param {string} filePath 
   * @param {string} ext - Optional extension to remove
   * @returns {Promise<string>}
   */
  pathBasename: (filePath, ext) => ipcRenderer.invoke('path:basename', filePath, ext),
  
  /**
   * Get extension from path
   * @param {string} filePath 
   * @returns {Promise<string>}
   */
  pathExtname: (filePath) => ipcRenderer.invoke('path:extname', filePath),
  
  /**
   * Normalize a path
   * @param {string} filePath 
   * @returns {Promise<string>}
   */
  pathNormalize: (filePath) => ipcRenderer.invoke('path:normalize', filePath),
  
  /**
   * Get special app path
   * @param {string} name - home, appData, userData, documents, downloads, temp, etc.
   * @returns {Promise<string>}
   */
  getAppPath: (name) => ipcRenderer.invoke('path:getAppPath', name),
  
  // ============================================
  // Media URL Operations
  // ============================================
  
  /**
   * Get a URL for a local file (using storyflow:// protocol)
   * @param {string} filePath 
   * @returns {Promise<string>}
   */
  getFileUrl: (filePath) => ipcRenderer.invoke('media:getFileUrl', filePath),
  
  /**
   * Get video FPS via ffprobe (Electron only)
   * @param {string} filePath
   * @returns {Promise<{success: boolean, fps?: number, error?: string}>}
   */
  getVideoFps: (filePath) => ipcRenderer.invoke('media:getVideoFps', filePath),

  /**
   * Get a direct file:// URL for a local file
   * @param {string} filePath 
   * @returns {Promise<string>}
   */
  getFileUrlDirect: (filePath) => ipcRenderer.invoke('media:getFileUrlDirect', filePath),
  
  // ============================================
  // App Settings (persistent storage in userData)
  // ============================================
  
  /**
   * Get a setting value
   * @param {string} key - Optional, returns all settings if not provided
   * @returns {Promise<any>}
   */
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  
  /**
   * Set a setting value
   * @param {string} key 
   * @param {any} value 
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  
  /**
   * Delete a setting
   * @param {string} key 
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  deleteSetting: (key) => ipcRenderer.invoke('settings:delete', key),

  // ============================================
  // Window Controls
  // ============================================

  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  toggleFullScreenWindow: () => ipcRenderer.invoke('window:toggleFullScreen'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
})

// Also expose a simple check for detecting Electron
contextBridge.exposeInMainWorld('isElectron', true)
