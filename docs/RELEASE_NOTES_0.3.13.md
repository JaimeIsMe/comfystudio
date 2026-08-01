# Velorn v0.3.13

## Highlights

- **Character sheets now honor your ASSET PREFIX.** With multiple cast members, generated sheets could all come out named `person_sheet` — indistinguishable in the People Wizard's sheet picker and the Assets panel. The prefix you type in the People step now always drives the generated file names (`eiji_sheet`, `anna_sheet`), exactly as the field's help text promises.

## Music Video

- Fixed: the character-sheet step inherited its naming prefix from the portrait's stored metadata instead of the ASSET PREFIX field. If you generated the portrait before typing the prefix — the natural top-to-bottom order — the default `person` stuck to every sheet afterward, for every cast member (issue #90). The typed prefix now wins; inheritance from the base asset only applies when the field is left empty.
- Already-generated sheets keep their existing names — rename them in the Assets panel if needed; newly generated sheets come out uniquely named.

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
