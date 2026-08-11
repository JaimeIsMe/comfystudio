# Velorn v0.3.24

Velorn can now upscale finished exports to 4K directly with NVIDIA RTX Video Super Resolution. The new path runs independently of ComfyUI, streams one frame at a time to keep memory bounded, and preserves the timeline's audio and aspect ratio.

## Highlights

- **Direct NVIDIA RTX 4K upscale.** Enable NVIDIA RTX 4K upscale in Export to enhance the finished MP4 with NVIDIA's AI video super-resolution engine.
- **No ComfyUI process required.** The upscale runs through a small optional Velorn-managed RTX runtime. Users who only use Velorn as an editor can still use the feature.
- **Bounded memory usage.** Frames are decoded, enhanced on the GPU, and encoded one at a time instead of loading the full video into system memory.
- **Landscape and vertical delivery.** The output uses a 3840-pixel long edge while preserving the source aspect ratio, including 2160x3840 vertical exports.
- **H.264 and H.265 support.** The final RTX export follows the selected delivery codec, uses NVIDIA NVENC, and preserves or converts the source audio as needed.
- **Four enhancement levels.** Low, Medium, High, and Ultra allow users to trade processing speed for AI reconstruction quality. High remains the recommended default.
- **Safer long-running exports.** Velorn reports RTX progress and ETA, supports cancellation, removes temporary source renders after success, and keeps the normal render when the upscale fails.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, M4, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.

## Notes

- Direct NVIDIA RTX upscaling currently requires 64-bit Windows, a compatible NVIDIA RTX GPU, current NVIDIA drivers, and NVENC support.
- The optional standalone runtime downloads about 595 MB on first setup and uses roughly 1 GB after installation.
- NVIDIA RTX upscaling is an export post-process. ComfyUI is still used separately for Velorn's local generation workflows.
- High is the recommended quality setting for most final exports. Ultra favors maximum detail preservation but takes longer.
