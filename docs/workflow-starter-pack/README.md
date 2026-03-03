# Workflow Starter Pack

This folder defines the "starter pack" artifacts that ComfyUI users can download to prepare their local setup before using Generate.

## Why this exists

ComfyStudio executes API-oriented workflow JSON files internally. Advanced ComfyUI users often want a parallel setup path where they can inspect workflows directly in ComfyUI, install missing custom nodes/models, and validate their environment.

The starter pack is the bridge for that setup flow.

## What is generated here

Run:

```bash
npm run starter-pack:build
```

This generates:

- `starter-pack.manifest.json` - machine-readable summary of built-in workflows, tiers, runtime mode, and dependency requirements.
- `INDEX.md` - human-readable index of workflows.
- `workflows/<workflow-id>.md` - one dependency/setup checklist per workflow.

## Current status

- The generated files are ready now.
- `setupWorkflowFile` fields are marked as `pending` by default. Replace those with real ComfyUI-importable workflow files as they are created.

## Maintenance rules

When adding or changing workflows:

1. Update `src/config/workflowRegistry.js`.
2. Update `src/config/workflowDependencyPacks.js`.
3. Run `npm run starter-pack:build`.
4. Add/update the ComfyUI-importable setup workflow JSON files for any new workflows.
5. Publish this folder (or a zip of it) to GitHub Releases for users.

## Publishing recommendation

- Publish a versioned zip (for example `comfystudio-workflow-starter-pack-vX.Y.Z.zip`).
- Include this folder as-is so users get both machine-readable (`starter-pack.manifest.json`) and human-readable (`INDEX.md`, per-workflow markdown) guidance.
