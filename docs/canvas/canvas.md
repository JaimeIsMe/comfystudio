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
  rules are fixed by this specification and the Canvas schema. It does expose
  one project-level creative integration: Canvas reads the agent selected in
  Velorn application settings. The agent profile and the Canvas selection are
  application configuration; the Canvas document stores no agent ID or
  credentials.

## LLM agent selection

Velorn Settings > LLM Agents manages named agent profiles using the
OpenAI-compatible model and generation contract. Profiles contain a provider
label, base URL, optional model override, optional API key, endpoint mode, and
enabled state. The default model is discovered from the server's `/models`
response rather than hard-coded. In auto endpoint mode, Velorn tries the
Responses API first and falls back to Chat Completions only when the provider
does not support Responses. LM Studio and Codex/OpenAI-compatible profiles are
available out of the box, and additional profiles can point to any compatible
server.

Canvas reads the profile selected in Settings at action time; changing or
deleting a profile never changes the project document. If the selected profile
is unavailable, Canvas actions must report that configuration problem rather
than silently using a different agent.

## Canvas Chat

The left Canvas menu has a visible Canvas agent card. Its **Bring agent to
Canvas** action opens Canvas Chat with the agent selected in Settings; once
active, the same action becomes **Open agent chat**. Canvas Chat is an
ephemeral, project-local conversation: it is never saved in the Canvas
document or project file. Its header has a Discard action that clears the
current conversation, removes the agent from the Canvas, and closes the panel
at any time.

Every request uses the LLM selected for Canvas in Settings and receives a
fresh, read-only Canvas context. That context includes the normalized node and
edge structure, node properties that describe the production plan, containment
and connection rules, and every Canvas block definition/capability. It does
not include API keys or local asset URLs.

The chat also receives live Velorn MCP context: the loopback server status,
project/timeline summary published to MCP, and the complete MCP tool catalogue
with descriptions and input schemas. This lets it reason about what Velorn can
inspect or do alongside the Canvas. Chat must describe and plan write-capable
MCP work for user approval; it does not autonomously invoke MCP actions.

## Node interaction

- Each node has a toolbar hidden by default. A collapsed child has no floating
  toolbar; its parent title bar remains available to expand the gallery.
- The toolbar appears on node hover.
- Every node header separates an uppercase block type label from the larger
  node title and a read-only metadata strip.
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
- Container sizing is recursive. A Scene's resolved size includes every Shot;
  a Timeline's resolved size includes each fully resolved Scene. Nested child
  cards must never render outside their parent boundary.
- Children are laid out in a gallery.
- Children are grouped by block type. Landscape galleries use one horizontal
  row per child type; portrait galleries use one vertical column per child
  type. Freeform galleries let children be positioned independently.
- Gallery layout can be `landscape` (horizontal), `portrait` (vertical), or
  `freeform`.
- The toolbar layout icon cycles through horizontal, vertical, and freeform
  modes.
- In freeform mode, children remain draggable within their parent. All three
  layouts use a consistent 24px gap around repeated children and a 40px gap
  between grouped columns. Each child column has a tinted bordered region and
  type header; the Prompt column has a separate white panel. The parent expands
  when a child is moved beyond an edge and shrinks when children move closer
  together.
- Navigation for galleries that become too large is explicitly deferred.
- Every node is resizable with a block-defined minimum size.
- Title bars are compact and do not consume unnecessary gallery space.
- Timeline and Scene render as nested organization frames with a visible
  hierarchy spine. Shot children render as raised production cards so Scene
  ownership is clear even when connection edges are hidden.
- Timeline and Scene always use portrait layout. They do not expose a layout
  toggle: Scenes remain a vertical Timeline list and Shots remain a vertical
  Scene list.
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
- Timeline creative defaults for video style, temporal/world effect, and
  camera flow are copied into newly created Shots and can be overridden there.
- Shot performance uses one mode (`performance`, `instrumental`, `visual_only`,
  or `b_roll`) plus explicit timed cues on Character-in-Shot assignments;
  singing and dialogue are cue types.
- Images connect to Sheets only when both belong to the same Character or
  Location parent. A Sheet accepts many Images; an Image accepts one Sheet.
- Edges are hidden until a node is clicked. Clicking a Sheet reveals all of
  its Image edges; clicking an Image reveals its single Sheet edge. Clicking
  the Canvas background hides the edges again.
- Every visible connection has a scissors action at its midpoint. Activating
  it removes that connection only, regardless of the connected block types.
- Other connections must be added to the schema before the UI exposes them.

## Visual language

The Canvas uses five schema-owned visual families:

| Family | Blocks | Card language |
| --- | --- | --- |
| Organization | Timeline, Scene | Broad nested frame, low elevation, hierarchy spine |
| Production | Shot | High-emphasis cinematic card with timing and creative-state chips |
| Subject | Character, Location | Media-forward identity/world container |
| Asset | Image, Audio, Character Sheet, Location Sheet | Compact type-specific media or document tile |
| System | Canvas Configuration | Utility panel with a subtle technical pattern |

All nodes have a left accent rail, separated type and title typography, and
compact read-only metadata chips. Color reinforces identity but is never the
only distinction. The node shell, interior layout, elevation, and content
silhouette must also communicate its role.

Prompt content uses a soft neutral paper panel rather than the same dark child
surface. Character and Location place their parent-owned Prompt first, then
their child groups. Shot places Shot Prompt first and Used elements second.
Prompt headers name the owning block and include a `Creative direction` cue; child
group headers include a `Child nodes` cue. Child groups use dark inset regions
with explicit headers. Prompt and child panels have matching header anatomy, a
strong divider, and clear bounds.
Overflowing prompt text fades at the bottom; blank content remains blank.

When Character or Location grows horizontally, its Prompt column keeps the
same fixed 280px width. Extra width is distributed evenly among the visible child
type columns, and child cards fill their assigned column width. Prompt does not
absorb horizontal resize space.

Image and Sheet children are visual references, so their normal gallery cards
are media-only. An Image fills its card with the selected source. A Character
Sheet or Location Sheet fills its card with the generated sheet image and uses
a restrained stacked-document placeholder until one exists. Their Prompt and
Seed remain editable but are not repeated in the gallery.

Hover reveals a single translucent toolbar shelf attached to the top edge.
Quick properties appear on the left side and node actions on the right.
Deletable nodes include a Delete action that uses the existing confirmation
and descendant cleanup path.
Selection adds an accent ring, dragging raises the card, and compatible or
incompatible drop containers receive green or red destination rings. Typed
connection labels appear next to handles on hover or selection.

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
