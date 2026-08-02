# Velorn v0.3.17

Masks grow up: bezier spline masks you sculpt on the monitor, and mask geometry that animates.

## Highlights

- **Spline masks.** A new **Spline** shape in the Mask section: a closed bezier path edited directly on the monitor. Drag anchor points to move them; drag their white handle dots to shape the curve — a smooth pair stays mirrored, Alt-drag breaks it into a cusp; click the small midpoint dots to add a point exactly on the curve; Alt-click an anchor to delete it (three-point minimum). Picking Spline starts you from a clean circle to sculpt. Feather and Invert work like every other shape, and preview and export read the identical matte.
- **Mask keyframes.** Mask geometry now animates: Center X/Y, Width, Height, Rotation, and Feather (plus Corner Radius on rounded rects) all have keyframe diamonds in the Mask section. The on-monitor handles follow the animated mask at the playhead, and dragging writes keyframes when a parameter is keyed. Splines ride the same system — the box carries the whole drawn path, so a shape can travel, scale, and rotate through a shot without touching a single point.

## Details

- Spline anchors live in the mask's own space: the mask's Center/Width/Height/Rotation — and their keyframes — move the drawn path rigidly, so points never drift.
- Switching a spline to another shape and back recovers the drawn path; shape experiments aren't destructive.
- While editing a spline the box resize handles step aside so anchors are always grabbable; the Width/Height sliders still scale the whole path.
- Keyframed mask parameters appear as "Mask …" rows in the keyframe editing view once keyed.
- Render-in-place bakes and preview caches invalidate automatically when mask animation changes.
- Next on the mask roadmap: per-point spline animation and a click-to-place pen mode.
- The window title and the Discord release announcer now say Velorn. Internal compatibility identifiers are deliberately unchanged, so projects, settings, and installs carry over untouched.

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
