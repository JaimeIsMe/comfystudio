# Velorn v0.3.21

Captions become a live timeline clip: Generate is instant, double-click reopens the editor, and captions grade, mask, and animate like any other layer. Plus bypass pills for one-click A/B checks.

## Highlights

- **Captions are live clips now.** Generating timeline captions no longer renders a baked overlay video — it places a captions clip that draws its cues fresh every frame, in both preview and export, pixel-identical to what the bake produced. Generate finishes instantly, and cue edits never wait on a re-render.
- **Double-click the captions clip to edit it.** The caption editor reopens seeded from the clip itself — cues, preset, colors, fonts, size, and placement exactly as you left them — and Generate applies your changes in place. It works after a restart or on another machine; right-click → Edit Captions does the same.
- **Regenerating keeps your look.** The captions clip carries its transforms, grades, masks, mattes, keyframes, and name through a regenerate — restyle the words without rebuilding the layer. And yes: captions clips take the full Inspector now, just like text and shapes.
- **Bypass pills.** The Mask, Color, and Effects sections each get a pill that temporarily switches the whole group off — the classic before/after check. Preview and export both honor it, and your settings stay untouched.
- **Real progress on caption work.** The Transcribe button fills with a live percentage while it listens, and asset-scope caption renders report render progress the same way.

## Details

- Existing baked caption overlays keep working exactly as before — they are normal video assets. Generate once from the caption editor to upgrade a timeline to the live clip.
- One captions clip per timeline, as before. Generate replaces it in place; timing resets to match the new cues.
- Caption drafts now restore the placement controls (size, nudge, position, motion) too, which previously reset after an app restart.
- Agent-driven caption generation over MCP still produces baked overlays for now.

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
