# Velorn v0.3.20

One home for masking: AI mask images join shapes and splines in the Mask section.

## Highlights

- **The Mask section is masking's single home.** An **Image** chip joins None / Rect / Ellipse / Round / Spline. When a clip uses an AI segmentation mask, the Mask section now shows its asset card, an eye to bypass it, the Invert toggle, and a **Pick / Swap Mask Image** button listing your mask assets — everything that used to live in the Effects tab, in the place your hands already go for masking.
- **The chips are a real mode selector.** Picking a shape quietly bypasses the image mask; picking **Image** clears the shape and re-enables it; **None** switches masking off without deleting anything, so flipping between approaches is always reversible. The header's Remove clears whichever kind is present.
- The Effects tab no longer lists mask effects — it's for effects now.

## Details

- Pure reorganization: mask data, projects, and every render path are untouched. Existing masked clips look identical; their controls simply moved.
- Dragging a mask asset onto a clip still works exactly as before — the Mask section picks it up.
- Generate mask images with AI segmentation from the Assets panel, as before.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.

## Notes

- Velorn still depends on a separate local ComfyUI installation for local generation; editing, export, and captions do not require an active ComfyUI connection.
