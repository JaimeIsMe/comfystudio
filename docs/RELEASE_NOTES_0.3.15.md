# Velorn v0.3.15

The biggest feature release yet: a real color suite, clip masking with on-monitor handles, and the classic NLE round trips.

## Highlights

- **Grade with LUTs.** Select a clip → Inspector → Color → **Look (LUT)** → *Import .cube…* — any 3D `.cube` LUT applies instantly, with an Intensity slider. LUTs import once into an app-wide library and are available in every project. Put one on an **adjustment clip** spanning your edit to give every AI-generated shot the same look in one move. Preview and export render the LUT through the same GPU pass, so what you see is exactly what exports.
- **Video scopes.** A new **Scopes** view next to Timeline / Dope Sheet / Mixer: **luma waveform**, **RGB parade**, and a **vectorscope** with 75% targets and a skin-tone line (BT.709 throughout, matching the pipeline). The parade is the fastest way to spot that one generated shot running warmer than its neighbors.
- **Shape masks.** Select a video or image clip → Inspector → **Mask** (right under Crop): Rectangle, Ellipse, or Rounded, with position/size/rotation, **Feather**, and **Invert**. While the Mask section is open, the mask draws on the monitor with **gold drag handles** — center dot moves it, edge handles resize, a dotted ring shows feather reach. Masks ride the clip's transform and export identically.
- **Match Frame.** Press **F** on a timeline clip (or right-click → *Match Frame in Source Player*) to open its source asset parked on the exact frame under the playhead, with the clip's range pre-marked — grab an alternate take or a different select from the same source in seconds.
- **Reveal round trips.** **Shift+F** or right-click → *Reveal in Assets Panel* jumps from a timeline clip to its asset — switches to the Assets tab, navigates to its folder, selects it, and pulses it into view. *Reveal in Finder / File Explorer* opens the file selected in your OS file manager (desktop app, files on disk; also on the Assets panel's right-click menu).

## Color

- The LUT library lives at the app level — import your pack once, use it everywhere. A project opened on a machine without the LUT renders without it and the Inspector says so.
- 1D LUTs are rejected with a clear message (3D `.cube` only); non-standard domains are treated as 0–1 with a console note.
- On machines without WebGL2, LUTs are skipped consistently in both preview and export.
- Scopes cost nothing while closed; the panel samples the program monitor at ~10Hz while open and remembers your last mode.

## Masking

- Masks are clip-attached — no extra track, nothing destructive; feather is resolution-independent; every drag or slider gesture is one undo step.
- Render-in-place bakes and preview caches invalidate automatically when a mask changes.
- Existing AI/segmentation masks are unchanged; they'll fold into the same Mask section in an upcoming release.

## Editing

- Match Frame targets the selected clip (preferring one under the playhead), else the active track's clip at the playhead. Remappable (`F` by default).
- Both new shortcuts (F, Shift+F) are remappable in hotkey settings and merge into existing customized layouts automatically.

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
