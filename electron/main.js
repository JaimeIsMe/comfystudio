const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs').promises
const fsSync = require('fs')
const http = require('http')
const { spawn } = require('child_process')
const { fileURLToPath } = require('url')
const ffmpegPath = require('ffmpeg-static')
const ffprobeStatic = require('ffprobe-static')
const ffprobePath = ffprobeStatic?.path || ffprobeStatic

const isDev = !app.isPackaged

// App icon (build/icon.png) – used for window and taskbar/dock
const iconPath = path.join(__dirname, '..', 'build', 'icon.png')

const SPLASH_MIN_DURATION_MS = 4500  // Minimum time splash is visible (Resolve-style)
const COMFYUI_CHECK_MS = 2500        // Max wait for ComfyUI
const STEP_DELAY_MS = 400            // Delay between status messages
const COMFY_CONNECTION_SETTING_KEY = 'comfyConnection'
const DEFAULT_LOCAL_COMFY_PORT = 8188

let mainWindow = null
let splashWindow = null
let exportWorkerWindow = null
const settingsPath = path.join(app.getPath('userData'), 'settings.json')

function setSplashStatus(text) {
  if (!splashWindow || splashWindow.isDestroyed()) return
  const escaped = JSON.stringify(String(text))
  splashWindow.webContents.executeJavaScript(`document.getElementById('splash-status').textContent = ${escaped}`).catch(() => {})
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function sanitizeLocalComfyPort(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return null
  if (parsed < 1 || parsed > 65535) return null
  return parsed
}

async function resolveLocalComfyPort() {
  try {
    const data = await fs.readFile(settingsPath, 'utf8')
    const settings = JSON.parse(data)
    const raw = settings?.[COMFY_CONNECTION_SETTING_KEY]
    const rawPort = raw && typeof raw === 'object' ? raw.port : raw
    return sanitizeLocalComfyPort(rawPort) || DEFAULT_LOCAL_COMFY_PORT
  } catch {
    return DEFAULT_LOCAL_COMFY_PORT
  }
}

async function checkComfyUIRunning(portOverride = null) {
  const port = sanitizeLocalComfyPort(portOverride) || await resolveLocalComfyPort()
  const healthUrl = `http://127.0.0.1:${port}/system_stats`
  return new Promise((resolve) => {
    const req = http.get(healthUrl, (res) => {
      resolve({
        ok: res.statusCode === 200 || (res.statusCode >= 200 && res.statusCode < 400),
        port,
      })
    })
    req.on('error', () => resolve({ ok: false, port }))
    req.setTimeout(COMFYUI_CHECK_MS, () => {
      req.destroy()
      resolve({ ok: false, port })
    })
  })
}

async function runStartupChecks() {
  const start = Date.now()
  if (!splashWindow || splashWindow.isDestroyed()) return

  const comfyPort = await resolveLocalComfyPort()
  setSplashStatus(`Checking ComfyUI on localhost:${comfyPort}…`)
  const comfyCheck = await checkComfyUIRunning(comfyPort)
  if (comfyCheck.ok) {
    setSplashStatus(`ComfyUI connected (localhost:${comfyCheck.port})`)
  } else {
    setSplashStatus(`ComfyUI not detected on localhost:${comfyCheck.port}`)
  }
  await delay(STEP_DELAY_MS)

  setSplashStatus('Loading project page…')
  await delay(STEP_DELAY_MS)
  setSplashStatus('Loading media page…')
  await delay(STEP_DELAY_MS)
  setSplashStatus('Loading workspace…')
  await delay(STEP_DELAY_MS)

  const elapsed = Date.now() - start
  const remaining = Math.max(0, SPLASH_MIN_DURATION_MS - elapsed)
  if (remaining > 0) {
    await delay(remaining)
  }
}

// ============================================
// Window Controls
// ============================================

ipcMain.handle('window:minimize', () => {
  if (mainWindow) {
    mainWindow.minimize()
  }
  return true
})

ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return false
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
  return true
})

ipcMain.handle('window:close', () => {
  if (mainWindow) {
    mainWindow.close()
  }
  return true
})

ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false
})

ipcMain.handle('window:toggleFullScreen', () => {
  if (!mainWindow) return false
  mainWindow.setFullScreen(!mainWindow.isFullScreen())
  return true
})

// Register custom protocol for serving local files
function registerFileProtocol() {
  protocol.handle('comfystudio', async (request) => {
    const url = request.url.replace('comfystudio://', '')
    const filePath = decodeURIComponent(url)
    
    try {
      // Security: Only allow access to files within user's documents or app paths
      const normalizedPath = path.normalize(filePath)
      
      return net.fetch(`file://${normalizedPath}`)
    } catch (err) {
      console.error('Protocol error:', err)
      return new Response('File not found', { status: 404 })
    }
  })
}

function createSplashWindow() {
  const splashPath = isDev
    ? path.join(__dirname, '../public/splash.html')
    : path.join(__dirname, '../dist/splash.html')
  // Match your splash image aspect ratio (1632×656); extra height for status bar
  const SPLASH_ASPECT = 1632 / 656
  const splashWidth = 1200
  const statusBarHeight = 44
  const splashHeight = Math.round(splashWidth / SPLASH_ASPECT) + statusBarHeight
  splashWindow = new BrowserWindow({
    width: splashWidth,
    height: splashHeight,
    icon: iconPath,
    backgroundColor: '#0a0a0b',
    frame: false,
    transparent: false,
    center: true,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  splashWindow.loadFile(splashPath)
  splashWindow.on('closed', () => {
    splashWindow = null
  })
  return splashWindow
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    icon: iconPath,
    backgroundColor: '#0a0a0b',
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? true : false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // In dev mode, disable web security to allow file:// URLs from localhost
      // In production, the app loads from file:// so this isn't an issue
      webSecurity: !isDev,
    }
  })

  // Start in fullscreen (F11-style: takes over entire screen, no taskbar)
  mainWindow.setFullScreen(true)

  // Load the app
  if (isDev) {
    // Try common Vite ports in case 5173 is in use
    const tryPorts = [5173, 5174, 5175, 5176]
    let loaded = false
    
    for (const port of tryPorts) {
      try {
        await mainWindow.loadURL(`http://127.0.0.1:${port}`)
        console.log(`Loaded from port ${port}`)
        loaded = true
        break
      } catch (err) {
        console.log(`Port ${port} not available, trying next...`)
      }
    }
    
    if (!loaded) {
      console.error('Could not connect to Vite dev server on any port')
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
  
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  
  // Register keyboard shortcut for DevTools (F12 or Ctrl+Shift+I)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || 
        (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools()
      event.preventDefault()
    }
  })
}

// ============================================
// IPC Handlers - Dialog Operations
// ============================================

ipcMain.handle('dialog:selectDirectory', async (event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: options.title || 'Select Folder',
    defaultPath: options.defaultPath || app.getPath('documents'),
  })
  
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  
  return result.filePaths[0]
})

ipcMain.handle('dialog:selectFile', async (event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', ...(options.multiple ? ['multiSelections'] : [])],
    title: options.title || 'Select File',
    defaultPath: options.defaultPath || app.getPath('documents'),
    filters: options.filters || [
      { name: 'Media Files', extensions: ['mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg', 'jpg', 'jpeg', 'png', 'gif', 'webp'] },
      { name: 'All Files', extensions: ['*'] }
    ],
  })
  
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  
  return options.multiple ? result.filePaths : result.filePaths[0]
})

ipcMain.handle('dialog:saveFile', async (event, options = {}) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options.title || 'Save File',
    defaultPath: options.defaultPath || app.getPath('documents'),
    filters: options.filters || [
      { name: 'All Files', extensions: ['*'] }
    ],
  })
  
  if (result.canceled) {
    return null
  }
  
  return result.filePath
})

// ============================================
// IPC Handlers - File System Operations
// ============================================

ipcMain.handle('fs:exists', async (event, filePath) => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
})

ipcMain.handle('fs:isDirectory', async (event, filePath) => {
  try {
    const stat = await fs.stat(filePath)
    return stat.isDirectory()
  } catch {
    return false
  }
})

ipcMain.handle('fs:createDirectory', async (event, dirPath, options = {}) => {
  try {
    await fs.mkdir(dirPath, { recursive: options.recursive !== false })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('fs:readFile', async (event, filePath, options = {}) => {
  try {
    const encoding = options.encoding || null // null returns Buffer
    const data = await fs.readFile(filePath, encoding)
    
    // If no encoding specified, return as base64 for binary files
    if (!encoding) {
      return { success: true, data: data.toString('base64'), encoding: 'base64' }
    }
    
    return { success: true, data, encoding }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('fs:readFileAsBuffer', async (event, filePath) => {
  try {
    const data = await fs.readFile(filePath)
    const slice = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    return { success: true, data: slice }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('fs:writeFile', async (event, filePath, data, options = {}) => {
  try {
    // Ensure parent directory exists
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    
    // Handle different data types
    let writeData = data
    if (options.encoding === 'base64') {
      writeData = Buffer.from(data, 'base64')
    } else if (typeof data === 'object' && !Buffer.isBuffer(data)) {
      // JSON object
      writeData = JSON.stringify(data, null, 2)
    }
    
    await fs.writeFile(filePath, writeData, options.encoding === 'base64' ? null : options)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('fs:writeFileFromArrayBuffer', async (event, filePath, arrayBuffer) => {
  try {
    // Ensure parent directory exists
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    
    const buffer = Buffer.from(arrayBuffer)
    await fs.writeFile(filePath, buffer)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('fs:deleteFile', async (event, filePath) => {
  try {
    await fs.unlink(filePath)
    return { success: true }
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { success: true } // Already deleted
    }
    return { success: false, error: err.message }
  }
})

ipcMain.handle('fs:deleteDirectory', async (event, dirPath, options = {}) => {
  try {
    await fs.rm(dirPath, { recursive: options.recursive !== false, force: true })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('fs:copyFile', async (event, srcPath, destPath) => {
  try {
    // Ensure destination directory exists
    const dir = path.dirname(destPath)
    await fs.mkdir(dir, { recursive: true })
    
    await fs.copyFile(srcPath, destPath)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('fs:moveFile', async (event, srcPath, destPath) => {
  try {
    // Ensure destination directory exists
    const dir = path.dirname(destPath)
    await fs.mkdir(dir, { recursive: true })
    
    await fs.rename(srcPath, destPath)
    return { success: true }
  } catch (err) {
    // If rename fails (cross-device), fall back to copy + delete
    if (err.code === 'EXDEV') {
      await fs.copyFile(srcPath, destPath)
      await fs.unlink(srcPath)
      return { success: true }
    }
    return { success: false, error: err.message }
  }
})

ipcMain.handle('fs:listDirectory', async (event, dirPath, options = {}) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    
    const items = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name)
      let stat = null
      
      if (options.includeStats) {
        try {
          stat = await fs.stat(fullPath)
        } catch {
          // Ignore stat errors
        }
      }
      
      return {
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        size: stat?.size,
        modified: stat?.mtime?.toISOString(),
        created: stat?.birthtime?.toISOString(),
      }
    }))
    
    return { success: true, items }
  } catch (err) {
    return { success: false, error: err.message, items: [] }
  }
})

ipcMain.handle('fs:getFileInfo', async (event, filePath) => {
  try {
    const stat = await fs.stat(filePath)
    return {
      success: true,
      info: {
        name: path.basename(filePath),
        path: filePath,
        size: stat.size,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        modified: stat.mtime.toISOString(),
        created: stat.birthtime.toISOString(),
      }
    }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ============================================
// IPC Handlers - Path Operations
// ============================================

ipcMain.handle('path:join', (event, ...parts) => {
  return path.join(...parts)
})

ipcMain.handle('path:dirname', (event, filePath) => {
  return path.dirname(filePath)
})

ipcMain.handle('path:basename', (event, filePath, ext) => {
  return path.basename(filePath, ext)
})

ipcMain.handle('path:extname', (event, filePath) => {
  return path.extname(filePath)
})

ipcMain.handle('path:normalize', (event, filePath) => {
  return path.normalize(filePath)
})

ipcMain.handle('path:getAppPath', (event, name) => {
  // Valid names: home, appData, userData, documents, downloads, music, pictures, videos, temp
  return app.getPath(name)
})

// ============================================
// IPC Handlers - Media Info (using HTML5 in renderer for now)
// Future: Replace with FFprobe for frame-accurate info
// ============================================

ipcMain.handle('media:getFileUrl', (event, filePath) => {
  // Convert file path to comfystudio:// protocol URL
  const encodedPath = encodeURIComponent(filePath)
  return `comfystudio://${encodedPath}`
})

ipcMain.handle('media:getFileUrlDirect', (event, filePath) => {
  // Return file:// URL directly (for when protocol isn't working)
  // Normalize path for URL
  let normalizedPath = filePath.replace(/\\/g, '/')
  if (!normalizedPath.startsWith('/')) {
    normalizedPath = '/' + normalizedPath
  }
  return `file://${normalizedPath}`
})

ipcMain.handle('media:getVideoFps', async (event, filePath) => {
  if (!ffprobePath) {
    return { success: false, error: 'FFprobe binary not available.' }
  }

  const parseFps = (value) => {
    if (!value || value === '0/0') return null
    const [num, den] = String(value).split('/').map(Number)
    if (!den || !num) return null
    return num / den
  }

  return await new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,avg_frame_rate,r_frame_rate',
      '-of', 'json',
      filePath
    ]

    const proc = spawn(ffprobePath, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    proc.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: stderr || `FFprobe exited with code ${code}` })
        return
      }
      try {
        const parsed = JSON.parse(stdout)
        const streams = Array.isArray(parsed?.streams) ? parsed.streams : []
        const videoStream = streams.find((stream) => stream?.codec_type === 'video') || null
        const fps = parseFps(videoStream?.avg_frame_rate) || parseFps(videoStream?.r_frame_rate)
        const hasAudio = streams.some((stream) => stream?.codec_type === 'audio')
        resolve({ success: true, fps: fps || null, hasAudio })
      } catch (err) {
        resolve({ success: false, error: err.message })
      }
    })
  })
})

const audioWaveformCache = new Map()

function resolveMediaInputPath(mediaInput) {
  if (!mediaInput || typeof mediaInput !== 'string') return null
  if (mediaInput.startsWith('comfystudio://')) {
    return decodeURIComponent(mediaInput.replace('comfystudio://', ''))
  }
  if (mediaInput.startsWith('file://')) {
    try {
      return fileURLToPath(mediaInput)
    } catch (_) {
      // Fallback for unusual path encodings
      let normalizedPath = mediaInput.replace('file://', '')
      normalizedPath = decodeURIComponent(normalizedPath)
      if (/^\/[a-zA-Z]:\//.test(normalizedPath)) {
        normalizedPath = normalizedPath.slice(1)
      }
      return normalizedPath.replace(/\//g, path.sep)
    }
  }
  return mediaInput
}

ipcMain.handle('media:getAudioWaveform', async (event, mediaInput, options = {}) => {
  if (!ffmpegPath) {
    return { success: false, error: 'FFmpeg binary not available.' }
  }

  const filePath = resolveMediaInputPath(mediaInput)
  if (!filePath) {
    return { success: false, error: 'Invalid audio input path.' }
  }

  const sampleCount = Math.max(128, Math.min(8192, Math.round(Number(options?.sampleCount) || 4096)))
  const sampleRate = Math.max(400, Math.min(6000, Math.round(Number(options?.sampleRate) || 2000)))

  let stat
  try {
    stat = await fs.stat(filePath)
  } catch (err) {
    return { success: false, error: `Audio file not found: ${err.message}` }
  }

  const cacheKey = `${filePath}|${sampleCount}|${sampleRate}|${stat.mtimeMs}`
  if (audioWaveformCache.has(cacheKey)) {
    return { success: true, ...audioWaveformCache.get(cacheKey) }
  }

  return await new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-i', filePath,
      '-vn',
      '-ac', '1',
      '-ar', String(sampleRate),
      '-f', 'f32le',
      'pipe:1',
    ]

    const proc = spawn(ffmpegPath, args, { windowsHide: true })
    const chunks = []
    let stderr = ''

    proc.stdout.on('data', (data) => {
      chunks.push(Buffer.from(data))
    })
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    proc.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: stderr || `FFmpeg exited with code ${code}` })
        return
      }

      try {
        const raw = Buffer.concat(chunks)
        const floatCount = Math.floor(raw.length / 4)
        if (floatCount <= 0) {
          resolve({ success: false, error: 'No audio samples decoded.' })
          return
        }

        const bucketCount = sampleCount
        const bucketSize = Math.max(1, Math.floor(floatCount / bucketCount))
        const peaks = new Array(bucketCount).fill(0)
        let maxPeak = 0

        for (let i = 0; i < bucketCount; i++) {
          const start = i * bucketSize
          const end = i === bucketCount - 1 ? floatCount : Math.min(floatCount, start + bucketSize)
          const span = Math.max(1, end - start)
          const stride = Math.max(1, Math.floor(span / 96))

          let peak = 0
          for (let s = start; s < end; s += stride) {
            const amp = Math.abs(raw.readFloatLE(s * 4))
            if (amp > peak) peak = amp
          }

          peaks[i] = peak
          if (peak > maxPeak) maxPeak = peak
        }

        if (maxPeak > 0) {
          for (let i = 0; i < peaks.length; i++) {
            peaks[i] = peaks[i] / maxPeak
          }
        }

        const result = {
          peaks,
          duration: floatCount / sampleRate,
        }
        audioWaveformCache.set(cacheKey, result)
        resolve({ success: true, ...result })
      } catch (err) {
        resolve({ success: false, error: err.message })
      }
    })
  })
})

// ============================================
// IPC Handlers - App Settings Storage
// ============================================

ipcMain.handle('settings:get', async (event, key) => {
  try {
    const data = await fs.readFile(settingsPath, 'utf8')
    const settings = JSON.parse(data)
    return key ? settings[key] : settings
  } catch {
    return key ? null : {}
  }
})

ipcMain.handle('settings:set', async (event, key, value) => {
  try {
    let settings = {}
    try {
      const data = await fs.readFile(settingsPath, 'utf8')
      settings = JSON.parse(data)
    } catch {
      // File doesn't exist yet
    }
    
    settings[key] = value
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('settings:delete', async (event, key) => {
  try {
    const data = await fs.readFile(settingsPath, 'utf8')
    const settings = JSON.parse(data)
    delete settings[key]
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ============================================
// Export Operations
// ============================================

ipcMain.handle('export:runInWorker', async (event, payload) => {
  if (exportWorkerWindow && !exportWorkerWindow.isDestroyed()) {
    return { success: false, error: 'Export already in progress' }
  }
  const workerUrl = isDev
    ? `http://127.0.0.1:5173?export=worker`
    : `file://${path.join(__dirname, '../dist/index.html')}?export=worker`
  exportWorkerWindow = new BrowserWindow({
    width: 400,
    height: 200,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Allow loading file:// URLs for video/image elements during export (otherwise "Media load rejected by URL safety check")
      webSecurity: false,
    },
  })
  const workerContents = exportWorkerWindow.webContents
  const forwardToMain = (channel, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }
  const onProgress = (event, data) => {
    if (event.sender === workerContents) forwardToMain('export:progress', data)
  }
  const onComplete = (event, data) => {
    if (event.sender === workerContents) {
      forwardToMain('export:complete', data)
      if (exportWorkerWindow && !exportWorkerWindow.isDestroyed()) {
        exportWorkerWindow.close()
        exportWorkerWindow = null
      }
    }
  }
  const onError = (event, err) => {
    if (event.sender === workerContents) {
      console.error('[Export] Worker reported error:', err, typeof err)
      forwardToMain('export:error', err)
      if (exportWorkerWindow && !exportWorkerWindow.isDestroyed()) {
        exportWorkerWindow.close()
        exportWorkerWindow = null
      }
    }
  }
  ipcMain.on('export:progress', onProgress)
  ipcMain.on('export:complete', onComplete)
  ipcMain.on('export:error', onError)
  const sendJob = () => {
    if (exportWorkerWindow && !exportWorkerWindow.isDestroyed()) {
      exportWorkerWindow.webContents.send('export:job', payload)
    }
  }
  ipcMain.once('export:workerReady', (event) => {
    if (event.sender === workerContents) sendJob()
  })
  exportWorkerWindow.on('closed', () => {
    ipcMain.removeListener('export:progress', onProgress)
    ipcMain.removeListener('export:complete', onComplete)
    ipcMain.removeListener('export:error', onError)
  })
  exportWorkerWindow.on('closed', () => {
    exportWorkerWindow = null
  })
  await exportWorkerWindow.loadURL(workerUrl)
  return { started: true }
})

const formatFilterNumber = (value, fallback = '0.000000') => {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(0, num).toFixed(6)
}

const getExportClipTimeScale = (clip) => {
  if (!clip) return 1
  const sourceScale = Number(clip.sourceTimeScale)
  const timelineFps = Number(clip.timelineFps)
  const sourceFps = Number(clip.sourceFps)
  const baseScale = Number.isFinite(sourceScale) && sourceScale > 0
    ? sourceScale
    : ((Number.isFinite(timelineFps) && timelineFps > 0 && Number.isFinite(sourceFps) && sourceFps > 0)
      ? (timelineFps / sourceFps)
      : 1)
  const speed = Number(clip.speed)
  const speedScale = Number.isFinite(speed) && speed > 0 ? speed : 1
  return baseScale * speedScale
}

const buildAtempoFilterChain = (rate) => {
  const safeRate = Math.max(0.01, Number(rate) || 1)
  let remaining = safeRate
  const filters = []
  let guard = 0
  while (remaining > 2 && guard < 16) {
    filters.push('atempo=2.0')
    remaining /= 2
    guard += 1
  }
  while (remaining < 0.5 && guard < 32) {
    filters.push('atempo=0.5')
    remaining /= 0.5
    guard += 1
  }
  filters.push(`atempo=${remaining.toFixed(6)}`)
  return filters
}

ipcMain.handle('export:mixAudio', async (event, options = {}) => {
  if (!ffmpegPath) {
    return { success: false, error: 'FFmpeg binary not available.' }
  }

  const {
    projectPath = '',
    outputPath,
    rangeStart = 0,
    rangeEnd = 0,
    sampleRate = 44100,
    channels = 2,
    clips = [],
    tracks = [],
    assets = [],
    timeoutMs = 180000,
  } = options

  if (!outputPath) {
    return { success: false, error: 'Missing output path for audio mix.' }
  }

  const start = Number(rangeStart)
  const end = Number(rangeEnd)
  const rangeStartSec = Number.isFinite(start) ? start : 0
  const rangeEndSec = Number.isFinite(end) ? end : rangeStartSec
  const totalDuration = Math.max(0, rangeEndSec - rangeStartSec)
  if (totalDuration <= 0.000001) {
    return { success: false, error: 'Invalid export range for audio mix.' }
  }

  const trackMap = new Map((tracks || []).map((track) => [track.id, track]))
  const assetMap = new Map((assets || []).map((asset) => [asset.id, asset]))
  const preparedInputs = []

  for (const clip of clips || []) {
    if (!clip || clip.type !== 'audio') continue
    const track = trackMap.get(clip.trackId)
    if (!track || track.type !== 'audio' || track.muted || track.visible === false) continue
    if (clip.reverse) continue // Matches timeline preview behavior (reverse audio is silent).

    const asset = assetMap.get(clip.assetId)
    if (!asset) continue

    let inputPath = null
    if (asset.path && projectPath) {
      inputPath = path.join(projectPath, asset.path)
    }
    if (!inputPath && asset.url) {
      inputPath = resolveMediaInputPath(asset.url)
    }
    if (!inputPath && clip.url) {
      inputPath = resolveMediaInputPath(clip.url)
    }
    if (!inputPath || !fsSync.existsSync(inputPath)) continue

    const clipStart = Number(clip.startTime) || 0
    const clipDuration = Math.max(0, Number(clip.duration) || 0)
    if (clipDuration <= 0.000001) continue
    const clipEnd = clipStart + clipDuration

    const visibleStart = Math.max(rangeStartSec, clipStart)
    const visibleEnd = Math.min(rangeEndSec, clipEnd)
    if (visibleEnd <= visibleStart) continue

    const clipOffsetOnTimeline = visibleStart - clipStart
    const timeScale = getExportClipTimeScale(clip)
    if (!Number.isFinite(timeScale) || timeScale <= 0) continue

    const trimStart = Math.max(0, Number(clip.trimStart) || 0)
    const sourceOffsetSec = Math.max(0, trimStart + clipOffsetOnTimeline * timeScale)
    const timelineVisibleSec = visibleEnd - visibleStart
    const sourceDurationSec = Math.max(0, timelineVisibleSec * timeScale)
    if (sourceDurationSec <= 0.000001) continue

    const delayMs = Math.max(0, Math.round((visibleStart - rangeStartSec) * 1000))
    preparedInputs.push({
      inputPath,
      sourceOffsetSec,
      sourceDurationSec,
      delayMs,
      timeScale,
      forceMono: track.channels === 'mono',
    })
  }

  if (preparedInputs.length === 0) {
    return { success: false, error: 'No eligible audio clips for mix.' }
  }

  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
  } catch (err) {
    return { success: false, error: err.message || 'Failed to prepare audio mix output folder.' }
  }

  const normalizedSampleRate = Math.max(8000, Math.min(192000, Math.round(Number(sampleRate) || 44100)))
  const normalizedChannels = Math.max(1, Math.min(2, Math.round(Number(channels) || 2)))
  const normalizedTimeout = Math.max(30000, Math.round(Number(timeoutMs) || 180000))

  const args = ['-y']
  for (const entry of preparedInputs) {
    args.push('-i', entry.inputPath)
  }

  const inputFilters = []
  const mixLabels = []
  preparedInputs.forEach((entry, index) => {
    const filters = [
      `atrim=start=${formatFilterNumber(entry.sourceOffsetSec)}:duration=${formatFilterNumber(entry.sourceDurationSec)}`,
      'asetpts=PTS-STARTPTS',
      ...buildAtempoFilterChain(entry.timeScale),
    ]

    if (entry.forceMono) {
      filters.push('aformat=channel_layouts=mono')
    }
    if (entry.delayMs > 0) {
      filters.push(`adelay=${entry.delayMs}:all=1`)
    }

    const label = `mix${index}`
    inputFilters.push(`[${index}:a]${filters.join(',')}[${label}]`)
    mixLabels.push(`[${label}]`)
  })

  const finalMixFilter = mixLabels.length === 1
    ? `${mixLabels[0]}atrim=duration=${formatFilterNumber(totalDuration)},asetpts=PTS-STARTPTS[outa]`
    : `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:dropout_transition=0,atrim=duration=${formatFilterNumber(totalDuration)},asetpts=PTS-STARTPTS[outa]`
  const filterComplex = `${inputFilters.join(';')};${finalMixFilter}`

  args.push(
    '-filter_complex', filterComplex,
    '-map', '[outa]',
    '-ar', String(normalizedSampleRate),
    '-ac', String(normalizedChannels),
    '-c:a', 'pcm_s16le',
    outputPath
  )

  return await new Promise((resolve) => {
    const ffmpeg = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    let killedByTimeout = false
    const timeoutHandle = setTimeout(() => {
      killedByTimeout = true
      ffmpeg.kill('SIGKILL')
    }, normalizedTimeout)

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    ffmpeg.on('error', (err) => {
      clearTimeout(timeoutHandle)
      resolve({ success: false, error: err.message })
    })

    ffmpeg.on('close', (code) => {
      clearTimeout(timeoutHandle)
      if (killedByTimeout) {
        resolve({ success: false, error: `Audio mix timed out after ${Math.round(normalizedTimeout / 1000)}s` })
        return
      }
      if (code === 0) {
        resolve({ success: true, clipCount: preparedInputs.length })
        return
      }
      resolve({ success: false, error: stderr || `FFmpeg exited with code ${code}` })
    })
  })
})

ipcMain.handle('export:encodeVideo', async (event, options = {}) => {
  const {
    framePattern,
    fps = 24,
    outputPath,
    audioPath = null,
    format = 'mp4',
    duration = null,
    videoCodec = 'h264',
    audioCodec = 'aac',
    proresProfile = '3',
    useHardwareEncoder = false,
    nvencPreset = 'p5',
    preset = 'medium',
    qualityMode = 'crf',
    crf = 18,
    bitrateKbps = 8000,
    keyframeInterval = null,
    audioBitrateKbps = 192,
    audioSampleRate = 44100
  } = options

  if (!ffmpegPath) {
    return { success: false, error: 'FFmpeg binary not available.' }
  }
  if (!framePattern || !outputPath) {
    return { success: false, error: 'Missing export inputs.' }
  }

  let encoderUsed = null
  const args = ['-y', '-framerate', String(fps), '-i', framePattern]
  if (audioPath) {
    args.push('-i', audioPath)
  }
  if (duration) {
    args.push('-t', String(duration))
  }

  const isProRes = videoCodec === 'prores' || (format === 'mov' && options.proresProfile != null)
  const normalizedCodec = isProRes
    ? 'prores'
    : (format === 'webm' || videoCodec === 'vp9'
      ? 'vp9'
      : (videoCodec === 'h265' ? 'h265' : 'h264'))

  if (normalizedCodec === 'prores') {
    const profileNum = Math.min(4, Math.max(0, parseInt(String(proresProfile), 10) || 3))
    args.push(
      '-c:v', 'prores_ks',
      '-profile:v', String(profileNum),
      '-pix_fmt', profileNum === 4 ? 'yuva444p10le' : 'yuv422p10le'
    )
    encoderUsed = 'prores_ks'
  } else if (normalizedCodec === 'vp9') {
    const vp9SpeedMap = {
      ultrafast: 8,
      superfast: 7,
      veryfast: 6,
      faster: 5,
      fast: 4,
      medium: 3,
      slow: 2,
      slower: 1,
      veryslow: 0,
    }
    args.push(
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', 'yuv420p',
      '-row-mt', '1',
      '-cpu-used', String(vp9SpeedMap[preset] ?? 3)
    )
    encoderUsed = 'libvpx-vp9'
    if (qualityMode === 'bitrate') {
      args.push('-b:v', `${bitrateKbps}k`)
    } else {
      args.push('-crf', String(crf), '-b:v', '0')
    }
  } else if (normalizedCodec === 'h265') {
    if (useHardwareEncoder) {
      args.push(
        '-c:v', 'hevc_nvenc',
        '-preset', nvencPreset,
        '-pix_fmt', 'yuv420p',
        '-rc', qualityMode === 'bitrate' ? 'vbr' : 'vbr'
      )
      encoderUsed = 'hevc_nvenc'
      if (qualityMode === 'bitrate') {
        args.push('-b:v', `${bitrateKbps}k`)
      } else {
        args.push('-cq', String(crf))
      }
    } else {
      args.push(
        '-c:v', 'libx265',
        '-preset', preset,
        '-pix_fmt', 'yuv420p'
      )
      encoderUsed = 'libx265'
      if (qualityMode === 'bitrate') {
        args.push('-b:v', `${bitrateKbps}k`)
      } else {
        args.push('-crf', String(crf))
      }
    }
    args.push('-tag:v', 'hvc1')
  } else {
    // Default to H.264
    if (useHardwareEncoder) {
      args.push(
        '-c:v', 'h264_nvenc',
        '-preset', nvencPreset,
        '-pix_fmt', 'yuv420p',
        '-rc', qualityMode === 'bitrate' ? 'vbr' : 'vbr'
      )
      encoderUsed = 'h264_nvenc'
      if (qualityMode === 'bitrate') {
        args.push('-b:v', `${bitrateKbps}k`)
      } else {
        args.push('-cq', String(crf))
      }
    } else {
      args.push(
        '-c:v', 'libx264',
        '-preset', preset,
        '-pix_fmt', 'yuv420p'
      )
      encoderUsed = 'libx264'
      if (qualityMode === 'bitrate') {
        args.push('-b:v', `${bitrateKbps}k`)
      } else {
        args.push('-crf', String(crf))
      }
    }
  }

  if (keyframeInterval && Number(keyframeInterval) > 0) {
    args.push('-g', String(keyframeInterval), '-keyint_min', String(keyframeInterval))
  }

  if (format === 'mp4') {
    args.push('-movflags', '+faststart')
  }

  if (audioPath) {
    const useOpus = format === 'webm' || audioCodec === 'opus'
    args.push('-c:a', useOpus ? 'libopus' : 'aac')
    args.push('-b:a', `${audioBitrateKbps}k`)
    args.push('-ar', String(audioSampleRate))
  }

  args.push(outputPath)
  console.log(`[Export] Encoding with ${encoderUsed} (${useHardwareEncoder ? 'NVENC' : 'software'})`)

  return await new Promise((resolve) => {
    const ffmpeg = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    ffmpeg.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, encoderUsed })
      } else {
        resolve({ success: false, error: stderr || `FFmpeg exited with code ${code}`, encoderUsed })
      }
    })
  })
})

// ============================================
// Playback cache (Flame-style: transcode for smooth playback)
// ============================================
ipcMain.handle('playback:transcode', async (event, { inputPath, outputPath }) => {
  if (!ffmpegPath) {
    return { success: false, error: 'FFmpeg binary not available.' }
  }
  if (!inputPath || !outputPath) {
    return { success: false, error: 'Missing inputPath or outputPath.' }
  }

  // Same dimensions, H.264, keyframe every 6 frames, no B-frames = easy decode
  const args = [
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-g', '6',
    '-keyint_min', '6',
    '-bf', '0',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '192k',
    outputPath
  ]

  return await new Promise((resolve) => {
    const ffmpeg = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    ffmpeg.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: stderr || `FFmpeg exited with code ${code}` })
      }
    })
  })
})

ipcMain.handle('export:checkNvenc', async () => {
  if (!ffmpegPath) {
    return { available: false, h264: false, h265: false, error: 'FFmpeg binary not available.' }
  }
  
  return await new Promise((resolve) => {
    const ffmpeg = spawn(ffmpegPath, ['-hide_banner', '-encoders'], { windowsHide: true })
    let output = ''
    
    ffmpeg.stdout.on('data', (data) => {
      output += data.toString()
    })
    ffmpeg.stderr.on('data', (data) => {
      output += data.toString()
    })
    
    ffmpeg.on('error', (err) => {
      resolve({ available: false, h264: false, h265: false, error: err.message })
    })
    
    ffmpeg.on('close', () => {
      const hasH264 = output.includes('h264_nvenc')
      const hasH265 = output.includes('hevc_nvenc')
      resolve({
        available: hasH264 || hasH265,
        h264: hasH264,
        h265: hasH265,
      })
    })
  })
})

// ============================================
// App Lifecycle
// ============================================

app.whenReady().then(() => {
  registerFileProtocol()
  const splash = createSplashWindow()
  splash.webContents.once('did-finish-load', () => {
    runStartupChecks()
      .then(() => {
        createWindow()
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.close()
          splashWindow = null
        }
      })
      .catch((err) => {
        console.error('Startup checks failed:', err)
        createWindow()
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.close()
          splashWindow = null
        }
      })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Handle any uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error)
})
