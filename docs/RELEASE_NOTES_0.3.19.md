# Velorn v0.3.19

Draw your masks: a pen tool for spline masks.

## Highlights

- **Pen-draw mode.** A new **Draw a Spline (pen)** button in the Mask section turns the monitor into a drawing surface: **click** places a corner point, **click-drag** pulls out smooth curve handles, clicking the **first point** (or pressing **Enter**) closes the shape, and **Esc** cancels without touching anything. The moment you close, the mask is live and the edit gizmo takes over.
- Drawn splines are full citizens: they scale and rotate through the mask box, keyframe with the whole-mask parameters, morph with Shape keyframes, and appear in the dope sheet — identical in every way to a spline you started from the seeded circle.
- Drawing over a clip that already has a mask keeps your Feather and Invert settings; the new path simply replaces the old geometry.
- Points land exactly under your cursor regardless of clip scale, rotation, monitor zoom, or pan.

## Details

- The drawn shape's bounding box becomes the mask's Center/Width/Height box, so the sliders and their keyframes behave predictably on drawn shapes.
- Three points minimum to close; the first point highlights when the shape is closeable.
- Draw mode exits automatically if you change the clip selection.

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
