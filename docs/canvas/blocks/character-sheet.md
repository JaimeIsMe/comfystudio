# Character Sheet block specification

## Role

Character Sheet builds one multi-pose or multi-description image from a prompt,
seed, and one or more connected Character Images.

## Properties

- Prompt
- Seed

The Character Sheet has no Role or Notes property. Its reference images are
represented by Image-to-Sheet connections inside the same Character.

## Role

Character Sheet stores structured character reference and continuity notes.

## Color

The Character Sheet block owns the accent color `#e879f9`.

## Parent constraint

Character Sheet may only be placed inside Character.

## Properties

- Prompt
- Role
- Notes

Character Sheet is expanded by default. When its parent is collapsed, it has
no floating toolbar. Its minimum size is 150x100 and its default normal size is
190x132. Resizing it resizes all sibling Character Sheets of the same Character
to the same normal size. Images in that Character keep their own size.
Character Sheet does not expose a layout toggle and uses vertical layout when
a layout is applicable.

Character Sheet accepts multiple Image links from Images inside the same
Character. Clicking the Sheet reveals all those links; clicking an Image
reveals only that Image's one Sheet link.
## Visual identity

Character Sheet belongs to the Asset visual family and uses a stacked-page
placeholder until generated, then shows only its associated sheet image. Its
connected reference count remains visible as metadata; Prompt and Seed remain
available in Edit mode.

A Character Sheet may only be added when the same Character already contains
at least one Image with associated media. The Add option remains visible but
disabled until that prerequisite is satisfied.
