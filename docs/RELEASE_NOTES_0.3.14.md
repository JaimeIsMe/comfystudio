# Velorn v0.3.14

## Highlights

- **Source Player: mark In/Out on an asset, insert exactly that range** (issue #89). Double-click a video or audio asset — or right-click → Open in Source Player — and the preview monitor becomes a source viewer with a range scrubber underneath: set In and Out, audition the selection, then **Insert at Playhead** or **Add to End**. The timeline stays visible the whole time, so inserts land right before your eyes. Clips arrive pre-trimmed but non-destructive: the timeline trim handles can still reveal the rest of the source afterwards.
- **Scrubbing feels like an editor now.** Both the source scrubber and the timeline playhead track your pointer at whatever pace the video decoder can actually sustain, instead of choking on a backlog of queued seeks. Slow, precise cut-point hunting updates roughly every frame; before, the picture froze until you let go or jumped in multi-frame steps.

## Editing

- Source view keyboard grammar is the NLE standard: **I** / **O** mark points, **X** clears, **Space** auditions the range (playback stops at the Out point and restarts from In), **arrow keys** step frames. **Esc** hands the monitor back to the timeline. Timeline shortcuts are untouched outside asset preview.
- Inserting a video range brings its embedded audio along as a linked, identically trimmed clip — same behavior as drag-and-drop.
- Inserts follow your **active (highlighted) track**, with a live "Inserts to …" readout under the monitor that updates the moment you click a different track.
- Timeline scrubbing now retargets whenever the shown frame is more than about one frame from the playhead (previously ~4 frames), so the preview keeps up during slow drags. Playback performance is unaffected.

## MCP

- `add_asset_to_timeline` accepts `sourceInSeconds` / `sourceOutSeconds`, so agents can place a source range as a pre-trimmed clip the same way the Source Player does.

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
