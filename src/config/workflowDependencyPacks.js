/**
 * Workflow dependency manifests used for preflight checks before queueing jobs.
 * Phase 1 intentionally focuses on required dependencies only.
 */

const COMFY_REGISTRY_URL = 'https://registry.comfy.org'

const QWEN_IMAGE_EDIT_SHARED_MODELS = Object.freeze([
  {
    classType: 'VAELoader',
    inputKey: 'vae_name',
    filename: 'qwen_image_vae.safetensors',
    targetSubdir: 'vae',
  },
  {
    classType: 'CLIPLoader',
    inputKey: 'clip_name',
    filename: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
    targetSubdir: 'text_encoders',
  },
  {
    classType: 'UNETLoader',
    inputKey: 'unet_name',
    filename: 'qwen_image_edit_2509_fp8_e4m3fn.safetensors',
    targetSubdir: 'diffusion_models',
  },
  {
    classType: 'LoraLoaderModelOnly',
    inputKey: 'lora_name',
    filename: 'Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors',
    targetSubdir: 'loras',
  },
])

const QWEN_IMAGE_EDIT_REQUIRED_NODES = Object.freeze([
  { classType: 'TextEncodeQwenImageEditPlus' },
  { classType: 'FluxKontextImageScale' },
  { classType: 'KSampler' },
  { classType: 'SaveImage' },
])

export const WORKFLOW_DEPENDENCY_PACKS = Object.freeze({
  'wan22-i2v': Object.freeze({
    id: 'wan22-i2v',
    displayName: 'WAN 2.2 Image-to-Video',
    requiredNodes: Object.freeze([
      { classType: 'CLIPLoader' },
      { classType: 'VAELoader' },
      { classType: 'UNETLoader' },
      { classType: 'LoraLoaderModelOnly' },
      { classType: 'WanImageToVideo' },
      { classType: 'SaveVideo' },
    ]),
    requiredModels: Object.freeze([
      {
        classType: 'CLIPLoader',
        inputKey: 'clip_name',
        filename: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
        targetSubdir: 'text_encoders',
      },
      {
        classType: 'VAELoader',
        inputKey: 'vae_name',
        filename: 'wan_2.1_vae.safetensors',
        targetSubdir: 'vae',
      },
      {
        classType: 'UNETLoader',
        inputKey: 'unet_name',
        filename: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
        targetSubdir: 'diffusion_models',
      },
      {
        classType: 'UNETLoader',
        inputKey: 'unet_name',
        filename: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
        targetSubdir: 'diffusion_models',
      },
      {
        classType: 'LoraLoaderModelOnly',
        inputKey: 'lora_name',
        filename: 'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
        targetSubdir: 'loras',
      },
      {
        classType: 'LoraLoaderModelOnly',
        inputKey: 'lora_name',
        filename: 'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
        targetSubdir: 'loras',
      },
    ]),
    docsUrl: COMFY_REGISTRY_URL,
  }),

  'kling-o3-i2v': Object.freeze({
    id: 'kling-o3-i2v',
    displayName: 'Kling O3 Omni Image-to-Video',
    requiredNodes: Object.freeze([
      { classType: 'KlingOmniProImageToVideoNode' },
      { classType: 'SaveVideo' },
    ]),
    requiredModels: Object.freeze([]),
    requiresComfyOrgApiKey: true,
    docsUrl: COMFY_REGISTRY_URL,
  }),

  'nano-banana-2': Object.freeze({
    id: 'nano-banana-2',
    displayName: 'Nano Banana 2',
    requiredNodes: Object.freeze([
      { classType: 'GeminiNanoBanana2' },
      { classType: 'SaveImage' },
    ]),
    requiredModels: Object.freeze([]),
    requiresComfyOrgApiKey: true,
    docsUrl: COMFY_REGISTRY_URL,
  }),

  'z-image-turbo': Object.freeze({
    id: 'z-image-turbo',
    displayName: 'Z Image Turbo',
    requiredNodes: Object.freeze([
      { classType: 'CLIPLoader' },
      { classType: 'VAELoader' },
      { classType: 'UNETLoader' },
      { classType: 'ModelSamplingAuraFlow' },
      { classType: 'KSampler' },
      { classType: 'SaveImage' },
    ]),
    requiredModels: Object.freeze([
      {
        classType: 'CLIPLoader',
        inputKey: 'clip_name',
        filename: 'qwen_3_4b.safetensors',
        targetSubdir: 'text_encoders',
      },
      {
        classType: 'VAELoader',
        inputKey: 'vae_name',
        filename: 'ae.safetensors',
        targetSubdir: 'vae',
      },
      {
        classType: 'UNETLoader',
        inputKey: 'unet_name',
        filename: 'z_image_turbo_bf16.safetensors',
        targetSubdir: 'diffusion_models',
      },
    ]),
    docsUrl: COMFY_REGISTRY_URL,
  }),

  'image-edit': Object.freeze({
    id: 'image-edit',
    displayName: 'Qwen Image Edit',
    requiredNodes: QWEN_IMAGE_EDIT_REQUIRED_NODES,
    requiredModels: QWEN_IMAGE_EDIT_SHARED_MODELS,
    docsUrl: COMFY_REGISTRY_URL,
  }),

  'image-edit-model-product': Object.freeze({
    id: 'image-edit-model-product',
    displayName: 'Qwen Image Edit (Model + Product)',
    requiredNodes: Object.freeze([
      ...QWEN_IMAGE_EDIT_REQUIRED_NODES,
      { classType: 'ImageResizeKJv2' },
    ]),
    requiredModels: QWEN_IMAGE_EDIT_SHARED_MODELS,
    docsUrl: COMFY_REGISTRY_URL,
  }),

  'multi-angles': Object.freeze({
    id: 'multi-angles',
    displayName: 'Multiple Angles (Character)',
    requiredNodes: Object.freeze([
      { classType: 'TextEncodeQwenImageEditPlus' },
      { classType: 'SaveImage' },
    ]),
    requiredModels: Object.freeze([
      ...QWEN_IMAGE_EDIT_SHARED_MODELS,
      {
        classType: 'LoraLoaderModelOnly',
        inputKey: 'lora_name',
        filename: 'Qwen-Edit-2509-Multiple-angles.safetensors',
        targetSubdir: 'loras',
      },
    ]),
    docsUrl: COMFY_REGISTRY_URL,
  }),

  'multi-angles-scene': Object.freeze({
    id: 'multi-angles-scene',
    displayName: 'Multiple Angles (Scene)',
    requiredNodes: Object.freeze([
      { classType: 'TextEncodeQwenImageEditPlus' },
      { classType: 'SaveImage' },
    ]),
    requiredModels: Object.freeze([
      ...QWEN_IMAGE_EDIT_SHARED_MODELS,
      {
        classType: 'LoraLoaderModelOnly',
        inputKey: 'lora_name',
        filename: 'Qwen-Edit-2509-Multiple-angles.safetensors',
        targetSubdir: 'loras',
      },
    ]),
    docsUrl: COMFY_REGISTRY_URL,
  }),

  'music-gen': Object.freeze({
    id: 'music-gen',
    displayName: 'AceStep Music Generation',
    requiredNodes: Object.freeze([
      { classType: 'TextEncodeAceStepAudio1.5' },
      { classType: 'VAEDecodeAudio' },
      { classType: 'SaveAudioMP3' },
    ]),
    requiredModels: Object.freeze([
      {
        classType: 'UNETLoader',
        inputKey: 'unet_name',
        filename: 'acestep_v1.5_turbo.safetensors',
        targetSubdir: 'diffusion_models',
      },
      {
        classType: 'VAELoader',
        inputKey: 'vae_name',
        filename: 'ace_1.5_vae.safetensors',
        targetSubdir: 'vae',
      },
    ]),
    docsUrl: COMFY_REGISTRY_URL,
  }),
})

export function getWorkflowDependencyPack(workflowId) {
  const normalized = String(workflowId || '').trim()
  const canonicalId = (
    normalized === 'nano-banana-pro'
      ? 'nano-banana-2'
      : normalized
  )
  return WORKFLOW_DEPENDENCY_PACKS[canonicalId] || null
}
