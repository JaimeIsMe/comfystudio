# Canvas Configuration block specification

## Role

Canvas Configuration is the mandatory global-rule node for one Canvas.

## Color

The Canvas Configuration block owns the accent color `#f97316` (orange) so it
is immediately recognizable as the Canvas-level rule node.

## Lifetime

- Exactly one configuration node exists in every Canvas.
- It is created with the initial Canvas.
- It is never offered in the add menus.
- It can never be deleted.

## Editable options

- Prompt
- Character image workflow, selected from available Text to Image workflows.
- Character sheet workflow, selected from available image workflows.
- Location image workflow, selected from available Text to Image workflows.
- Location sheet workflow, selected from available image workflows.

These workflow selections are persisted as Canvas Configuration state and are
used by child Image and Sheet generation.
## Visual identity

Canvas Configuration belongs to the System visual family. It uses a utility
panel silhouette, dashed structure, and subtle technical pattern.
