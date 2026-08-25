# Velorn v0.3.29

Velorn v0.3.29 lets local MCP agents search and import Pexels stock media through the same project-owned workflow as the visible Stock tab, and keeps transitions attached when an edit is moved as a group.

## New

- **Pexels search for MCP agents.** Agents can search Pexels photos or videos using the API key already saved in Velorn Settings, including orientation and pagination controls.
- **Safe bulk stock import.** Agents can preview and import selected Pexels result IDs or the first non-duplicate results into an organized project folder. Imported media becomes project-owned and keeps Pexels source and creator provenance.
- **Visible Stock-tab handoff.** Agent searches open the matching results in Velorn's Stock tab by default, so creators can review the same media before importing or placing it on a timeline.
- **Composable timeline placement.** Stock import remains separate from the existing preview-first timeline placement tools, keeping downloads and edit decisions independently reviewable.

## Fixed

- **Transitions follow group moves.** When both clips attached to a between-clip transition move together by the same amount, the transition timing now moves with them instead of remaining behind at its old timeline position.

## Notes

- Pexels features require a Pexels API key in `Settings > Stock (Pexels)`.
- Restart Velorn and reconnect an MCP client after updating so the client refreshes the available tool list.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, M4, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.
