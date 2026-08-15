# Velorn v0.3.27

Velorn v0.3.27 adds PNG image sequence export for compositing, VFX, archival, and frame-by-frame delivery workflows.

## Highlights

- **PNG image sequence export.** Choose **PNG Sequence** in the Export panel to render the visible timeline as individually numbered PNG frames.
- **Predictable portable filenames.** Velorn creates names such as `project_000001.png`, using a filename stem that is safe across Windows, macOS, and Linux.
- **Exact frame output.** PNG sequences use the selected frame rate and resolution, including odd custom dimensions that video encoders would normally round.
- **Non-destructive output folders.** Velorn creates a new `<name>_png` child folder and refuses to reuse an existing directory, preventing accidental overwrites or unsafe cleanup.
- **Safer cancellation and failure handling.** Incomplete sequence folders are removed when possible. If cleanup cannot complete, Velorn reports the exact folder that still contains partial files.
- **Reliable export-job tracking.** Hidden export-worker events are correlated to the correct job so UI exports, queued exports, and agent-started background exports cannot complete or fail one another accidentally.
- **Clearer standalone-editor documentation.** The README now makes clear that editing, captions, export, project management, and MCP editorial tools work without ComfyUI; all current generation features require a locally running ComfyUI instance.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, M4, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.

## Notes

- PNG sequences contain image frames only. Audio, video codecs, hardware encoding, and NVIDIA RTX 4K upscaling do not apply to this export format.
- Choose a parent destination and Velorn will create a new sequence folder automatically. Existing directories are never claimed as PNG sequence outputs.
- Normal video and audio export behavior is unchanged.
