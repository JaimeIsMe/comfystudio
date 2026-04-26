# ComfyStudio v0.1.13 Release Notes

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs

## Highlights

- Fixes Settings > File Paths so Output Directory and Workflows Directory can be selected with the native folder picker and persist after reopening Settings
- Fixes LTX 2.3 spatial upscaler setup so the model is checked and installed under `latent_upscale_models`, matching ComfyUI's `LatentUpscaleModelLoader`
- Fixes Music Video Director Mode shot timing so explicit `Length:` values above 5 seconds are preserved up to the music-video limit

## Fixes

- Wired the File Paths browse buttons to Electron's native directory picker
- Saved and restored Output Directory and Workflows Directory through app settings
- Updated LTX 2.3 Image-to-Video and Music Video Shot dependency metadata for the spatial upscaler
- Kept ad-style Director Mode duration defaults short while allowing music-video plans to use longer shot durations

## Known Notes

- ComfyStudio still depends on a separate local ComfyUI installation
- Built-in workflow setup checks still assume standard model filenames unless users run custom workflows directly in the ComfyUI tab
- Extra ComfyUI model paths are tracked as a future workflow setup compatibility improvement
