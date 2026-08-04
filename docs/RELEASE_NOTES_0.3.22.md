# Velorn v0.3.22

Generation-heavy edits no longer need a long browser-clicking session: MiniMax H3 reference-and-audio jobs can be queued, monitored, and returned to the edit through Velorn's MCP bridge. Large alternate-take timelines also gain video-track solo for fast review.

## Highlights

- **Direct MiniMax H3 generation over MCP.** Queue a paid H3 reference-to-video performance from an exact Velorn image asset and audio segment, choose 768P or 2K output, preserve the requested aspect ratio and seed, and identify the shot without opening the ComfyUI canvas.
- **Live generation-queue monitoring.** Agents can poll queued, running, completed, and failed Generate jobs, including progress, prompt IDs, and imported result asset IDs. Routine batch work no longer depends on computer-use clicking.
- **Video-track solo.** Every video-track header now has an `S` control. One or several picture tracks can be soloed while other video tracks are temporarily suppressed; the original eye/visibility settings remain intact.
- **Solo stays consistent through delivery.** Video solo is honored by preview, transitions, flattened preview caching, native export, Premiere XML, FCPXML, and MCP timeline inspection.
- **Clean alternate music-video assemblies.** MCP assembly can provide a new timeline name, making it easy to build a clean synchronized edit without modifying an older sequence.

## Generation Details

- Adds the `queue_h3_reference_video` MCP tool for exact image-plus-audio H3 jobs.
- Adds `get_generation_queue_status` for live Generate queue polling.
- Registers the MiniMax H3 reference workflow in Velorn's workflow catalog and generic prompt-batch routing.
- H3 jobs use positive prompting only; no negative prompt is sent.
- The bundled LTX 2.3 image-to-video-with-audio workflow now leaves its negative text input empty, matching LTX 2.3's expected behavior.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, M4, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.

## Notes

- Velorn still depends on a separate local ComfyUI installation for local generation.
- Credit-backed ComfyUI workflows require the user to be signed in to the relevant Comfy account on the new computer.
- The first launch on macOS may still require the usual permission prompts for local files and external tools.
