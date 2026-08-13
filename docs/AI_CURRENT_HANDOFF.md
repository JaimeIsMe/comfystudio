# Current AI Handoff

Last updated: 2026-08-12

This is the live state for moving Velorn development from the old Windows checkout to a clean repository state that can be cloned on Ubuntu.

## Merged Migration

- Worktree: `C:\Users\papa\Documents\coding_projects\general\velorn-migration-cleanup`
- PR: `#99` - merged into `main` on 2026-08-12
- Merge commit: `c4be213`
- Latest release remains `v0.3.25`; the recovered changes are on `main` but have not been released yet.
- This worktree remains intentionally separate from the old dirty `main` checkout.

Recovered, tested, and merged changes:

1. `592cf30` - Add a Settings toggle that hides the Comfy.org credit balance and stops its polling while hidden.
2. `fb09ce6` - Refresh paused text/shape/caption rasters when timeline or asset state changes.
3. `bcea1de` - Recognize namespaced `model.prompt` inputs in imported workflows, with MiniMax H3 regression coverage.

The production renderer build passed after every feature. Electron main/preload syntax checks pass. All ten existing `package.json` test scripts plus the two recovered-feature suites pass: 82 tests total, 0 failures.

The maintainer also verified all three user-facing behaviors in the Electron app before PR #99 was merged.

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
- No dirty old worktree has been deleted.

Clean, fully superseded worktrees removed on 2026-08-12:

- `comfystudio-license-gplv3`
- `velorn-long-source-export`
- `velorn-my-workflows-mcp`
- `velorn-native-rtx-upscale`

Old worktrees retained because they contain uncommitted or unique work:

- `comfystudio-joao-16gb-preview` - modified project loading plus review screenshots and a long detached feature history.
- `comfystudio-pr49` - one modified Generate file on a detached PR test.
- `comfystudio-pr49-local-test` - staged and unstaged ASR/music-video test changes.
- `comfyui_pr50_merge_check` - staged custom-workflow/media changes, two untracked covers, and two commits not represented in `main`.
- `velorn-infinite-canvas` - uncommitted canvas UI, schema, store, and test work.

Do not delete those retained worktrees without a separate review and explicit maintainer approval.

## Remaining Work

1. On Ubuntu, clone `main` fresh; do not copy `node_modules` or the Windows `.codex` directory.
2. Run the Ubuntu startup commands below and verify Velorn opens.
3. Keep Windows available for Windows packaging, Azure signing behavior, and NVIDIA RTX export testing.
4. Review retained worktrees individually before any further deletion.

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
