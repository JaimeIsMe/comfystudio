const assert = require('node:assert/strict')
const test = require('node:test')

const {
  clearSystemFontCacheForTests,
  discoverSystemFonts,
  listSystemFonts,
  parseFontconfigFamilies,
  parseSystemProfilerFamilies,
} = require('../electron/systemFonts')

test.afterEach(() => {
  clearSystemFontCacheForTests()
})

test('parses fontconfig aliases into unique font family names', () => {
  assert.deepEqual(
    parseFontconfigFamilies('DejaVu Sans,DejaVu Sans Condensed\nNoto Sans\nDejaVu Sans\n'),
    ['DejaVu Sans', 'DejaVu Sans Condensed', 'Noto Sans']
  )
})

test('reads nested family names from macOS system_profiler JSON', () => {
  const output = JSON.stringify({
    SPFontsDataType: [
      { typefaces: [{ family: 'Avenir Next' }, { family: 'Avenir Next' }] },
      { typefaces: [{ font_family: 'SF Pro Display' }] },
    ],
  })
  assert.deepEqual(parseSystemProfilerFamilies(output), ['Avenir Next', 'SF Pro Display'])
})

test('uses the Windows installed-font collection and parses returned family names', async () => {
  const invocations = []
  const result = await discoverSystemFonts({
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows' },
    runCommand: async (command, args) => {
      invocations.push({ command, args })
      return { stdout: 'Arial\r\nYu Gothic UI\r\nArial\r\n' }
    },
  })

  assert.deepEqual(result.fonts, ['Arial', 'Yu Gothic UI'])
  assert.equal(result.source, 'windows-font-collection')
  assert.equal(invocations.length, 1)
  assert.match(invocations[0].command, /powershell\.exe$/i)
  assert.ok(invocations[0].args.includes('-NoProfile'))
  assert.match(invocations[0].args.at(-1), /System\.Drawing\.Text\.InstalledFontCollection/)
})

test('shares one in-flight operating-system font discovery and caches its result', async () => {
  let calls = 0
  let finishDiscovery
  const runCommand = async () => {
    calls += 1
    return new Promise((resolve) => {
      finishDiscovery = () => resolve({ stdout: 'Inter\nNoto Sans\n' })
    })
  }

  const first = listSystemFonts({ platform: 'linux', runCommand })
  const second = listSystemFonts({ platform: 'linux', runCommand })
  assert.equal(calls, 1)
  finishDiscovery()

  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.deepEqual(firstResult.fonts, ['Inter', 'Noto Sans'])
  assert.deepEqual(secondResult.fonts, firstResult.fonts)

  const cached = await listSystemFonts({ platform: 'linux', runCommand })
  assert.equal(calls, 1)
  assert.equal(cached.cached, true)
})

test('force refresh retries after a cached discovery failure', async () => {
  let calls = 0
  const runCommand = async () => {
    calls += 1
    if (calls === 1) throw new Error('font service unavailable')
    return { stdout: 'Retry Sans\n' }
  }

  const failed = await listSystemFonts({ platform: 'linux', runCommand })
  assert.equal(failed.success, false)
  assert.match(failed.error, /font service unavailable/)

  const cachedFailure = await listSystemFonts({ platform: 'linux', runCommand })
  assert.equal(calls, 1)
  assert.equal(cachedFailure.cached, true)

  const retried = await listSystemFonts({ platform: 'linux', runCommand, forceRefresh: true })
  assert.equal(calls, 2)
  assert.equal(retried.success, true)
  assert.deepEqual(retried.fonts, ['Retry Sans'])
})
