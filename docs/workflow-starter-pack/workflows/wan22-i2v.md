# Image to Video (WAN 2.2)

- **Workflow ID:** `wan22-i2v`
- **Category:** `video`
- **Tier:** `pro`
- **Runtime:** `local`
- **App Workflow JSON:** `/workflows/video_wan2_2_14B_i2v.json`
- **Setup Workflow File (for ComfyUI users):** `workflows/wan22-i2v.comfyui.json` (pending)

## Required Custom Nodes
- `CLIPLoader`
- `LoraLoaderModelOnly`
- `SaveVideo`
- `UNETLoader`
- `VAELoader`
- `WanImageToVideo`

## Required Models
| Filename | ComfyUI Folder | Loader | Input Key |
|---|---|---|---|
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `models/text_encoders` | `CLIPLoader` | `clip_name` |
| `wan_2.1_vae.safetensors` | `models/vae` | `VAELoader` | `vae_name` |
| `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` | `models/diffusion_models` | `UNETLoader` | `unet_name` |
| `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors` | `models/loras` | `LoraLoaderModelOnly` | `lora_name` |
| `wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors` | `models/loras` | `LoraLoaderModelOnly` | `lora_name` |
| `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors` | `models/diffusion_models` | `UNETLoader` | `unet_name` |

## API Key
- Not required.

## Setup Steps
1. Import this workflow in ComfyUI (using setup workflow file when available).
2. Install missing custom nodes in ComfyUI Manager.
3. Download missing models to the expected folders.
4. Return to ComfyStudio Generate and click re-check.

