# Music Generation

- **Workflow ID:** `music-gen`
- **Category:** `audio`
- **Tier:** `lite`
- **Runtime:** `local`
- **App Workflow JSON:** `/workflows/music_generation.json`
- **Setup Workflow File (for ComfyUI users):** `workflows/music-gen.comfyui.json` (pending)

## Required Custom Nodes
- `SaveAudioMP3`
- `TextEncodeAceStepAudio1.5`
- `VAEDecodeAudio`

## Required Models
| Filename | ComfyUI Folder | Loader | Input Key |
|---|---|---|---|
| `ace_1.5_vae.safetensors` | `models/vae` | `VAELoader` | `vae_name` |
| `acestep_v1.5_turbo.safetensors` | `models/diffusion_models` | `UNETLoader` | `unet_name` |

## API Key
- Not required.

## Setup Steps
1. Import this workflow in ComfyUI (using setup workflow file when available).
2. Install missing custom nodes in ComfyUI Manager.
3. Download missing models to the expected folders.
4. Return to ComfyStudio Generate and click re-check.

