# Current AI Handoff

Last updated: 2026-08-12

This is the live state for moving Velorn development from the old Windows checkout to a clean repository state that can be cloned on Ubuntu.

## Clean Migration Branch

- Worktree: `C:\Users\papa\Documents\coding_projects\general\velorn-migration-cleanup`
- Branch: `codex/migration-cleanup`
- Base: `origin/main` at `0ca5db5` (`v0.3.25`)
- This branch is intentionally separate from the old dirty `main` checkout.

Recovered, tested, and committed changes:

1. `592cf30` - Add a Settings toggle that hides the Comfy.org credit balance and stops its polling while hidden.
2. `fb09ce6` - Refresh paused text/shape/caption rasters when timeline or asset state changes.
3. `bcea1de` - Recognize namespaced `model.prompt` inputs in imported workflows, with MiniMax H3 regression coverage.

The production renderer build passed after every feature. Electron main/preload syntax checks pass. All ten existing `package.json` test scripts plus the two recovered-feature suites pass: 82 tests total, 0 failures.

## Preserved Windows Checkout

The original checkout remains untouched at:

`C:\Users\papa\Documents\coding_projects\general\comfyui_editing`

At migration start it was on local `main` at `6b450ce` (`v0.3.23`), three commits behind `origin/main`, with 20 modified tracked files and many untracked files. It contains useful fixes mixed with obsolete experiments, generated review media, drafts, and screenshots.

A safety inventory exists at:

`C:\Users\papa\Documents\coding_projects\general\velorn-migration-backup-2026-08-12`

It contains:

- `tracked-changes.patch`
- `git-status.txt`
- `untracked-files.txt`
- `recent-history.txt`

Do not reset, pull, delete, or repurpose the old checkout until the maintainer has verified the clean branch and explicitly approves cleanup.

## Deliberate Decisions

- The old ComfyUI-based RTX upscale implementation was not migrated. Standalone NVIDIA RTX 4K export already shipped upstream in v0.3.24.
- My Workflows MCP support was not recopied because it already shipped upstream in v0.3.25.
- Manual title-bar/window dragging and unload changes were reviewed but not migrated. They are platform-sensitive, mixed with unrelated work, and lack a clear verification record. They remain recoverable in the old checkout and backup patch.
- Generated timeline contact sheets, output media, mockups, marketing drafts, and old handoff notes were not brought into the clean branch.
- No old worktree has been deleted.

## Remaining Work

1. Launch `npm run electron:dev` for maintainer UI verification of:
   - Settings credit-balance toggle.
   - Immediate paused text-clip preview updates.
   - A custom imported workflow using `model.prompt` if a suitable graph is available.
2. Review the final branch diff and commit these context documents.
3. Push or merge only after the maintainer approves the clean result.
4. On Ubuntu, clone the repository fresh after the intended branch is merged/pushed; do not copy `node_modules` or the Windows `.codex` directory.
5. Keep Windows available for Windows packaging, Azure signing behavior, and NVIDIA RTX export testing.

## Ubuntu First Session

After cloning the intended Git branch on Ubuntu:

```bash
npm ci
npm run build
npm run electron:dev
```

Start a new Codex task with:

> Read AGENTS.md, docs/AI_PROJECT_CONTEXT.md, docs/AI_CURRENT_HANDOFF.md, and docs/AI_RELEASE_HANDOFF.md. Inspect git status and recent history, then summarize the product, architecture, current branch state, and next safe step before changing files.

Local projects, ComfyUI models, credentials, signing secrets, generated media, and machine-specific settings are not repository context and must be migrated separately and deliberately.
