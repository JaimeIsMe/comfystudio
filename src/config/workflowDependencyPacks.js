/**
 * Workflow dependency manifests used for preflight checks before queueing jobs.
 * Phase 1 intentionally focuses on required dependencies only.
 */

import { TOPAZ_VIDEO_UPSCALE_WORKFLOW_ID } from './topazVideoUpscaleConfig'
import { MUSIC_VIDEO_SHOT_WORKFLOW_ID, VOCAL_EXTRACT_WORKFLOW_ID } from './musicVideoShotConfig'

const COMFY_REGISTRY_URL = 'https://registry.comfy.org'
const NANO_BANANA_2_FALLBACK_ESTIMATED_CREDITS = Object.freeze({
  // Resolution-dependent partner-node pricing currently spans roughly $0.0696-$0.123 per image.
  // Converted using Comfy's documented 211 credits = $1 rate.
  min: 14.6856,
  max: 25.953,
})

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

  'ltx23-i2v': Object.freeze({
    id: 'ltx23-i2v',
    displayName: 'LTX 2.3 Image-to-Video',
    requiredNodes: Object.freeze([
      { classType: 'CheckpointLoaderSimple' },
      { classType: 'LTXAVTextEncoderLoader' },
      { classType: 'LTXVAudioVAELoader' },
      { classType: 'LoraLoaderModelOnly' },
      { classType: 'ResizeImageMaskNode' },
      { classType: 'ResizeImagesByLongerEdge' },
      { classType: 'LTXVPreprocess' },
      { classType: 'EmptyLTXVLatentVideo' },
      { classType: 'LTXVImgToVideoInplace' },
      { classType: 'LTXVConditioning' },
      { classType: 'LTXVCropGuides' },
      { classType: 'LTXVEmptyLatentAudio' },
      { classType: 'LTXVSeparateAVLatent' },
      { classType: 'LTXVConcatAVLatent' },
      { classType: 'LTXVLatentUpsampler' },
      { classType: 'LatentUpscaleModelLoader' },
      { classType: 'LTXVAudioVAEDecode' },
      { classType: 'VAEDecodeTiled' },
      { classType: 'CreateVideo' },
      { classType: 'SaveVideo' },
    ]),
    requiredModels: Object.freeze([
      {
        classType: 'CheckpointLoaderSimple',
        inputKey: 'ckpt_name',
        filename: 'ltx-2.3-22b-dev-fp8.safetensors',
        targetSubdir: 'checkpoints',
      },
      {
        classType: 'LTXVAudioVAELoader',
        inputKey: 'ckpt_name',
        filename: 'ltx-2.3-22b-dev-fp8.safetensors',
        targetSubdir: 'checkpoints',
      },
      {
        classType: 'LTXAVTextEncoderLoader',
        inputKey: 'text_encoder',
        filename: 'gemma_3_12B_it_fp4_mixed.safetensors',
        targetSubdir: 'text_encoders',
      },
      {
        classType: 'LTXAVTextEncoderLoader',
        inputKey: 'ckpt_name',
        filename: 'ltx-2.3-22b-dev-fp8.safetensors',
        targetSubdir: 'checkpoints',
      },
      {
        classType: 'LoraLoaderModelOnly',
        inputKey: 'lora_name',
        filename: 'ltx-2.3-22b-distilled-lora-384.safetensors',
        targetSubdir: 'loras',
      },
      {
        classType: 'LatentUpscaleModelLoader',
        inputKey: 'model_name',
        filename: 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors',
        targetSubdir: 'upscale_models',
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

  'grok-video-i2v': Object.freeze({
    id: 'grok-video-i2v',
    displayName: 'Grok Imagine Video',
    requiredNodes: Object.freeze([
      { classType: 'GrokVideoNode' },
      { classType: 'SaveVideo' },
    ]),
    requiredModels: Object.freeze([]),
    requiresComfyOrgApiKey: true,
    docsUrl: COMFY_REGISTRY_URL,
  }),

  'vidu-q2-i2v': Object.freeze({
    id: 'vidu-q2-i2v',
    displayName: 'Vidu Q2 Image-to-Video',
    requiredNodes: Object.freeze([
      { classType: 'Vidu2ImageToVideoNode' },
      { classType: 'SaveVideo' },
    ]),
    requiredModels: Object.freeze([]),
    requiresComfyOrgApiKey: true,
    docsUrl: COMFY_REGISTRY_URL,
  }),

  [TOPAZ_VIDEO_UPSCALE_WORKFLOW_ID]: Object.freeze({
    id: TOPAZ_VIDEO_UPSCALE_WORKFLOW_ID,
    displayName: 'Topaz Video Upscale',
    requiredNodes: Object.freeze([
      { classType: 'LoadVideo' },
      { classType: 'TopazVideoEnhance' },
      { classType: 'SaveVideo' },
    ]),
    requiredModels: Object.freeze([]),
    requiresComfyOrgApiKey: true,
    docsUrl: COMFY_REGISTRY_URL,
  }),

  [MUSIC_VIDEO_SHOT_WORKFLOW_ID]: Object.freeze({
    id: MUSIC_VIDEO_SHOT_WORKFLOW_ID,
    displayName: 'Music Video Shot (LTX 2.3 + Audio)',
    requiredNodes: Object.freeze([
      // LTX 2.3 audio-conditioned graph
      { classType: 'UNETLoader' },
      { classType: 'DualCLIPLoader' },
      { classType: 'VAELoader' },
      { classType: 'VAELoaderKJ' },
      { classType: 'LTX2AttentionTunerPatch' },
      { classType: 'LTX2SamplingPreviewOverride' },
      { classType: 'LTX2_NAG' },
      { classType: 'LTXVAudioVAEEncode' },
      { classType: 'LTXVChunkFeedForward' },
      { classType: 'LTXVConcatAVLatent' },
      { classType: 'LTXVConditioning' },
      { classType: 'LTXVImgToVideoInplace' },
      { classType: 'LTXVLatentUpsampler' },
      { classType: 'LTXVPreprocess' },
      { classType: 'LTXVSeparateAVLatent' },
      { classType: 'LatentUpscaleModelLoader' },
      { classType: 'TextGenerateLTX2Prompt' },
      // Audio handling + vocal stem fallback
      { classType: 'LoadAudio' },
      { classType: 'TrimAudioDuration' },
      { classType: 'MelBandRoFormerModelLoader' },
      { classType: 'MelBandRoFormerSampler' },
      // KJ Nodes helpers
      { classType: 'ImageResizeKJv2' },
      { classType: 'ResizeImageMaskNode' },
      { classType: 'ResizeImagesByLongerEdge' },
      { classType: 'GetImageSizeAndCount' },
      { classType: 'SimpleCalculatorKJ' },
      { classType: 'LazySwitchKJ' },
      { classType: 'PathchSageAttentionKJ' },
      // rgthree
      { classType: 'Power Lora Loader (rgthree)' },
      // easy-use / comfy switch
      { classType: 'ComfySwitchNode' },
      // Output
      { classType: 'CreateVideo' },
      { classType: 'SaveVideo' },
    ]),
    requiredModels: Object.freeze([
      {
        classType: 'UNETLoader',
        inputKey: 'unet_name',
        filename: 'ltx-2.3-22b-distilled_transformer_only_fp8_scaled.safetensors',
        targetSubdir: 'diffusion_models',
      },
      {
        classType: 'VAELoader',
        inputKey: 'vae_name',
        filename: 'LTX23_video_vae_bf16.safetensors',
        targetSubdir: 'vae',
      },
      {
        classType: 'VAELoader',
        inputKey: 'vae_name',
        filename: 'taeltx2_3.safetensors',
        targetSubdir: 'vae',
      },
      {
        classType: 'VAELoaderKJ',
        inputKey: 'vae_name',
        filename: 'LTX23_audio_vae_bf16.safetensors',
        targetSubdir: 'vae',
      },
      {
        classType: 'DualCLIPLoader',
        inputKey: 'clip_name1',
        filename: 'gemma_3_12B_it_fp8_scaled.safetensors',
        targetSubdir: 'text_encoders',
      },
      {
        classType: 'DualCLIPLoader',
        inputKey: 'clip_name2',
        filename: 'ltx-2.3_text_projection_bf16.safetensors',
        targetSubdir: 'text_encoders',
      },
      {
        classType: 'LatentUpscaleModelLoader',
        inputKey: 'model_name',
        filename: 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors',
        targetSubdir: 'upscale_models',
      },
      {
        classType: 'MelBandRoFormerModelLoader',
        inputKey: 'model_name',
        filename: 'MelBandRoformer_fp16.safetensors',
        targetSubdir: 'audio_checkpoints',
      },
      // LoRAs — Power Lora Loader holds them in its lora_1..lora_4 slots.
      // The dep checker scans by basename, so sub-folder prefixes in the
      // workflow (e.g. "LTX\\LTX-2\\ID-Lora\\...") don't affect matching.
      {
        classType: 'Power Lora Loader (rgthree)',
        inputKey: 'lora',
        filename: 'LTX-2.3-22b-AV-LoRA-talking-head-v1.safetensors',
        targetSubdir: 'loras',
      },
      {
        classType: 'Power Lora Loader (rgthree)',
        inputKey: 'lora',
        filename: 'Ltx2.3-Licon-VBVR-I2V-96000-R32.safetensors',
        targetSubdir: 'loras',
      },
      {
        classType: 'Power Lora Loader (rgthree)',
        inputKey: 'lora',
        filename: 'LTX-2-Image2Vid-Adapter.safetensors',
        targetSubdir: 'loras',
      },
      {
        classType: 'Power Lora Loader (rgthree)',
        inputKey: 'lora',
        filename: 'ltx-2-19b-lora-camera-control-dolly-out.safetensors',
        targetSubdir: 'loras',
      },
    ]),
    docsUrl: COMFY_REGISTRY_URL,
  }),

  [VOCAL_EXTRACT_WORKFLOW_ID]: Object.freeze({
    id: VOCAL_EXTRACT_WORKFLOW_ID,
    displayName: 'Vocal Extract (Mel-Band RoFormer)',
    requiredNodes: Object.freeze([
      { classType: 'LoadAudio' },
      { classType: 'MelBandRoFormerModelLoader' },
      { classType: 'MelBandRoFormerSampler' },
      { classType: 'SaveAudioMP3' },
    ]),
    requiredModels: Object.freeze([
      {
        classType: 'MelBandRoFormerModelLoader',
        inputKey: 'model_name',
        filename: 'MelBandRoformer_fp16.safetensors',
        targetSubdir: 'audio_checkpoints',
      },
    ]),
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
    fallbackEstimatedCredits: NANO_BANANA_2_FALLBACK_ESTIMATED_CREDITS,
    docsUrl: COMFY_REGISTRY_URL,
  }),

  'grok-text-to-image': Object.freeze({
    id: 'grok-text-to-image',
    displayName: 'Grok Imagine',
    requiredNodes: Object.freeze([
      { classType: 'GrokImageNode' },
      { classType: 'SaveImage' },
    ]),
    requiredModels: Object.freeze([]),
    requiresComfyOrgApiKey: true,
    docsUrl: COMFY_REGISTRY_URL,
  }),

  'seedream-5-lite-image-edit': Object.freeze({
    id: 'seedream-5-lite-image-edit',
    displayName: 'Seedream 5.0 Lite Image Edit',
    requiredNodes: Object.freeze([
      { classType: 'ByteDanceSeedreamNode' },
      { classType: 'BatchImagesNode' },
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

  'caption-qwen-asr': Object.freeze({
    id: 'caption-qwen-asr',
    displayName: 'Caption Transcription (Qwen ASR)',
    requiredNodes: Object.freeze([
      { classType: 'VHS_LoadVideo' },
      { classType: 'VHS_LoadAudioUpload', notes: 'Needed when Music Video sends an audio asset directly to the caption workflow.' },
      { classType: 'Qwen3TTSEngineNode' },
      { classType: 'UnifiedASRTranscribeNode' },
      { classType: 'ASRPunctuationTruecaseNode' },
      { classType: 'SRTAdvancedOptionsNode' },
      { classType: 'TextToSRTBuilderNode' },
      { classType: 'ShowText|pysssss' },
    ]),
    requiredModels: Object.freeze([]),
    docsUrl: 'https://github.com/diodiogod/TTS-Audio-Suite',
  }),

  'mask-gen': Object.freeze({
    id: 'mask-gen',
    displayName: 'Mask Generation',
    requiredNodes: Object.freeze([
      { classType: 'MatAnyoneVideoMatting' },
      { classType: 'MaskToImage' },
      { classType: 'SaveImage' },
      { classType: 'VHS_LoadVideo' },
      { classType: 'SAM3Propagate' },
      { classType: 'LoadSAM3Model' },
      { classType: 'SAM3VideoSegmentation' },
      { classType: 'SAM3VideoOutput' },
      { classType: 'GetImagesFromBatchIndexed' },
      { classType: 'ImageToMask' },
    ]),
    requiredModels: Object.freeze([]),
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
