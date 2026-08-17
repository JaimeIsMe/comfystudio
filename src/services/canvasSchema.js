const CANVAS_SCHEMA_VERSION = 7

export const CANVAS_BLOCK_TYPES = Object.freeze({
  configuration: 'canvas-config',
  character: 'character',
  image: 'image',
  characterSheet: 'character-sheet',
  location: 'location',
  locationSheet: 'location-sheet',
  audio: 'audio',
  timeline: 'timeline',
  scene: 'scene',
  shot: 'shot',
})

export const CANVAS_RULES = Object.freeze({
  allowConnections: true,
  allowDanglingConnections: false,
  enforceTypedConnections: true,
  enforceConnectionCardinality: true,
  maxNodes: null,
  maxEdges: null,
})

export const CANVAS_CHILD_LAYOUTS = Object.freeze({
  landscape: 'landscape',
  portrait: 'portrait',
  freeform: 'freeform',
})

export const CANVAS_IMAGE_ASPECT_RATIOS = Object.freeze([
  { value: '1:1', label: '1:1' },
  { value: '2:3', label: '2:3' },
  { value: '3:2', label: '3:2' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
])

export const CANVAS_IMAGE_RESOLUTIONS = Object.freeze([
  { value: '512p', label: '512p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
])

const CANVAS_BLOCK_LIBRARY_DEFINITIONS = [
  {
    type: CANVAS_BLOCK_TYPES.configuration,
    label: 'Canvas Configuration',
    description: 'Global rules for this Canvas',
    category: 'Canvas',
    icon: 'configuration',
    accent: '#f97316',
    inputs: [],
    outputs: [],
    fixed: true,
    minSize: { width: 190, height: 100 },
    defaultSize: { width: 230, height: 132 },
    properties: [
      { id: 'prompt', label: 'Prompt', type: 'textarea', defaultValue: '' },
      { id: 'seed', label: 'Seed', type: 'number', defaultValue: 1 },
      { id: 'characterImageWorkflow', label: 'Character image workflow', type: 'workflow-select', optionsSource: 'text-to-image', defaultValue: 'z-image-turbo' },
      { id: 'characterSheetWorkflow', label: 'Character sheet workflow', type: 'workflow-select', optionsSource: 'image', defaultValue: 'image-edit' },
      { id: 'locationImageWorkflow', label: 'Location image workflow', type: 'workflow-select', optionsSource: 'text-to-image', defaultValue: 'z-image-turbo' },
      { id: 'locationSheetWorkflow', label: 'Location sheet workflow', type: 'workflow-select', optionsSource: 'image', defaultValue: 'image-edit' },
    ],
    defaults: { title: 'Canvas configuration', properties: { prompt: '', seed: 1, characterImageWorkflow: 'z-image-turbo', characterSheetWorkflow: 'image-edit', locationImageWorkflow: 'z-image-turbo', locationSheetWorkflow: 'image-edit' } },
  },
  {
    type: CANVAS_BLOCK_TYPES.character,
    label: 'Character',
    description: 'A person, performer, or subject',
    category: 'Production',
    icon: 'character',
    accent: '#a78bfa',
    inputs: [],
    outputs: [{ id: 'right', type: 'character', label: 'Character' }],
    contains: [CANVAS_BLOCK_TYPES.image, CANVAS_BLOCK_TYPES.characterSheet],
    defaultChildLayout: CANVAS_CHILD_LAYOUTS.portrait,
    minSize: { width: 220, height: 120 },
    defaultSize: { width: 280, height: 180 },
    properties: [
      { id: 'prompt', label: 'Prompt', type: 'textarea', defaultValue: '' },
      { id: 'seed', label: 'Seed', type: 'number', defaultValue: 1 },
      { id: 'name', label: 'Name', type: 'text', defaultValue: '' },
      { id: 'description', label: 'Description', type: 'textarea', defaultValue: '' },
    ],
    defaults: { title: 'New character', properties: { prompt: '', seed: 1, name: '', description: '' } },
  },
  {
    type: CANVAS_BLOCK_TYPES.image,
    label: 'Image',
    description: 'A reference image for a Character or Location',
    category: 'Production',
    icon: 'image',
    accent: '#c084fc',
    inputs: [],
    outputs: [{ id: 'sheet', type: 'image-sheet-link', label: 'Sheet' }],
    allowedParents: [CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.location],
    minSize: { width: 280, height: 150 },
    defaultSize: { width: 380, height: 190 },
    properties: [
      { id: 'prompt', label: 'Prompt', type: 'textarea', defaultValue: '' },
      { id: 'seed', label: 'Seed', type: 'number', defaultValue: 1 },
      { id: 'aspectRatio', label: 'Aspect ratio', type: 'select', defaultValue: '1:1', options: CANVAS_IMAGE_ASPECT_RATIOS, inToolbar: true },
      { id: 'size', label: 'Size', type: 'select', defaultValue: '1080p', options: CANVAS_IMAGE_RESOLUTIONS, inToolbar: true },
    ],
    defaults: { title: 'Character image', properties: { prompt: '', seed: 1, aspectRatio: '1:1', size: '1080p' } },
  },
  {
    type: CANVAS_BLOCK_TYPES.characterSheet,
    label: 'Character Sheet',
    description: 'Structured character reference and continuity notes',
    category: 'Character',
    icon: 'characterSheet',
    accent: '#e879f9',
    inputs: [{ id: 'images', type: 'image-sheet-link', label: 'Images', multiple: true }],
    outputs: [{ id: 'right', type: 'character-sheet', label: 'Character sheet' }],
    allowedParents: [CANVAS_BLOCK_TYPES.character],
    minSize: { width: 150, height: 100 },
    defaultSize: { width: 190, height: 132 },
    properties: [
      { id: 'prompt', label: 'Prompt', type: 'textarea', defaultValue: '' },
      { id: 'seed', label: 'Seed', type: 'number', defaultValue: 1 },
    ],
    defaults: { title: 'Character sheet', properties: { prompt: '', seed: 1 } },
  },
  {
    type: CANVAS_BLOCK_TYPES.location,
    label: 'Location',
    description: 'A place, set, or visual world',
    category: 'Production',
    icon: 'location',
    accent: '#34d399',
    inputs: [],
    outputs: [{ id: 'right', type: 'location', label: 'Location' }],
    contains: [CANVAS_BLOCK_TYPES.image, CANVAS_BLOCK_TYPES.locationSheet],
    defaultChildLayout: CANVAS_CHILD_LAYOUTS.portrait,
    minSize: { width: 220, height: 120 },
    defaultSize: { width: 280, height: 180 },
    properties: [
      { id: 'prompt', label: 'Prompt', type: 'textarea', defaultValue: '' },
      { id: 'seed', label: 'Seed', type: 'number', defaultValue: 1 },
      { id: 'description', label: 'Description', type: 'textarea', defaultValue: '' },
    ],
    defaults: { title: 'New location', properties: { prompt: '', seed: 1, description: '' } },
  },
  {
    type: CANVAS_BLOCK_TYPES.locationSheet,
    label: 'Location Sheet',
    description: 'Structured location reference built from prompt, seed, and connected images',
    category: 'Location',
    icon: 'locationSheet',
    accent: '#6ee7b7',
    inputs: [{ id: 'images', type: 'image-sheet-link', label: 'Images', multiple: true }],
    outputs: [{ id: 'right', type: 'location-sheet', label: 'Location sheet' }],
    allowedParents: [CANVAS_BLOCK_TYPES.location],
    minSize: { width: 150, height: 100 },
    defaultSize: { width: 190, height: 132 },
    properties: [
      { id: 'prompt', label: 'Prompt', type: 'textarea', defaultValue: '' },
      { id: 'seed', label: 'Seed', type: 'number', defaultValue: 1 },
    ],
    defaults: { title: 'Location sheet', properties: { prompt: '', seed: 1 } },
  },
  {
    type: CANVAS_BLOCK_TYPES.audio,
    label: 'Audio',
    description: 'Music, dialogue, or sound design',
    category: 'Production',
    icon: 'audio',
    accent: '#f59e0b',
    inputs: [],
    outputs: [{ id: 'right', type: 'audio', label: 'Audio' }],
    properties: [{ id: 'prompt', label: 'Prompt', type: 'textarea', defaultValue: '' }, { id: 'seed', label: 'Seed', type: 'number', defaultValue: 1 }],
    minSize: { width: 150, height: 100 },
    defaultSize: { width: 190, height: 132 },
    defaults: { title: 'New audio', properties: { prompt: '', seed: 1 } },
  },
  {
    type: CANVAS_BLOCK_TYPES.timeline,
    label: 'Timeline',
    description: 'A sequence container for scenes',
    category: 'Production',
    icon: 'timeline',
    accent: '#fb7185',
    fixed: true,
    inputs: [],
    outputs: [{ id: 'right', type: 'timeline', label: 'Timeline' }],
    contains: [CANVAS_BLOCK_TYPES.scene],
    defaultChildLayout: CANVAS_CHILD_LAYOUTS.portrait,
    minSize: { width: 220, height: 120 },
    defaultSize: { width: 280, height: 180 },
    properties: [
      { id: 'prompt', label: 'Prompt', type: 'textarea', defaultValue: '' },
      { id: 'seed', label: 'Seed', type: 'number', defaultValue: 1 },
      { id: 'description', label: 'Description', type: 'textarea', defaultValue: '' },
    ],
    defaults: { title: 'New timeline', properties: { prompt: '', seed: 1, description: '' } },
  },
  {
    type: CANVAS_BLOCK_TYPES.scene,
    label: 'Scene',
    description: 'An organizing container for shots',
    category: 'Production',
    icon: 'scene',
    accent: '#38bdf8',
    outputs: [{ id: 'right', type: 'scene', label: 'Scene' }],
    contains: [CANVAS_BLOCK_TYPES.shot],
    defaultChildLayout: CANVAS_CHILD_LAYOUTS.portrait,
    allowedParents: [CANVAS_BLOCK_TYPES.timeline],
    minSize: { width: 220, height: 140 },
    defaultSize: { width: 300, height: 260 },
    properties: [{ id: 'prompt', label: 'Prompt', type: 'textarea', defaultValue: '' }, { id: 'seed', label: 'Seed', type: 'number', defaultValue: 1 }],
    defaults: { title: 'Scene 1', properties: { prompt: '', seed: 1 } },
  },
  {
    type: CANVAS_BLOCK_TYPES.shot,
    label: 'Shot',
    description: 'A specific shot with its location, characters, and direction',
    category: 'Production',
    icon: 'shot',
    accent: '#60a5fa',
    inputs: [
      { id: 'location', type: 'location', label: 'Location' },
      { id: 'character', type: 'character', label: 'Characters', multiple: true },
    ],
    outputs: [{ id: 'right', type: 'shot', label: 'Shot' }],
    allowedParents: [CANVAS_BLOCK_TYPES.scene],
    minSize: { width: 300, height: 170 },
    defaultSize: { width: 420, height: 220 },
    properties: [
      { id: 'prompt', label: 'Prompt', type: 'textarea', defaultValue: '' },
      { id: 'seed', label: 'Seed', type: 'number', defaultValue: 1 },
      { id: 'description', label: 'Description', type: 'textarea', defaultValue: '' },
      { id: 'duration', label: 'Duration (seconds)', type: 'number', defaultValue: 5 },
      { id: 'duration_start', label: 'Duration start (ms)', type: 'number', defaultValue: 0, min: 0, step: 1 },
      { id: 'duration_end', label: 'Duration end (ms)', type: 'number', defaultValue: 5000, min: 0, step: 1 },
      { id: 'framing', label: 'Framing', type: 'text', defaultValue: '' },
      { id: 'cameraMovement', label: 'Camera movement', type: 'text', defaultValue: '' },
      { id: 'lens', label: 'Lens', type: 'text', defaultValue: '' },
      { id: 'lighting', label: 'Lighting', type: 'textarea', defaultValue: '' },
      { id: 'action', label: 'Action', type: 'textarea', defaultValue: '' },
      { id: 'dialogue', label: 'Dialogue', type: 'textarea', defaultValue: '' },
    ],
    defaults: { title: 'Shot 1', properties: { prompt: '', seed: 1, description: '', duration: 5, duration_start: 0, duration_end: 5000, framing: '', cameraMovement: '', lens: '', lighting: '', action: '', dialogue: '' } },
  },
]

export const CANVAS_BLOCK_LIBRARY = Object.freeze(CANVAS_BLOCK_LIBRARY_DEFINITIONS.map((definition) => ({
  ...definition,
  properties: Object.freeze((definition.properties || []).map((property) => ({
    ...property,
    inToolbar: property.inToolbar === true,
  }))),
})))

const DEFAULT_VIEWPORT = Object.freeze({ x: 0, y: 0, zoom: 1 })

export function getCanvasBlockDefinition(type) {
  return CANVAS_BLOCK_LIBRARY.find((definition) => definition.type === type) || null
}

export function createCanvasNode(type, options = {}) {
  const definition = getCanvasBlockDefinition(type)
  if (!definition) throw new Error(`Unknown Canvas block type: ${type}`)

  const index = Math.max(0, Number(options.index) || 0)
  const createUniqueId = (prefix) => {
    const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    return `${prefix}-${token}`
  }
  const id = String(options.id || createUniqueId(type))
  const internalAssetId = [CANVAS_BLOCK_TYPES.image, CANVAS_BLOCK_TYPES.audio, CANVAS_BLOCK_TYPES.characterSheet].includes(definition.type)
    ? String(options.assetId || options.properties?.assetId || createUniqueId('asset'))
    : null
  const properties = Object.fromEntries((definition.properties || []).map((property) => {
    const hasOption = Boolean(options.properties && Object.prototype.hasOwnProperty.call(options.properties, property.id))
    const hasDefault = Boolean(definition.defaults.properties && Object.prototype.hasOwnProperty.call(definition.defaults.properties, property.id))
    const legacySize = property.id === 'size' && options.properties && options.properties.resolution
      ? ({ hd: '512p', fhd: '1080p' }[options.properties.resolution] || options.properties.resolution)
      : undefined
    const value = hasOption
      ? options.properties[property.id]
      : legacySize !== undefined
        ? legacySize
        : hasDefault
        ? definition.defaults.properties[property.id]
        : property.defaultValue
    return [property.id, value === undefined ? '' : value]
  }))
  return {
    id,
    type: definition.type,
    position: options.position || { x: 180 + (index % 3) * 240, y: 120 + Math.floor(index / 3) * 170 },
    ...(definition.contains ? { style: { width: 280, height: 220 } } : {}),
    ...(options.parentId ? { parentId: options.parentId, extent: 'parent' } : {}),
    data: {
      kind: definition.type,
      title: options.title || definition.defaults.title,
      detail: definition.label,
      accent: definition.accent,
      properties,
      size: { ...(definition.defaultSize || { width: 190, height: 132 }), ...(options.size || {}) },
      ...(internalAssetId ? { assetId: internalAssetId } : {}),
      ...(options.assetUrl ? { assetUrl: String(options.assetUrl) } : {}),
      ...(options.assetName ? { assetName: String(options.assetName) } : {}),
      ...(options.assetSource ? { assetSource: String(options.assetSource) } : {}),
      ...(definition.type === CANVAS_BLOCK_TYPES.image ? { imageMode: options.imageMode || 'create-from-prompt' } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
      ...(definition.allowedParents ? { collapsed: options.collapsed ?? false } : {}),
      ...(definition.contains ? { layout: options.layout || definition.defaultChildLayout } : {}),
    },
    ...(definition.fixed ? { deletable: false } : {}),
  }
}

export function createCanvasDocument(options = {}) {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    id: String(options.id || 'canvas-main'),
    name: String(options.name || 'Production Canvas'),
    rules: { ...CANVAS_RULES, ...(options.rules || {}) },
    nodes: Array.isArray(options.nodes) ? options.nodes : [],
    edges: Array.isArray(options.edges) ? options.edges : [],
    viewport: { ...DEFAULT_VIEWPORT, ...(options.viewport || {}) },
  }
}

export function createInitialCanvasDocument(options = {}) {
  const character = createCanvasNode(CANVAS_BLOCK_TYPES.character, { id: 'character-1', title: 'Lead performer', position: { x: 80, y: 90 } })
  const location = createCanvasNode(CANVAS_BLOCK_TYPES.location, { id: 'location-1', title: 'Night street', position: { x: 430, y: 90 } })
  return createCanvasDocument({
    ...options,
    nodes: [
      createCanvasNode(CANVAS_BLOCK_TYPES.configuration, { id: 'canvas-config', title: 'Canvas rules', position: { x: 80, y: -110 } }),
      character,
      createCanvasNode(CANVAS_BLOCK_TYPES.image, { id: 'character-image-1', parentId: character.id, position: { x: 12, y: 46 } }),
      location,
      createCanvasNode(CANVAS_BLOCK_TYPES.image, { id: 'location-image-1', parentId: location.id, position: { x: 12, y: 46 } }),
      createCanvasNode(CANVAS_BLOCK_TYPES.timeline, { id: 'timeline-1', title: 'Main timeline', position: { x: 780, y: 90 } }),
    ],
    edges: [],
  })
}

function getHandleDefinition(node, handleId, direction) {
  const definition = getCanvasBlockDefinition(node?.type)
  if (!definition) return null
  const handles = direction === 'source' ? definition.outputs : definition.inputs
  return handles.find((handle) => handle.id === handleId) || handles[0] || null
}

export function isValidCanvasConnection(connection, nodes, rules = CANVAS_RULES, edges = []) {
  if (!rules.allowConnections || !connection?.source || !connection?.target) return false
  const source = nodes.find((node) => node.id === connection.source)
  const target = nodes.find((node) => node.id === connection.target)
  if (!source || !target || source.id === target.id) return false
  if (!rules.enforceTypedConnections) return true

  const output = getHandleDefinition(source, connection.sourceHandle, 'source')
  const input = getHandleDefinition(target, connection.targetHandle, 'target')
  if (!output || !input) return false
  const isImageSheetLink = output.type === 'image-sheet-link' || input.type === 'image-sheet-link'
  if (isImageSheetLink && source.parentId !== target.parentId) return false
  if (rules.enforceTypedConnections && !(output.type === input.type || output.type === 'any' || input.type === 'any')) return false
  if (rules.enforceConnectionCardinality) {
    const sourceConnections = edges.filter((edge) => edge.source === source.id && (edge.sourceHandle || output.id) === (connection.sourceHandle || output.id))
    const targetConnections = edges.filter((edge) => edge.target === target.id && (edge.targetHandle || input.id) === (connection.targetHandle || input.id))
    if (output.multiple !== true && sourceConnections.length > 0) return false
    if (input.multiple !== true && targetConnections.length > 0) return false
  }
  return true
}

export function canAddCanvasNode(document, type) {
  const definition = getCanvasBlockDefinition(type)
  if (!definition) return false
  const configuredMaxNodes = document?.rules?.maxNodes
  if (configuredMaxNodes === null || configuredMaxNodes === undefined) return true
  const maxNodes = Number(configuredMaxNodes)
  return !Number.isFinite(maxNodes) || maxNodes < 0 || document.nodes.length < maxNodes
}

export function canContainCanvasNode(parentType, childType) {
  const parent = getCanvasBlockDefinition(parentType)
  const child = getCanvasBlockDefinition(childType)
  if (!parent || !child) return false
  return Boolean(parent.contains?.includes(child.type) && child.allowedParents?.includes(parent.type))
}

export function canDeleteCanvasNodes(nodes, nodeIds) {
  const deleteIds = nodeIds instanceof Set ? nodeIds : new Set(nodeIds)
  return nodes.every((node) => !deleteIds.has(node.id) || !getCanvasBlockDefinition(node.type)?.fixed)
}

export function normalizeCanvasDocument(value) {
  const source = value && typeof value === 'object' ? value : {}
  const base = createCanvasDocument(source)
  const nodes = base.nodes
    .map((node, index) => {
      const definition = getCanvasBlockDefinition(node?.type)
      if (!definition) return null
      const normalized = createCanvasNode(definition.type, {
        id: node.id,
        index,
        position: node.position,
        title: node.data?.title,
        properties: node.data?.properties,
        assetId: node.data?.assetId || node.data?.properties?.assetId,
        assetUrl: node.data?.assetUrl,
        assetName: node.data?.assetName,
        assetSource: node.data?.assetSource,
        size: node.data?.size,
        imageMode: node.data?.imageMode,
        parentId: node.parentId,
        collapsed: node.data?.collapsed,
        layout: [CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.location, CANVAS_BLOCK_TYPES.timeline, CANVAS_BLOCK_TYPES.scene].includes(definition.type)
          ? CANVAS_CHILD_LAYOUTS.portrait
          : node.data?.layout,
      })
      return { ...normalized, selected: Boolean(node.selected), dragging: Boolean(node.dragging) }
    })
    .filter(Boolean)
  const configuration = nodes.find((node) => node.type === CANVAS_BLOCK_TYPES.configuration)
  const withConfiguration = configuration
    ? nodes
    : [createCanvasNode(CANVAS_BLOCK_TYPES.configuration, { id: 'canvas-config', title: 'Canvas rules', position: { x: 80, y: -110 } }), ...nodes]
  const ensuredNodes = withConfiguration.flatMap((node) => {
    if (![CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.location].includes(node.type)) return [node]
    if (withConfiguration.some((candidate) => candidate.parentId === node.id)) return [node]
    return [node, createCanvasNode(CANVAS_BLOCK_TYPES.image, { parentId: node.id, position: { x: 12, y: 46 } })]
  })
  const shotCounters = new Map()
  const sceneCounters = new Map()
  const titledNodes = ensuredNodes.map((node) => {
    if (node.type === CANVAS_BLOCK_TYPES.scene) {
      const sceneNumber = (sceneCounters.get(node.parentId) || 0) + 1
      sceneCounters.set(node.parentId, sceneNumber)
      const title = /^Scene \d+$/.test(String(node.data?.title || '')) || node.data?.title === 'New scene'
        ? `Scene ${sceneNumber}`
        : node.data?.title
      return { ...node, data: { ...node.data, title } }
    }
    if (node.type !== CANVAS_BLOCK_TYPES.shot) return node
    const shotNumber = (shotCounters.get(node.parentId) || 0) + 1
    shotCounters.set(node.parentId, shotNumber)
    return { ...node, data: { ...node.data, title: `Shot ${shotNumber}` } }
  })
  const nodeIds = new Set(titledNodes.map((node) => node.id))
  const edges = base.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  return { ...base, schemaVersion: CANVAS_SCHEMA_VERSION, nodes: titledNodes, edges }
}

export { CANVAS_SCHEMA_VERSION }
