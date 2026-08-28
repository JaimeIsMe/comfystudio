const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 20000
const COMMAND_MAX_BUFFER = 16 * 1024 * 1024

let cachedResult = null
let pendingDiscovery = null

function normalizeFontFamily(value) {
  if (typeof value !== 'string') return null
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized || normalized.length > 160) return null
  return normalized
}

function uniqueFontFamilies(values = []) {
  const seen = new Set()
  const families = []

  for (const value of values) {
    const family = normalizeFontFamily(value)
    if (!family) continue
    const key = family.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    families.push(family)
  }

  return families.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

function parseLineSeparatedFamilies(output = '') {
  return uniqueFontFamilies(String(output).split(/\r?\n/))
}

function parseFontconfigFamilies(output = '') {
  const aliases = []
  for (const line of String(output).split(/\r?\n/)) {
    for (const family of line.split(',')) aliases.push(family)
  }
  return uniqueFontFamilies(aliases)
}

function parseSystemProfilerFamilies(output = '') {
  let parsed
  try {
    parsed = JSON.parse(String(output))
  } catch (_) {
    return []
  }

  const families = []
  const visit = (value) => {
    if (!value) return
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value !== 'object') return

    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLocaleLowerCase().replace(/[^a-z]/g, '')
      if (
        typeof child === 'string'
        && (normalizedKey === 'family' || normalizedKey === 'fontfamily' || normalizedKey === 'familyname')
      ) {
        families.push(child)
      }
      visit(child)
    }
  }

  visit(parsed)
  return uniqueFontFamilies(families)
}

async function defaultCommandRunner(command, args) {
  return execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: COMMAND_MAX_BUFFER,
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  })
}

async function discoverLinuxFonts(runCommand) {
  const { stdout = '' } = await runCommand('fc-list', ['--format=%{family}\n'])
  return { fonts: parseFontconfigFamilies(stdout), source: 'fontconfig' }
}

async function discoverMacFonts(runCommand) {
  const { stdout = '' } = await runCommand('/usr/sbin/system_profiler', [
    'SPFontsDataType',
    '-json',
    '-detailLevel',
    'mini',
  ])
  return { fonts: parseSystemProfilerFamilies(stdout), source: 'system_profiler' }
}

async function discoverWindowsFonts(runCommand, env) {
  const systemRoot = env.SystemRoot || env.WINDIR || 'C:\\Windows'
  const bundledPowerShell = path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  const powerShell = fs.existsSync(bundledPowerShell) ? bundledPowerShell : 'powershell.exe'
  const script = [
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
    'Add-Type -AssemblyName System.Drawing',
    '$fonts = New-Object System.Drawing.Text.InstalledFontCollection',
    '$fonts.Families | ForEach-Object { $_.Name }',
  ].join('; ')
  const { stdout = '' } = await runCommand(powerShell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ])
  return { fonts: parseLineSeparatedFamilies(stdout), source: 'windows-font-collection' }
}

async function discoverSystemFonts({
  platform = process.platform,
  env = process.env,
  runCommand = defaultCommandRunner,
} = {}) {
  if (platform === 'win32') return discoverWindowsFonts(runCommand, env)
  if (platform === 'darwin') return discoverMacFonts(runCommand)
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') {
    return discoverLinuxFonts(runCommand)
  }
  return { fonts: [], source: 'unsupported-platform' }
}

async function listSystemFonts(options = {}) {
  const forceRefresh = options.forceRefresh === true
  if (!forceRefresh && cachedResult) {
    return { ...cachedResult, cached: true }
  }
  if (!forceRefresh && pendingDiscovery) return pendingDiscovery

  const discovery = (async () => {
    try {
      const result = await discoverSystemFonts(options)
      const fonts = uniqueFontFamilies(result.fonts)
      const nextResult = {
        success: fonts.length > 0,
        fonts,
        source: result.source,
        ...(fonts.length > 0 ? {} : { error: 'No installed font families were reported by the operating system.' }),
      }
      cachedResult = nextResult
      return { ...nextResult, cached: false }
    } catch (error) {
      const nextResult = {
        success: false,
        fonts: [],
        source: 'unavailable',
        error: error?.message || 'Installed fonts could not be listed.',
      }
      cachedResult = nextResult
      return { ...nextResult, cached: false }
    } finally {
      pendingDiscovery = null
    }
  })()

  pendingDiscovery = discovery
  return discovery
}

function clearSystemFontCacheForTests() {
  cachedResult = null
  pendingDiscovery = null
}

module.exports = {
  clearSystemFontCacheForTests,
  discoverSystemFonts,
  listSystemFonts,
  normalizeFontFamily,
  parseFontconfigFamilies,
  parseLineSeparatedFamilies,
  parseSystemProfilerFamilies,
  uniqueFontFamilies,
}
