/**
 * File System Service
 * Handles all file system operations for project management
 * Supports both Electron (native fs) and Web (File System Access API)
 */

// ============================================
// Environment Detection
// ============================================

export const isElectron = () => {
  return typeof window !== 'undefined' && window.electronAPI?.isElectron === true
}

export const isFileSystemSupported = () => {
  if (isElectron()) {
    return true // Electron always supports file operations
  }
  return 'showDirectoryPicker' in window && 'showOpenFilePicker' in window
}

// ============================================
// Directory Access
// ============================================

/**
 * Request directory access from user
 * @param {string} purpose - Description shown to user (e.g., "Select Projects Folder")
 * @returns {Promise<string|FileSystemDirectoryHandle|null>} Path (Electron) or Handle (Web)
 */
export const requestDirectoryAccess = async (purpose = 'Select Folder') => {
  if (isElectron()) {
    const result = await window.electronAPI.selectDirectory({ title: purpose })
    return result // Returns string path or null
  }
  
  // Web fallback - File System Access API
  if (!isFileSystemSupported()) {
    throw new Error('File System Access API not supported. Please use Chrome or Edge.')
  }

  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents',
    })
    return handle
  } catch (err) {
    if (err.name === 'AbortError') {
      return null // User cancelled
    }
    throw err
  }
}

/**
 * Request to open a specific project folder
 * @returns {Promise<string|FileSystemDirectoryHandle|null>}
 */
export const openProjectFolder = async () => {
  return requestDirectoryAccess('Select Project Folder')
}

// ============================================
// Project Operations
// ============================================

/**
 * Create project folder structure
 * @param {string|FileSystemDirectoryHandle} baseDir - The base projects directory
 * @param {string} projectName - Name of the project
 * @returns {Promise<string|FileSystemDirectoryHandle>} - The project directory path/handle
 */
export const createProjectFolder = async (baseDir, projectName) => {
  if (isElectron()) {
    const projectPath = await window.electronAPI.pathJoin(baseDir, projectName)
    
    // Create main project folder and subfolders
    await window.electronAPI.createDirectory(projectPath)
    await window.electronAPI.createDirectory(await window.electronAPI.pathJoin(projectPath, 'assets'))
    await window.electronAPI.createDirectory(await window.electronAPI.pathJoin(projectPath, 'assets', 'video'))
    await window.electronAPI.createDirectory(await window.electronAPI.pathJoin(projectPath, 'assets', 'audio'))
    await window.electronAPI.createDirectory(await window.electronAPI.pathJoin(projectPath, 'assets', 'images'))
    await window.electronAPI.createDirectory(await window.electronAPI.pathJoin(projectPath, 'renders'))
    await window.electronAPI.createDirectory(await window.electronAPI.pathJoin(projectPath, 'autosave'))
    await window.electronAPI.createDirectory(await window.electronAPI.pathJoin(projectPath, 'cache'))
    
    return projectPath
  }
  
  // Web fallback
  const projectDir = await baseDir.getDirectoryHandle(projectName, { create: true })
  
  await projectDir.getDirectoryHandle('assets', { create: true })
  const assetsDir = await projectDir.getDirectoryHandle('assets', { create: false })
  await assetsDir.getDirectoryHandle('video', { create: true })
  await assetsDir.getDirectoryHandle('audio', { create: true })
  await assetsDir.getDirectoryHandle('images', { create: true })
  
  await projectDir.getDirectoryHandle('renders', { create: true })
  await projectDir.getDirectoryHandle('autosave', { create: true })
  
  return projectDir
}

/**
 * Save project data to .storyflow file
 * @param {string|FileSystemDirectoryHandle} projectDir - The project directory
 * @param {object} projectData - The project data to save
 */
export const saveProject = async (projectDir, projectData) => {
  const dataWithMeta = {
    ...projectData,
    version: '1.0',
    modified: new Date().toISOString(),
  }
  
  if (isElectron()) {
    const filePath = await window.electronAPI.pathJoin(projectDir, 'project.storyflow')
    const result = await window.electronAPI.writeFile(filePath, JSON.stringify(dataWithMeta, null, 2))
    if (!result.success) {
      throw new Error(result.error)
    }
    return
  }
  
  // Web fallback
  const fileHandle = await projectDir.getFileHandle('project.storyflow', { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(dataWithMeta, null, 2))
  await writable.close()
}

/**
 * Safely parse project JSON without crashing startup
 * @param {string} rawText
 * @param {string} sourceLabel
 * @returns {object|null}
 */
const parseProjectJson = (rawText, sourceLabel) => {
  const trimmed = typeof rawText === 'string' ? rawText.trim() : ''
  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed)
  } catch (err) {
    console.warn(`Invalid project file (${sourceLabel})`, err)
    return null
  }
}

/**
 * Load project data from .storyflow file
 * @param {string|FileSystemDirectoryHandle} projectDir - The project directory
 * @returns {Promise<object|null>} - The project data or null if not found
 */
export const loadProject = async (projectDir) => {
  if (isElectron()) {
    const filePath = await window.electronAPI.pathJoin(projectDir, 'project.storyflow')
    const exists = await window.electronAPI.exists(filePath)
    if (!exists) {
      throw new Error('Project file not found. This folder does not contain project.storyflow — the project may have been moved or the path is wrong. Try opening the project folder with "Open project".')
    }
    
    const result = await window.electronAPI.readFile(filePath, { encoding: 'utf8' })
    if (!result.success) {
      throw new Error(result.error || 'Could not read project file')
    }
    const projectData = parseProjectJson(result.data, filePath)
    if (!projectData) {
      throw new Error('Project file is empty or invalid (corrupted JSON). The project.storyflow file may be damaged.')
    }
    return projectData
  }
  
  // Web fallback
  try {
    const fileHandle = await projectDir.getFileHandle('project.storyflow')
    const file = await fileHandle.getFile()
    const text = await file.text()
    const projectData = parseProjectJson(text, 'project.storyflow')
    if (!projectData) {
      throw new Error('Project file is empty or invalid (corrupted JSON). The project.storyflow file may be damaged.')
    }
    return projectData
  } catch (err) {
    if (err.name === 'NotFoundError') {
      throw new Error('Project file not found. This folder does not contain project.storyflow.')
    }
    if (err.message && err.message.startsWith('Project file')) {
      throw err
    }
    throw err
  }
}

/**
 * Check if a directory is a valid StoryFlow project
 * @param {string|FileSystemDirectoryHandle} dir - Directory to check
 * @returns {Promise<boolean>}
 */
export const isValidProject = async (dir) => {
  if (isElectron()) {
    const filePath = await window.electronAPI.pathJoin(dir, 'project.storyflow')
    return await window.electronAPI.exists(filePath)
  }
  
  // Web fallback
  try {
    await dir.getFileHandle('project.storyflow')
    return true
  } catch {
    return false
  }
}

/**
 * List all projects in the projects directory
 * @param {string|FileSystemDirectoryHandle} baseDir - The base projects directory
 * @returns {Promise<Array>} - Array of project info objects
 */
export const listProjects = async (baseDir) => {
  const projects = []
  
  if (isElectron()) {
    const result = await window.electronAPI.listDirectory(baseDir, { includeStats: true })
    if (!result.success) {
      console.warn('Error listing projects:', result.error)
      return []
    }
    
    for (const entry of result.items) {
      if (entry.isDirectory) {
        try {
          const isProject = await isValidProject(entry.path)
          if (isProject) {
            const projectData = await loadProject(entry.path)
            if (projectData) {
              projects.push({
                name: projectData.name || entry.name,
                path: entry.path, // Use path instead of handle in Electron
                modified: projectData.modified,
                created: projectData.created,
                settings: projectData.settings,
                thumbnail: projectData.thumbnail,
              })
            }
          }
        } catch (err) {
          console.warn(`Error reading project ${entry.name}:`, err)
        }
      }
    }
  } else {
    // Web fallback
    for await (const entry of baseDir.values()) {
      if (entry.kind === 'directory') {
        try {
          const isProject = await isValidProject(entry)
          if (isProject) {
            const projectData = await loadProject(entry)
            if (projectData) {
              projects.push({
                name: projectData.name || entry.name,
                handle: entry, // Use handle in web mode
                modified: projectData.modified,
                created: projectData.created,
                settings: projectData.settings,
                thumbnail: projectData.thumbnail,
              })
            }
          }
        } catch (err) {
          console.warn(`Error reading project ${entry.name}:`, err)
        }
      }
    }
  }
  
  // Sort by modified date (most recent first)
  projects.sort((a, b) => new Date(b.modified) - new Date(a.modified))
  
  return projects
}

// ============================================
// Asset Import
// ============================================

/**
 * Import a file to the project's assets folder
 * @param {string|FileSystemDirectoryHandle} projectDir - The project directory
 * @param {File|string} file - The file to import (File object or path in Electron)
 * @param {string} category - Asset category: 'video', 'audio', or 'images'
 * @returns {Promise<object>} - Asset info object with relative path
 */
export const importAsset = async (projectDir, file, category = 'video') => {
  if (isElectron()) {
    // In Electron, file can be a File object (from drag-drop) or a string path
    const srcPath = typeof file === 'string' ? file : null
    const fileName = typeof file === 'string' 
      ? await window.electronAPI.pathBasename(file)
      : file.name
    
    const categoryPath = await window.electronAPI.pathJoin(projectDir, 'assets', category)
    await window.electronAPI.createDirectory(categoryPath)
    
    // Generate unique filename if exists
    let finalFileName = fileName
    let counter = 1
    let destPath = await window.electronAPI.pathJoin(categoryPath, finalFileName)
    
    while (await window.electronAPI.exists(destPath)) {
      const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : ''
      const baseName = fileName.replace(ext, '')
      finalFileName = `${baseName}_${counter}${ext}`
      destPath = await window.electronAPI.pathJoin(categoryPath, finalFileName)
      counter++
    }
    
    // Copy or write the file
    if (srcPath) {
      // File is a path - copy it
      const result = await window.electronAPI.copyFile(srcPath, destPath)
      if (!result.success) {
        throw new Error(result.error)
      }
    } else {
      // File is a File object - write its contents
      const arrayBuffer = await file.arrayBuffer()
      const result = await window.electronAPI.writeFileFromArrayBuffer(destPath, arrayBuffer)
      if (!result.success) {
        throw new Error(result.error)
      }
    }
    
    // Get file info
    const relativePath = `assets/${category}/${finalFileName}`
    const fileInfo = await window.electronAPI.getFileInfo(destPath)
    
    // Get media info
    let duration = null
    let width = null
    let height = null
    let fps = null
    
    if (category === 'video' || category === 'audio') {
      try {
        const fileUrl = await window.electronAPI.getFileUrlDirect(destPath)
        console.log(`Getting media info for ${finalFileName} from ${fileUrl}`)
        const mediaInfo = await getMediaInfoFromUrl(fileUrl, category)
        duration = mediaInfo.duration
        width = mediaInfo.width
        height = mediaInfo.height
        console.log(`Media info for ${finalFileName}:`, { duration, width, height })
      } catch (err) {
        console.warn('Could not get media info:', err)
        
        // Fallback: If we have a File object, try getting info from that
        if (typeof file !== 'string' && file instanceof File) {
          try {
            const blobUrl = URL.createObjectURL(file)
            const mediaInfo = await getMediaInfoFromUrl(blobUrl, category)
            duration = mediaInfo.duration
            width = mediaInfo.width
            height = mediaInfo.height
            URL.revokeObjectURL(blobUrl)
            console.log(`Fallback media info for ${finalFileName}:`, { duration, width, height })
          } catch (fallbackErr) {
            console.warn('Fallback media info also failed:', fallbackErr)
          }
        }
      }
    }

    if (category === 'video') {
      try {
        const fpsResult = await window.electronAPI.getVideoFps(destPath)
        if (fpsResult?.success && fpsResult.fps) {
          fps = fpsResult.fps
        }
      } catch (err) {
        console.warn('Could not get video FPS:', err)
      }
    }
    
    return {
      id: `asset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: finalFileName,
      type: category === 'images' ? 'image' : category,
      path: relativePath,
      absolutePath: destPath, // Store absolute path for Electron
      imported: new Date().toISOString(),
      size: fileInfo.info?.size || (typeof file !== 'string' ? file.size : 0),
      mimeType: typeof file !== 'string' ? file.type : getMimeType(finalFileName),
      duration,
      width,
      height,
      fps,
      isImported: true,
    }
  }
  
  // Web fallback - original implementation
  const assetsDir = await projectDir.getDirectoryHandle('assets')
  const categoryDir = await assetsDir.getDirectoryHandle(category, { create: true })
  
  // Generate unique filename if exists
  let fileName = file.name
  let counter = 1
  let fileHandle
  
  while (true) {
    try {
      await categoryDir.getFileHandle(fileName)
      const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : ''
      const baseName = file.name.replace(ext, '')
      fileName = `${baseName}_${counter}${ext}`
      counter++
    } catch {
      break
    }
  }
  
  fileHandle = await categoryDir.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(file)
  await writable.close()
  
  const relativePath = `assets/${category}/${fileName}`
  
  let duration = null
  let width = null
  let height = null
  
  if (category === 'video' || category === 'audio') {
    try {
      const mediaInfo = await getMediaInfo(file)
      duration = mediaInfo.duration
      width = mediaInfo.width
      height = mediaInfo.height
    } catch (err) {
      console.warn('Could not get media info:', err)
    }
  }
  
  return {
    id: `asset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name: fileName,
    type: category === 'images' ? 'image' : category,
    path: relativePath,
    imported: new Date().toISOString(),
    size: file.size,
    mimeType: file.type,
    duration,
    width,
    height,
    isImported: true,
  }
}

// Helper to get MIME type from filename
function getMimeType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase()
  const mimeTypes = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

// ============================================
// Media Info Extraction
// ============================================

/**
 * Get media file info from a File object (Web only)
 * @param {File} file - The media file
 * @returns {Promise<object>} - Object with duration, width, height
 */
const getMediaInfo = (file) => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    
    if (file.type.startsWith('video/')) {
      const video = document.createElement('video')
      video.preload = 'metadata'
      
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url)
        resolve({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        })
      }
      
      video.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('Failed to load video metadata'))
      }
      
      video.src = url
    } else if (file.type.startsWith('audio/')) {
      const audio = document.createElement('audio')
      audio.preload = 'metadata'
      
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url)
        resolve({
          duration: audio.duration,
          width: null,
          height: null,
        })
      }
      
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('Failed to load audio metadata'))
      }
      
      audio.src = url
    } else {
      URL.revokeObjectURL(url)
      resolve({ duration: null, width: null, height: null })
    }
  })
}

/**
 * Get media info from a URL (for Electron file:// URLs)
 * @param {string} url - The file URL
 * @param {string} type - 'video' or 'audio'
 * @returns {Promise<object>}
 */
const getMediaInfoFromUrl = (url, type) => {
  return new Promise((resolve, reject) => {
    // Timeout after 10 seconds
    const timeout = setTimeout(() => {
      console.warn('Media info extraction timed out for:', url)
      resolve({ duration: null, width: null, height: null })
    }, 10000)
    
    if (type === 'video') {
      const video = document.createElement('video')
      video.preload = 'metadata'
      // Allow cross-origin for file:// URLs in Electron
      video.crossOrigin = 'anonymous'
      
      video.onloadedmetadata = () => {
        clearTimeout(timeout)
        console.log('Video metadata loaded:', { duration: video.duration, width: video.videoWidth, height: video.videoHeight })
        resolve({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        })
      }
      
      video.onerror = (e) => {
        clearTimeout(timeout)
        console.error('Failed to load video metadata:', e)
        reject(new Error('Failed to load video metadata'))
      }
      
      video.src = url
      // Force load attempt
      video.load()
    } else if (type === 'audio') {
      const audio = document.createElement('audio')
      audio.preload = 'metadata'
      
      audio.onloadedmetadata = () => {
        clearTimeout(timeout)
        resolve({
          duration: audio.duration,
          width: null,
          height: null,
        })
      }
      
      audio.onerror = (e) => {
        clearTimeout(timeout)
        console.error('Failed to load audio metadata:', e)
        reject(new Error('Failed to load audio metadata'))
      }
      
      audio.src = url
      audio.load()
    } else {
      clearTimeout(timeout)
      resolve({ duration: null, width: null, height: null })
    }
  })
}

// ============================================
// File Read/Write Operations
// ============================================

/**
 * Read a file from the project directory
 * @param {string|FileSystemDirectoryHandle} projectDir - The project directory
 * @param {string} relativePath - Relative path to the file
 * @returns {Promise<File|{data: ArrayBuffer, name: string}>}
 */
export const readProjectFile = async (projectDir, relativePath) => {
  if (isElectron()) {
    const filePath = await window.electronAPI.pathJoin(projectDir, relativePath)
    const result = await window.electronAPI.readFileAsBuffer(filePath)
    if (!result.success) {
      throw new Error(result.error)
    }
    const name = await window.electronAPI.pathBasename(filePath)
    return { data: result.data, name }
  }
  
  // Web fallback
  const parts = relativePath.split('/')
  let currentDir = projectDir
  
  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i])
  }
  
  const fileName = parts[parts.length - 1]
  const fileHandle = await currentDir.getFileHandle(fileName)
  return await fileHandle.getFile()
}

/**
 * Get a URL for a project file (for use in video/audio elements)
 * @param {string|FileSystemDirectoryHandle} projectDir - The project directory
 * @param {string} relativePath - Relative path to the file
 * @returns {Promise<string>} - URL for the file
 */
export const getProjectFileUrl = async (projectDir, relativePath) => {
  if (isElectron()) {
    const filePath = await window.electronAPI.pathJoin(projectDir, relativePath)
    return await window.electronAPI.getFileUrlDirect(filePath)
  }
  
  // Web fallback
  const file = await readProjectFile(projectDir, relativePath)
  return URL.createObjectURL(file)
}

/**
 * Get a URL for an absolute file path (Electron only)
 * @param {string} absolutePath - The absolute file path
 * @returns {Promise<string>} - URL for the file
 */
export const getAbsoluteFileUrl = async (absolutePath) => {
  if (isElectron()) {
    return await window.electronAPI.getFileUrlDirect(absolutePath)
  }
  throw new Error('getAbsoluteFileUrl is only available in Electron')
}

/**
 * Delete a file from the project
 * @param {string|FileSystemDirectoryHandle} projectDir - The project directory
 * @param {string} relativePath - Relative path to the file
 */
export const deleteProjectFile = async (projectDir, relativePath) => {
  if (isElectron()) {
    const filePath = await window.electronAPI.pathJoin(projectDir, relativePath)
    const result = await window.electronAPI.deleteFile(filePath)
    if (!result.success) {
      throw new Error(result.error)
    }
    return
  }
  
  // Web fallback
  const parts = relativePath.split('/')
  let currentDir = projectDir
  
  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i])
  }
  
  const fileName = parts[parts.length - 1]
  await currentDir.removeEntry(fileName)
}

// ============================================
// Directory Handle Storage (Web only - not needed in Electron)
// ============================================

const DB_NAME = 'storyflow-handles'
const DB_VERSION = 1
const STORE_NAME = 'directory-handles'

const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
  })
}

/**
 * Store a directory handle or path for later retrieval
 * @param {string} key - Storage key (e.g., 'defaultProjectsLocation', 'currentProject')
 * @param {FileSystemDirectoryHandle|string} handle - The directory handle or path
 */
export const storeDirectoryHandle = async (key, handle) => {
  if (isElectron()) {
    // In Electron, store path in settings
    await window.electronAPI.setSetting(key, handle)
    return
  }
  
  // Web fallback - IndexedDB
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(handle, key)
    
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

/**
 * Retrieve a stored directory handle or path
 * @param {string} key - Storage key
 * @returns {Promise<FileSystemDirectoryHandle|string|null>}
 */
export const getStoredDirectoryHandle = async (key) => {
  if (isElectron()) {
    // In Electron, get path from settings
    const path = await window.electronAPI.getSetting(key)
    return path || null
  }
  
  // Web fallback - IndexedDB
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(key)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result || null)
    })
  } catch {
    return null
  }
}

/**
 * Verify and request permission for a stored handle
 * @param {FileSystemDirectoryHandle|string} handle - The stored handle or path
 * @returns {Promise<boolean>} - Whether permission was granted / path is valid
 */
export const verifyPermission = async (handle) => {
  if (!handle) return false
  
  if (isElectron()) {
    // In Electron, check if path exists and is accessible
    const exists = await window.electronAPI.exists(handle)
    const isDir = await window.electronAPI.isDirectory(handle)
    return exists && isDir
  }
  
  // Web fallback
  try {
    const options = { mode: 'readwrite' }
    if ((await handle.queryPermission(options)) === 'granted') {
      return true
    }
    
    if ((await handle.requestPermission(options)) === 'granted') {
      return true
    }
    
    return false
  } catch {
    return false
  }
}

/**
 * Remove a stored directory handle or path
 * @param {string} key - Storage key
 */
export const removeStoredDirectoryHandle = async (key) => {
  if (isElectron()) {
    await window.electronAPI.deleteSetting(key)
    return
  }
  
  // Web fallback
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.delete(key)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch {
    // Ignore errors
  }
}

// ============================================
// Render Cache Operations
// ============================================

/**
 * Save a render cache file to the project's cache folder
 * @param {string|FileSystemDirectoryHandle} projectDir - The project directory
 * @param {string} clipId - The clip ID (used for filename)
 * @param {Blob} blob - The rendered video blob
 * @param {object} metadata - Cache metadata (hash, dimensions, etc.)
 * @returns {Promise<string>} - The relative path to the cached file
 */
export const saveRenderCache = async (projectDir, clipId, blob, metadata) => {
  const timestamp = Date.now()
  const filename = `${clipId}_${timestamp}.webm`
  const metaFilename = `${clipId}_${timestamp}.meta.json`
  
  if (isElectron()) {
    const cacheDir = await window.electronAPI.pathJoin(projectDir, 'cache')
    await window.electronAPI.createDirectory(cacheDir)
    
    const filePath = await window.electronAPI.pathJoin(cacheDir, filename)
    const metaPath = await window.electronAPI.pathJoin(cacheDir, metaFilename)
    
    // Write video blob
    const arrayBuffer = await blob.arrayBuffer()
    const result = await window.electronAPI.writeFileFromArrayBuffer(filePath, arrayBuffer)
    if (!result.success) {
      throw new Error(result.error)
    }
    
    // Write metadata
    const metaData = {
      ...metadata,
      clipId,
      filename,
      created: new Date().toISOString(),
    }
    const metaResult = await window.electronAPI.writeFile(metaPath, JSON.stringify(metaData, null, 2))
    if (!metaResult.success) {
      throw new Error(metaResult.error)
    }
    
    return `cache/${filename}`
  }
  
  // Web fallback
  const cacheDir = await projectDir.getDirectoryHandle('cache', { create: true })
  
  const fileHandle = await cacheDir.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(blob)
  await writable.close()
  
  const metaHandle = await cacheDir.getFileHandle(metaFilename, { create: true })
  const metaWritable = await metaHandle.createWritable()
  await metaWritable.write(JSON.stringify({
    ...metadata,
    clipId,
    filename,
    created: new Date().toISOString(),
  }, null, 2))
  await metaWritable.close()
  
  return `cache/${filename}`
}

/**
 * Load a render cache file from the project's cache folder
 * @param {string|FileSystemDirectoryHandle} projectDir - The project directory
 * @param {string} relativePath - The relative path to the cache file
 * @returns {Promise<{url: string, metadata: object}|null>}
 */
export const loadRenderCache = async (projectDir, relativePath) => {
  try {
    if (isElectron()) {
      const filePath = await window.electronAPI.pathJoin(projectDir, relativePath)
      const exists = await window.electronAPI.exists(filePath)
      if (!exists) {
        return null
      }
      
      const url = await window.electronAPI.getFileUrlDirect(filePath)
      
      // Try to load metadata
      const metaPath = filePath.replace('.webm', '.meta.json')
      let metadata = null
      if (await window.electronAPI.exists(metaPath)) {
        const metaResult = await window.electronAPI.readFile(metaPath, { encoding: 'utf8' })
        if (metaResult.success) {
          metadata = JSON.parse(metaResult.data)
        }
      }
      
      return { url, metadata }
    }
    
    // Web fallback
    const file = await readProjectFile(projectDir, relativePath)
    const url = URL.createObjectURL(file)
    
    const metaPath = relativePath.replace('.webm', '.meta.json')
    let metadata = null
    try {
      const metaFile = await readProjectFile(projectDir, metaPath)
      metadata = JSON.parse(await metaFile.text())
    } catch {
      // Metadata file might not exist
    }
    
    return { url, metadata }
  } catch (err) {
    console.warn('Failed to load render cache:', err)
    return null
  }
}

/**
 * List all render caches in the project
 * @param {string|FileSystemDirectoryHandle} projectDir - The project directory
 * @returns {Promise<Array<{clipId: string, path: string, metadata: object}>>}
 */
export const listRenderCaches = async (projectDir) => {
  const caches = []
  
  try {
    if (isElectron()) {
      const cacheDir = await window.electronAPI.pathJoin(projectDir, 'cache')
      const exists = await window.electronAPI.exists(cacheDir)
      if (!exists) {
        return []
      }
      
      const result = await window.electronAPI.listDirectory(cacheDir)
      if (!result.success) {
        return []
      }
      
      for (const entry of result.items) {
        if (entry.isFile && entry.name.endsWith('.webm')) {
          const clipId = entry.name.split('_')[0]
          const path = `cache/${entry.name}`
          
          // Try to load metadata
          let metadata = null
          const metaName = entry.name.replace('.webm', '.meta.json')
          const metaPath = await window.electronAPI.pathJoin(cacheDir, metaName)
          if (await window.electronAPI.exists(metaPath)) {
            const metaResult = await window.electronAPI.readFile(metaPath, { encoding: 'utf8' })
            if (metaResult.success) {
              metadata = JSON.parse(metaResult.data)
            }
          }
          
          caches.push({ clipId, path, metadata })
        }
      }
    } else {
      // Web fallback
      const cacheDir = await projectDir.getDirectoryHandle('cache', { create: false })
      
      for await (const entry of cacheDir.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.webm')) {
          const clipId = entry.name.split('_')[0]
          const path = `cache/${entry.name}`
          
          let metadata = null
          try {
            const metaName = entry.name.replace('.webm', '.meta.json')
            const metaHandle = await cacheDir.getFileHandle(metaName)
            const metaFile = await metaHandle.getFile()
            metadata = JSON.parse(await metaFile.text())
          } catch {
            // Metadata might not exist
          }
          
          caches.push({ clipId, path, metadata })
        }
      }
    }
  } catch (err) {
    if (err.name !== 'NotFoundError') {
      console.warn('Error listing render caches:', err)
    }
  }
  
  return caches
}

/**
 * Delete a render cache file
 * @param {string|FileSystemDirectoryHandle} projectDir - The project directory
 * @param {string} relativePath - The relative path to the cache file
 */
export const deleteRenderCache = async (projectDir, relativePath) => {
  try {
    if (isElectron()) {
      const filePath = await window.electronAPI.pathJoin(projectDir, relativePath)
      await window.electronAPI.deleteFile(filePath)
      
      const metaPath = filePath.replace('.webm', '.meta.json')
      await window.electronAPI.deleteFile(metaPath)
    } else {
      // Web fallback
      const cacheDir = await projectDir.getDirectoryHandle('cache', { create: false })
      const filename = relativePath.split('/').pop()
      
      await cacheDir.removeEntry(filename)
      
      const metaFilename = filename.replace('.webm', '.meta.json')
      try {
        await cacheDir.removeEntry(metaFilename)
      } catch {
        // Metadata might not exist
      }
    }
  } catch (err) {
    console.warn('Failed to delete render cache:', err)
  }
}

/**
 * Clear all render caches for a clip
 * @param {string|FileSystemDirectoryHandle} projectDir - The project directory
 * @param {string} clipId - The clip ID
 */
export const clearClipRenderCaches = async (projectDir, clipId) => {
  try {
    if (isElectron()) {
      const cacheDir = await window.electronAPI.pathJoin(projectDir, 'cache')
      const exists = await window.electronAPI.exists(cacheDir)
      if (!exists) return
      
      const result = await window.electronAPI.listDirectory(cacheDir)
      if (!result.success) return
      
      for (const entry of result.items) {
        if (entry.isFile && entry.name.startsWith(`${clipId}_`)) {
          await window.electronAPI.deleteFile(entry.path)
        }
      }
    } else {
      // Web fallback
      const cacheDir = await projectDir.getDirectoryHandle('cache', { create: false })
      
      const toDelete = []
      for await (const entry of cacheDir.values()) {
        if (entry.kind === 'file' && entry.name.startsWith(`${clipId}_`)) {
          toDelete.push(entry.name)
        }
      }
      
      for (const filename of toDelete) {
        await cacheDir.removeEntry(filename)
      }
    }
  } catch (err) {
    if (err.name !== 'NotFoundError') {
      console.warn('Failed to clear clip render caches:', err)
    }
  }
}

// ============================================
// Export
// ============================================

export default {
  isElectron,
  isFileSystemSupported,
  requestDirectoryAccess,
  openProjectFolder,
  createProjectFolder,
  saveProject,
  loadProject,
  isValidProject,
  listProjects,
  importAsset,
  readProjectFile,
  getProjectFileUrl,
  getAbsoluteFileUrl,
  deleteProjectFile,
  storeDirectoryHandle,
  getStoredDirectoryHandle,
  verifyPermission,
  removeStoredDirectoryHandle,
  saveRenderCache,
  loadRenderCache,
  listRenderCaches,
  deleteRenderCache,
  clearClipRenderCaches,
}
