# Location Sheet block specification

## Role

Location Sheet builds one multi-view location reference image from a prompt,
seed, and one or more connected Location Images.

## Color

The Location Sheet block owns the accent color `#6ee7b7`.

## Parent constraint

Location Sheet may only be placed inside Location.

## Properties

- Prompt
- Seed

Location Sheet is expanded by default. When its parent is collapsed, it has no
floating toolbar. Its minimum size is 150x100 and its default normal size is
190x132. Resizing it resizes all sibling Location Sheets of the same Location
to the same normal size. Images in that Location keep their own size.

Location Sheet accepts multiple Image links from Images inside the same
Location. Clicking the Sheet reveals all those links; clicking an Image
reveals only that Image's one Sheet link.
