# Velorn v0.3.31

Velorn v0.3.31 adds animated GIF round trips, a built-in place to discover community work and tutorials, and faster timeline navigation with configurable zoom shortcuts.

## New

- **Animated GIF import.** Import an animated GIF from the Assets panel, drag and drop, MCP, or supported generation results and use it as editable timeline media. Velorn preserves the animation timing and creates project-owned playback media for reliable scrubbing, trimming, compositing, and export. Static GIFs remain regular image assets.
- **Optimized GIF export.** Export the timeline or selected range as a continuously looping GIF with adjustable resolution and frame rate. Velorn uses an optimized 256-color palette for better quality and more practical file sizes.
- **Discover Velorn creations and tutorials.** The new Discover resource brings together Featured videos, work made by the Velorn community, and practical tutorials. Videos use click-to-load YouTube playback so the player is not loaded until you choose to watch.
- **Submit work for the showcase.** Creators can submit a YouTube video from Discover with attribution and explicit rights/featuring permission. Submissions go through review and are never published automatically.
- **Timeline zoom hotkeys.** Use `1` to frame all timeline content, `2` to zoom out, and `3` to zoom in. All three actions can be changed or cleared in `Settings > Hotkeys`.

## Improved

- **A clearly separate Discover resource.** Discover appears after Export with its own visual treatment, remains available from the Welcome screen, and can be hidden at any time in `Settings > Appearance`.
- **Resilient Discover catalog.** Velorn can refresh the curated catalog independently while retaining a validated bundled fallback for offline or unavailable-network situations.
- **Safer animated GIF handling.** Import validates GIF structure and resource bounds, preserves transparent animations with alpha-capable project media, avoids unsafe cache conversions, and cleans up interrupted native conversions.
- **Reliable GIF export cancellation.** Two-pass palette generation and encoding are cancellable, temporary output is cleaned safely, and an existing destination is preserved if export fails.
- **Export settings remain intact.** Switching to GIF and back no longer resets the saved codec, quality, audio, hardware-encoding, direct-pipe, upscale, resolution, or frame-rate choices used by regular video exports.
- **Expanded showcase.** Discover now includes eight curated videos, including two additional AI music videos made with Velorn.
- **English and Japanese coverage.** New Discover and GIF controls include matching English and Japanese interface text.

## Notes

- Animated GIFs are normalized into project-owned video media on import. Seeing an `.mp4` or alpha-capable `.webm` inside the project media folder is expected; the original GIF name and source details remain attached to the asset.
- GIF export is currently opaque, audio-free, and set to loop continuously. High resolutions and frame rates can create very large GIF files, so moderate settings are recommended.
- Watching Discover videos requires an internet connection. Thumbnails come from YouTube, and the embedded player loads only after you select a video.
- Existing custom hotkey assignments take priority during migration. If `1`, `2`, or `3` was already assigned, the new conflicting default is left unassigned rather than replacing the creator's binding.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, M4, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.
