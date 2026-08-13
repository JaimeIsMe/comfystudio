import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyImportedWorkflowBindings,
  detectImportedWorkflowBindings,
} from './importedWorkflowBindings.js'

test('detects and replaces MiniMax H3 model.prompt without touching the source image', () => {
  const workflow = {
    2: {
      class_type: 'LoadImage',
      inputs: { image: 'old-reference.png' },
    },
    4: {
      class_type: 'MinimaxHailuo03FirstLastFrameNode',
      inputs: {
        first_frame: ['2', 0],
        'model.prompt': 'Old character-specific prompt',
        seed: 42,
      },
    },
    5: {
      class_type: 'SaveVideo',
      inputs: { video: ['4', 0], filename_prefix: 'video/test' },
    },
  }

  const detected = detectImportedWorkflowBindings(workflow, null)

  assert.deepEqual(detected.bindings.prompt, {
    nodeId: '4',
    inputKey: 'model.prompt',
  })

  const bound = applyImportedWorkflowBindings(workflow, detected.bindings, {
    prompt: 'Clean paper-city motion prompt',
    inputImage: '01_city_stage.png',
    seed: 310001,
  })

  assert.equal(bound['4'].inputs['model.prompt'], 'Clean paper-city motion prompt')
  assert.equal(bound['2'].inputs.image, '01_city_stage.png')
  assert.equal(bound['4'].inputs.seed, 310001)
})
