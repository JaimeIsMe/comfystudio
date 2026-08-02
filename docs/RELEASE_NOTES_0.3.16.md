# Velorn v0.3.16

The Inspector, reorganized: task tabs with at-a-glance state, Resolve-style color wheels, and one home for compositing.

## Highlights

- **Task tabs.** The Inspector is now organized by task — **Transform · Mask · Color · Effects · Motion · Mix** (text clips lead with **Text**; adjustment clips get their own set). Every tab shows a colored dot when something inside is non-default, so a project reads at a glance — including one you haven't opened in a month. Each tab carries a subtle identity color, and your active tab is remembered per clip type.
- **Color wheels.** The Color tab now leads with four Resolve-style wheels — **Global / Lift / Gamma / Gain**. Drag a puck to push that tonal range toward a hue (angle picks the hue, distance sets the strength); the slider under each wheel drives the range's level. Double-click any wheel or slider to reset it. The wheels drive the same grade the sliders always did — the slider groups stay below as fine controls, and Scopes in the bottom view read the result.
- **One home for compositing.** Opacity, Blend Mode, and Track Matte moved out of Transform into **Mix**, joining the layer-compositing controls. Text clips gain the Track Matte selector.
- **Slimmer clip header.** Clip identity — name, track, type, fps — lives in a compact header that stays pinned while you scroll, with the tab bar pinned right under it. The full metadata table (source in/out, codec, format, size…) is one click away behind the **⋯** button.
- **Crop, decluttered.** The gray crop preview box is gone — the monitor is the preview. The four crop sliders are unchanged.

## Details

- Wheels map directly onto the existing per-range controls: Lift = Shadows offset, Gamma = Midtones gamma, Gain = Highlights gain, Global level = brightness. Existing projects read back exactly, and grades made with wheels round-trip with the sliders (and with grades set over MCP).
- To keyframe wheel parameters, use the keyframe diamonds on the slider rows below the wheels; diamonds on the wheels themselves are coming.
- Non-default dots by tab: Transform (position, scale, rotation, crop, flips, corner pin), Mask, Color (any grade or LUT), Effects (blur, GLSL effects, motion blur), Motion (speed, reverse), Mix (opacity, blend mode, track matte).
- Motion blur's dot moved from Transform to Effects to match where the control lives.
- Expanded/collapsed section preferences persist as before; nothing about the underlying clip data changed in this release.

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
