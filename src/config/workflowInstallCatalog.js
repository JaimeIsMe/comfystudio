const COMFY_REGISTRY_URL = 'https://registry.comfy.org'
const HUGGING_FACE_BASE_URL = 'https://huggingface.co'

function hfResolve(repo, relativePath) {
  return `${HUGGING_FACE_BASE_URL}/${repo}/resolve/main/${relativePath}`
}

function hfBlob(repo, relativePath) {
  return `${HUGGING_FACE_BASE_URL}/${repo}/blob/main/${relativePath}`
}

function modelKey(targetSubdir = '', filename = '') {
  return `${String(targetSubdir || '').trim().toLowerCase()}::${String(filename || '').trim().toLowerCase()}`
}

function createModelRecipe({
  filename,
  targetSubdir,
  displayName,
  downloadUrl,
  sourceUrl = '',
  licenseUrl = '',
  sizeBytes = null,
  sha256 = '',
  notes = '',
}) {
  return Object.freeze({
    filename,
    targetSubdir,
    displayName,
    downloadUrl,
    sourceUrl,
    licenseUrl,
    sizeBytes: Number.isFinite(sizeBytes) ? Number(sizeBytes) : null,
    sha256: String(sha256 || '').trim().toLowerCase(),
    notes: String(notes || '').trim(),
  })
}

function createAutoNodePack({
  id,
  displayName,
  repoUrl,
  installDirName,
  docsUrl = repoUrl,
  requirementsStrategy = 'requirements-txt',
  notes = '',
  classTypes = [],
}) {
  return Object.freeze({
    id,
    kind: 'auto',
    displayName,
    repoUrl,
    installDirName,
    docsUrl,
    requirementsStrategy,
    notes,
    classTypes: Object.freeze(
      (Array.isArray(classTypes) ? classTypes : [])
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    ),
  })
}

function createCoreNodeHint({
  classType,
  docsUrl = '',
  notes = '',
  displayName = 'ComfyUI core',
  installRecommendation = 'update-comfyui',
  fallbackRepoUrl = '',
}) {
  return Object.freeze({
    classType,
    kind: 'core',
    displayName,
    docsUrl,
    notes,
    installRecommendation,
    fallbackRepoUrl,
  })
}

function createManualNodeHint({
  classType,
  displayName = 'Manual setup required',
  docsUrl = COMFY_REGISTRY_URL,
  notes = '',
  searchTerm = '',
}) {
  return Object.freeze({
    classType,
    kind: 'manual',
    displayName,
    docsUrl,
    notes,
    searchTerm: String(searchTerm || classType || '').trim(),
  })
}

export const CURATED_NODE_PACKS = Object.freeze([
  createAutoNodePack({
    id: 'kjnodes',
    displayName: 'ComfyUI-KJNodes',
    repoUrl: 'https://github.com/kijai/ComfyUI-KJNodes',
    installDirName: 'ComfyUI-KJNodes',
    docsUrl: 'https://github.com/kijai/ComfyUI-KJNodes',
    requirementsStrategy: 'requirements-txt',
    notes: 'Provides ImageResizeKJv2 and GetImagesFromBatchIndexed for bundled helper workflows.',
    classTypes: ['ImageResizeKJv2', 'GetImagesFromBatchIndexed'],
  }),
  createAutoNodePack({
    id: 'videohelpersuite',
    displayName: 'ComfyUI-VideoHelperSuite',
    repoUrl: 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite',
    installDirName: 'ComfyUI-VideoHelperSuite',
    docsUrl: 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite',
    requirementsStrategy: 'requirements-txt',
    notes: 'Used by some advanced/hidden video workflows such as workflow import helpers and caption tooling.',
    classTypes: ['VHS_LoadVideo', 'VHS_LoadVideoPath', 'VHS_LoadAudioUpload'],
  }),
  createAutoNodePack({
    id: 'tts-audio-suite',
    displayName: 'TTS-Audio-Suite',
    repoUrl: 'https://github.com/diodiogod/TTS-Audio-Suite',
    installDirName: 'TTS-Audio-Suite',
    docsUrl: 'https://github.com/diodiogod/TTS-Audio-Suite',
    requirementsStrategy: 'requirements-txt',
    notes: 'Provides Qwen ASR transcription, punctuation/truecase cleanup, and SRT builder nodes used by caption generation and Music Video timed lyrics.',
    classTypes: [
      'UnifiedASRTranscribeNode',
      'Qwen3TTSEngineNode',
      'ASRPunctuationTruecaseNode',
      'TextToSRTBuilderNode',
      'SRTAdvancedOptionsNode',
    ],
  }),
  createAutoNodePack({
    id: 'pysssss-custom-scripts',
    displayName: 'ComfyUI-Custom-Scripts',
    repoUrl: 'https://github.com/pythongosssss/ComfyUI-Custom-Scripts',
    installDirName: 'ComfyUI-Custom-Scripts',
    docsUrl: 'https://github.com/pythongosssss/ComfyUI-Custom-Scripts',
    requirementsStrategy: 'requirements-txt',
    notes: 'Provides Show Text, which the caption workflow uses to expose the generated SRT text back to ComfyStudio.',
    classTypes: ['ShowText|pysssss'],
  }),
  createAutoNodePack({
    id: 'matanyone-kytra',
    displayName: 'ComfyUI_MatAnyone_Kytra',
    repoUrl: 'https://github.com/KytraScript/ComfyUI_MatAnyone_Kytra',
    installDirName: 'ComfyUI_MatAnyone_Kytra',
    docsUrl: 'https://github.com/KytraScript/ComfyUI_MatAnyone_Kytra',
    requirementsStrategy: 'requirements-txt',
    notes: 'Provides MatAnyoneVideoMatting for the bundled mask-generation workflow.',
    classTypes: ['MatAnyoneVideoMatting'],
  }),
])

const AUTO_NODE_PACK_BY_CLASS_TYPE = Object.freeze(
  CURATED_NODE_PACKS.reduce((acc, pack) => {
    for (const classType of pack.classTypes) {
      acc[classType] = pack
    }
    return acc
  }, {})
)

export const CORE_NODE_HINTS = Object.freeze({
  BatchImagesNode: createCoreNodeHint({
    classType: 'BatchImagesNode',
    docsUrl: `${COMFY_REGISTRY_URL}`,
    notes: 'This ships with modern ComfyUI builds. If it is missing, update ComfyUI first.',
  }),
  CheckpointLoaderSimple: createCoreNodeHint({
    classType: 'CheckpointLoaderSimple',
    docsUrl: `${COMFY_REGISTRY_URL}`,
    notes: 'Core checkpoint loader. Missing this usually means the ComfyUI install is incomplete or very outdated.',
  }),
  CLIPLoader: createCoreNodeHint({
    classType: 'CLIPLoader',
    docsUrl: `${COMFY_REGISTRY_URL}`,
    notes: 'Core text-encoder loader. Missing this usually means the ComfyUI install is incomplete or very outdated.',
  }),
  CreateVideo: createCoreNodeHint({
    classType: 'CreateVideo',
    docsUrl: 'https://docs.comfy.org/built-in-nodes/CreateVideo',
    notes: 'CreateVideo is part of newer ComfyUI builds.',
  }),
  'EmptyAceStep1.5LatentAudio': createCoreNodeHint({
    classType: 'EmptyAceStep1.5LatentAudio',
    docsUrl: 'https://docs.comfy.org/tutorials/audio/ace-step/ace-step-v1',
    notes: 'Ace-Step nodes are bundled into newer ComfyUI builds. Update ComfyUI if this is missing.',
  }),
  EmptyLTXVLatentVideo: createCoreNodeHint({
    classType: 'EmptyLTXVLatentVideo',
    docsUrl: 'https://docs.comfy.org/built-in-nodes/EmptyLTXVLatentVideo',
    notes: 'LTX 2.3 workflow support is built into newer ComfyUI builds.',
  }),
  FluxKontextImageScale: createCoreNodeHint({
    classType: 'FluxKontextImageScale',
    docsUrl: `${COMFY_REGISTRY_URL}`,
    notes: 'Qwen/Flux edit support ships with current ComfyUI releases.',
  }),
  ImageToMask: createCoreNodeHint({
    classType: 'ImageToMask',
    docsUrl: `${COMFY_REGISTRY_URL}`,
    notes: 'Core mask conversion node. Missing this usually means the ComfyUI install is incomplete or very outdated.',
  }),
  KSampler: createCoreNodeHint({
    classType: 'KSampler',
    docsUrl: `${COMFY_REGISTRY_URL}`,
    notes: 'Core sampler node. Missing this usually means the ComfyUI install is incomplete or very outdated.',
  }),
  LatentUpscaleModelLoader: createCoreNodeHint({
    classType: 'LatentUpscaleModelLoader',
    docsUrl: 'https://docs.comfy.org/built-in-nodes/LatentUpscaleModelLoader',
    notes: 'This loader is built into ComfyUI. Missing it usually means the install is outdated.',
  }),
  LoraLoaderModelOnly: createCoreNodeHint({
    classType: 'LoraLoaderModelOnly',
    docsUrl: `${COMFY_REGISTRY_URL}`,
    notes: 'Core LoRA loader. Missing this usually means the ComfyUI install is incomplete or very outdated.',
  }),
  MaskToImage: createCoreNodeHint({
    classType: 'MaskToImage',
    docsUrl: `${COMFY_REGISTRY_URL}`,
    notes: 'Core mask conversion node. Missing this usually means the ComfyUI install is incomplete or very outdated.',
  }),
  LTXAVTextEncoderLoader: createCoreNodeHint({
    classType: 'LTXAVTextEncoderLoader',
    docsUrl: 'https://docs.comfy.org/tutorials/video/ltx/ltx-2-3',
    notes: 'Update ComfyUI to a build with LTX 2.3 support. If that still does not expose the node, install or update ComfyUI-LTXVideo manually.',
    fallbackRepoUrl: 'https://github.com/Lightricks/ComfyUI-LTXVideo',
  }),
  LTXVAudioVAEDecode: createCoreNodeHint({
    classType: 'LTXVAudioVAEDecode',
    docsUrl: 'https://docs.comfy.org/tutorials/video/ltx/ltx-2-3',
    notes: 'Update ComfyUI to a build with LTX 2.3 support. If that still does not expose the node, install or update ComfyUI-LTXVideo manually.',
    fallbackRepoUrl: 'https://github.com/Lightricks/ComfyUI-LTXVideo',
  }),
  LTXVAudioVAELoader: createCoreNodeHint({
    classType: 'LTXVAudioVAELoader',
    docsUrl: 'https://docs.comfy.org/built-in-nodes/LTXVAudioVAELoader',
    notes: 'Update ComfyUI to a build with LTX 2.3 support. If that still does not expose the node, install or update ComfyUI-LTXVideo manually.',
    fallbackRepoUrl: 'https://github.com/Lightricks/ComfyUI-LTXVideo',
  }),
  LTXVConcatAVLatent: createCoreNodeHint({
    classType: 'LTXVConcatAVLatent',
    docsUrl: 'https://docs.comfy.org/tutorials/video/ltx/ltx-2-3',
    notes: 'LTX workflow nodes are bundled into newer ComfyUI builds.',
    fallbackRepoUrl: 'https://github.com/Lightricks/ComfyUI-LTXVideo',
  }),
  LTXVConditioning: createCoreNodeHint({
    classType: 'LTXVConditioning',
    docsUrl: 'https://docs.comfy.org/tutorials/video/ltx/ltx-2-3',
    notes: 'LTX workflow nodes are bundled into newer ComfyUI builds.',
    fallbackRepoUrl: 'https://github.com/Lightricks/ComfyUI-LTXVideo',
  }),
  LTXVCropGuides: createCoreNodeHint({
    classType: 'LTXVCropGuides',
    docsUrl: 'https://docs.comfy.org/tutorials/video/ltx/ltx-2-3',
    notes: 'LTX workflow nodes are bundled into newer ComfyUI builds.',
    fallbackRepoUrl: 'https://github.com/Lightricks/ComfyUI-LTXVideo',
  }),
  LTXVEmptyLatentAudio: createCoreNodeHint({
    classType: 'LTXVEmptyLatentAudio',
    docsUrl: 'https://docs.comfy.org/tutorials/video/ltx/ltx-2-3',
    notes: 'LTX workflow nodes are bundled into newer ComfyUI builds.',
    fallbackRepoUrl: 'https://github.com/Lightricks/ComfyUI-LTXVideo',
  }),
  LTXVImgToVideoInplace: createCoreNodeHint({
    classType: 'LTXVImgToVideoInplace',
    docsUrl: 'https://docs.comfy.org/tutorials/video/ltx/ltx-2-3',
    notes: 'LTX workflow nodes are bundled into newer ComfyUI builds.',
    fallbackRepoUrl: 'https://github.com/Lightricks/ComfyUI-LTXVideo',
  }),
  LTXVLatentUpsampler: createCoreNodeHint({
    classType: 'LTXVLatentUpsampler',
    docsUrl: 'https://docs.comfy.org/tutorials/video/ltx/ltx-2-3',
    notes: 'LTX workflow nodes are bundled into newer ComfyUI builds.',
    fallbackRepoUrl: 'https://github.com/Lightricks/ComfyUI-LTXVideo',
  }),
  LTXVPreprocess: createCoreNodeHint({
    classType: 'LTXVPreprocess',
    docsUrl: 'https://docs.comfy.org/tutorials/video/ltx/ltx-2-3',
    notes: 'LTX workflow nodes are bundled into newer ComfyUI builds.',
    fallbackRepoUrl: 'https://github.com/Lightricks/ComfyUI-LTXVideo',
  }),
  LTXVSeparateAVLatent: createCoreNodeHint({
    classType: 'LTXVSeparateAVLatent',
    docsUrl: 'https://docs.comfy.org/tutorials/video/ltx/ltx-2-3',
    notes: 'LTX workflow nodes are bundled into newer ComfyUI builds.',
    fallbackRepoUrl: 'https://github.com/Lightricks/ComfyUI-LTXVideo',
  }),
  ModelSamplingAuraFlow: createCoreNodeHint({
    classType: 'ModelSamplingAuraFlow',
    docsUrl: 'https://docs.comfy.org/built-in-nodes/ModelSamplingAuraFlow',
    notes: 'This sampler ships with newer ComfyUI builds.',
  }),
  ResizeImageMaskNode: createCoreNodeHint({
    classType: 'ResizeImageMaskNode',
    docsUrl: `${COMFY_REGISTRY_URL}`,
    notes: 'Part of current ComfyUI core image utilities.',
  }),
  ResizeImagesByLongerEdge: createCoreNodeHint({
    classType: 'ResizeImagesByLongerEdge',
    docsUrl: 'https://docs.comfy.org/built-in-nodes/ResizeImagesByLongerEdge',
    notes: 'Part of current ComfyUI core image utilities.',
  }),
  SaveAudioMP3: createCoreNodeHint({
    classType: 'SaveAudioMP3',
    docsUrl: 'https://docs.comfy.org/tutorials/audio/ace-step/ace-step-v1',
    notes: 'Ace-Step audio save nodes are included in newer ComfyUI builds.',
  }),
  SaveImage: createCoreNodeHint({
    classType: 'SaveImage',
    docsUrl: `${COMFY_REGISTRY_URL}`,
    notes: 'Core image output node. Missing this usually means the ComfyUI install is incomplete or very outdated.',
  }),
  SaveVideo: createCoreNodeHint({
    classType: 'SaveVideo',
    docsUrl: 'https://docs.comfy.org/built-in-nodes/CreateVideo',
    notes: 'Core video output support ships with newer ComfyUI builds.',
  }),
  'TextEncodeAceStepAudio1.5': createCoreNodeHint({
    classType: 'TextEncodeAceStepAudio1.5',
    docsUrl: 'https://docs.comfy.org/tutorials/audio/ace-step/ace-step-v1',
    notes: 'Update ComfyUI to a build with Ace-Step 1.5 support if this node is missing.',
  }),
  TextEncodeQwenImageEditPlus: createCoreNodeHint({
    classType: 'TextEncodeQwenImageEditPlus',
    docsUrl: 'https://docs.comfy.org/built-in-nodes/TextEncodeQwenImageEditPlus',
    notes: 'Native Qwen image edit support ships with newer ComfyUI builds.',
  }),
  UNETLoader: createCoreNodeHint({
    classType: 'UNETLoader',
    docsUrl: `${COMFY_REGISTRY_URL}`,
    notes: 'Core diffusion model loader. Missing this usually means the ComfyUI install is incomplete or very outdated.',
  }),
  VAEDecodeAudio: createCoreNodeHint({
    classType: 'VAEDecodeAudio',
    docsUrl: 'https://docs.comfy.org/tutorials/audio/ace-step/ace-step-v1',
    notes: 'Ace-Step audio decode support ships with newer ComfyUI builds.',
  }),
  VAEDecodeTiled: createCoreNodeHint({
    classType: 'VAEDecodeTiled',
    docsUrl: 'https://docs.comfy.org/built-in-nodes/VAEDecodeTiled',
    notes: 'Tiled VAE decode is part of current ComfyUI core.',
  }),
  VAELoader: createCoreNodeHint({
    classType: 'VAELoader',
    docsUrl: `${COMFY_REGISTRY_URL}`,
    notes: 'Core VAE loader. Missing this usually means the ComfyUI install is incomplete or very outdated.',
  }),
  WanImageToVideo: createCoreNodeHint({
    classType: 'WanImageToVideo',
    docsUrl: 'https://docs.comfy.org/tutorials/video/wan/wan2_2',
    notes: 'Update ComfyUI first. If WanImageToVideo is still missing afterwards, install a maintained Wan wrapper such as ComfyUI-WanVideoWrapper manually.',
    fallbackRepoUrl: 'https://github.com/kijai/ComfyUI-WanVideoWrapper',
  }),
})

export const MANUAL_NODE_HINTS = Object.freeze({
  ByteDanceSeedreamNode: createManualNodeHint({
    classType: 'ByteDanceSeedreamNode',
    displayName: 'Partner node via Comfy Registry',
    notes: 'This cloud partner node is not mapped to a stable unattended install recipe yet. Use the registry or ComfyUI Manager.',
  }),
  GeminiNanoBanana2: createManualNodeHint({
    classType: 'GeminiNanoBanana2',
    displayName: 'Partner node via Comfy Registry',
    notes: 'This cloud partner node is not mapped to a stable unattended install recipe yet. Use the registry or ComfyUI Manager.',
  }),
  GrokImageNode: createManualNodeHint({
    classType: 'GrokImageNode',
    displayName: 'Partner node via Comfy Registry',
    notes: 'This cloud partner node is not mapped to a stable unattended install recipe yet. Use the registry or ComfyUI Manager.',
  }),
  GrokVideoNode: createManualNodeHint({
    classType: 'GrokVideoNode',
    displayName: 'Partner node via Comfy Registry',
    notes: 'This cloud partner node is not mapped to a stable unattended install recipe yet. Use the registry or ComfyUI Manager.',
  }),
  KlingOmniProImageToVideoNode: createManualNodeHint({
    classType: 'KlingOmniProImageToVideoNode',
    displayName: 'Partner node via Comfy Registry',
    notes: 'This cloud partner node is not mapped to a stable unattended install recipe yet. Use the registry or ComfyUI Manager.',
  }),
  LoadSAM3Model: createManualNodeHint({
    classType: 'LoadSAM3Model',
    displayName: 'ComfyUI-SAM3',
    docsUrl: 'https://github.com/PozzettiAndrea/ComfyUI-SAM3',
    notes: 'Install via ComfyUI Manager or clone ComfyUI-SAM3 and run `python install.py`. This pack uses a comfy-env installer instead of a plain requirements.txt flow.',
    searchTerm: 'ComfyUI-SAM3',
  }),
  SAM3Propagate: createManualNodeHint({
    classType: 'SAM3Propagate',
    displayName: 'ComfyUI-SAM3',
    docsUrl: 'https://github.com/PozzettiAndrea/ComfyUI-SAM3',
    notes: 'Install via ComfyUI Manager or clone ComfyUI-SAM3 and run `python install.py`. This pack uses a comfy-env installer instead of a plain requirements.txt flow.',
    searchTerm: 'ComfyUI-SAM3',
  }),
  SAM3VideoOutput: createManualNodeHint({
    classType: 'SAM3VideoOutput',
    displayName: 'ComfyUI-SAM3',
    docsUrl: 'https://github.com/PozzettiAndrea/ComfyUI-SAM3',
    notes: 'Install via ComfyUI Manager or clone ComfyUI-SAM3 and run `python install.py`. This pack uses a comfy-env installer instead of a plain requirements.txt flow.',
    searchTerm: 'ComfyUI-SAM3',
  }),
  SAM3VideoSegmentation: createManualNodeHint({
    classType: 'SAM3VideoSegmentation',
    displayName: 'ComfyUI-SAM3',
    docsUrl: 'https://github.com/PozzettiAndrea/ComfyUI-SAM3',
    notes: 'Install via ComfyUI Manager or clone ComfyUI-SAM3 and run `python install.py`. This pack uses a comfy-env installer instead of a plain requirements.txt flow.',
    searchTerm: 'ComfyUI-SAM3',
  }),
  Vidu2ImageToVideoNode: createManualNodeHint({
    classType: 'Vidu2ImageToVideoNode',
    displayName: 'Partner node via Comfy Registry',
    notes: 'This cloud partner node is not mapped to a stable unattended install recipe yet. Use the registry or ComfyUI Manager.',
  }),
})

export const MODEL_INSTALL_RECIPES = Object.freeze({
  [modelKey('vae', 'ace_1.5_vae.safetensors')]: createModelRecipe({
    filename: 'ace_1.5_vae.safetensors',
    targetSubdir: 'vae',
    displayName: 'ACE-Step 1.5 VAE',
    downloadUrl: hfResolve('Comfy-Org/ace_step_1.5_ComfyUI_files', 'split_files/vae/ace_1.5_vae.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/ace_step_1.5_ComfyUI_files', 'split_files/vae/ace_1.5_vae.safetensors'),
    licenseUrl: 'https://huggingface.co/ACE-Step/Ace-Step1.5',
    notes: 'Required by the built-in music generation workflow.',
  }),
  [modelKey('diffusion_models', 'acestep_v1.5_turbo.safetensors')]: createModelRecipe({
    filename: 'acestep_v1.5_turbo.safetensors',
    targetSubdir: 'diffusion_models',
    displayName: 'ACE-Step 1.5 Turbo diffusion model',
    downloadUrl: hfResolve('Comfy-Org/ace_step_1.5_ComfyUI_files', 'split_files/diffusion_models/acestep_v1.5_turbo.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/ace_step_1.5_ComfyUI_files', 'split_files/diffusion_models/acestep_v1.5_turbo.safetensors'),
    licenseUrl: 'https://huggingface.co/ACE-Step/Ace-Step1.5',
    sizeBytes: 4790000000,
    notes: 'Required by the built-in music generation workflow.',
  }),
  [modelKey('vae', 'ae.safetensors')]: createModelRecipe({
    filename: 'ae.safetensors',
    targetSubdir: 'vae',
    displayName: 'Z Image Turbo VAE',
    downloadUrl: hfResolve('Comfy-Org/z_image_turbo', 'split_files/vae/ae.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/z_image_turbo', 'split_files/vae/ae.safetensors'),
    licenseUrl: 'https://huggingface.co/Tongyi-MAI/Z-Image-Turbo',
    sizeBytes: 335304388,
    sha256: 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38',
    notes: 'Flux-compatible VAE used by Z Image Turbo.',
  }),
  [modelKey('text_encoders', 'gemma_3_12B_it_fp4_mixed.safetensors')]: createModelRecipe({
    filename: 'gemma_3_12B_it_fp4_mixed.safetensors',
    targetSubdir: 'text_encoders',
    displayName: 'Gemma 3 12B FP4 mixed text encoder',
    downloadUrl: hfResolve('Comfy-Org/ltx-2', 'split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/ltx-2', 'split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors'),
    licenseUrl: 'https://huggingface.co/google/gemma-3-12b-it-qat-q4_0-unquantized',
    notes: 'Used by the LTX 2.3 workflow text encoder loader.',
  }),
  [modelKey('checkpoints', 'ltx-2.3-22b-dev-fp8.safetensors')]: createModelRecipe({
    filename: 'ltx-2.3-22b-dev-fp8.safetensors',
    targetSubdir: 'checkpoints',
    displayName: 'LTX 2.3 22B FP8 checkpoint',
    downloadUrl: hfResolve('Lightricks/LTX-2.3-fp8', 'ltx-2.3-22b-dev-fp8.safetensors'),
    sourceUrl: hfBlob('Lightricks/LTX-2.3-fp8', 'ltx-2.3-22b-dev-fp8.safetensors'),
    licenseUrl: 'https://huggingface.co/Lightricks/LTX-2.3-fp8',
    notes: 'Main checkpoint used by the bundled LTX 2.3 workflow.',
  }),
  [modelKey('loras', 'ltx-2.3-22b-distilled-lora-384.safetensors')]: createModelRecipe({
    filename: 'ltx-2.3-22b-distilled-lora-384.safetensors',
    targetSubdir: 'loras',
    displayName: 'LTX 2.3 distilled LoRA',
    downloadUrl: hfResolve('Lightricks/LTX-2.3', 'ltx-2.3-22b-distilled-lora-384-1.1.safetensors'),
    sourceUrl: hfBlob('Lightricks/LTX-2.3', 'ltx-2.3-22b-distilled-lora-384-1.1.safetensors'),
    licenseUrl: 'https://huggingface.co/Lightricks/LTX-2.3',
    notes: 'Downloaded from the official Lightricks repo and saved under the workflow-expected filename.',
  }),
  [modelKey('upscale_models', 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors')]: createModelRecipe({
    filename: 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors',
    targetSubdir: 'upscale_models',
    displayName: 'LTX 2.3 spatial upscaler x2',
    downloadUrl: hfResolve('Lightricks/LTX-2.3', 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors'),
    sourceUrl: hfBlob('Lightricks/LTX-2.3', 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors'),
    licenseUrl: 'https://huggingface.co/Lightricks/LTX-2.3',
    notes: 'Required for the bundled LTX 2.3 upscaling step.',
  }),
  [modelKey('text_encoders', 'qwen_2.5_vl_7b_fp8_scaled.safetensors')]: createModelRecipe({
    filename: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
    targetSubdir: 'text_encoders',
    displayName: 'Qwen 2.5 VL 7B FP8 text encoder',
    downloadUrl: hfResolve('Comfy-Org/Qwen-Image_ComfyUI', 'split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/Qwen-Image_ComfyUI', 'split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors'),
    licenseUrl: 'https://huggingface.co/Qwen/Qwen-Image',
    sizeBytes: 9380000000,
    notes: 'Shared by Qwen image edit and multiple-angle workflows.',
  }),
  [modelKey('text_encoders', 'qwen_3_4b.safetensors')]: createModelRecipe({
    filename: 'qwen_3_4b.safetensors',
    targetSubdir: 'text_encoders',
    displayName: 'Qwen 3 4B text encoder',
    downloadUrl: hfResolve('Comfy-Org/z_image_turbo', 'split_files/text_encoders/qwen_3_4b.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/z_image_turbo', 'split_files/text_encoders/qwen_3_4b.safetensors'),
    licenseUrl: 'https://huggingface.co/Tongyi-MAI/Z-Image-Turbo',
    sizeBytes: 8040000000,
    notes: 'Text encoder used by Z Image Turbo.',
  }),
  [modelKey('diffusion_models', 'qwen_image_edit_2509_fp8_e4m3fn.safetensors')]: createModelRecipe({
    filename: 'qwen_image_edit_2509_fp8_e4m3fn.safetensors',
    targetSubdir: 'diffusion_models',
    displayName: 'Qwen Image Edit 2509 FP8 diffusion model',
    downloadUrl: hfResolve('Comfy-Org/Qwen-Image-Edit_ComfyUI', 'split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/Qwen-Image-Edit_ComfyUI', 'split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors'),
    licenseUrl: 'https://huggingface.co/Qwen/Qwen-Image-Edit-2509',
    sizeBytes: 20400000000,
    notes: 'Shared by Qwen image edit and multiple-angle workflows.',
  }),
  [modelKey('vae', 'qwen_image_vae.safetensors')]: createModelRecipe({
    filename: 'qwen_image_vae.safetensors',
    targetSubdir: 'vae',
    displayName: 'Qwen image VAE',
    downloadUrl: hfResolve('Comfy-Org/Qwen-Image_ComfyUI', 'split_files/vae/qwen_image_vae.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/Qwen-Image_ComfyUI', 'split_files/vae/qwen_image_vae.safetensors'),
    licenseUrl: 'https://huggingface.co/Qwen/Qwen-Image',
    notes: 'Shared by Qwen image edit and multiple-angle workflows.',
  }),
  [modelKey('loras', 'Qwen-Edit-2509-Multiple-angles.safetensors')]: createModelRecipe({
    filename: 'Qwen-Edit-2509-Multiple-angles.safetensors',
    targetSubdir: 'loras',
    displayName: 'Qwen multiple-angles LoRA',
    downloadUrl: hfResolve('Comfy-Org/Qwen-Image-Edit_ComfyUI', 'split_files/loras/Qwen-Edit-2509-Multiple-angles.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/Qwen-Image-Edit_ComfyUI', 'split_files/loras/Qwen-Edit-2509-Multiple-angles.safetensors'),
    licenseUrl: 'https://huggingface.co/dx8152/Qwen-Edit-2509-Multiple-angles',
    notes: 'Enables the bundled multi-angle helper workflows.',
  }),
  [modelKey('loras', 'Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors')]: createModelRecipe({
    filename: 'Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors',
    targetSubdir: 'loras',
    displayName: 'Qwen Image Edit lightning 4-step LoRA',
    downloadUrl: hfResolve('lightx2v/Qwen-Image-Lightning', 'Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors'),
    sourceUrl: hfBlob('lightx2v/Qwen-Image-Lightning', 'Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors'),
    licenseUrl: 'https://huggingface.co/lightx2v/Qwen-Image-Lightning',
    notes: 'Optional speed LoRA used by the bundled Qwen image edit workflow.',
  }),
  [modelKey('text_encoders', 'umt5_xxl_fp8_e4m3fn_scaled.safetensors')]: createModelRecipe({
    filename: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    targetSubdir: 'text_encoders',
    displayName: 'WAN UMT5 XXL FP8 text encoder',
    downloadUrl: hfResolve('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors'),
    licenseUrl: 'https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B',
    notes: 'Text encoder for the bundled WAN 2.2 workflow.',
  }),
  [modelKey('diffusion_models', 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors')]: createModelRecipe({
    filename: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
    targetSubdir: 'diffusion_models',
    displayName: 'WAN 2.2 high-noise expert diffusion model',
    downloadUrl: hfResolve('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors'),
    licenseUrl: 'https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B',
    notes: 'One of the two MoE expert models required for WAN 2.2 image-to-video.',
  }),
  [modelKey('loras', 'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors')]: createModelRecipe({
    filename: 'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
    targetSubdir: 'loras',
    displayName: 'WAN 2.2 4-step high-noise LoRA',
    downloadUrl: hfResolve('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors'),
    licenseUrl: 'https://huggingface.co/lightx2v/Wan2.2-Lightning',
    sizeBytes: 1230000000,
    sha256: 'd176c808d6fc461999b68e321efcb7501b20b8c3797523ed0df14f7d1deff11e',
    notes: 'ComfyUI-repackaged filename that matches the bundled WAN workflow.',
  }),
  [modelKey('loras', 'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors')]: createModelRecipe({
    filename: 'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
    targetSubdir: 'loras',
    displayName: 'WAN 2.2 4-step low-noise LoRA',
    downloadUrl: hfResolve('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors'),
    licenseUrl: 'https://huggingface.co/lightx2v/Wan2.2-Lightning',
    sizeBytes: 1230000000,
    sha256: '024f21de095bc8fad9809ded3e9e49a2e170dcf27075da8145ba7d60d8aab7f9',
    notes: 'ComfyUI-repackaged filename that matches the bundled WAN workflow.',
  }),
  [modelKey('diffusion_models', 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors')]: createModelRecipe({
    filename: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
    targetSubdir: 'diffusion_models',
    displayName: 'WAN 2.2 low-noise expert diffusion model',
    downloadUrl: hfResolve('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors'),
    licenseUrl: 'https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B',
    notes: 'One of the two MoE expert models required for WAN 2.2 image-to-video.',
  }),
  [modelKey('vae', 'wan_2.1_vae.safetensors')]: createModelRecipe({
    filename: 'wan_2.1_vae.safetensors',
    targetSubdir: 'vae',
    displayName: 'WAN 2.1 VAE',
    downloadUrl: hfResolve('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/vae/wan_2.1_vae.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/vae/wan_2.1_vae.safetensors'),
    licenseUrl: 'https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B',
    notes: 'Shared VAE for the bundled WAN 2.2 workflow.',
  }),
  [modelKey('diffusion_models', 'z_image_turbo_bf16.safetensors')]: createModelRecipe({
    filename: 'z_image_turbo_bf16.safetensors',
    targetSubdir: 'diffusion_models',
    displayName: 'Z Image Turbo BF16 diffusion model',
    downloadUrl: hfResolve('Comfy-Org/z_image_turbo', 'split_files/diffusion_models/z_image_turbo_bf16.safetensors'),
    sourceUrl: hfBlob('Comfy-Org/z_image_turbo', 'split_files/diffusion_models/z_image_turbo_bf16.safetensors'),
    licenseUrl: 'https://huggingface.co/Tongyi-MAI/Z-Image-Turbo',
    notes: 'Primary local text-to-image model used by the bundled Z Image Turbo workflow.',
  }),
})

export function getNodeInstallInfo(classType = '') {
  const normalized = String(classType || '').trim()
  if (!normalized) {
    return Object.freeze({
      classType: '',
      kind: 'unknown',
      displayName: 'Unknown dependency',
      docsUrl: COMFY_REGISTRY_URL,
      notes: 'No class type was provided for this node dependency.',
    })
  }

  const autoPack = AUTO_NODE_PACK_BY_CLASS_TYPE[normalized]
  if (autoPack) {
    return Object.freeze({
      classType: normalized,
      ...autoPack,
    })
  }

  if (CORE_NODE_HINTS[normalized]) {
    return CORE_NODE_HINTS[normalized]
  }

  if (MANUAL_NODE_HINTS[normalized]) {
    return MANUAL_NODE_HINTS[normalized]
  }

  return Object.freeze({
    classType: normalized,
    kind: 'manual',
    displayName: 'Manual setup required',
    docsUrl: COMFY_REGISTRY_URL,
    searchTerm: normalized,
    notes: 'No curated install recipe is available yet for this node class.',
  })
}

export function getModelInstallInfo({ filename = '', targetSubdir = '' } = {}) {
  const key = modelKey(targetSubdir, filename)
  const recipe = MODEL_INSTALL_RECIPES[key]
  if (recipe) return recipe

  return Object.freeze({
    filename: String(filename || '').trim(),
    targetSubdir: String(targetSubdir || '').trim(),
    displayName: String(filename || '').trim() || 'Unknown model',
    downloadUrl: '',
    sourceUrl: '',
    licenseUrl: '',
    sizeBytes: null,
    sha256: '',
    notes: 'No curated download recipe is available yet for this model.',
  })
}

export function isNodeAutoInstallable(classType = '') {
  return getNodeInstallInfo(classType).kind === 'auto'
}

export function isModelAutoInstallable(model = {}) {
  return Boolean(getModelInstallInfo(model).downloadUrl)
}
