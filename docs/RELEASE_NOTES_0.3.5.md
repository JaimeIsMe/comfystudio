# Velorn v0.3.5

## Highlights

- Dramatically improved export performance for timelines that use unusually long source videos or clips with deep source in-points.
- Added automatic lossless source preparation so long local videos can use Velorn's faster sequential decoder instead of falling back to repeated random-access seeking.
- Reduced renderer memory pressure during long exports and improved export diagnostics.

## Long-Source Export Performance

- Velorn now inspects long local video sources before rendering.
- Sources that are already optimized for sequential reading are reused directly.
- Sources whose movie index is not positioned for efficient decoding are temporarily remuxed as video-only MP4 files with FFmpeg's stream-copy mode.
- Stream-copy preparation does not re-encode the video and does not reduce image quality.
- Prepared sources are created only inside the export's temporary folder and are removed with the rest of the temporary export files.
- Preparation happens once per source file, even when that source appears in many timeline clips.
- If preparation is unavailable or fails, Velorn keeps the existing standard decoder as a fallback instead of failing the export.

## Stability And Diagnostics

- Reduced compressed-frame read-ahead for the sequential decoder to keep memory use bounded on long, high-bitrate masters.
- Avoided loading extremely large source headers into the Electron renderer.
- Suppressed expected stream-abort messages when a decoder reaches the end of a clip or closes normally.
- Added source-preparation counts to export diagnostics so logs report how many long sources were reused, remuxed, or fell back.
- Export now verifies that FFmpeg can actually start before rendering begins, and a missing or blocked FFmpeg installation is reported with its expected location instead of a bare numeric error code.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

## Notes

- The first export of a long, non-optimized source may spend a short time preparing that source before frame rendering begins.
- Preparation requires enough free temporary disk space for a video-only stream copy of each affected source.
- Actual export speed still depends on timeline complexity, effects, compositing, source codecs, storage speed, and hardware.
- Velorn still depends on a separate local ComfyUI installation for local generation; editing and export do not require an active ComfyUI connection.
