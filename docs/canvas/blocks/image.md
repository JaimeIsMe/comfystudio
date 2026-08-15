# Image block specification

## Role

Image is a reference image belonging to exactly one Character or Location.

## Color

The Image block owns the accent color `#c084fc`.

## Parent constraint

Image may only be placed inside Character or Location. It may not be a
top-level node and may not be dragged outside a compatible parent.

## Properties

- Prompt
- Seed
- Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4, or 21:9
- Resolution: HD, FHD, 2K, or 4K

The Image asset ID is internal metadata. It is generated automatically, is
persisted with the Image, and is not shown in the edit panel.

Prompt is an editable Image property. Prompt is not a Canvas node and must
never appear as a standalone block in the add menus or sidebar.

Image has Add and Edit modes with expanded in-node forms. Add mode offers
Comfy image selection, single-image upload, and prompt generation using the
workflow selected in Canvas Configuration. Image is
expanded by default. Its title bar shows `Image - Title`. When its
parent is collapsed, its compact card body has no repeated text and no floating
toolbar. In normal mode it remains a visual card with no repeated description
text; its toolbar opens the property editor.
Image minimum size is 150x100 and its default normal size is 190x132. Resizing
one Image resizes all sibling Images in the same parent to the same normal
size. Character Sheets in that parent keep their own size.

For a new Image, the property editor provides two actions: `Create from prompt`
and `Prompt an image`. The selected action is stored as the Image workflow
mode and does not create a Prompt node.

Image has one Sheet link. The link is valid only to a Sheet inside the same
Character or Location parent. It is hidden until the Image or its Sheet is
clicked, and disappears when the Canvas background is clicked.
