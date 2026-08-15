# Canvas specifications

These Markdown files are the canonical product specifications for the Canvas
area. Implementation changes must preserve the rules in these files; when a
behavior changes, update the relevant specification first and then update the
schema, UI, and tests.

The application must be reconstructible from this directory alone. The
specifications therefore contain the complete block catalog, containment map,
global rules, initial document, interaction rules, sizing rules, and image
actions. Source code is an implementation of these files, not a second source
of product requirements.

- [Canvas](./canvas.md) defines global rules, persistence, and interaction.
- [Requirements](./requirements.md) is the consolidated acceptance checklist.
- [Canvas Configuration](./blocks/canvas-configuration.md) defines the
  mandatory, non-deletable configuration node.
- [Character](./blocks/character.md) defines character containers.
- [Image](./blocks/image.md) defines image children and image properties.
- [Character Sheet](./blocks/character-sheet.md) defines character sheets.
- [Location](./blocks/location.md) defines location containers.
- [Location Sheet](./blocks/location-sheet.md) defines location sheets.
- [Audio](./blocks/audio.md) defines audio elements.
- [Timeline](./blocks/timeline.md) defines timeline containers.
- [Scene](./blocks/scene.md) defines scene children and scene connections.
