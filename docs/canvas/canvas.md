# Canvas specification

## Purpose

Canvas is an isolated, unlimited React Flow workspace for organizing
characters, locations, audio, and timelines. It is separate from the editor
timeline and does not create default relationships between nodes.

## Initial state

The original Canvas contains exactly four top-level nodes:

1. One non-deletable Canvas Configuration node.
2. One Character.
3. One Location.
4. One Timeline.

It contains no inter-node connections on creation. Character and Location
contain their required default Image children.

Each Character and Location always has at least one child. The initial Canvas
and every newly created Character or Location receive one default Image. A
parent with only one child cannot lose that child; adding a Sheet first allows
the original Image to be deleted.

## Persistence

Canvas state is stored under the project `canvas` field. Canvas changes are
auto-saved after a short idle debounce. Auto-save persists the complete
normalized Canvas document, including configuration, nodes, parent
relationships, properties, sizes, layouts, and edges. Auto-save is scoped to
the current project, does not write when no project is open, and serializes
writes so changes cannot overlap project saves. The saved document is restored
when the project is reopened. A project without a Canvas field uses the
initial state above.

## Node add and edit modes

- Every node has an Add mode and an Edit mode.
- Add mode opens when a new node is created; Edit mode opens from the node
  toolbar. Both modes show the node at an expanded size with its real editable
  state available.
- Add and Edit mode are in-node forms, not sliding panels. Each form has a
  close X in the top-right corner and a Save button in the bottom-right
  corner. Closing discards unsaved form changes; Save commits them to the node.
- Every node has a Prompt property. Prompt is persisted with the node and is
  available in both Add and Edit mode.
- Canvas Configuration has distinct Character Image, Character Sheet, Location
  Image, and Location Sheet workflow properties populated from the available
  workflow catalogs.
- Image Add mode offers picking an image from Comfy, uploading one image, or
  generating one from a prompt. The selected image action is persisted as the
  Image workflow mode.
- Image generation persists seed, standard aspect ratio, and HD/FHD/2K/4K
  resolution selections, and uses the selected Canvas Configuration workflow.
- Canvas image generation jobs are surfaced in a stacked global notification
  list with a dismiss-completed action.
- Character Sheets use Prompt and Seed plus same-Character Image connections;
  the editor shows every sibling Image with an in-place connected/disconnected
  toggle. Canvas Configuration stores the Character sheet workflow, defaulting
  to `image-edit`.

## Global rules

- Nodes are defined by the Canvas schema and each node type has its own MD
  specification.
- Each node owns its accent color; the Canvas must not assign a shared color.
- Connections are opt-in and must satisfy the source/target handle types.
- A node may only be parented to a compatible parent defined by the child spec.
- A child dragged outside its current compatible parent remains inside that
  parent at its previous valid position.
- There is no overflow navigation or pagination yet.
- The Canvas Configuration node is the persisted owner of these global rules
  and cannot be removed.
- The Canvas Configuration node currently has no editable rule options. Global
  rules are fixed by this specification and the Canvas schema.

## Node interaction

- Each node has a toolbar hidden by default. A collapsed child has no floating
  toolbar; its parent title bar remains available to expand the gallery.
- The toolbar appears on node hover.
- Every node title bar shows the block type and title as `Type - Title`.
- Edit opens a compact property editor that expands from the node's left edge
  toward the right, over the existing gallery content. Save or cancel closes
  the overlay and reveals the gallery again.
- Container nodes expose `+` in the toolbar. The menu only lists their
  compatible child types.
- Adding a child through `+` creates the child with that container as its
  parent.
- Container title bars place the expand/collapse-all icon on the right side of
  the title, next to the container label.
- Child blocks start in normal gallery mode, showing their editable content.
  The parent title bar owns the expand/collapse-all control.
- Compact parent preview shows only the first child of the first gallery row;
  other children remain persisted and are revealed when the parent expands. The
  preview child renders expanded and fills the parent's usable inner area, but
  its floating toolbar and handles remain hidden until the parent expands.
- A parent with no children shows an Empty icon.
- Expanding a parent shows every child in normal mode at once, including its
  toolbar, connections, and editable properties. Collapsing the parent returns
  every child to compact mode.

## Container layout

- Containers always resize to contain all their children.
- Children are laid out in a gallery.
- Children are grouped by block type. Landscape galleries use one horizontal
  row per child type; portrait galleries use one vertical column per child
  type. Freeform galleries let children be positioned independently.
- Gallery layout can be `landscape` (horizontal), `portrait` (vertical), or
  `freeform`.
- The toolbar layout icon cycles through horizontal, vertical, and freeform
  modes.
- In freeform mode, children remain draggable within their parent. All three
  layouts use the same small border gap around children. The parent expands
  when a child is moved beyond an edge and shrinks when children move closer
  together.
- Navigation for galleries that become too large is explicitly deferred.
- Every node is resizable with a block-defined minimum size.
- Title bars are compact and do not consume unnecessary gallery space.
- Resizing one child applies the resulting normal size only to sibling children
  of the same block type in that parent.
- Resizing a compact child expands same-type siblings before applying the
  shared normal size; other child types keep their existing size and mode.
- A container's minimum size is always recalculated from its children.
- Parent resize is clamped to that recalculated grouped-gallery minimum so
  child rows/columns never overlap.

## Current containment map

| Parent | Allowed children |
| --- | --- |
| Character | Image, Character Sheet |
| Image | none; prompt is an Image property |
| Location | Image, Location Sheet |
| Timeline | Scene |
| Scene | Shot |

## Current connections

- Shot accepts one Location connection.
- Shot accepts multiple Character connections.
- Shot previews use the first Image child of each connected Location or
  Character, and its card displays those Used elements beside the Shot prompt.
- Images connect to Sheets only when both belong to the same Character or
  Location parent. A Sheet accepts many Images; an Image accepts one Sheet.
- Edges are hidden until a node is clicked. Clicking a Sheet reveals all of
  its Image edges; clicking an Image reveals its single Sheet edge. Clicking
  the Canvas background hides the edges again.
- Every visible connection has a scissors action at its midpoint. Activating
  it removes that connection only, regardless of the connected block types.
- Other connections must be added to the schema before the UI exposes them.

## Spec-driven implementation rules

This file is the canonical Canvas contract. Read it together with
`requirements.md` and the relevant file under `blocks/` before changing Canvas
behavior. The app must be reconstructible from these Markdown files alone.

For every Canvas change:

1. Update the relevant Canvas MD specification first.
2. Update `src/services/canvasSchema.js`.
3. Update the isolated Canvas UI in `src/components/CanvasWorkspace.jsx`.
4. Add or update focused assertions in `tests/canvasSchema.test.js`.
5. Run `git diff --check`, the focused schema tests, and a production build.

Do not introduce behavior absent from the MD specifications or remove a
documented rule to simplify implementation.

The mandatory Canvas Configuration node is always present and non-deletable.
It has no editable rule options unless explicitly requested and documented
first. Canvas remains isolated from unrelated editor state. Persistence is
automatic: Canvas edits are debounced and store the normalized document in the
project's `canvas` field, and project open restores it with the Configuration
node guaranteed.

The following invariants must remain enforced by both schema and UI:

- Typed containment, compatible drag/drop, no default edges, and per-block
  colors.
- Hover-only toolbars, expanded child cards by default, compact galleries after
  collapse, parent-level expand/collapse, minimum sizing, and sibling-size
  propagation during resize.
- Grouped child galleries: one row per type in landscape and one column per
  type in portrait. Parent resize uses the complete grouped-gallery minimum.
- Compact parent previews show only the first child of the first row, or an
  Empty icon when there are no children; hidden children remain persisted.
- Image prompt is a property, never a Canvas node. Images are compatible only
  inside Character or Location.
- Image-to-Sheet links remain same-parent many-images-to-one-sheet links. Links
  stay hidden until node click and background click clears them.
- Delete and Backspace require confirmation before removing selected nodes. The
  fixed Configuration node is never removed; deleting a container removes its
  descendants and connected edges.
