# Velorn v0.3.12

## Highlights

- **Music-video image and video prompts no longer inherit music vocabulary.** Song descriptions like "rap, boom bap, 90 BPM, male vocal" in the style notes were leaking into keyframe and motion prompts, planting rappers, DJ booths, and stage lights into b-roll and narrative shots that asked for none of it. Generation prompts now receive only the visual parts of your style notes — the director-brief LLM still sees the full song context for planning.

## Music Video

- The "Song style / visual look notes" field keeps its dual purpose, filtered at the right boundary: segments describing the music (genres, BPM, vocals, song structure, production terms) stay in the creative brief; segments describing the look ("neon noir, 35mm film grain") flow into image and video prompts. The filter is deliberately conservative — words that double as visual vocabulary (jazz club, metal, country, house, lo-fi) are never touched.
- Thanks to the community report with a concrete failing case (issue #91) — a parliamentary-office cutaway that rendered as a DJ scene. That example made the fix an afternoon instead of a week.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.

## Notes

- Existing director plans keep their already-composed prompts; re-parse the script (or rebuild the plan) to recompose prompts with the fix.
- Velorn still depends on a separate local ComfyUI installation for local generation; editing, export, and captions do not require an active ComfyUI connection.
