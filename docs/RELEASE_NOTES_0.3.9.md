<!-- In progress — v0.3.9 is unreleased. Items accumulate here as they land on main. -->

# Velorn v0.3.9

## Highlights

- Captions no longer require ComfyUI. A one-click local transcription engine (whisper.cpp) downloads on first use — about 150 MB — and runs on the CPU, several times faster than realtime. ComfyUI's Qwen3-ASR remains available as a selectable engine.
- The Inspector now has the same full-height mode as the left panel — expand either side (or both) to span the full window height, Resolve style.

## Captions

- New "Transcription engine" row in Add Captions: Auto / Local / ComfyUI, with a one-click engine download (whisper.cpp base model). Auto prefers the local engine once installed and falls back to ComfyUI otherwise, so existing setups keep working unchanged.
- The local engine provides word-level caption timings in both scopes. Timeline-scope transcriptions previously had no word timing at all, so the word-pop presets were interpolating between cue boundaries; with the local engine they get real per-word times.
- Windows and Linux to start; the macOS local engine needs our own CLI build and comes later.

## Editing

- New full-height toggle at the bottom of the Inspector's icon bar, mirroring the left panel's. The Inspector spans preview + timeline; the resize handle works in both modes.
- Both sides can be full-height at once. In the vertical (9:16) layout the left panel takes priority — the Inspector returns to full height automatically when the left panel gives it up.
- Full-height modes now persist across restarts for both panels (the left panel's was previously forgotten on relaunch).
