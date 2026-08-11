const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { spawn } = require('child_process')

const PYTHON_VERSION = '3.13.15'
const PYTHON_ARCHIVE_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`
const PYTHON_ARCHIVE_SHA256 = 'd1f04d990aee1253d8569e8e5104e30fa9f5fa830899f14843448872d936a2cf'
const MANAGED_RUNTIME_DIR = 'rtx-runtime-v1'
const RUNTIME_PACKAGES = Object.freeze([
  'numpy==2.2.6',
  'fastrlock==0.8.3',
  'cupy-cuda12x==13.6.0',
  'nvidia-vfx==0.1.0.1',
])
const RUNTIME_WHEELS = Object.freeze([
  Object.freeze({
    package: 'pip',
    filename: 'pip-bootstrap.zip',
    url: 'https://files.pythonhosted.org/packages/44/3c/d717024885424591d5376220b5e836c2d5293ce2011523c9de23ff7bf068/pip-25.3-py3-none-any.whl',
    sha256: '9655943313a94722b7774661c21049070f6bbb0a1516bf02f7c8d5d9201514cd',
    size: 1778622,
    bootstrap: true,
  }),
  Object.freeze({
    package: 'numpy',
    filename: 'numpy-2.2.6-cp313-cp313-win_amd64.whl',
    url: 'https://files.pythonhosted.org/packages/cb/3b/d58c12eafcb298d4e6d0d40216866ab15f59e55d148a5658bb3132311fcf/numpy-2.2.6-cp313-cp313-win_amd64.whl',
    sha256: 'b0544343a702fa80c95ad5d3d608ea3599dd54d4632df855e4c8d24eb6ecfa1c',
    size: 12610885,
  }),
  Object.freeze({
    package: 'fastrlock',
    filename: 'fastrlock-0.8.3-cp313-cp313-win_amd64.whl',
    url: 'https://files.pythonhosted.org/packages/28/a3/2ad0a0a69662fd4cf556ab8074f0de978ee9b56bff6ddb4e656df4aa9e8e/fastrlock-0.8.3-cp313-cp313-win_amd64.whl',
    sha256: '8d1d6a28291b4ace2a66bd7b49a9ed9c762467617febdd9ab356b867ed901af8',
    size: 30472,
  }),
  Object.freeze({
    package: 'cupy-cuda12x',
    filename: 'cupy_cuda12x-13.6.0-cp313-cp313-win_amd64.whl',
    url: 'https://files.pythonhosted.org/packages/72/36/c9e24acb19f039f814faea880b3704a3661edaa6739456b73b27540663e3/cupy_cuda12x-13.6.0-cp313-cp313-win_amd64.whl',
    sha256: '297b4268f839de67ef7865c2202d3f5a0fb8d20bd43360bc51b6e60cb4406447',
    size: 89750580,
  }),
  Object.freeze({
    package: 'nvidia-vfx',
    filename: 'nvidia_vfx-0.1.0.1-cp312-abi3-win_amd64.whl',
    url: 'https://pypi.nvidia.com/nvidia-vfx/nvidia_vfx-0.1.0.1-cp312-abi3-win_amd64.whl',
    sha256: 'b6cfaff5f435ad18329a1e1c1ac3ceb36f2aa6cfb0774d271c0bcc3aeaf31c53',
    size: 490396952,
  }),
])
const QUALITY_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH', 'ULTRA'])
const activeJobs = new Map()
let activeInstall = null

function createCancelledError(message = 'RTX operation cancelled') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function normalizeQuality(value = '') {
  const normalized = String(value || '').trim().toUpperCase()
  return QUALITY_LEVELS.has(normalized) ? normalized : 'HIGH'
}

function getManagedRuntimePaths(userDataPath) {
  const root = path.join(path.resolve(userDataPath), MANAGED_RUNTIME_DIR)
  return {
    root,
    pythonDir: path.join(root, 'python'),
    pythonPath: path.join(root, 'python', 'python.exe'),
    manifestPath: path.join(root, 'runtime.json'),
  }
}

function getComfyPythonCandidates(comfyRootPath = '') {
  const rootText = String(comfyRootPath || '').trim()
  if (!rootText) return []
  const root = path.resolve(rootText)
  const parent = path.dirname(root)
  const grandparent = path.dirname(parent)
  return [
    path.join(root, 'python_embeded', 'python.exe'),
    path.join(root, 'python_embedded', 'python.exe'),
    path.join(parent, 'python_embeded', 'python.exe'),
    path.join(parent, 'python_embedded', 'python.exe'),
    path.join(grandparent, 'python_embeded', 'python.exe'),
    path.join(grandparent, 'python_embedded', 'python.exe'),
  ]
}

function getRuntimeCandidates({ userDataPath, comfyRootPath = '', explicitPythonPath = '' }) {
  const managed = getManagedRuntimePaths(userDataPath)
  const candidates = [
    { pythonPath: managed.pythonPath, kind: 'managed', label: 'Velorn RTX runtime' },
  ]
  if (String(explicitPythonPath || '').trim()) {
    candidates.push({
      pythonPath: path.resolve(String(explicitPythonPath).trim()),
      kind: 'custom',
      label: 'Custom RTX Python runtime',
    })
  }
  for (const pythonPath of getComfyPythonCandidates(comfyRootPath)) {
    candidates.push({ pythonPath, kind: 'compatible-local', label: 'Compatible local RTX runtime' })
  }

  const seen = new Set()
  return candidates.filter((candidate) => {
    const key = path.normalize(candidate.pythonPath).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function tailLines(text = '', count = 16) {
  return String(text || '').split(/\r?\n/).filter(Boolean).slice(-count).join('\n')
}

function killProcessTree(child) {
  if (!child || child.exitCode !== null || child.killed) return
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.unref()
    return
  }
  child.kill('SIGTERM')
}

function runProcess(command, args = [], options = {}) {
  const {
    cwd = undefined,
    env = process.env,
    signal = null,
    timeoutMs = 0,
    onStdoutLine = null,
    onStderrLine = null,
  } = options

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createCancelledError())
      return
    }

    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let stdoutPending = ''
    let stderrPending = ''
    let settled = false
    let timeout = null

    const flushLines = (chunk, pending, callback) => {
      const combined = pending + chunk
      const lines = combined.split(/\r?\n/)
      const nextPending = lines.pop() || ''
      for (const line of lines) callback?.(line)
      return nextPending
    }
    const cleanup = () => {
      signal?.removeEventListener?.('abort', abort)
      if (timeout) clearTimeout(timeout)
    }
    const finish = (error, value) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(value)
    }
    const abort = () => {
      killProcessTree(child)
      finish(createCancelledError())
    }

    signal?.addEventListener?.('abort', abort, { once: true })
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        killProcessTree(child)
        finish(new Error(`Process timed out after ${Math.round(timeoutMs / 1000)} seconds.`))
      }, timeoutMs)
    }

    child.stdout.on('data', (data) => {
      const text = data.toString('utf8')
      stdout += text
      if (stdout.length > 512 * 1024) stdout = stdout.slice(-512 * 1024)
      stdoutPending = flushLines(text, stdoutPending, onStdoutLine)
    })
    child.stderr.on('data', (data) => {
      const text = data.toString('utf8')
      stderr += text
      if (stderr.length > 512 * 1024) stderr = stderr.slice(-512 * 1024)
      stderrPending = flushLines(text, stderrPending, onStderrLine)
    })
    child.on('error', (error) => finish(error))
    child.on('close', (code, processSignal) => {
      if (stdoutPending) onStdoutLine?.(stdoutPending)
      if (stderrPending) onStderrLine?.(stderrPending)
      finish(null, { code, signal: processSignal, stdout, stderr, child })
    })
  })
}

async function probePythonRuntime(pythonPath) {
  const code = [
    'import json',
    'import importlib.metadata as metadata',
    'import cupy as cp',
    'import nvvfx',
    'props = cp.cuda.runtime.getDeviceProperties(0)',
    'name = props.get("name", "NVIDIA GPU")',
    'name = name.decode("utf-8", errors="replace") if isinstance(name, bytes) else str(name)',
    'print(json.dumps({"gpu": name, "cupy": cp.__version__, "nvidiaVfx": metadata.version("nvidia-vfx")}))',
  ].join('; ')
  const result = await runProcess(pythonPath, ['-c', code], { timeoutMs: 45000 })
  if (result.code !== 0) {
    throw new Error(tailLines(result.stderr || result.stdout) || `Python exited with code ${result.code}.`)
  }
  const payloadLine = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop()
  try {
    return JSON.parse(payloadLine)
  } catch {
    throw new Error('The RTX runtime returned an invalid readiness response.')
  }
}

async function checkRtxRuntime(options = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    return {
      ready: false,
      installAvailable: false,
      error: 'NVIDIA RTX Video Super Resolution is currently available on 64-bit Windows only.',
    }
  }

  const candidates = getRuntimeCandidates(options)
  const failures = []
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.pythonPath)) continue
    try {
      const details = await probePythonRuntime(candidate.pythonPath)
      return {
        ready: true,
        installAvailable: true,
        ...candidate,
        ...details,
      }
    } catch (error) {
      failures.push(`${candidate.label}: ${error?.message || error}`)
    }
  }

  return {
    ready: false,
    installAvailable: true,
    error: failures.length > 0
      ? `A local Python runtime was found, but NVIDIA RTX support is incomplete. ${failures[0]}`
      : 'Install the optional Velorn RTX runtime to enable direct 4K upscaling. ComfyUI is not required.',
  }
}

function downloadFile(urlText, outputPath, options = {}, redirectsRemaining = 5) {
  const { signal = null, onProgress = () => {} } = options
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createCancelledError())
      return
    }
    const url = new URL(urlText)
    const transport = url.protocol === 'https:' ? https : http
    const partialPath = `${outputPath}.part`
    let request = null
    let output = null
    let settled = false

    const cleanup = () => signal?.removeEventListener?.('abort', abort)
    const finish = async (error, value) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        try { await fs.promises.rm(partialPath, { force: true }) } catch { /* ignore */ }
        reject(error)
      } else {
        resolve(value)
      }
    }
    const abort = () => {
      const error = createCancelledError('RTX runtime installation cancelled')
      output?.destroy(error)
      request?.destroy(error)
      void finish(error)
    }

    signal?.addEventListener?.('abort', abort, { once: true })
    request = transport.get(url, { headers: { 'User-Agent': 'Velorn RTX Runtime Installer' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        cleanup()
        settled = true
        if (redirectsRemaining <= 0) {
          reject(new Error('Too many redirects while downloading the RTX runtime.'))
          return
        }
        const redirected = new URL(response.headers.location, url).toString()
        downloadFile(redirected, outputPath, options, redirectsRemaining - 1).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        void finish(new Error(`Download failed with HTTP ${response.statusCode}.`))
        return
      }

      const totalBytes = Number(response.headers['content-length']) || null
      let transferredBytes = 0
      let lastProgressAt = 0
      output = fs.createWriteStream(partialPath)
      response.on('data', (chunk) => {
        transferredBytes += chunk.length
        const now = Date.now()
        if (now - lastProgressAt >= 200 || (totalBytes && transferredBytes >= totalBytes)) {
          lastProgressAt = now
          onProgress({ transferredBytes, totalBytes })
        }
      })
      response.on('error', (error) => void finish(error))
      output.on('error', (error) => void finish(error))
      output.on('close', async () => {
        if (settled) return
        try {
          await fs.promises.rm(outputPath, { force: true })
          await fs.promises.rename(partialPath, outputPath)
          onProgress({ transferredBytes, totalBytes: totalBytes || transferredBytes })
          await finish(null, { outputPath, transferredBytes, totalBytes })
        } catch (error) {
          await finish(error)
        }
      })
      response.pipe(output)
    })
    request.on('error', (error) => void finish(error))
  })
}

async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const input = fs.createReadStream(filePath)
    input.on('error', reject)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', () => resolve(hash.digest('hex')))
  })
}

async function expandZip(archivePath, destinationPath, signal = null) {
  await fs.promises.mkdir(destinationPath, { recursive: true })
  const script = '& { param($archive, $destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }'
  const result = await runProcess('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command', script,
    archivePath,
    destinationPath,
  ], { signal, timeoutMs: 120000 })
  if (result.code !== 0) {
    throw new Error(tailLines(result.stderr || result.stdout) || 'Could not extract the Python runtime.')
  }
}

async function enableEmbeddedPythonSitePackages(pythonDir) {
  const entries = await fs.promises.readdir(pythonDir)
  const pthName = entries.find((name) => /^python\d+\._pth$/i.test(name))
  if (!pthName) throw new Error('The embedded Python path configuration was not found.')
  const pthPath = path.join(pythonDir, pthName)
  const original = await fs.promises.readFile(pthPath, 'utf8')
  const lines = original.split(/\r?\n/)
  const next = []
  let hasSitePackages = false
  let hasImportSite = false
  for (const line of lines) {
    if (/^\s*#?\s*import\s+site\s*$/i.test(line)) {
      if (!hasImportSite) next.push('import site')
      hasImportSite = true
      continue
    }
    if (/^\s*Lib[\\/]site-packages\s*$/i.test(line)) hasSitePackages = true
    next.push(line)
  }
  if (!hasSitePackages) next.push('Lib\\site-packages')
  if (!hasImportSite) next.push('import site')
  await fs.promises.writeFile(pthPath, `${next.filter((line, index, all) => index < all.length - 1 || line).join('\r\n')}\r\n`, 'utf8')
}

function emitInstallProgress(onProgress, payload) {
  try { onProgress({ scope: 'rtx-runtime', ...payload }) } catch { /* renderer closed */ }
}

async function installRtxRuntime(options = {}) {
  if (activeInstall) return await activeInstall
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    return { success: false, error: 'The standalone RTX runtime is currently available on 64-bit Windows only.' }
  }

  const { userDataPath, signal = null, onProgress = () => {} } = options
  const managed = getManagedRuntimePaths(userDataPath)
  const temporaryRoot = path.join(path.dirname(managed.root), `.rtx-runtime-install-${crypto.randomUUID()}`)
  const pythonDir = path.join(temporaryRoot, 'python')
  const downloadsDir = path.join(temporaryRoot, 'downloads')
  const pythonArchive = path.join(downloadsDir, `python-${PYTHON_VERSION}.zip`)

  activeInstall = (async () => {
    try {
      await fs.promises.mkdir(downloadsDir, { recursive: true })
      emitInstallProgress(onProgress, {
        stage: 'python-download',
        percent: 1,
        message: 'Downloading the small Python runtime...',
      })
      await downloadFile(PYTHON_ARCHIVE_URL, pythonArchive, {
        signal,
        onProgress: ({ transferredBytes, totalBytes }) => {
          const ratio = totalBytes ? transferredBytes / totalBytes : 0
          emitInstallProgress(onProgress, {
            stage: 'python-download',
            percent: 1 + (ratio * 9),
            transferredBytes,
            totalBytes,
            message: totalBytes
              ? `Downloading Python runtime... ${Math.round(ratio * 100)}%`
              : 'Downloading Python runtime...',
          })
        },
      })
      const archiveHash = await sha256File(pythonArchive)
      if (archiveHash.toLowerCase() !== PYTHON_ARCHIVE_SHA256) {
        throw new Error('The downloaded Python runtime failed its integrity check.')
      }

      emitInstallProgress(onProgress, { stage: 'python-extract', percent: 11, message: 'Preparing the Python runtime...' })
      await expandZip(pythonArchive, pythonDir, signal)
      await enableEmbeddedPythonSitePackages(pythonDir)
      const pythonPath = path.join(pythonDir, 'python.exe')

      const wheelBytes = RUNTIME_WHEELS.reduce((total, wheel) => total + wheel.size, 0)
      let completedWheelBytes = 0
      for (const wheel of RUNTIME_WHEELS) {
        const wheelPath = path.join(downloadsDir, wheel.filename)
        emitInstallProgress(onProgress, {
          stage: 'packages-download',
          percent: 14 + ((completedWheelBytes / wheelBytes) * 68),
          message: wheel.package === 'nvidia-vfx'
            ? 'Downloading NVIDIA RTX Video Super Resolution...'
            : `Downloading ${wheel.package}...`,
        })
        await downloadFile(wheel.url, wheelPath, {
          signal,
          onProgress: ({ transferredBytes }) => {
            const currentBytes = Math.min(wheel.size, transferredBytes)
            emitInstallProgress(onProgress, {
              stage: 'packages-download',
              percent: 14 + (((completedWheelBytes + currentBytes) / wheelBytes) * 68),
              transferredBytes: completedWheelBytes + currentBytes,
              totalBytes: wheelBytes,
              message: wheel.package === 'nvidia-vfx'
                ? 'Downloading NVIDIA RTX Video Super Resolution...'
                : `Downloading ${wheel.package}...`,
            })
          },
        })
        const wheelHash = await sha256File(wheelPath)
        if (wheelHash.toLowerCase() !== wheel.sha256) {
          throw new Error(`The downloaded ${wheel.package} package failed its integrity check.`)
        }
        completedWheelBytes += wheel.size
      }

      emitInstallProgress(onProgress, {
        stage: 'pip-setup',
        percent: 83,
        message: 'Preparing the local package installer...',
      })
      const pipWheel = RUNTIME_WHEELS.find((wheel) => wheel.bootstrap)
      const sitePackagesPath = path.join(pythonDir, 'Lib', 'site-packages')
      await expandZip(path.join(downloadsDir, pipWheel.filename), sitePackagesPath, signal)

      emitInstallProgress(onProgress, {
        stage: 'packages-install',
        percent: 85,
        message: 'Installing NVIDIA RTX libraries (about 1 GB)...',
      })
      let packageProgress = 85
      const packageResult = await runProcess(pythonPath, [
        '-m', 'pip', 'install',
        '--disable-pip-version-check',
        '--no-input',
        '--no-cache-dir',
        '--no-index',
        '--find-links', downloadsDir,
        '--only-binary=:all:',
        '--upgrade',
        ...RUNTIME_PACKAGES,
      ], {
        signal,
        timeoutMs: 45 * 60 * 1000,
        onStdoutLine: (line) => {
          if (/^Processing\s+/i.test(line) || /^Installing collected packages/i.test(line)) {
            packageProgress = Math.min(94, packageProgress + 2)
            emitInstallProgress(onProgress, {
              stage: 'packages-install',
              percent: packageProgress,
              message: 'Installing NVIDIA RTX libraries...',
            })
          }
        },
      })
      if (packageResult.code !== 0) {
        throw new Error(tailLines(packageResult.stderr || packageResult.stdout) || 'Could not install NVIDIA RTX libraries.')
      }

      emitInstallProgress(onProgress, { stage: 'verify', percent: 96, message: 'Checking the GPU and RTX runtime...' })
      const details = await probePythonRuntime(pythonPath)
      await fs.promises.rm(downloadsDir, { recursive: true, force: true })
      await fs.promises.writeFile(path.join(temporaryRoot, 'runtime.json'), JSON.stringify({
        runtimeVersion: 1,
        pythonVersion: PYTHON_VERSION,
        packages: RUNTIME_PACKAGES,
        installedAt: new Date().toISOString(),
        ...details,
      }, null, 2), 'utf8')

      await fs.promises.rm(managed.root, { recursive: true, force: true })
      await fs.promises.rename(temporaryRoot, managed.root)
      emitInstallProgress(onProgress, { stage: 'complete', percent: 100, message: 'NVIDIA RTX runtime is ready.' })
      return {
        success: true,
        ready: true,
        pythonPath: managed.pythonPath,
        kind: 'managed',
        label: 'Velorn RTX runtime',
        ...details,
      }
    } catch (error) {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {})
      if (signal?.aborted || error?.name === 'AbortError') {
        return { success: false, cancelled: true, error: 'RTX runtime installation cancelled.' }
      }
      return { success: false, error: error?.message || String(error) }
    } finally {
      activeInstall = null
    }
  })()

  return await activeInstall
}

function buildRtxHelperArgs(options = {}) {
  const width = Math.max(8, Math.round(Number(options.width) || 3840))
  const height = Math.max(8, Math.round(Number(options.height) || 2160))
  if (width > 8192 || height > 8192) throw new Error('RTX output dimensions cannot exceed 8192 pixels.')
  return [
    options.helperPath,
    '--input', path.resolve(options.inputPath),
    '--output', path.resolve(options.outputPath),
    '--width', String(width),
    '--height', String(height),
    '--quality', normalizeQuality(options.quality),
    '--ffmpeg', path.resolve(options.ffmpegPath),
    '--ffprobe', path.resolve(options.ffprobePath),
    '--encoder', String(options.encoder || 'h264_nvenc'),
    '--cq', String(Math.max(0, Math.min(51, Math.round(Number(options.cq) || 18)))),
  ]
}

async function runRtxVideoUpscale(options = {}) {
  const {
    jobId = `rtx-${crypto.randomUUID()}`,
    runtime,
    inputPath,
    outputPath,
    helperPath,
    ffmpegPath,
    ffprobePath,
    onProgress = () => {},
  } = options
  if (!runtime?.pythonPath || !fs.existsSync(runtime.pythonPath)) throw new Error('The NVIDIA RTX runtime is not ready.')
  if (!inputPath || !fs.existsSync(path.resolve(inputPath))) throw new Error('The RTX source video does not exist.')
  if (!outputPath) throw new Error('No RTX output path was provided.')
  if (!helperPath || !fs.existsSync(helperPath)) throw new Error('The Velorn RTX helper is missing.')
  if (!ffmpegPath || !fs.existsSync(ffmpegPath) || !ffprobePath || !fs.existsSync(ffprobePath)) {
    throw new Error('Velorn could not find its FFmpeg tools.')
  }
  if (path.resolve(inputPath).toLowerCase() === path.resolve(outputPath).toLowerCase()) {
    throw new Error('The RTX output must use a different path from the source render.')
  }
  if (activeJobs.has(jobId)) throw new Error(`RTX job ${jobId} is already running.`)

  await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true })
  const args = buildRtxHelperArgs({ ...options, helperPath, ffmpegPath, ffprobePath })
  let helperError = null
  let completion = null
  let stdoutPending = ''
  let stderr = ''
  let cancelled = false

  const child = spawn(runtime.pythonPath, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  activeJobs.set(jobId, { child, outputPath: path.resolve(outputPath), cancel: () => { cancelled = true; killProcessTree(child) } })

  const consumeLine = (line) => {
    const trimmed = String(line || '').trim()
    if (!trimmed) return
    let event
    try { event = JSON.parse(trimmed) } catch { return }
    if (event.event === 'error') helperError = event
    if (event.event === 'complete') completion = event
    try { onProgress({ jobId, ...event }) } catch { /* renderer closed */ }
  }

  try {
    const result = await new Promise((resolve, reject) => {
      child.stdout.on('data', (data) => {
        const combined = stdoutPending + data.toString('utf8')
        const lines = combined.split(/\r?\n/)
        stdoutPending = lines.pop() || ''
        lines.forEach(consumeLine)
      })
      child.stderr.on('data', (data) => {
        stderr += data.toString('utf8')
        if (stderr.length > 256 * 1024) stderr = stderr.slice(-256 * 1024)
      })
      child.on('error', reject)
      child.on('close', (code, processSignal) => {
        if (stdoutPending) consumeLine(stdoutPending)
        resolve({ code, signal: processSignal })
      })
    })

    if (cancelled) throw createCancelledError('RTX upscale cancelled')
    if (result.code !== 0 || !completion) {
      throw new Error(helperError?.message || tailLines(stderr) || `RTX helper exited with code ${result.code}.`)
    }
    if (!fs.existsSync(path.resolve(outputPath))) throw new Error('RTX upscale completed without creating an output video.')
    return {
      success: true,
      jobId,
      outputPath: path.resolve(outputPath),
      runtimeKind: runtime.kind,
      runtimeLabel: runtime.label,
      ...completion,
    }
  } catch (error) {
    await fs.promises.rm(path.resolve(outputPath), { force: true }).catch(() => {})
    if (cancelled || error?.name === 'AbortError') {
      return { success: false, cancelled: true, jobId, error: 'RTX upscale cancelled.' }
    }
    return { success: false, jobId, error: error?.message || String(error) }
  } finally {
    activeJobs.delete(jobId)
  }
}

function cancelRtxVideoUpscale(jobId = '') {
  const job = activeJobs.get(String(jobId || '').trim())
  if (!job) return { success: false, error: 'RTX job is not running.' }
  job.cancel()
  return { success: true, cancelled: true, jobId }
}

module.exports = {
  MANAGED_RUNTIME_DIR,
  PYTHON_ARCHIVE_SHA256,
  PYTHON_ARCHIVE_URL,
  PYTHON_VERSION,
  RUNTIME_PACKAGES,
  RUNTIME_WHEELS,
  buildRtxHelperArgs,
  cancelRtxVideoUpscale,
  checkRtxRuntime,
  getComfyPythonCandidates,
  getManagedRuntimePaths,
  getRuntimeCandidates,
  installRtxRuntime,
  normalizeQuality,
  probePythonRuntime,
  runRtxVideoUpscale,
}
