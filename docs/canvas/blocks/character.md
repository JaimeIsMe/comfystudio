# Character block specification

## Role

Character is a top-level production container for a person, performer, or
subject.

## Color

The Character block owns the accent color `#a78bfa`.

## Children

Character may contain any number of:

- Image
- Character Sheet

Children are arranged in portrait Character columns grouped by type. A
parent-owned Character Prompt is the first column, followed by Image and
Character Sheet columns explicitly identified as Child nodes. A minimum gap
separates columns. In
portrait mode each type occupies its own column. In freeform mode each child
can be positioned independently. The container expands to fit them with a
small border gap and shrinks when they move inward. The Character toolbar
provides `+` and a horizontal/vertical/freeform layout toggle, plus
expand/collapse-all for its child cards. Child cards are expanded by default
and collapse together into their compact view.

Horizontal Character resizing keeps Character Prompt at a fixed 280px width and
shares additional width evenly between the Image and Character Sheet columns.

Character must always contain at least one Image or Character Sheet. A newly
created Character receives a default Image. If it has only that Image, add a
Character Sheet before deleting the Image.

## Properties

- Prompt
- Name
- Description

Character minimum size is 220x120 and its default size is 280x180. It may be
resized larger, but never below its child gallery's required size.
## Visual identity

Character belongs to the Subject visual family. It uses a media-forward,
portrait-oriented identity treatment with Images and Sheets clearly separated
from its Prompt panel.
