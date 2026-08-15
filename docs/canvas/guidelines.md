# Canvas implementation guidelines

These guidelines govern all Canvas work in Velorn.

## Canonical source

The Canvas product is specified entirely by the Markdown files in this
directory. Read these files before making a change:

1. `requirements.md` for the complete acceptance checklist.
2. `canvas.md` for document-level behavior and global rules.
3. The relevant file under `blocks/` for the block being changed.

The MD files are the source of truth. Source code, tests, and runtime behavior
must implement them. A requirement is not considered implemented if it exists
only in chat, memory, or source code.

## Required change order

For every behavior change:

1. Update the relevant Canvas MD specification.
2. Update `src/services/canvasSchema.js` so the rule is represented in the
   schema.
3. Update the isolated Canvas UI in `src/components/CanvasWorkspace.jsx`.
4. Add or update focused assertions in `tests/canvasSchema.test.js`.
5. Run `git diff --check`, the focused tests, and the production build.

Do not silently introduce undocumented behavior, remove a documented rule, or
change a block definition in the UI without changing its MD specification.

## Non-negotiable invariants

- Canvas remains isolated and React Flow-based.
- The mandatory Canvas Configuration node is always present and cannot be
  deleted.
- The Canvas Configuration node has no editable rule options unless they are
  explicitly added to the Canvas MD specifications first.
- The initial document has one Configuration, Character, Location, and
  Timeline, with one default Image in Character and Location and no edges.
- Character and Location must never be left without a child. New containers get
  a default Image, and deletion must preserve one child unless the container
  itself is being deleted.
- Prompt is a property on every node, never a standalone node.
- Parent compatibility is enforced by both schema and drag/drop behavior.
- Node colors come from their block definitions.
- Toolbars are hidden until hover; collapsed child cards expose no floating
  toolbar. Add and Edit are expanded in-node modes with a top-right close
  control and bottom-right Save button; closing discards the draft.
- Every node has a persisted Prompt property. Image Add mode exposes Comfy
  selection, single-image upload, and prompt generation choices.
- Child cards are expanded by default; parent title bars control
  expand/collapse-all.
- Compact parent previews show only the first child of the first row. Empty
  parents show an Empty icon; the visible preview child fills the parent's
  usable inner area without exposing its toolbar or handles; hidden children
  remain persisted.
- Keep title bars compact so they do not dominate the node's usable area.
- Child galleries stay grouped by block type: rows in landscape, columns in
  portrait, and independently positioned cards in freeform mode.
- Links stay hidden until a node is clicked and are cleared by a background
  click. Image-to-Sheet links stay within one parent, with many Images to one
  Sheet and at most one Sheet per Image.
- Parent galleries resize around their children and never clip them.
- Parent resize must use the complete grouped-gallery minimum, preserving
  spacing between every type row or column.
- All three layouts use the same small border gap. Freeform parents recalculate
  their position and size when children move, expanding at the outer boundary
  and shrinking when children move inward.
- Every node has a minimum size. Resizing one child applies its normal size only
  to same-type siblings in that parent.
- A resize gesture on a compact child must expand same-type siblings before
  applying the shared size; other child types retain their own size and mode.
- No default inter-node connections are created.
- Canvas persistence is automatic: debounced Canvas edits write the complete
  normalized Canvas document to the current project, and project reopen must
  restore it.
- Delete and Backspace require confirmation before removing selected nodes;
  the fixed Configuration node is never removed, and deleting a container must
  remove its descendants and connected edges.
