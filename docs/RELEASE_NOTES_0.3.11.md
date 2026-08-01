# Velorn v0.3.11

## Highlights

- **Audio-only export.** A new Audio Only format in the Export tab writes your timeline's program mix — every track volume, pan, fade, solo, and the master gain — straight to WAV, MP3, or M4A, with no video rendering. An hour-long timeline delivers its audio in about a minute.
- **Exports with broken audio now fail in seconds, not hours.** Video exports validate every audio clip's source file before rendering a single frame, and errors name the exact files that need relinking instead of a bare clip count.
- **The Add Captions window is redesigned around your captions.** The cue list is now front and center — click a line to preview it, type in the row to fix it — with a cleaner two-stage flow and the style controls always paired with a live preview.

## Export

- New format: Audio Only (WAV lossless, MP3, or M4A). Same mix rules as a video export, so what you hear is what you get. Loudness normalization works here too. One current limit: projects using Mixer insert effects are declined with a clear message rather than exported without them — that support comes later.
- Before any frames render, the export now checks that every audio clip's file actually resolves on disk. A timeline that would have failed at the very end — after a full hour of rendering — now stops within seconds and tells you which files to fix.
- Audio mix errors name names: "Dropped: narration_03.mp3 (file not found — relink or restore it)" instead of "included 38 of 50 clips".

## Captions

- Add Captions opens to one simple card the first time — pick a model, transcribe. After transcription the window belongs to the result: your captions as a searchable list on the left (click to seek the preview, edit text right in the row), and the selected caption's timing and placement controls on the right.
- Style presets and your saved styles now share one compact dropdown, the preview stays visible while you adjust any style control, and model downloads/deletion moved behind a "Manage models" disclosure.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.

## Notes

- If your exports from a moved or relinked project ever came out missing audio, v0.3.10's fix plus this release's validation close that chapter: update, re-open the project, and re-export.
- Velorn still depends on a separate local ComfyUI installation for local generation; editing, export, and captions do not require an active ComfyUI connection.
