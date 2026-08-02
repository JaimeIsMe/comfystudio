# Velorn v0.3.18

Splines learn to act: animate the drawn shape itself, and a dope sheet that opens on your animation.

## Highlights

- **Per-point spline animation.** Spline masks now animate as shapes, the way Flame and After Effects do it: a **Shape** keyframe diamond at the top of the Mask section keys the entire drawn path, and once keyed, dragging any anchor or handle at a different playhead position writes a new shape keyframe. Playback morphs every point and curve handle smoothly between your drawn shapes, with the full easing set — and the whole-mask animation from v0.3.17 (position, scale, rotation, feather) stacks on top. Rotoscoping is now genuinely possible.
- **Add points without breaking animation.** Inserting or deleting a spline point applies the same edit to every shape keyframe behind the scenes, so refining your shape after animating never desynchronizes the morph.
- **The dope sheet opens on what you animated.** The keyframe editor now defaults to **Animated** — only properties with keyframes — instead of a long scroll of every slider. The **All** view brings everything back, organized into collapsible groups (Position, Scale, Rotation, Crop, Color, Mask…) whose headers show summary key markers even when collapsed. Your view and collapse choices are remembered.
- **Space plays the clip.** While the keyframe editor is open, Space plays the selected clip's range — from the playhead inside it, from the start otherwise — and loops at the clip end so you can polish animation the way it's meant to be watched. A **Loop Clip / Play Once** toggle sits in the header; close the panel and Space returns to normal timeline playback.
- **Mask Shape in the dope sheet.** Shape keyframes appear as a timing-only row: drag to retime, marquee, copy/paste, and set easing like any other keys.

## Details

- Shape keyframes interpolate every anchor and bezier handle pairwise; if two neighboring keyframes ever carry different point counts, the earlier shape holds instead of glitching.
- Double-clicking a dope sheet lane adds a keyframe at the playhead; mask rows capture the animated value at that moment.
- Mask geometry rows (center, size, rotation, feather) appear in the dope sheet for masked clips.
- Collapsed group headers show the union of their children's keyframe times as faint markers.

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
