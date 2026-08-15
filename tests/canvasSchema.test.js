import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CANVAS_BLOCK_LIBRARY,
  CANVAS_BLOCK_TYPES,
  CANVAS_CHILD_LAYOUTS,
  CANVAS_IMAGE_ASPECT_RATIOS,
  CANVAS_IMAGE_RESOLUTIONS,
  canAddCanvasNode,
  canContainCanvasNode,
  canDeleteCanvasNodes,
  createCanvasDocument,
  createCanvasNode,
  createInitialCanvasDocument,
  isValidCanvasConnection,
  normalizeCanvasDocument,
} from '../src/services/canvasSchema.js'

test('Canvas block definitions provide typed handles and defaults', () => {
  assert.equal(CANVAS_BLOCK_LIBRARY.length, 9)
  for (const definition of CANVAS_BLOCK_LIBRARY) {
    assert.ok(definition.type)
    assert.ok(definition.defaults.title)
    if (!definition.fixed) assert.ok(definition.outputs.length > 0)
  }
  const configuration = CANVAS_BLOCK_LIBRARY.find((definition) => definition.type === CANVAS_BLOCK_TYPES.configuration)
  assert.equal(configuration.fixed, true)
  assert.ok(configuration.properties.some((property) => property.id === 'prompt'))
  assert.deepEqual(configuration.properties.find((property) => property.id === 'characterImageWorkflow'), {
    id: 'characterImageWorkflow',
    label: 'Character image workflow',
    type: 'workflow-select',
    optionsSource: 'text-to-image',
    defaultValue: 'z-image-turbo',
  })
  const configNode = createCanvasNode(CANVAS_BLOCK_TYPES.configuration, { id: 'canvas-config' })
  assert.equal(configNode.data.properties.characterImageWorkflow, 'z-image-turbo')
  assert.equal(createCanvasNode(CANVAS_BLOCK_TYPES.configuration, { id: 'canvas-config' }).data.properties.characterSheetWorkflow, 'image-edit')
  assert.equal(configNode.data.properties.locationImageWorkflow, 'z-image-turbo')
  assert.equal(configNode.data.properties.locationSheetWorkflow, 'image-edit')
  assert.deepEqual(createCanvasNode(CANVAS_BLOCK_TYPES.configuration, { id: 'canvas-config' }).deletable, false)
  for (const definition of CANVAS_BLOCK_LIBRARY) {
    assert.ok(definition.minSize.width > 0)
    assert.ok(definition.minSize.height > 0)
    assert.ok(definition.defaultSize.width >= definition.minSize.width)
    assert.ok(definition.defaultSize.height >= definition.minSize.height)
  }
})

test('Canvas rules allow production context to connect to a scene', () => {
  const nodes = [
    createCanvasNode(CANVAS_BLOCK_TYPES.character, { id: 'character-1' }),
    createCanvasNode(CANVAS_BLOCK_TYPES.scene, { id: 'scene-1' }),
  ]
  assert.equal(isValidCanvasConnection({ source: 'character-1', target: 'scene-1', sourceHandle: 'right', targetHandle: 'character' }, nodes), true)
  assert.equal(isValidCanvasConnection({ source: 'scene-1', target: 'character-1', sourceHandle: 'right', targetHandle: 'left' }, nodes), false)
})

test('Images connect to many-to-one Sheets only within the same parent', () => {
  const nodes = [
    createCanvasNode(CANVAS_BLOCK_TYPES.character, { id: 'character-1' }),
    createCanvasNode(CANVAS_BLOCK_TYPES.image, { id: 'image-1', parentId: 'character-1' }),
    createCanvasNode(CANVAS_BLOCK_TYPES.image, { id: 'image-2', parentId: 'character-1' }),
    createCanvasNode(CANVAS_BLOCK_TYPES.characterSheet, { id: 'sheet-1', parentId: 'character-1' }),
    createCanvasNode(CANVAS_BLOCK_TYPES.characterSheet, { id: 'sheet-2', parentId: 'character-1' }),
    createCanvasNode(CANVAS_BLOCK_TYPES.location, { id: 'location-1' }),
    createCanvasNode(CANVAS_BLOCK_TYPES.locationSheet, { id: 'location-sheet-1', parentId: 'location-1' }),
  ]
  const firstLink = { source: 'image-1', target: 'sheet-1', sourceHandle: 'sheet', targetHandle: 'images' }
  assert.equal(isValidCanvasConnection(firstLink, nodes, undefined, []), true)
  assert.equal(isValidCanvasConnection({ ...firstLink, target: 'sheet-2' }, nodes, undefined, [{ id: 'existing', ...firstLink }]), false)
  assert.equal(isValidCanvasConnection({ ...firstLink, source: 'image-2' }, nodes, undefined, [{ id: 'existing', ...firstLink }]), true)
  assert.equal(isValidCanvasConnection({ ...firstLink, target: 'location-sheet-1' }, nodes), false)
  assert.equal(isValidCanvasConnection({ source: 'sheet-1', target: 'image-1', sourceHandle: 'images', targetHandle: 'sheet' }, nodes), false)
  assert.equal(isValidCanvasConnection({ ...firstLink, source: 'image-1', target: 'sheet-1' }, nodes, undefined, [{ id: 'existing', ...firstLink }]), false)
})

test('Location Images connect to Location Sheets within the same parent', () => {
  const nodes = [
    createCanvasNode(CANVAS_BLOCK_TYPES.location, { id: 'location-1' }),
    createCanvasNode(CANVAS_BLOCK_TYPES.image, { id: 'image-1', parentId: 'location-1' }),
    createCanvasNode(CANVAS_BLOCK_TYPES.locationSheet, { id: 'location-sheet-1', parentId: 'location-1' }),
  ]
  assert.equal(isValidCanvasConnection({ source: 'image-1', target: 'location-sheet-1', sourceHandle: 'sheet', targetHandle: 'images' }, nodes), true)
})

test('Canvas normalization drops unknown blocks and dangling edges', () => {
  const document = normalizeCanvasDocument({
    nodes: [
      createCanvasNode(CANVAS_BLOCK_TYPES.scene, { id: 'scene-1' }),
      { id: 'unknown-1', type: 'unknown', position: { x: 0, y: 0 } },
    ],
    edges: [
      { id: 'valid', source: 'scene-1', target: 'scene-1' },
      { id: 'dangling', source: 'scene-1', target: 'missing' },
    ],
  })
  assert.deepEqual(document.nodes.map((node) => node.id), ['canvas-config', 'scene-1'])
  assert.deepEqual(document.edges, [{ id: 'valid', source: 'scene-1', target: 'scene-1' }])
})

test('Canvas document owns global rules', () => {
  const document = createCanvasDocument({ rules: { maxNodes: 12, enforceTypedConnections: false } })
  assert.equal(document.rules.maxNodes, 12)
  assert.equal(document.rules.enforceTypedConnections, false)
})

test('Container nodes define a default child layout', () => {
  const character = createCanvasNode(CANVAS_BLOCK_TYPES.character)
  const location = createCanvasNode(CANVAS_BLOCK_TYPES.location)
  assert.equal(character.data.layout, CANVAS_CHILD_LAYOUTS.landscape)
  assert.equal(location.data.layout, CANVAS_CHILD_LAYOUTS.landscape)
  assert.equal(CANVAS_CHILD_LAYOUTS.freeform, 'freeform')
})

test('Initial and new Character and Location nodes receive a default Image', () => {
  const initial = createInitialCanvasDocument()
  assert.equal(initial.nodes.filter((node) => node.parentId === 'character-1').length, 1)
  assert.equal(initial.nodes.filter((node) => node.parentId === 'location-1').length, 1)
  const character = createCanvasNode(CANVAS_BLOCK_TYPES.character, { id: 'character-new' })
  const image = createCanvasNode(CANVAS_BLOCK_TYPES.image, { parentId: character.id })
  assert.equal(canDeleteCanvasNodes([character, image], new Set([image.id])), false)
  const sheet = createCanvasNode(CANVAS_BLOCK_TYPES.characterSheet, { parentId: character.id })
  assert.equal(canDeleteCanvasNodes([character, image, sheet], new Set([image.id])), true)
})

test('Canvas document starts without inter-node connections', () => {
  assert.deepEqual(createCanvasDocument().edges, [])
})

test('Unlimited node rules allow adding top-level and child nodes', () => {
  const document = createCanvasDocument({ nodes: [createCanvasNode(CANVAS_BLOCK_TYPES.character)] })
  assert.equal(canAddCanvasNode(document, CANVAS_BLOCK_TYPES.location), true)
  assert.equal(canAddCanvasNode(document, CANVAS_BLOCK_TYPES.image), true)
  assert.equal(canAddCanvasNode(createCanvasDocument({ rules: { maxNodes: 1 }, nodes: document.nodes }), CANVAS_BLOCK_TYPES.location), false)
})

test('Canvas containment rules keep character and timeline children explicit', () => {
  const image = CANVAS_BLOCK_LIBRARY.find((definition) => definition.type === CANVAS_BLOCK_TYPES.image)
  assert.deepEqual(image.allowedParents, [CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.location])
  assert.equal(canContainCanvasNode(CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.image), true)
  assert.equal(canContainCanvasNode(CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.characterSheet), true)
  assert.equal(canContainCanvasNode(CANVAS_BLOCK_TYPES.location, CANVAS_BLOCK_TYPES.image), true)
  assert.equal(canContainCanvasNode(CANVAS_BLOCK_TYPES.location, CANVAS_BLOCK_TYPES.locationSheet), true)
  assert.equal(canContainCanvasNode(CANVAS_BLOCK_TYPES.timeline, CANVAS_BLOCK_TYPES.scene), true)
  assert.equal(canContainCanvasNode(CANVAS_BLOCK_TYPES.scene, CANVAS_BLOCK_TYPES.character), false)
})

test('Child nodes default to expanded mode and can be normalized compact', () => {
  const compactImage = createCanvasNode(CANVAS_BLOCK_TYPES.image, { parentId: 'character-1' })
  const expandedImage = createCanvasNode(CANVAS_BLOCK_TYPES.image, { parentId: 'character-1', collapsed: true })
  assert.equal(compactImage.data.collapsed, false)
  assert.equal(compactImage.data.imageMode, 'create-from-prompt')
  assert.equal(expandedImage.data.collapsed, true)

  const normalized = normalizeCanvasDocument({ nodes: [expandedImage], edges: [] })
  assert.equal(normalized.nodes.find((node) => node.id === expandedImage.id).data.collapsed, true)
})

test('Image keeps prompt as an editable property instead of a Canvas block', () => {
  const image = CANVAS_BLOCK_LIBRARY.find((definition) => definition.type === CANVAS_BLOCK_TYPES.image)
  assert.ok(image.properties.some((property) => property.id === 'prompt' && property.type === 'textarea'))
  const node = createCanvasNode(CANVAS_BLOCK_TYPES.image)
  assert.equal(node.data.properties.seed, 1)
  assert.equal(node.data.properties.aspectRatio, '1:1')
  assert.equal(node.data.properties.resolution, 'fhd')
  assert.deepEqual(CANVAS_IMAGE_ASPECT_RATIOS.map((option) => option.value), ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'])
  assert.deepEqual(CANVAS_IMAGE_RESOLUTIONS.map((option) => option.value), ['hd', 'fhd', '2k', '4k'])
  assert.equal(image.properties.some((property) => property.id === 'assetId'), false)
  assert.equal(CANVAS_BLOCK_TYPES.prompt, undefined)
})

test('Character Sheets use prompt and seed without role or notes', () => {
  const sheet = CANVAS_BLOCK_LIBRARY.find((definition) => definition.type === CANVAS_BLOCK_TYPES.characterSheet)
  assert.deepEqual(sheet.properties.map((property) => property.id), ['prompt', 'seed'])
  assert.deepEqual(createCanvasNode(CANVAS_BLOCK_TYPES.characterSheet).data.properties, { prompt: '', seed: 1 })
})

test('Location Sheets use prompt and seed without style or notes', () => {
  const sheet = CANVAS_BLOCK_LIBRARY.find((definition) => definition.type === CANVAS_BLOCK_TYPES.locationSheet)
  assert.deepEqual(sheet.properties.map((property) => property.id), ['prompt', 'seed'])
  assert.deepEqual(createCanvasNode(CANVAS_BLOCK_TYPES.locationSheet).data.properties, { prompt: '', seed: 1 })
})

test('Every Canvas node definition owns a persisted Prompt property', () => {
  for (const definition of CANVAS_BLOCK_LIBRARY) {
    assert.ok(definition.properties.some((property) => property.id === 'prompt'))
    const node = createCanvasNode(definition.type)
    assert.equal(node.data.properties.prompt, '')
  }
})

test('New nodes can open in Add mode without persisting the UI mode during normalization', () => {
  const node = createCanvasNode(CANVAS_BLOCK_TYPES.image, { mode: 'add' })
  assert.equal(node.data.mode, 'add')
  const normalized = normalizeCanvasDocument({ nodes: [node], edges: [] })
  assert.equal(normalized.nodes.find((candidate) => candidate.id === node.id).data.mode, undefined)
})

test('Image asset IDs are generated internally and uniquely', () => {
  const first = createCanvasNode(CANVAS_BLOCK_TYPES.image)
  const second = createCanvasNode(CANVAS_BLOCK_TYPES.image)
  assert.ok(first.data.assetId)
  assert.notEqual(first.data.assetId, second.data.assetId)
  assert.equal(first.data.properties.assetId, undefined)
})

test('Audio asset IDs are internal metadata', () => {
  const audio = createCanvasNode(CANVAS_BLOCK_TYPES.audio)
  assert.ok(audio.data.assetId)
  assert.deepEqual(audio.data.properties, { prompt: '' })
})
