# Timeline block specification

## Role

Timeline is a top-level sequence container for scenes.

## Color

The Timeline block owns the accent color `#fb7185`.

## Children

Timeline may contain any number of Scene nodes. The Timeline container expands
to fit its children and supports horizontal/vertical/freeform child layout.
Freeform scenes can be positioned independently while the Timeline maintains a
small border gap and resizes around them. Scene cards are expanded by default;
the Timeline title bar expands or collapses all scenes together. Timeline uses
a vertical Scene layout for now and does not expose a layout toggle.

Timeline minimum size is 220x120 and its default size is 280x180. It may be
resized larger, but never below its child gallery's required size.

## Properties

- Prompt
- Description
- Video style default
- Temporal/world effect default
- Camera flow preset default
## Visual identity

Timeline belongs to the Organization visual family. It is the broadest,
lowest-elevation sequence frame and exposes Scene count plus concise creative
defaults as card metadata.
