# Image to Video (LTX 2.3)

Animate an image with local LTX 2.3

- **Workflow ID:** `ltx23-i2v`
- **Category:** `video`
- **Tier:** `pro`
- **Runtime:** `local`
- **App Workflow JSON:** `/workflows/video_ltx2_3_i2v.json`
- **Starter Pack Setup Workflow:** `workflows/local/ltx23-i2v.comfyui.json`
- **Setup Workflow Status:** `available`

## What This Setup Workflow Is
- A ComfyUI-importable copy of the workflow graph bundled with ComfyStudio.
- Use it to inspect missing nodes, model loaders, and expected filenames directly inside ComfyUI.
- This is a local workflow: expect to install the listed custom nodes and local model files before it runs successfully.

## Required Custom Nodes
- `CheckpointLoaderSimple`
- `CreateVideo`
- `EmptyLTXVLatentVideo`
- `LatentUpscaleModelLoader`
- `LoraLoaderModelOnly`
- `LTXAVTextEncoderLoader`
- `LTXVAudioVAEDecode`
- `LTXVAudioVAELoader`
- `LTXVConcatAVLatent`
- `LTXVConditioning`
- `LTXVCropGuides`
- `LTXVEmptyLatentAudio`
- `LTXVImgToVideoInplace`
- `LTXVLatentUpsampler`
- `LTXVPreprocess`
- `LTXVSeparateAVLatent`
- `ResizeImageMaskNode`
- `ResizeImagesByLongerEdge`
- `SaveVideo`
- `VAEDecodeTiled`

## Required Models
| Filename | ComfyUI Folder | Loader | Input Key |
|---|---|---|---|
| `gemma_3_12B_it_fp4_mixed.safetensors` | `models/text_encoders` | `LTXAVTextEncoderLoader` | `text_encoder` |
| `ltx-2.3-22b-dev-fp8.safetensors` | `models/checkpoints` | `CheckpointLoaderSimple` | `ckpt_name` |
| `ltx-2.3-22b-dev-fp8.safetensors` | `models/checkpoints` | `LTXVAudioVAELoader` | `ckpt_name` |
| `ltx-2.3-22b-dev-fp8.safetensors` | `models/checkpoints` | `LTXAVTextEncoderLoader` | `ckpt_name` |
| `ltx-2.3-22b-distilled-lora-384.safetensors` | `models/loras` | `LoraLoaderModelOnly` | `lora_name` |
| `ltx-2.3-spatial-upscaler-x2-1.1.safetensors` | `models/upscale_models` | `LatentUpscaleModelLoader` | `model_name` |

## API Key
- Not required for this workflow.

## Setup Steps
1. Import `workflows/local/ltx23-i2v.comfyui.json` into ComfyUI.
2. Let ComfyUI show any missing custom nodes, then install them in ComfyUI Manager.
3. Place the required model files into the folders listed above.
4. Re-open the workflow in ComfyUI and confirm all loaders resolve.
5. Return to ComfyStudio Generate and click `Re-check` before queueing.

## Related Guides
- `../WHERE_FILES_GO.md`
- `../API_KEYS.md`
- `../TROUBLESHOOTING.md`

