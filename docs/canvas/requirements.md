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
- Character Sheet can only be added after its Character has at least one Image
  with associated media. Location Sheet has the equivalent Location Image
  prerequisite. An empty default Image node does not satisfy the requirement;
  existing Sheets are preserved.
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
  minimum size, default size, and visual family in the block specifications.
- Nodes use five visual families that remain distinguishable without color:
  Organization (Timeline and Scene), Production (Shot), Subject (Character and
  Location), Asset (Image, Audio, and Sheets), and System (Canvas
  Configuration).
- Every node has a colored left identity rail, a small uppercase type label, a
  separate larger title, and a compact metadata strip. Type and title are not
  combined into one `Type - Title` string.
- Organization nodes are low-elevation nested frames; Scene remains visually
  quieter than its Shot children. Production nodes have the strongest card
  emphasis. Subject nodes are media-forward, Asset nodes use type-specific
  silhouettes, and System nodes use a utility-panel treatment.
- Character uses portrait-oriented identity cues and Location uses
  landscape-oriented environment cues. Image is an edge-to-edge media tile,
  Sheets use a stacked-page treatment, Audio uses a waveform treatment, Shot
  uses a cinematic timing treatment, and Canvas Configuration uses a subtle
  technical pattern.
- Repeated descriptive helper text is not rendered inside node cards.
- Every node has a hidden-on-idle toolbar shown on hover.
- The toolbar is one translucent shelf attached across the top node boundary.
  Quick properties and node actions are visually separated within that shelf.
  Deletable nodes expose a toolbar Delete action using the same confirmation
  and containment safeguards as Delete or Backspace.
- Selected nodes use an accent ring and stronger elevation. Dragged nodes lift
  from the Canvas. Valid and invalid drop containers use clear green and red
  destination rings respectively.
- Connection handles reveal their typed labels on hover or selection. Visible
  connection lines retain a midpoint removal action.
- Prompt panels use a soft neutral paper surface, strong divider, a block-
  specific Prompt header plus a `Creative direction` cue, and bottom fade
  when text overflows. Child regions remain dark,
  inset, and independently labeled; missing prompt content stays blank.
- Metadata is read-only on the card. Shot shows duration and key creative
  settings; Image shows aspect ratio, resolution, and seed; containers show
  child counts; Sheets show reference count; other nodes show concise relevant
  state. Editing remains in Edit mode or the hover quick toolbar.
- Every node has an edit action with a compact in-node property editor. The
  editor expands left-to-right over the node and existing child cards, then
  collapses back on Save or cancel.
- Every node is resizable and has a minimum size.
- A parent can never be smaller than the space required by its children.
- Nested container sizing is recursive: Scene includes the complete vertical
  size of every Shot, and Timeline includes the resulting complete size of
  every Scene. No Shot may render beyond its Scene boundary.
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
- Timeline, Scene, Character Sheet, and Location Sheet do not expose a layout
  icon. Timeline lists Scenes vertically and Scene lists Shots vertically.
- Character and Location use portrait galleries with a minimum gap between
  columns. Their first column is the parent-owned Character Prompt or Location
  Prompt, followed by explicitly labeled Child nodes columns for Images and
  Sheets. Shot also places its parent-owned Shot Prompt first, followed by Used
  elements.
- Horizontal resizing of Character or Location keeps its Prompt column at a
  fixed 280px width. Additional width is divided evenly across the Image and
  Sheet child columns, and their child cards expand with those columns.
- Image, Character Sheet, and Location Sheet child cards show only their
  associated image in normal gallery view. Their Prompt and Seed remain
  available through Edit and quick controls but do not consume gallery space.
- Default Image titles are parent-aware: Character children use `Character
  image` and Location children use `Location image`. Existing default
  `Character image` titles under Location migrate automatically; custom titles
  are preserved.
- Every block with a Prompt also persists a Seed. Shot editing uses two
  columns: Shot properties on the left and Used elements on the right, with
  separate Location and Characters sections. Shot duration_start and
  duration_end are editable as comma-separated millisecond values such as
  `3,250` (3 seconds and 250 milliseconds) and stored internally as milliseconds.
- Timeline stores Video style, Temporal/world effect, and Camera flow preset as
  creative defaults. New Shots snapshot those defaults; existing Shots can
  override them independently.
- Shot performance uses one mode: performance, instrumental, visual_only, or
  b_roll. Singing and dialogue are timed cue types on Character-in-Shot
  assignments, with absolute timeline millisecond start/end offsets and
  optional text. Cue ranges are clamped to the Shot duration_start/end.
- A child can only be dragged into a compatible parent.
- An invalid drag leaves the child in its previous valid parent and position.

## Child presentation

- Children are placed inside their parent in a gallery with a visible 24px gap
  between repeated elements and a 40px gap between grouped columns.
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
  header still shows the Image type label and its title as separate levels in
  compact and normal modes.
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
