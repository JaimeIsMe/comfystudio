/**
 * Central workflow registry - shared by GenerateWorkspace, Settings, and workflow store.
 * Defines all known workflows: built-in (always installed) and available (user can download).
 */

export const WORKFLOW_CATEGORIES = {
  video: 'video',
  image: 'image',
  audio: 'audio',
}

// Built-in workflows shipped with ComfyStudio - always installed, cannot be deleted
export const BUILTIN_WORKFLOWS = [
  { id: 'wan22-i2v', label: 'Image to Video (WAN 2.2)', category: 'video', needsImage: true, description: 'Animate an image into video', file: 'video_wan2_2_14B_i2v.json' },
  { id: 'kling-o3-i2v', label: 'Image to Video (Kling O3 Omni)', category: 'video', needsImage: true, description: 'Premium image-to-video with Kling 3.0 Omni', file: 'api_kling_o3_i2v.json' },
  { id: 'multi-angles', label: 'Multiple Angles (Characters)', category: 'image', needsImage: true, description: 'Generate 8 camera angles from one character image', file: '1_click_multiple_angles.json' },
  { id: 'multi-angles-scene', label: 'Multiple Angles (Scenes)', category: 'image', needsImage: true, description: 'Generate 8 camera angles from one scene image', file: '1_click_multiple_scene_angles-v1.0.json' },
  { id: 'image-edit', label: 'Image Edit', category: 'image', needsImage: true, description: 'Edit image with text prompt', file: 'image_qwen_image_edit_2509.json' },
  { id: 'z-image-turbo', label: 'Text to Image (Z Image Turbo)', category: 'image', needsImage: false, description: 'Generate image from text prompt using Z Image Turbo', file: 'image_z_image_turbo.json' },
  { id: 'nano-banana-2', label: 'Text to Image (Nano Banana 2)', category: 'image', needsImage: false, description: 'Premium text-to-image with Nano Banana 2', file: 'api_google_nano_banana2_image_edit.json' },
  { id: 'music-gen', label: 'Music Generation', category: 'audio', needsImage: false, description: 'Generate music from tags and lyrics', file: 'music_generation.json' },
]

// Map workflow id -> public path (for loading JSON)
export const BUILTIN_WORKFLOW_PATHS = {
  'wan22-i2v': '/workflows/video_wan2_2_14B_i2v.json',
  'kling-o3-i2v': '/workflows/api_kling_o3_i2v.json',
  'multi-angles': '/workflows/1_click_multiple_angles.json',
  'multi-angles-scene': '/workflows/1_click_multiple_scene_angles-v1.0.json',
  'image-edit': '/workflows/image_qwen_image_edit_2509.json',
  'image-edit-model-product': '/workflows/image_qwen_image_edit_2509_Model_and_Product.json',
  'z-image-turbo': '/workflows/image_z_image_turbo.json',
  'nano-banana-2': '/workflows/api_google_nano_banana2_image_edit.json',
  'nano-banana-pro': '/workflows/api_google_nano_banana2_image_edit.json', // legacy id alias
  'music-gen': '/workflows/music_generation.json',
}

// Optional workflows - user can download to enable (not in Generate until installed)
export const AVAILABLE_WORKFLOWS = [
  { id: 'mask-gen', label: 'Mask Generation', category: 'image', needsImage: true, description: 'Generate masks from images/videos using text prompts (SAM3)', file: 'mask_generation_text_prompt.json' },
]

// All workflows for display (built-in + available)
export const ALL_WORKFLOWS = [...BUILTIN_WORKFLOWS, ...AVAILABLE_WORKFLOWS]

// Category labels for UI
export const CATEGORY_LABELS = {
  video: 'Video',
  image: 'Image',
  audio: 'Audio',
}
