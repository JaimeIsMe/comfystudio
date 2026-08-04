# Velorn v0.3.23

Projects moved from Windows to macOS can export normally again. Velorn now keeps relocated media paths portable instead of accidentally combining the Mac project folder with an already-absolute path and reporting every source as undecodable.

## Highlights

- **Cross-platform project exports are repaired.** A project created on Windows and copied to a Mac no longer fails export with a long list of `MEDIA_ELEMENT_ERROR: Format error` sources.
- **Relinked media stays portable.** Media found under the moved project's `assets` folder is saved as an `assets/...` project-relative path while retaining the correct current-machine absolute path for the active session.
- **Affected projects self-heal.** Projects opened by the affected release are normalized automatically the next time they are opened, without requiring users to relink dozens of clips manually.
- **Export path resolution is defensive.** Velorn recognizes absolute media paths instead of joining them to the project folder a second time.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, M4, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.

## Notes

- The repair was verified with a real project created on Windows, moved to macOS, and exported from the Mac.
- Keep the complete project folder together when moving between computers so media inside its `assets` folder can be found automatically.
- Velorn still depends on a separate local ComfyUI installation for local generation.
