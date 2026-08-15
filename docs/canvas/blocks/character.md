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

Children are arranged in the Character gallery grouped by type. In landscape
mode Images occupy one row and Character Sheets occupy another row. In
portrait mode each type occupies its own column. In freeform mode each child
can be positioned independently. The container expands to fit them with a
small border gap and shrinks when they move inward. The Character toolbar
provides `+` and a horizontal/vertical/freeform layout toggle, plus
expand/collapse-all for its child cards. Child cards are expanded by default
and collapse together into their compact view.

Character must always contain at least one Image or Character Sheet. A newly
created Character receives a default Image. If it has only that Image, add a
Character Sheet before deleting the Image.

## Properties

- Prompt
- Name
- Description

Character minimum size is 220x120 and its default size is 280x180. It may be
resized larger, but never below its child gallery's required size.
