const test = require('node:test')
const assert = require('node:assert/strict')

const { createComfyStudioMcpServer } = require('../electron/mcpServer')

const imageAsset = {
  id: 'image-1',
  name: 'S01 reference.png',
  type: 'image',
  path: 'images/S01 reference.png',
}

const audioAsset = {
  id: 'audio-1',
  name: 'S01 performance.wav',
  type: 'audio',
  path: 'audio/S01 performance.wav',
  duration: 9,
}

function createSnapshot() {
  return {
    app: { name: 'Velorn' },
    project: { id: 'project-1', name: 'H3 MCP test', path: 'C:/test/project' },
    timelines: [],
    currentTimeline: null,
    assets: [imageAsset, audioAsset],
  }
}

function parseTextResult(result) {
  assert.equal(result?.isError, undefined)
  return JSON.parse(result.content[0].text)
}

test('queue_h3_reference_video previews a validated 2K image+audio job without dispatching', async () => {
  let dispatched = false
  const server = createComfyStudioMcpServer({
    performAction: async () => {
      dispatched = true
      return { success: true }
    },
  })
  server.updateSnapshot(createSnapshot())

  const result = await server.callTool('queue_h3_reference_video', {
    imageAssetId: imageAsset.id,
    audioAssetId: audioAsset.id,
    shotId: 'S01',
    prompt: 'Use <Picture 1> and <Audio 1> as exact references.',
    resolutionTier: '2K',
    aspectRatio: '16:9',
    previewOnly: true,
    seed: 42,
  })
  const body = parseTextResult(result)

  assert.equal(dispatched, false)
  assert.equal(body.previewOnly, true)
  assert.equal(body.plan.totalJobs, 1)
  assert.deepEqual(body.plan.jobs[0].assetFieldIds, {
    referenceImage1: imageAsset.id,
    referenceAudio1: audioAsset.id,
  })
  assert.deepEqual(body.plan.jobs[0].resolution, { width: 2560, height: 1440 })
  assert.equal(body.plan.jobs[0].durationSeconds, 9)
  assert.equal(body.plan.jobs[0].negativePrompt, '')
})

test('queue_h3_reference_video apply dispatches one direct Generate job', async () => {
  let dispatchedRequest = null
  const server = createComfyStudioMcpServer({
    performAction: async (request) => {
      dispatchedRequest = request
      return { success: true, jobs: [{ id: 'job-1', status: 'queued' }] }
    },
  })
  server.updateSnapshot(createSnapshot())

  const result = await server.callTool('queue_h3_reference_video', {
    imageAssetId: imageAsset.id,
    audioAssetId: audioAsset.id,
    prompt: 'Use <Picture 1> and <Audio 1> as exact references.',
    durationSeconds: 7,
    resolutionTier: '768P',
    aspectRatio: '9:16',
    previewOnly: false,
    seed: 99,
  })
  parseTextResult(result)

  assert.equal(dispatchedRequest.action, 'queue_prompt_generation_batch')
  assert.equal(dispatchedRequest.payload.previewOnly, false)
  assert.equal(dispatchedRequest.payload.jobs.length, 1)
  assert.equal(dispatchedRequest.payload.jobs[0].workflowId, 'minimax-h3-r2v')
  assert.deepEqual(dispatchedRequest.payload.jobs[0].resolution, { width: 768, height: 1366 })
  assert.equal(dispatchedRequest.payload.jobs[0].durationSeconds, 7)
})

test('queue_h3_reference_video rejects mismatched asset types before dispatch', async () => {
  const server = createComfyStudioMcpServer({ performAction: async () => ({ success: true }) })
  server.updateSnapshot(createSnapshot())

  const result = await server.callTool('queue_h3_reference_video', {
    imageAssetId: audioAsset.id,
    audioAssetId: imageAsset.id,
    prompt: 'test',
    previewOnly: true,
  })

  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /must reference an image/i)
})
