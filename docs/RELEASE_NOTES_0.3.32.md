# Velorn v0.3.32

Velorn v0.3.32 adds GPU-accelerated smooth slow motion, transparent video workflows, faster multi-clip trimming, and more flexible caption and font editing.

## New

- **GPU-accelerated Optical Flow.** Create smooth slow motion for slowed video clips with local RIFE frame interpolation. Velorn builds a reusable project cache in the background and uses the generated frames in preview and export.
- **Transparent media workflows.** Import transparent PNG sequences and supported alpha video, preserve transparency through playback and project caches, and export alpha-capable WebM or ProRes 4444 files.
- **Trim multiple selected clips together.** Select several clips and drag the head or tail of any selected clip to apply the same trim to the whole selection. Velorn respects source limits, neighboring clips, and minimum clip length as one undoable edit.
- **Editable caption cues.** Add cues at the preview playhead, split a cue at the text cursor, delete unwanted cues, and edit each cue's start time and duration before generating captions on the timeline.
- **Installed system fonts.** Text, captions, motion graphics, and Inspector font controls now expose fonts installed on the computer through a straightforward selectable list.

## Improved

- **Precise Optical Flow frame stepping.** Paused one-frame navigation waits for the requested generated frame instead of showing a stale or skipped preview frame.
- **Safer cached slow motion.** Optical Flow caches are validated against the source, trim, speed ramp, transitions, project session, and interpolation model. Missing or stale caches fail clearly instead of silently changing the result.
- **Responsive Settings and caption editing.** Settings categories and details remain independently scrollable in shorter windows, while caption review keeps timing and cue controls usable at lower resolutions.
- **Clearer caption timing.** The preview scrubber now uses the same time display as cue rows, making it easier to place and retime captions accurately.
- **Reliable font rendering.** Font family names containing spaces or punctuation render consistently in the editor, timeline, captions, motion graphics, and final export.
- **Simpler Effects and Transitions lists.** Effects and transitions return to clear text-based choices while richer visual previews are reconsidered.
- **Window-size support.** Velorn restores more practical minimum window sizing and protects modal content from being clipped on smaller displays.

## Notes

- Optical Flow is designed for slowed video. It requires a compatible Vulkan or Metal-capable GPU and creates temporary frame data while building the final project cache. Processing time and disk use increase with resolution, duration, and slowdown amount.
- The first Optical Flow release supports standard 8-bit SDR, constant-frame-rate video. Unsupported alpha, HDR, high-bit-depth, variable-frame-rate, reverse, or otherwise incompatible sources show a clear explanation and can continue using Frame or Frame Blend sampling.
- Optical Flow affects picture frames only. Audio continues through Velorn's existing time-stretch path.
- Alpha export is available only with formats and codecs that preserve transparency. Velorn hides or rejects combinations that would flatten the image.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, M4, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.
