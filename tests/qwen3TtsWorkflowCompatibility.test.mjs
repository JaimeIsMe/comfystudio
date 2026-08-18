import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  resolveQwen3TtsWorkflowInputs,
} from '../src/utils/qwen3TtsWorkflowCompatibility.mjs'

function workflowWith(inputs) {
  return {
    45: {
      class_type: 'Qwen3TTSEngineNode',
      inputs: { ...inputs },
    },
  }
}

function objectInfoWith(requiredInputs, optionalInputs = {}) {
  return {
    Qwen3TTSEngineNode: {
      input: {
        required: { ...requiredInputs },
        optional: { ...optionalInputs },
      },
    },
  }
}

test('adapts a legacy model_size workflow to the current model_variant schema', () => {
  const workflow = workflowWith({ model_size: '0.6B', device: 'auto' })
  const objectInfo = objectInfoWith({ model_variant: [['0.6B', '1.7B']] })

  const resolved = resolveQwen3TtsWorkflowInputs(workflow, objectInfo)

  assert.notStrictEqual(resolved, workflow)
  assert.deepEqual(resolved[45].inputs, { model_variant: '0.6B', device: 'auto' })
  assert.deepEqual(workflow[45].inputs, { model_size: '0.6B', device: 'auto' })
})

test('adapts a current model_variant workflow to a legacy model_size schema', () => {
  const workflow = workflowWith({ model_variant: '0.6B', device: 'auto' })
  const objectInfo = objectInfoWith({ model_size: [['0.6B', '1.7B']] })

  const resolved = resolveQwen3TtsWorkflowInputs(workflow, objectInfo)

  assert.deepEqual(resolved[45].inputs, { model_size: '0.6B', device: 'auto' })
  assert.deepEqual(workflow[45].inputs, { model_variant: '0.6B', device: 'auto' })
})

test('includes both aliases when ComfyUI object info is unavailable', () => {
  const workflow = workflowWith({ model_variant: '0.6B', device: 'auto' })

  const withoutInfo = resolveQwen3TtsWorkflowInputs(workflow, null)
  const withEmptyInfo = resolveQwen3TtsWorkflowInputs(workflow, {})

  assert.deepEqual(withoutInfo[45].inputs, {
    model_variant: '0.6B',
    model_size: '0.6B',
    device: 'auto',
  })
  assert.deepEqual(withEmptyInfo, withoutInfo)
  assert.deepEqual(workflow[45].inputs, { model_variant: '0.6B', device: 'auto' })
})

test('does not invent a model selection for an incomplete imported workflow', () => {
  const workflow = workflowWith({ device: 'auto' })
  const objectInfo = objectInfoWith({ model_variant: [['0.6B', '1.7B']] })

  assert.strictEqual(resolveQwen3TtsWorkflowInputs(workflow, objectInfo), workflow)
})

test('honors the required legacy alias in a transitional schema', () => {
  const workflow = workflowWith({ model_variant: '0.6B', device: 'auto' })
  const objectInfo = objectInfoWith(
    { model_size: [['0.6B', '1.7B']] },
    { model_variant: [['0.6B', '1.7B']] }
  )

  const resolved = resolveQwen3TtsWorkflowInputs(workflow, objectInfo)

  assert.deepEqual(resolved[45].inputs, { model_size: '0.6B', device: 'auto' })
})

test('the bundled caption workflow uses the current model_variant contract', () => {
  const workflowPath = fileURLToPath(
    new URL('../public/workflows/caption_qwen_asr_transcription.json', import.meta.url)
  )

  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'))
  assert.equal(workflow['45'].class_type, 'Qwen3TTSEngineNode')
  assert.equal(workflow['45'].inputs.model_variant, '0.6B')
  assert.equal(Object.hasOwn(workflow['45'].inputs, 'model_size'), false)
})
