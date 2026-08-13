# Agent Notes

- The product/app is called Velorn. Do not refer to it as ComfyStudio in user-facing text, MCP metadata, docs, or chat.
- `comfystudio` may still appear as a legacy package name, protocol/file-extension namespace, bridge identifier, repository URL, or backward-compatible MCP alias. Treat those as internal compatibility identifiers only.
- Read `docs/AI_PROJECT_CONTEXT.md` before substantial implementation work.
- Read `docs/AI_CURRENT_HANDOFF.md` for the current branch, migration, and verification state.
- Read `docs/AI_RELEASE_HANDOFF.md` before commits, tags, releases, or GitHub Actions work.
- Velorn is a creator-facing desktop video editor. Preserve simple guided workflows; do not turn routine product surfaces into ComfyUI-style node configuration.
- Keep project files portable. Store project-owned media paths relative to the project when possible and preserve legacy project compatibility.
- Treat generation and editing as separate layers: editing, captions, and export must not require ComfyUI unless the specific feature is explicitly a ComfyUI workflow.
- Agent write actions should inspect first, preview when supported, and use Velorn's existing undo/checkpoint paths.
- Keep changes narrowly scoped and test risky behavior at the renderer, Electron IPC, and packaged-platform boundaries it touches.
