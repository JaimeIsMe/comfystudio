# Velorn v0.3.10

## Highlights

- **Local captions come to macOS.** The on-device caption engine now runs on all three platforms — a universal Mac build (Apple Silicon + Intel, Metal-accelerated on Apple Silicon) downloads on first use, just like Windows and Linux. Captions no longer require ComfyUI anywhere.
- **Caption timing overhaul.** Words now land when they're actually spoken: transcriptions snap to the timeline regions that really contain audio, smeared boundary words are repaired, and hallucinated captions over silence are dropped entirely.
- **Moved projects heal themselves.** Open a project whose media files moved — a new drive, a new machine, a zipped copy from a friend — and Velorn relinks the assets automatically.
- **Captions are editable after the fact.** Double-click (or right-click) a caption overlay on the timeline to reopen Edit Captions with your cues loaded; Generate replaces the overlay in place.

## Captions

- The local caption engine now installs on macOS. In v0.3.9 Mac users still needed ComfyUI for captions — that gap is closed.
- Fixed: on timelines with many clips and quiet space before the first one, every caption could land seconds late (up to the length of the leading silence). Transcripts of any length now keep their word timing.
- Transcription is biased toward your project's own vocabulary — the project name, timeline names, and on-screen text are included automatically, and a Vocabulary field in Add Captions takes brand names, people, and jargon so they come back spelled right.
- Captions hear exactly the mix you hear: only clips on audible audio tracks, honoring every mute and solo — the same rules as playback and export. Audio embedded in video clips joins by putting it on an audio track, same as everywhere else in the app.
- Whisper's non-speech markers ([MUSIC], [BLANK_AUDIO], ♪) no longer appear as caption text, and utterances "heard" where the timeline has no audio are dropped as hallucinations.
- Sung vocals are protected: held notes are never chopped short by the timing repair.
- Fixed: the caption audio mix could truncate at a delayed clip, cutting off everything after it.
- Fixed: transcribing a timeline with no audible audio clips could crash the editor to a black screen; it now explains what to unmute instead.

## Projects

- Auto-relink on open: dead absolute paths re-resolve against the project's assets folder, then the healed project saves once. Verified on a real project zipped from a Mac and opened on Windows.
- Fixed: relinked media was silently missing from caption transcription and from **exported audio**. If you've ever moved a project and its exports lost audio, this was why — re-export on v0.3.10.

## Editing

- Audio track headers now have a solo button (S) — the same solo the Mixer panel uses, so soloing for a quick listen or a cleaner transcription is one click.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package
- `Workflow Starter Pack` (optional): advanced ComfyUI setup aid for users who want to inspect workflows manually

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.

## Notes

- The local caption engine downloads on first use from the Add Captions dialog (~150 MB for the default tier; larger tiers are optional). This now applies to macOS too.
- Velorn still depends on a separate local ComfyUI installation for local generation; editing, export, and captions do not require an active ComfyUI connection.
