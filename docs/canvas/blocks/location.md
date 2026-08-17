# Location block specification

## Role

Location is a top-level production container for a place, set, or visual
world.

## Color

The Location block owns the accent color `#34d399`.

## Children

Location may contain any number of:

- Image
- Location Sheet

Children are arranged in portrait Location columns grouped by type. Images
occupy one column and Location Sheets occupy another column, with a separate
Prompt column on the right. A minimum gap separates columns. In
portrait mode each type occupies its own column. In freeform mode each child
can be positioned independently. The container expands to fit them with a
small border gap and shrinks when they move inward. The Location toolbar
provides `+` and a horizontal/vertical/freeform layout toggle, plus
expand/collapse-all for its child cards. Child cards are expanded by default
and collapse together into their compact view.

Location must always contain at least one Image or Location Sheet. A newly
created Location receives a default Image. If it has only that Image, add a
Location Sheet before deleting the Image.

## Properties

- Prompt
- Description

Location minimum size is 220x120 and its default size is 280x180. It may be
resized larger, but never below its child gallery's required size.
