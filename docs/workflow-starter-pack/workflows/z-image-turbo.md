# Text to Image (Z Image Turbo)

- **Workflow ID:** `z-image-turbo`
- **Category:** `image`
- **Tier:** `lite`
- **Runtime:** `local`
- **App Workflow JSON:** `/workflows/image_z_image_turbo.json`
- **Setup Workflow File (for ComfyUI users):** `workflows/z-image-turbo.comfyui.json` (pending)

## Required Custom Nodes
- `CLIPLoader`
- `KSampler`
- `ModelSamplingAuraFlow`
- `SaveImage`
- `UNETLoader`
- `VAELoader`

## Required Models
| Filename | ComfyUI Folder | Loader | Input Key |
|---|---|---|---|
| `ae.safetensors` | `models/vae` | `VAELoader` | `vae_name` |
| `qwen_3_4b.safetensors` | `models/text_encoders` | `CLIPLoader` | `clip_name` |
| `z_image_turbo_bf16.safetensors` | `models/diffusion_models` | `UNETLoader` | `unet_name` |

## API Key
- Not required.

## Setup Steps
1. Import this workflow in ComfyUI (using setup workflow file when available).
2. Install missing custom nodes in ComfyUI Manager.
3. Download missing models to the expected folders.
4. Return to ComfyStudio Generate and click re-check.

