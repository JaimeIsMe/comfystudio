const CANVAS_SCHEMA_VERSION = 8

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

export const CANVAS_VISUAL_FAMILIES = Object.freeze({
  organization: 'organization',
  production: 'production',
  subject: 'subject',
  asset: 'asset',
  system: 'system',
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

export const CANVAS_SHOT_PERFORMANCE_MODES = Object.freeze([
  { value: 'performance', label: 'Performance' },
  { value: 'instrumental', label: 'Instrumental' },
  { value: 'visual_only', label: 'Visual only' },
  { value: 'b_roll', label: 'B-roll' },
])

export const CANVAS_SHOT_CUE_TYPES = Object.freeze([
  { value: 'singing', label: 'Singing' },
  { value: 'dialogue', label: 'Dialogue' },
  { value: 'reaction', label: 'Reaction' },
  { value: 'silent', label: 'Silent' },
  { value: 'instrumental_action', label: 'Instrumental action' },
])

export const CANVAS_SHOT_CAMERA_FLOW_OPTIONS = Object.freeze([
  { value: 'off', label: 'Off', impact: 'Do not auto-fill camera or framing direction.' },
  { value: 'balanced', label: 'Balanced cinematic flow', impact: 'Vary wide, medium, close, lateral, reveal, and reset coverage.' },
  { value: 'intimate_closeups', label: 'Intimate close-ups', impact: 'Keep coverage tight, intimate, and frame-filling.' },
  { value: 'music_video', label: 'Music video shots', impact: 'Use rhythmic performance, movement, reveal, and tracking coverage.' },
  { value: 'fisheye_distorted', label: 'Fisheye / distorted', impact: 'Favor wide-angle, fisheye, and optical-distortion coverage.' },
  { value: 'quiet', label: 'Quiet', impact: 'Favor restrained, gentle, low-energy camera movement.' },
  { value: 'energetic', label: 'Energetic', impact: 'Favor active tracking, dynamic movement, and stronger camera energy.' },
])

export const CANVAS_SHOT_TEMPORAL_EFFECT_OPTIONS = Object.freeze([
  { value: '', label: 'Off / natural time', impact: 'Characters and environment move in the same natural time.' },
  { value: 'realtime_subjects_timelapse_world', label: 'Real-time characters / time-lapse world', impact: 'Keep mapped characters natural while the background world accelerates.' },
  { value: 'frozen_world', label: 'Characters move / world frozen', impact: 'Characters move while the surrounding world remains almost still.' },
  { value: 'reverse_world', label: 'Characters forward / world reverses', impact: 'Characters move forward while background action runs backward.' },
  { value: 'day_night_sweep', label: 'Day/night sweep', impact: 'Accelerate daylight, shadows, and practical-light changes.' },
  { value: 'seasonal_passage', label: 'Seasons pass', impact: 'Transition the location through coherent seasonal changes.' },
  { value: 'crowd_flow', label: 'Crowd river', impact: 'Move anonymous extras around protected referenced characters.' },
  { value: 'looping_background', label: 'Looping background', impact: 'Repeat background actions while the referenced cast continues.' },
  { value: 'delayed_world', label: 'Delayed world', impact: 'Make environmental reactions visibly lag behind the characters.' },
  { value: 'living_shadows', label: 'Living shadows', impact: 'Let shadows move independently from the protected characters.' },
  { value: 'reflection_delay', label: 'Delayed reflections', impact: 'Make reflections respond later than the real-time cast.' },
  { value: 'gravity_separation', label: 'Altered-gravity world', impact: 'Keep characters grounded while loose environment objects move unnaturally.' },
])

const CANVAS_SHOT_VIDEO_STYLE_LABELS = [
  'Cinematic realism', 'Gothic romance', 'Dark fantasy', 'Ethereal dreamscape', 'Surrealism', 'Cosmic horror',
  'Psychological horror', 'Found footage', 'Analog horror', 'Body horror', 'Occult ritual', 'Silent Hill-inspired',
  'Cyberpunk', 'Biopunk', 'Dieselpunk', 'Steampunk', 'Post-apocalyptic', 'Dystopian sci-fi', 'Retro-futurism',
  'Y2K futurism', 'Vaporwave', 'Synthwave', 'Dreamcore', 'Weirdcore', 'Liminal space', 'Dark academia',
  'Cottagecore', 'Fairycore', 'Angelcore', 'Goblincore', 'Whimsigoth', 'Baroque', 'Rococo', 'Art Nouveau',
  'Art Deco', 'Victorian gothic', 'Renaissance-inspired', 'Medieval fantasy', 'Mythological epic', 'Film noir',
  'Neo-noir', 'Expressionism', 'Giallo horror', 'Grindhouse', '1970s psychedelic', '1980s music video',
  '1990s grunge', 'Early-2000s pop', 'Indie sleaze', 'Lo-fi VHS', 'Super 8 film', 'Vintage Hollywood',
  'High-fashion editorial', 'Avant-garde fashion', 'Runway glamour', 'Luxury commercial', 'Beauty campaign',
  'Pop-star music video', 'Industrial metal', 'Gothic metal', 'Alternative rock', 'Punk rock', 'Dark pop',
  'Hyperpop', 'K-pop-inspired', 'R&B glamour', 'Eerie claymation', 'Stop-motion', 'Paper-cut animation',
  'Hand-painted animation', 'Anime-inspired', 'Graphic novel', 'Comic-book', 'Cel-shaded 3D', 'Photorealistic CGI',
  'Low-poly 3D', 'Miniature diorama', 'Dollhouse surrealism', 'Liquid chrome', 'Holographic iridescence',
  'Neon noir', 'Monochrome minimalism', 'High-key white studio', 'Low-key chiaroscuro', 'Soft pastel',
  'Desaturated melancholy', 'Crimson-and-black', 'Teal-and-orange blockbuster', 'Golden-hour nostalgia',
  'Moonlit blue', 'Underwater ethereal', 'Elemental fantasy', 'Nature mysticism', 'Apocalyptic biblical',
  'Glitch art', 'Datamosh', 'CRT distortion', 'Kaleidoscopic', 'Double exposure', 'Infrared', 'Thermal vision',
  'Fisheye distortion', 'Security-camera footage', 'Documentary realism', 'Social-media selfie', 'TikTok transformation',
  'Dreamlike slow motion', 'Frenetic montage', 'One-take immersive', 'Music-video performance',
  'Narrative short film', 'Movie-trailer aesthetic',
]

export const CANVAS_SHOT_VIDEO_STYLE_OPTIONS = Object.freeze([
  { value: '', label: 'Default / let prompt decide', impact: 'No additional global video aesthetic is imposed.' },
  ...CANVAS_SHOT_VIDEO_STYLE_LABELS.map((label) => ({
    value: label,
    label,
    impact: `${label} visual direction for the target video translator.`,
  })),
])

const DEFAULT_SHOT_ASSIGNMENTS = Object.freeze([])

export function normalizeCanvasShotAssignments(assignments, durationStart = 0, durationEnd = Number.POSITIVE_INFINITY) {
  const startLimit = Math.max(0, Number(durationStart) || 0)
  const endLimit = Math.max(startLimit, Number.isFinite(Number(durationEnd)) ? Number(durationEnd) : startLimit)
  return Array.isArray(assignments) ? assignments.map((assignment) => ({
    characterId: String(assignment?.characterId || ''),
    cues: Array.isArray(assignment?.cues) ? assignment.cues.map((cue) => {
      const start = Math.min(endLimit, Math.max(startLimit, Number(cue?.start) || startLimit))
      const end = Math.min(endLimit, Math.max(start, Number(cue?.end) || start))
      return { start, end, type: String(cue?.type || 'silent'), text: String(cue?.text || '') }
    }) : [],
  })) : []
}

export function formatCanvasTime(milliseconds) {
  const value = Math.max(0, Math.round(Number(milliseconds) || 0))
  return value.toLocaleString('en-US')
}

export function parseCanvasTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '')
  if (!text) return null
  if (/^\d{1,3}(?:,\d{3})+$/.test(text)) return Math.max(0, Number(text.replace(/,/g, '')))
  const match = text.match(/^(?:(\d+(?:\.\d+)?)sec)?(?:(\d+)milli?sec)?$/)
  if (!match || (!match[1] && !match[2])) return null
  const seconds = match[1] ? Number(match[1]) * 1000 : 0
  const millis = match[2] ? Number(match[2]) : 0
  return Number.isFinite(seconds) && Number.isFinite(millis) ? Math.max(0, Math.round(seconds + millis)) : null
}

const CANVAS_BLOCK_LIBRARY_DEFINITIONS = [
  {
    type: CANVAS_BLOCK_TYPES.configuration,
    label: 'Canvas Configuration',
    description: 'Global rules for this Canvas',
    category: 'Canvas',
    visualFamily: CANVAS_VISUAL_FAMILIES.system,
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
    visualFamily: CANVAS_VISUAL_FAMILIES.subject,
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
    visualFamily: CANVAS_VISUAL_FAMILIES.asset,
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
    visualFamily: CANVAS_VISUAL_FAMILIES.asset,
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
    visualFamily: CANVAS_VISUAL_FAMILIES.subject,
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
    visualFamily: CANVAS_VISUAL_FAMILIES.asset,
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
    visualFamily: CANVAS_VISUAL_FAMILIES.asset,
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
    visualFamily: CANVAS_VISUAL_FAMILIES.organization,
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
      { id: 'videoStyle', label: 'Video style default', type: 'select', defaultValue: '', options: CANVAS_SHOT_VIDEO_STYLE_OPTIONS },
      { id: 'temporalWorldEffect', label: 'Temporal/world effect default', type: 'select', defaultValue: '', options: CANVAS_SHOT_TEMPORAL_EFFECT_OPTIONS },
      { id: 'cameraFlow', label: 'Camera flow preset default', type: 'select', defaultValue: '', options: CANVAS_SHOT_CAMERA_FLOW_OPTIONS },
    ],
    defaults: { title: 'New timeline', properties: { prompt: '', seed: 1, description: '', videoStyle: '', temporalWorldEffect: '', cameraFlow: '' } },
  },
  {
    type: CANVAS_BLOCK_TYPES.scene,
    label: 'Scene',
    description: 'An organizing container for shots',
    category: 'Production',
    visualFamily: CANVAS_VISUAL_FAMILIES.organization,
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
    visualFamily: CANVAS_VISUAL_FAMILIES.production,
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
      { id: 'duration', label: 'Duration (seconds)', type: 'readonly', defaultValue: 5 },
      { id: 'duration_start', label: 'Duration start', type: 'timecode', defaultValue: 0 },
      { id: 'duration_end', label: 'Duration end', type: 'timecode', defaultValue: 5000 },
      { id: 'framing', label: 'Framing', type: 'select', defaultValue: '', options: [
        { value: '', label: 'Inherited/default' },
        { value: 'extreme_close_up', label: 'Extreme close-up' },
        { value: 'close_up', label: 'Close-up' },
        { value: 'medium', label: 'Medium' },
        { value: 'wide', label: 'Wide' },
        { value: 'extreme_wide', label: 'Extreme wide' },
      ], inToolbar: true },
      { id: 'cameraMovement', label: 'Exact camera movement', type: 'text', defaultValue: '' },
      { id: 'lens', label: 'Lens', type: 'text', defaultValue: '' },
      { id: 'lighting', label: 'Lighting', type: 'textarea', defaultValue: '' },
      { id: 'action', label: 'Action', type: 'textarea', defaultValue: '' },
      { id: 'cameraFlow', label: 'Camera flow preset', type: 'select', defaultValue: '', options: CANVAS_SHOT_CAMERA_FLOW_OPTIONS, inToolbar: true },
      { id: 'videoStyle', label: 'Video style', type: 'select', defaultValue: '', options: CANVAS_SHOT_VIDEO_STYLE_OPTIONS },
      { id: 'temporalWorldEffect', label: 'Temporal/world effect', type: 'select', defaultValue: '', options: CANVAS_SHOT_TEMPORAL_EFFECT_OPTIONS },
      { id: 'performanceMode', label: 'Performance mode', type: 'select', defaultValue: 'performance', options: CANVAS_SHOT_PERFORMANCE_MODES, inToolbar: true },
      { id: 'characterAssignments', label: 'Character assignments', type: 'shot-cues', defaultValue: DEFAULT_SHOT_ASSIGNMENTS },
    ],
    defaults: { title: 'Shot 1', properties: { prompt: '', seed: 1, description: '', duration: 5, duration_start: 0, duration_end: 5000, framing: '', cameraMovement: '', lens: '', lighting: '', action: '', videoStyle: '', temporalWorldEffect: '', cameraFlow: '', performanceMode: 'performance', characterAssignments: DEFAULT_SHOT_ASSIGNMENTS } },
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

export function getCanvasCapabilities() {
  return CANVAS_BLOCK_LIBRARY.map((definition) => ({
    type: definition.type,
    label: definition.label,
    description: definition.description,
    visualFamily: definition.visualFamily,
    fixed: Boolean(definition.fixed),
    allowedParents: definition.allowedParents || [],
    contains: definition.contains || [],
    inputs: (definition.inputs || []).map((handle) => ({ id: handle.id, label: handle.label, type: handle.type, multiple: handle.multiple === true })),
    outputs: (definition.outputs || []).map((handle) => ({ id: handle.id, label: handle.label, type: handle.type, multiple: handle.multiple === true })),
    properties: (definition.properties || []).map((property) => ({
      id: property.id,
      label: property.label,
      type: property.type,
      options: (property.options || []).map((option) => ({ value: option.value, label: option.label })),
    })),
  }))
}

export function createCanvasShotTranslationContext(shotNode) {
  const properties = shotNode?.data?.properties || {}
  const durationStartMs = Math.max(0, Number(properties.duration_start) || 0)
  const durationEndMs = Math.max(durationStartMs, Number(properties.duration_end) || durationStartMs)
  const assignments = normalizeCanvasShotAssignments(properties.characterAssignments, durationStartMs, durationEndMs)
  return {
    shotId: String(shotNode?.id || ''),
    prompt: String(properties.prompt || ''),
    performanceMode: String(properties.performanceMode || 'performance'),
    videoStyle: String(properties.videoStyle || ''),
    temporalWorldEffect: String(properties.temporalWorldEffect || ''),
    cameraFlow: String(properties.cameraFlow || ''),
    framing: String(properties.framing || ''),
    cameraMovement: String(properties.cameraMovement || ''),
    action: String(properties.action || ''),
    lighting: String(properties.lighting || ''),
    durationStartMs,
    durationEndMs,
    characterAssignments: assignments.map((assignment) => ({
      characterId: String(assignment?.characterId || ''),
      cues: Array.isArray(assignment?.cues) ? assignment.cues.map((cue) => ({
        startMs: cue.start,
        endMs: cue.end,
        type: String(cue?.type || 'silent'),
        text: String(cue?.text || ''),
      })) : [],
    })),
  }
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
  if (definition.type === CANVAS_BLOCK_TYPES.shot) {
    properties.duration = Math.max(0, (Number(properties.duration_end) || 0) - (Number(properties.duration_start) || 0)) / 1000
  }
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
      createCanvasNode(CANVAS_BLOCK_TYPES.image, { id: 'location-image-1', parentId: location.id, title: 'Location image', position: { x: 12, y: 46 } }),
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

export function canAddCanvasChild(parentId, childType, nodes) {
  const parent = nodes.find((node) => node.id === parentId)
  if (!parent || !canContainCanvasNode(parent.type, childType)) return false
  if (![CANVAS_BLOCK_TYPES.characterSheet, CANVAS_BLOCK_TYPES.locationSheet].includes(childType)) return true
  return nodes.some((node) => node.parentId === parentId
    && node.type === CANVAS_BLOCK_TYPES.image
    && Boolean(String(node.data?.assetUrl || '').trim()))
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
      const parent = node.parentId ? base.nodes.find((candidate) => candidate.id === node.parentId) : null
      const contextualTitle = definition.type === CANVAS_BLOCK_TYPES.image
        && parent?.type === CANVAS_BLOCK_TYPES.location
        && (!node.data?.title || node.data.title === 'Character image')
        ? 'Location image'
        : node.data?.title
      const legacyProperties = node.data?.properties || {}
      const migratedProperties = definition.type === CANVAS_BLOCK_TYPES.shot
        && !Array.isArray(legacyProperties.characterAssignments)
        && String(legacyProperties.dialogue || '').trim()
        ? {
          ...legacyProperties,
          characterAssignments: [{ characterId: '', cues: [{ start: 0, end: Number(legacyProperties.duration || 5) * 1000, type: 'dialogue', text: String(legacyProperties.dialogue).trim() }] }],
        }
        : legacyProperties
      if (definition.type === CANVAS_BLOCK_TYPES.shot) {
        if (migratedProperties.duration_end == null && migratedProperties.duration != null) {
          migratedProperties.duration_end = Math.max(0, Number(migratedProperties.duration) * 1000)
        }
        migratedProperties.characterAssignments = normalizeCanvasShotAssignments(
          migratedProperties.characterAssignments,
          migratedProperties.duration_start,
          migratedProperties.duration_end,
        )
      }
      const normalized = createCanvasNode(definition.type, {
        id: node.id,
        index,
        position: node.position,
        title: contextualTitle,
        properties: migratedProperties,
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
