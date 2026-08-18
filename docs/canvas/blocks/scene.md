# Scene block specification

## Role

Scene is an organizing container for an ordered group of Shots inside a
Timeline. It does not own production connections; those belong to its Shots.
Adding a Scene is immediate and does not open an Add form. Double-click a
Scene when its title needs editing.

## Color

The Scene block owns the accent color `#38bdf8`.

## Parent constraint

Scene may only be placed inside Timeline.

## Children

Scene contains any number of Shot nodes in a vertical gallery. Shots can be
dragged between Scenes and reordered by dragging them above or below another
Shot. Their labels are assigned automatically as `Shot 1`, `Shot 2`, and so
on within each Scene.

## Properties

- Prompt

Scene is expanded by default. When its parent is collapsed, it has no floating
toolbar. Its minimum size is 150x100 and its default normal size is 190x132.
Scene uses a portrait child layout by default. Resizing it resizes all sibling
Scenes of the same Timeline to the same normal size.

Scene does not expose a child-layout toggle. A stale saved freeform or
landscape value is ignored and normalized to portrait layout.

Scene height is resolved from the complete vertical Shot list, including card
heights, labels, gaps, and border padding. Timeline uses that resolved Scene
height when sizing its own Scene list, so no Shot renders outside Scene bounds.
## Visual identity

Scene belongs to the Organization visual family. It is a quiet nested frame
with a visible hierarchy spine and Shot count; raised Shot cards remain the
dominant production elements.
