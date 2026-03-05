export const SHOT_CATEGORIES = {
  Shot: ['Extreme close-up', 'Close-up', 'Medium close-up', 'Medium shot', 'Medium wide', 'Wide shot', 'Extreme wide', 'Over-the-shoulder', 'POV', 'Two-shot', 'Insert shot'],
  Movement: ['Static', 'Pan', 'Tilt', 'Dolly in', 'Dolly out', 'Push in', 'Pull out', 'Tracking shot', 'Crane shot', 'Steadicam', 'Handheld', 'Drone', 'Aerial', 'Orbit', 'Whip pan'],
  Angle: ['Eye level', 'Low angle', 'High angle', "Bird's eye", 'Overhead', "Worm's eye", 'Dutch angle'],
  Lighting: ['Natural light', 'Golden hour', 'Blue hour', 'High key', 'Low key', 'Dramatic lighting', 'Cinematic lighting', 'Soft lighting', 'Hard lighting', 'Backlit', 'Silhouette', 'Rim lighting', 'Neon', 'Candlelit', 'Moonlit'],
  Mood: ['Cinematic', 'Dramatic', 'Epic', 'Intimate', 'Mysterious', 'Tense', 'Suspenseful', 'Romantic', 'Melancholic', 'Energetic', 'Serene', 'Ethereal', 'Dark'],
  Style: ['Film noir', 'Documentary', 'Commercial', 'Music video', 'Blockbuster', 'Indie film', 'Vintage', 'Retro', 'Sci-fi', 'Fantasy', 'Horror', 'Western'],
  Color: ['Desaturated', 'High contrast', 'Warm tones', 'Cool tones', 'Teal and orange', 'Black and white', 'Vibrant', 'Muted', 'Neon colors'],
  Speed: ['Slow motion', 'Real-time', 'Fast motion', 'Time-lapse', 'Hyperlapse'],
  Depth: ['Shallow DOF', 'Bokeh', 'Deep focus', 'Rack focus'],
  Lens: ['Anamorphic', 'Wide angle', 'Telephoto', 'Fisheye', 'Macro', '35mm film look'],
}

export const CATEGORY_ORDER = ['Shot', 'Movement', 'Angle', 'Lighting', 'Mood', 'Style', 'Color', 'Speed', 'Depth', 'Lens']

export const WORKFLOWS = {
  video: [
    { id: 'wan22-i2v', label: 'Image to Video (WAN 2.2)', needsImage: true, description: 'Animate an image into video' },
    { id: 'kling-o3-i2v', label: 'Image to Video (Kling O3 Omni)', needsImage: true, description: 'Premium image-to-video with Kling 3.0 Omni' },
  ],
  image: [
    { id: 'z-image-turbo', label: 'Text to Image (Z Image Turbo)', needsImage: false, description: 'Generate image from text prompt using Z Image Turbo' },
    { id: 'nano-banana-2', label: 'Text to Image (Nano Banana 2)', needsImage: false, description: 'Premium text-to-image with Nano Banana 2' },
    { id: 'multi-angles', label: 'Multiple Angles (Characters)', needsImage: true, description: 'Generate 8 camera angles from one character image' },
    { id: 'multi-angles-scene', label: 'Multiple Angles (Scenes)', needsImage: true, description: 'Generate 8 camera angles from one scene image' },
    { id: 'image-edit', label: 'Image Edit', needsImage: true, description: 'Edit image with text prompt (e.g. remove person on left, change color of car)' },
  ],
  audio: [
    { id: 'music-gen', label: 'Music Generation', needsImage: false, description: 'Generate music from tags and lyrics' },
  ],
}

export const DIRECTOR_MODE_BETA_LABEL = 'Director Mode beta'

export const YOLO_PROFILES = {
  draft: {
    storyboardWorkflowId: 'z-image-turbo',
    videoWorkflowId: 'wan22-i2v',
  },
  balanced: {
    storyboardWorkflowId: 'nano-banana-2',
    videoWorkflowId: 'wan22-i2v',
  },
  premium: {
    storyboardWorkflowId: 'nano-banana-2',
    videoWorkflowId: 'kling-o3-i2v',
  },
}

export const VIDEO_DURATION_PRESETS = [2, 3, 5, 8]
export const YOLO_QUEUE_CONFIRM_THRESHOLD = 10
export const ACTIVE_JOB_STATUSES = ['uploading', 'configuring', 'queuing', 'running', 'saving']
export const NON_TERMINAL_JOB_STATUSES = ['queued', 'paused', ...ACTIVE_JOB_STATUSES]

export const YOLO_AD_REFERENCE_CONSISTENCY_OPTIONS = Object.freeze({
  soft: 'Soft (allow stylistic variation)',
  medium: 'Medium (balanced consistency)',
  strict: 'Strict (maximize identity match)',
})

export const GENERATED_ASSET_FOLDERS = Object.freeze({
  image: ['Generated', 'Images'],
  video: ['Generated', 'Videos'],
  audio: ['Generated', 'Audio'],
})

export const YOLO_CAMERA_PRESET_OPTIONS = Object.freeze([
  { id: 'auto', label: 'Auto (from script)', angles: [] },
  { id: 'wide_establishing', label: 'Wide Establishing', angles: ['Wide shot', 'Eye level'] },
  { id: 'hero_product', label: 'Hero Product', angles: ['Close-up', 'Low angle'] },
  { id: 'dialogue_clean', label: 'Dialogue / Performance', angles: ['Medium shot', 'Over-the-shoulder'] },
  { id: 'dynamic_action', label: 'Dynamic Action', angles: ['Tracking shot', 'Low angle'] },
  { id: 'pov_energy', label: 'POV Energy', angles: ['POV', 'Handheld'] },
])

export const YOLO_VIDEO_WORKFLOW_TARGET_OPTIONS = Object.freeze([
  { id: 'profile', label: 'Profile default' },
  { id: 'wan22-i2v', label: 'WAN 2.2' },
  { id: 'kling-o3-i2v', label: 'Kling O3 Omni' },
])

const WORKFLOW_DISPLAY_LABELS = Object.freeze({
  'wan22-i2v': 'WAN 2.2',
  'kling-o3-i2v': 'Kling O3 Omni',
  'image-edit-model-product': 'Qwen Image Edit 2509 (Model + Product)',
})

export const OPEN_COMFY_TAB_EVENT = 'comfystudio-open-comfyui-tab'

export const HARDWARE_TIERS = Object.freeze({
  lite: {
    id: 'lite',
    shortLabel: 'Lite',
    label: 'Low-end local',
    badgeClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  },
  standard: {
    id: 'standard',
    shortLabel: 'Standard',
    label: 'Mid-range local',
    badgeClass: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  },
  pro: {
    id: 'pro',
    shortLabel: 'Pro',
    label: 'High-end local',
    badgeClass: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  },
  cloud: {
    id: 'cloud',
    shortLabel: 'Cloud',
    label: 'Credits / cloud',
    badgeClass: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
})

const WORKFLOW_HARDWARE = Object.freeze({
  'z-image-turbo': {
    tierId: 'lite',
    runtime: 'local',
    minimumVramGb: 8,
    recommendedVramGb: 10,
  },
  'music-gen': {
    tierId: 'lite',
    runtime: 'local',
    minimumVramGb: 4,
    recommendedVramGb: 8,
  },
  'image-edit': {
    tierId: 'standard',
    runtime: 'local',
    minimumVramGb: 12,
    recommendedVramGb: 16,
  },
  'image-edit-model-product': {
    tierId: 'standard',
    runtime: 'local',
    minimumVramGb: 12,
    recommendedVramGb: 16,
  },
  'multi-angles': {
    tierId: 'standard',
    runtime: 'local',
    minimumVramGb: 12,
    recommendedVramGb: 16,
  },
  'multi-angles-scene': {
    tierId: 'standard',
    runtime: 'local',
    minimumVramGb: 12,
    recommendedVramGb: 16,
  },
  'wan22-i2v': {
    tierId: 'pro',
    runtime: 'local',
    minimumVramGb: 20,
    recommendedVramGb: 24,
  },
  'nano-banana-2': {
    tierId: 'cloud',
    runtime: 'cloud',
  },
  'kling-o3-i2v': {
    tierId: 'cloud',
    runtime: 'cloud',
  },
})

export function getWorkflowDisplayLabel(workflowId = '') {
  return WORKFLOW_DISPLAY_LABELS[workflowId] || String(workflowId || '')
}

export function getWorkflowHardwareInfo(workflowId = '') {
  const normalized = String(workflowId || '').trim() === 'nano-banana-pro'
    ? 'nano-banana-2'
    : String(workflowId || '').trim()
  return WORKFLOW_HARDWARE[normalized] || null
}

export function getWorkflowTierMeta(workflowId = '') {
  const hardware = getWorkflowHardwareInfo(workflowId)
  if (!hardware) return null
  return HARDWARE_TIERS[hardware.tierId] || null
}

export function formatWorkflowHardwareRuntime(workflowId = '') {
  const hardware = getWorkflowHardwareInfo(workflowId)
  if (!hardware) return 'VRAM unknown'
  if (hardware.runtime === 'cloud') {
    return 'Credits via ComfyUI partner nodes'
  }
  const min = Number(hardware.minimumVramGb)
  const rec = Number(hardware.recommendedVramGb)
  if (Number.isFinite(min) && min > 0 && Number.isFinite(rec) && rec >= min) {
    return `${min}GB min / ${rec}GB rec`
  }
  if (Number.isFinite(min) && min > 0) {
    return `${min}GB minimum`
  }
  return 'Local GPU'
}

export function formatWorkflowTierSummary(workflowId = '') {
  const tier = getWorkflowTierMeta(workflowId)
  const label = getWorkflowDisplayLabel(workflowId)
  const runtime = formatWorkflowHardwareRuntime(workflowId)
  if (!tier) return `${label}: ${runtime}`
  return `${label}: ${tier.label} (${runtime})`
}
