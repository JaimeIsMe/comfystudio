# Velorn v0.3.7

## Highlights

- Timeline playback is dramatically faster on large, effect-heavy timelines — sequences that previously played at a fraction of real time now play near full speed, and scrubbing is far more responsive.
- ProRes and DNxHD/DNxHR sources now export correctly via automatic one-time preparation (they previously rendered as black).
- You can now stop a running export.
- "Frame all" fits timelines of any length — hour-long edits zoom out to fill the window.
- Exports carry broadcast-standard BT.709 color conversion and tags, so uploads no longer wash out.

## Playback Performance

- Fixed a bottleneck where an internal session-restore snapshot of the entire timeline was re-saved on every frame of playback. Large timelines now play near their target frame rate; the cost previously grew with project size.
- The timeline ruler and playhead no longer redraw the full clip area on every frame — deep zoom levels now play as fast as zoomed-out views.
- Scrubbing sheds the same per-move overhead and feels much snappier on big projects.
- The playback info overlay now shows the compositor's per-frame cost alongside fps for easier diagnosis.

## Export

- New Stop button cancels a running export cleanly.
- Sources the renderer cannot decode (ProRes, DNx, and similar) are automatically prepared once at export start as a visually transparent intermediate, then export normally — where they previously produced silent black video with working audio.
- If a source still cannot be prepared, the export fails up front with a clear message naming the file and reason, instead of rendering black.
- Removed the ambiguous "Selection" export range; saved settings fall back to Full Timeline.
- Better diagnostics: per-run export logs are kept, log writing falls back to a temp location when blocked, and crash messages name the real log path.

## Color

- Exports now convert to YUV with the correct BT.709 matrix and carry full color metadata in both the bitstream and container. Players and upload transcodes stop guessing, so delivered colors match the preview.

## Timeline & Compositing

- "Frame all" and the zoom controls fit timelines of any length; the ruler gains 15/30/60-minute tick steps for hour-scale views.
- Clips carrying GLSL effects (camera shake, fisheye, glitch, VHS look, and friends) now always composite the layers beneath them, fixing potential black reveals where the effect displaced the frame.

## Fixes

- Fixed the preview Play button doing nothing when selecting an asset that was already being previewed (most visible with a folder's only asset).

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

## Notes

- The playback improvements compound; heavy timelines that played at single-digit fps should now sit near target rate. Very high frame-rate timelines (60 fps) may still fall slightly short on complex projects — a known residual.
- Velorn still depends on a separate local ComfyUI installation for local generation; editing and export do not require an active ComfyUI connection.
