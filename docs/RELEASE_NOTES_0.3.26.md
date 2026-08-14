# Velorn v0.3.26

Velorn v0.3.26 improves audio reliability across preview, editing, and export, and lets Linux creators use a compatible system FFmpeg build for NVIDIA hardware encoding while retaining Velorn's bundled software fallback.

## Highlights

- **Smoother timeline audio playback.** Velorn now prepares nearby audio clips ahead of playback, keeps active layers stable across edits, and performs a bounded start alignment when playback begins in the middle of a clip. This reduces crackling, catch-up behavior, and gaps around short or multilayer cuts.
- **Short audio clips survive export.** Export now recognizes legacy video-backed clips placed on audio tracks and preserves fractional timeline delays, preventing very short fragments and frame-aligned cut boundaries from being dropped or shifted.
- **Safer audio splits.** Audio razor edits preserve clip gain, fades, timing, retiming, reverse state, and source ranges. Older projects with video-typed audio-track fragments are repaired when loaded.
- **Configurable FFmpeg for hardware export.** In **Settings > File Paths**, Linux users can select and test an external FFmpeg build that supports NVIDIA NVENC. The `VELORN_FFMPEG_PATH` environment variable is also supported for advanced setups.
- **Isolated hardware path with safe fallback.** A custom FFmpeg binary is used only for final H.264/H.265 hardware encoding. Velorn continues to use its bundled FFmpeg for normal media processing and automatically falls back to bundled software encoding when the custom binary or requested encoder is unavailable.
- **Comfy.org credit display control.** Creators can hide the cloud credit balance when they use local workflows and do not need the Comfy.org balance in the interface.
- **Immediate paused graphic refresh.** Text, shape, and caption changes now refresh the preview immediately while playback is paused.
- **Broader imported workflow support.** Imported workflows can bind namespaced prompt fields such as `model.prompt`.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, M4, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.

## Notes

- Editing, captions, export, MCP control, and local project management do not require ComfyUI. ComfyUI is needed only when running a ComfyUI generation workflow.
- Velorn's bundled FFmpeg remains the default and the software fallback. Configure an external binary only when you need a hardware encoder that is not included in the bundled build.
- Standalone NVIDIA RTX 4K upscaling remains Windows-only. The external FFmpeg setting affects H.264/H.265 hardware export, not RTX 4K upscaling.
