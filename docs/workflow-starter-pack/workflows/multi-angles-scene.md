# Multiple Angles (Scenes)

- **Workflow ID:** `multi-angles-scene`
- **Category:** `image`
- **Tier:** `standard`
- **Runtime:** `local`
- **App Workflow JSON:** `/workflows/1_click_multiple_scene_angles-v1.0.json`
- **Setup Workflow File (for ComfyUI users):** `workflows/multi-angles-scene.comfyui.json` (pending)

## Required Custom Nodes
- `SaveImage`
- `TextEncodeQwenImageEditPlus`

## Required Models
| Filename | ComfyUI Folder | Loader | Input Key |
|---|---|---|---|
| `qwen_2.5_vl_7b_fp8_scaled.safetensors` | `models/text_encoders` | `CLIPLoader` | `clip_name` |
| `qwen_image_edit_2509_fp8_e4m3fn.safetensors` | `models/diffusion_models` | `UNETLoader` | `unet_name` |
| `qwen_image_vae.safetensors` | `models/vae` | `VAELoader` | `vae_name` |
| `Qwen-Edit-2509-Multiple-angles.safetensors` | `models/loras` | `LoraLoaderModelOnly` | `lora_name` |
| `Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors` | `models/loras` | `LoraLoaderModelOnly` | `lora_name` |

## API Key
- Not required.

## Setup Steps
1. Import this workflow in ComfyUI (using setup workflow file when available).
2. Install missing custom nodes in ComfyUI Manager.
3. Download missing models to the expected folders.
4. Return to ComfyStudio Generate and click re-check.

