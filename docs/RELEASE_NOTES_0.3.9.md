<!-- In progress — v0.3.9 is unreleased. Items accumulate here as they land on main. -->

# Velorn v0.3.9

## Highlights

- Captions no longer use ComfyUI. A one-click local transcription engine (whisper.cpp) downloads on first use and runs on the CPU, several times faster than realtime, with three accuracy tiers to choose from.
- The Inspector now has the same full-height mode as the left panel — expand either side (or both) to span the full window height, Resolve style.

## Captions

- Transcription now runs on your machine — no ComfyUI, no setup. Pick an accuracy tier in Add Captions: Fast (142 MB), Accurate (466 MB), or Best (1.6 GB); each is a one-click download the first time you use it. The ComfyUI Qwen3-ASR path is retired from the captions UI (the music-video lyric pass still uses it for now).
- Word-level caption timings now exist in both scopes. Timeline-scope transcriptions previously had no word timing at all, so the word-pop presets were interpolating between cue boundaries; they now get real per-word times.
- Timeline captions honor mutes and solos, so for a busy mix you can solo the dialog or vocal track before transcribing — the dialog now says so.
- Windows and Linux to start; the macOS local engine needs our own CLI build and comes later.

## Editing

- New full-height toggle at the bottom of the Inspector's icon bar, mirroring the left panel's. The Inspector spans preview + timeline; the resize handle works in both modes.
- Both sides can be full-height at once. In the vertical (9:16) layout the left panel takes priority — the Inspector returns to full height automatically when the left panel gives it up.
- Full-height modes now persist across restarts for both panels (the left panel's was previously forgotten on relaunch).
