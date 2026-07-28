# Velorn v0.3.4

## Highlights

- Added agent-guided Music Video creation through Velorn's MCP tools. Agents can now configure a project, manage cast references and coverage passes, edit director scripts and individual shots, queue keyframes and videos, replace generated results, assemble the timeline, and save the project while keeping everything editable in the visible Director workspace.
- Added Adobe Premiere Pro XML export as a separate beta option alongside the existing FCPXML export for DaVinci Resolve and Final Cut Pro.
- Added a detachable clean-feed preview window for a second display.
- Added Default and Vertical editor layouts, Compact/Normal/Tall track heights, a responsive timeline toolbar, and a live playback FPS display.
- Added Seedance 2.0 Mini text-to-video and reference-to-video workflows.
- Improved export reliability for long source videos and timelines with delayed audio.

## Agent-Guided Music Videos

- Added a persistent, resumable Music Video session shared by MCP and the visible Director interface.
- Added tools for setup, cast management, character portraits and sheets, alternate performance and b-roll passes, director scripts, shot updates, transcription, keyframe/video generation, result replacement, timeline assembly, and project saving.
- Added preview-first generation and assembly plans so agents show intended actions before starting local GPU work, spending cloud credits, or modifying the timeline.
- Added timeline-shot replacement that preserves edit timing, transforms, effects, and sync locks.
- Routed reference-free local b-roll keyframes through Z-Image Turbo when the selected image-edit workflow requires an input image.
- Improved reference-free keyframe prompting so b-roll renders as one cinematic frame instead of a character-sheet or storyboard grid.
- Expanded the documented MCP catalog to 125 tools.

## Premiere Pro XML

- Added an XML format selector in Export:
  - `Resolve / Final Cut (FCPXML)`
  - `Premiere Pro XML (Beta)`
- Premiere export uses Final Cut Pro 7 XMEML v5 and includes sequence settings, video and audio tracks, clip timing, source trims, repeated media references, audio visibility, and supported static transforms.
- Added the same format choice to the `export_fcpxml` MCP tool.
- Premiere XML remains beta. Keyframed transforms, effects, transitions, titles, speed ramps, and other advanced timeline features may require finishing inside Premiere.

## Editor And Timeline

- Added a detachable preview window with a clean feed suitable for a second monitor.
- Added a playback FPS meter to the preview information overlay.
- Added Default and Vertical editor layout presets.
- Added Compact, Normal, and Tall timeline track-height presets.
- Made the timeline toolbar responsive instead of hiding controls at narrower widths.
- Increased crop controls to allow a full 100% crop on each side.
- Preserved clip effects and transforms when splitting or duplicating clips.
- Applied transform-only adjustment layers correctly during compositing.
- Made Delete target the newly placed timeline clip after dragging an asset into the edit.

## Generation

- Added Seedance 2.0 Mini text-to-video and reference-to-video workflows with dependency metadata and workflow-library support.
- Added direct Discord access from Velorn's feedback settings.
- Improved Music Video workflow guidance for local and cloud generation paths.

## Export Reliability

- Fixed audio mixes ending early when the first audible clip begins later in the timeline.
- Prevented out-of-memory export crashes on unusually long source videos. Sources longer than 20 minutes, or clips beginning more than 5 minutes into a source, now use Velorn's standard decoder instead of the memory-intensive fast decoder.
- Improved export diagnostics so decoder messages identify the source asset as well as the timeline clip.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

## Notes

- Velorn still depends on a separate local ComfyUI installation for local generation.
- Some workflows require custom nodes, local model files, cloud credits, or provider access.
- Long-source exports may be slower when Velorn selects the standard decoder, but this avoids the renderer memory failure seen with the fast path.
