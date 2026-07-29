# Velorn v0.3.6

## Highlights

- Fixed export crashes (out of memory) on timelines that use multi-gigabyte source files.
- Long sources now stream through the export decoder with a small, fixed memory footprint regardless of file size.

## Export Stability

- The export process no longer loads large source files fully into memory while rendering. Sources are read in small bounded windows, so export memory stays flat even for multi-gigabyte masters.
- Fixed a leak where sources with audio tracks retained every streamed byte until the end of the export.
- Both fixes apply to original sources and to Velorn's prepared (remuxed) long sources from v0.3.5.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

## Notes

- These fixes complete the long-source export work introduced in v0.3.5; exports that fall back to the standard decoder are unaffected.
- Velorn still depends on a separate local ComfyUI installation for local generation; editing and export do not require an active ComfyUI connection.
