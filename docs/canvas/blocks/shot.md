# Shot block specification

## Role

Shot is the production unit inside a Scene. It owns the location, characters,
and detailed direction for one shot.

The normal Shot card is split into two sides. The left side shows Used
elements: the connected Location followed by connected Characters. Each item
uses the first Image child of the connected Location or Character as its
preview. The right side shows the Shot prompt. Missing connections or missing
images show an empty placeholder without changing the underlying connections.

## Color

The Shot block owns the accent color `#60a5fa`.

## Parent constraint

Shot may only be placed inside Scene.

## Connections

- One Location input.
- Multiple Character inputs.

## Properties

- Prompt
- Description
- Duration in seconds
- Framing
- Camera movement
- Lens
- Lighting
- Action
- Dialogue

Shot cards are arranged vertically in their Scene. They can be dragged to a
different Scene or reordered within the current Scene. The Scene assigns the
automatic display label `Shot X` based on the current order.
