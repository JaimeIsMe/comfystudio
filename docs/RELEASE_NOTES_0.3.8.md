# Velorn v0.3.8

## Highlights

- Duplicate clips by holding Alt while dragging, Flame/Resolve style.
- High-frame-rate timelines now play at full speed — 60 fps sequences that previously topped out around 50 hold a locked 60.
- The app launches faster and stays quiet when idle — no more background saves, thumbnail captures, or constant ComfyUI polling while you're not doing anything.
- Hardware-encode exports now probe the encoder first and fall back to software with a clear message instead of stalling — fixes exports on Linux machines without NVENC and covers driver mismatches everywhere.
- Fixed a regression that silently broke PNG-sequence import and PNG-fallback export.
- Agents can now queue image-edit workflows over MCP.

## Editing

- Hold Alt and drag a clip to duplicate it in place, the same gesture as Flame and Resolve. Effects, transforms, and keyframes come along.
- Behavior change: Alt-dragging no longer slips a clip. Slip is its own tool — press Y.

## Export

- Hardware-encode requests (NVENC and friends) probe the encoder at export start. If the encoder is missing or the driver rejects it, the export switches to software encoding and says so plainly, instead of hanging with no output.
- Fixed PNG-fallback exports and the PNG sequence import stitcher, which were broken by an internal refactor.

## Agent & MCP

- Image-category workflows (Qwen image edit and similar) can now be queued by an agent over MCP — both the prepared-generation path and prompt batches with image inputs.

## Performance

- Fixed 60 fps timelines playing at roughly 50: the timeline panel was re-rendering on every frame of playback through a snapping subscription. High-frame-rate sequences now hold their target rate, and the gain grows with timeline size.
- The renderer bundle that loads at launch dropped from 4.4 MB to 2.6 MB. The Generate workspace now loads the first time you open the tab instead of at startup, and hidden experimental workspaces no longer load at all.
- Autosave only runs when something actually changed. Previously the full project was re-serialized, a thumbnail captured, and both written to disk every 30 seconds even while idle — on large projects that was a periodic stutter. A backstop save still runs every few minutes as insurance.
- ComfyUI queue polling rests at 30 seconds when nothing is generating and snaps back to 2 seconds the moment work starts, instead of polling every 2 seconds forever.
- Audio meters (the timeline VU meter and the Mixer strips) stop polling and re-rendering while playback is stopped.

## Project

- CONTRIBUTING now documents the issue-first workflow: agree on an issue before opening a PR, one PR per agreed issue.
