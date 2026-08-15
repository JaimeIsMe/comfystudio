# Scene block specification

## Role

Scene represents a shot or sequence to develop inside a Timeline.

## Color

The Scene block owns the accent color `#38bdf8`.

## Parent constraint

Scene may only be placed inside Timeline.

## Connections

- One Location input.
- Multiple Character inputs.

## Properties

- Prompt
- Description
- Duration in seconds

Scene is expanded by default. When its parent is collapsed, it has no floating
toolbar. Its minimum size is 150x100 and its default normal size is 190x132.
Resizing it resizes all sibling Scenes of the same Timeline to the same normal
size.
