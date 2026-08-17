# Canvas acceptance requirements

This is the consolidated, implementation-ready contract for the isolated
Canvas area. Every item below must remain true when the Canvas is changed.

## Document

- Canvas is an isolated, unlimited React Flow workspace.
- A Canvas has one mandatory Canvas Configuration node.
- The Canvas Configuration node is always present and can never be deleted.
- The initial Canvas contains exactly one Canvas Configuration, one Character,
  one Location, and one Timeline.
- The initial Canvas contains no inter-node connections. Character and Location
  contain their required default Image children.
- The initial Character and Location each contain one default Image child.
- Every Character and Location always retains at least one child. A new one
  receives a default Image; adding a Sheet first permits deleting that Image.
- The Canvas Configuration node owns global Canvas rules.
- The Canvas Configuration node has no editable rule toggles or node/edge
  limits unless explicitly added to this specification.
- Every node has a persisted Prompt property.
- Every node supports Add mode and Edit mode as expanded in-node forms. Each
  mode has a top-right close control and a bottom-right Save button.
- Canvas Configuration exposes a persisted Image generation workflow dropdown
  containing all available Text to Image workflows.
- Image Add mode offers Comfy image selection, single-image upload, and prompt
  generation actions.
- Image nodes persist seed, aspect ratio, and HD/FHD/2K/4K resolution. Generate
  Image queues the configured Text to Image workflow with those settings.
- Queued Canvas image generations appear in a stacked top-right notification
  list, with a command to dismiss completed and failed jobs.
- Character Sheets persist Prompt and Seed only. Their same-Character Images
  are listed in the sheet editor and can be connected or disconnected in place.
- Canvas Configuration exposes a persisted Character sheet workflow dropdown,
  defaulting to `image-edit` and listing image workflows.
- Canvas Configuration separately persists Character Image, Character Sheet,
  Location Image, and Location Sheet workflows.
- Location Sheets use the same Prompt, Seed, connected sibling-image, preview,
  and generation behavior as Character Sheets.
- There are no default connections between nodes.
- Canvas changes are persisted automatically after a short idle debounce.
  Auto-saving writes the complete normalized Canvas document into the current
  Velorn project file and never writes while there is no current project.
- Canvas auto-save writes are serialized; a later change is saved after an
  earlier auto-save finishes rather than starting overlapping project writes.
- Opening a project restores its saved Canvas document. Projects without a
  saved Canvas restore the initial Canvas state.

## Blocks and styling

- Every block has its own definition, color, allowed parents, properties,
  minimum size, and default size in the block specifications.
- Repeated descriptive helper text is not rendered inside node cards.
- Every node has a hidden-on-idle toolbar shown on hover.
- Every node title bar shows the block type and title as `Type - Title`.
- Every node has an edit action with a compact in-node property editor. The
  editor expands left-to-right over the node and existing child cards, then
  collapses back on Save or cancel.
- Every node is resizable and has a minimum size.
- A parent can never be smaller than the space required by its children.
- Resizing a parent is clamped against the complete grouped-gallery minimum;
  every child-type row or column retains its required spacing and cannot
  overlap another group.
- Resizing one child sets the same normal size only for same-type children of
  that parent.
- Resizing any compact child expands the parent gallery into normal mode and
  applies the resulting size to same-type siblings, so other child types keep
  their own dimensions and mode.

## Containment

- Character contains Image and Character Sheet.
- Location contains Image and Location Sheet.
- Timeline contains Scene.
- Scene contains Shot.
- Image, Character Sheet, Location Sheet, Scene, and Shot cannot exist at the top
  level.
- A Shot card shows its connected Location and Characters on the Used elements
  side, using each source's first Image child as its preview. Its other side
  shows the Shot prompt.
- Adding a Scene is immediate and opens no Add form. Scene title editing is
  available through double-click.
- Timeline, Character Sheet, and Location Sheet do not expose a layout icon;
  Timeline uses vertical Scene layout for now.
- Character and Location use portrait galleries with a minimum gap between
  columns. Their columns are Images, Sheets, and Prompt. Shot Used elements
  are labeled Location and Characters, beside its Prompt column.
- Every block with a Prompt also persists a Seed. Shot editing uses two
  columns: Shot properties on the left and Used elements on the right, with
  separate Location and Characters sections. Shot duration_start and
  duration_end are editable in milliseconds.
- A child can only be dragged into a compatible parent.
- An invalid drag leaves the child in its previous valid parent and position.

## Child presentation

- Children are placed inside their parent in a gallery.
- Children are grouped by block type within the gallery. In landscape mode,
  each block type occupies its own horizontal row; in portrait mode, each
  block type occupies its own vertical column. Freeform mode allows children
  to be positioned independently.
- A new child is expanded by default.
- In compact parent preview mode, only the first element of the first gallery
  row is shown. Other children remain persisted but are hidden from the preview.
- The visible compact-parent preview child is expanded to fill the parent's
  usable inner area, while its toolbar and handles remain hidden.
- An empty parent shows an Empty icon instead of an empty child gallery.
- Compact children show only a minimal identity representation; Image shows no
  visible text.
- The parent title bar has an expand/collapse-all icon on its right side.
- Expanding a parent changes all its children to normal mode.
- Normal mode exposes the child toolbar, connections, and property editor.
- Collapsed child cards do not expose the floating toolbar.
- Collapsing a parent returns all its children to compact mode.
- The parent title bar also exposes `+` for compatible child types and a
  horizontal/vertical/freeform gallery layout toggle.
- In freeform mode, children can be moved within the parent. The parent keeps
  the same small border gap used by horizontal and vertical layouts, stretches
  when a child crosses a current boundary, and shrinks when children move
  inward.
- The parent always grows to contain all child cards; overflow navigation is
  deferred.
- Title bars remain compact relative to the usable node area.

## Add and edit forms

- Add mode opens automatically for newly created nodes.
- Edit mode opens from the node toolbar.
- Both modes expand the node itself and expose its real editable state; they
  do not use a sliding property panel.
- Close discards unsaved form changes. Save commits the form to the node.

## Image

- Prompt is an editable property on every node, never a standalone node.
- Image may only be inside Character or Location.
- A new Image can choose `Create from prompt` or `Prompt an image` in its
  property editor.
- Image cards do not render repeated descriptive text in their body; the
  title bar still shows `Image - Title` in compact and normal modes.
- Images can connect to Sheets within the same Character or Location parent.
- A Sheet accepts multiple Image connections, while an Image can connect to at
  most one Sheet.
- Canvas links are hidden by default and are revealed when a node is clicked.
  Clicking a Sheet reveals all connected Images; clicking an Image reveals its
  one connected Sheet. Clicking the Canvas background hides the links again.

## Connections

- Connections are opt-in.
- Typed handles are enforced by the Canvas Configuration rules.
- Every visible connection exposes a midpoint scissors action that deletes
  only that connection.
- Scene has one Location input and multiple Character inputs.
- Dangling connections are disabled by default.

## Deletion

- Pressing Delete or Backspace on selected nodes asks for confirmation before
  removing them.
- The mandatory Canvas Configuration node cannot be deleted.
- Deleting a container also removes its contained child nodes and their edges.
