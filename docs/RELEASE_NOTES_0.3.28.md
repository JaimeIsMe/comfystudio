# Velorn v0.3.28

Velorn v0.3.28 fixes Qwen ASR caption transcription for Music Video workflows on installations using newer versions of TTS-Audio-Suite.

## Fixed

- **Qwen ASR transcription compatibility.** Velorn now detects whether the installed Qwen3-TTS Engine expects `model_variant` or the older `model_size` input and queues the compatible caption workflow automatically.
- **Music Video timed lyrics.** The same compatibility handling applies when preparing song lyrics and when transcribing a timeline for captions.
- **Resilient schema lookup.** If ComfyUI cannot report the node schema, Velorn safely provides both recognized input aliases so compatible TTS-Audio-Suite versions can continue.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, M4, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.
