import test from 'node:test'
import assert from 'node:assert/strict'
import { CANVAS_BLOCK_TYPES, createCanvasDocument, createCanvasNode } from './canvasSchema.js'
import { createCanvasChatContext } from './canvasChatContext.js'

test('Canvas Chat context contains normalized structure and schema capabilities without local asset URLs', () => {
  const character = createCanvasNode(CANVAS_BLOCK_TYPES.character, { id: 'character-1', title: 'Lead' })
  const image = createCanvasNode(CANVAS_BLOCK_TYPES.image, {
    id: 'image-1', parentId: character.id, assetName: 'lead.png', assetUrl: 'file:///private/lead.png', assetSource: 'project',
  })
  const context = createCanvasChatContext(createCanvasDocument({ nodes: [character, image] }))
  assert.equal(context.nodes.length, 3)
  assert.deepEqual(context.nodes.find((node) => node.id === 'image-1').asset, { name: 'lead.png', source: 'project' })
  assert.equal(JSON.stringify(context).includes('file:///private/lead.png'), false)
  assert.ok(context.capabilities.some((block) => block.type === CANVAS_BLOCK_TYPES.shot))
})
