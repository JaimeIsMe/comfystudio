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

Children are arranged in portrait Location columns grouped by type. A
parent-owned Location Prompt is the first column, followed by Image and
Location Sheet columns explicitly identified as Child nodes. A minimum gap
separates columns. In
portrait mode each type occupies its own column. In freeform mode each child
can be positioned independently. The container expands to fit them with a
small border gap and shrinks when they move inward. The Location toolbar
provides `+` and a horizontal/vertical/freeform layout toggle, plus
expand/collapse-all for its child cards. Child cards are expanded by default
and collapse together into their compact view.

Horizontal Location resizing keeps Location Prompt at a fixed 280px width and
shares additional width evenly between the Image and Location Sheet columns.

Location must always contain at least one Image or Location Sheet. A newly
created Location receives a default Image. If it has only that Image, add a
Location Sheet before deleting the Image.

## Properties

- Prompt
- Description

Location minimum size is 220x120 and its default size is 280x180. It may be
resized larger, but never below its child gallery's required size.
## Visual identity

Location belongs to the Subject visual family. It uses a media-forward,
landscape-oriented environment treatment with Images and Sheets clearly
separated from its Prompt panel.
