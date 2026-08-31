const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

async function source(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8')
}

function between(value, start, end) {
  const startIndex = value.indexOf(start)
  const endIndex = value.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`)
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`)
  return value.slice(startIndex, endIndex)
}

test('only a successful manual export creates an eligible provenance candidate', async () => {
  const panel = await source('src/components/ExportPanel.jsx')
  const manualExport = between(
    panel,
    'const handleStartExport = async () => {',
    'const handlePrepareProvenanceReview = async () => {'
  )
  const workerCompletion = between(
    panel,
    'const onComplete = (data, metadata) => {',
    'const onError = (err, metadata) => {'
  )
  const queue = between(panel, 'const runQueue = async () => {', 'const handleStartQueue = () => {')

  assert.match(manualExport, /const result = await runExportJob\(jobSettings\)/u)
  assert.match(manualExport, /isProvenanceEligibleExport\(candidate\)/u)
  assert.match(manualExport, /setManualProvenanceCandidate\(candidate\)/u)
  assert.doesNotMatch(manualExport, /inspectExportForProvenance|openProvenanceReview/u)
  assert.doesNotMatch(
    workerCompletion,
    /setManualProvenanceCandidate\(candidate\)|createCreatorProvenanceReview/u,
  )
  assert.match(queue, /setManualProvenanceCandidate\(null\)/u)
  assert.doesNotMatch(queue, /setManualProvenanceCandidate\(candidate\)/u)
})

test('background worker events invalidate but never create a provenance candidate', async () => {
  const panel = await source('src/components/ExportPanel.jsx')
  const workerEvents = between(
    panel,
    'const onProgress = (data, metadata) => {',
    'const unsubscribe = ['
  )

  assert.match(workerEvents, /if \(!completion\)[\s\S]*provenanceAttemptRef\.current \+= 1/u)
  assert.match(workerEvents, /if \(!completion\)[\s\S]*setManualProvenanceCandidate\(null\)/u)
  assert.doesNotMatch(workerEvents, /setManualProvenanceCandidate\(candidate\)/u)
})

test('hashing and browser opening remain two separate explicit actions', async () => {
  const panel = await source('src/components/ExportPanel.jsx')
  const prepare = between(
    panel,
    'const handlePrepareProvenanceReview = async () => {',
    'const handleOpenProvenanceReview = async () => {'
  )
  const open = between(
    panel,
    'const handleOpenProvenanceReview = async () => {',
    'const handleExportXml = async () => {'
  )

  assert.match(prepare, /inspectExportForProvenance\(candidate\.outputPath\)/u)
  assert.match(prepare, /createCreatorProvenanceReview/u)
  assert.doesNotMatch(prepare, /openProvenanceReview\(/u)
  assert.match(open, /openProvenanceReview\(review\.issueUrl\)/u)
  assert.doesNotMatch(open, /inspectExportForProvenance/u)
})

test('changing projects invalidates any old export review or late hash result', async () => {
  const panel = await source('src/components/ExportPanel.jsx')
  const projectChange = between(
    panel,
    'if (previousSettingsStorageKeyRef.current === settingsStorageKey) return',
    'useEffect(() => {\n    saveExportSettings(settingsStorageKey, settings)'
  )

  assert.match(projectChange, /provenanceAttemptRef\.current \+= 1/u)
  assert.match(projectChange, /setManualProvenanceCandidate\(null\)/u)
  assert.match(projectChange, /setProvenanceReviewState\(EMPTY_PROVENANCE_REVIEW\)/u)
  assert.match(projectChange, /setExportResult\(null\)/u)
})

test('the preload and main process expose only the narrow local-hash and fixed-review bridges', async () => {
  const [main, preload, packageJson] = await Promise.all([
    source('electron/main.js'),
    source('electron/preload.js'),
    source('package.json'),
  ])
  const inspectHandler = between(
    main,
    "ipcMain.handle('provenance:inspectExport'",
    "ipcMain.handle('provenance:openReview'"
  )
  const openHandler = between(
    main,
    "ipcMain.handle('provenance:openReview'",
    "ipcMain.handle('shell:showItemInFolder'"
  )

  assert.match(preload, /inspectExportForProvenance/u)
  assert.match(preload, /openProvenanceReview/u)
  assert.match(inspectHandler, /inspectProvenanceExport\(outputPath\)/u)
  assert.doesNotMatch(inspectHandler, /openExternal|fetch\(|WebSocket/u)
  assert.match(openHandler, /validatePublicProvenanceReviewUrl\(reviewUrl\)/u)
  assert.match(openHandler, /shell\.openExternal\(target\)/u)

  for (const forbiddenDependency of [
    '@solana/',
    'sas-lib',
    '@wallet-standard/',
  ]) {
    assert.equal(packageJson.includes(forbiddenDependency), false)
  }
})

test('the review copy names the privacy and preview-only boundaries', async () => {
  const [panel, english, japanese] = await Promise.all([
    source('src/components/ExportPanel.jsx'),
    source('public/lang/lang_en.json').then(JSON.parse),
    source('public/lang/lang_jp.json').then(JSON.parse),
  ])
  const copy = english.export.provenance
  for (const statement of [
    'Nothing is uploaded, signed, or written to Solana by preparing it.',
    'Not included: the filename, local path, project name, prompts, source files, or media bytes.',
    'The review link is encoded, not encrypted.',
    'It does not request a wallet signature or create a blockchain transaction.',
    'not proof of copyright, legal identity, originality, or permission.',
  ]) {
    assert.equal(
      Object.values(copy).some(value => typeof value === 'string' && value.includes(statement)),
      true,
      `Missing review boundary: ${statement}`,
    )
  }
  assert.deepEqual(Object.keys(japanese.export.provenance), Object.keys(copy))
  assert.deepEqual(
    Object.keys(japanese.export.provenance.fields),
    Object.keys(copy.fields),
  )
  assert.match(panel, /t\('export\.provenance\.intro'\)/u)
  assert.match(panel, /t\('export\.provenance\.claimBoundary'\)/u)
})
