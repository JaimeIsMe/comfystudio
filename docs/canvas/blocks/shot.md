# Shot block specification

## Role

Shot is the production unit inside a Scene. It owns the location, characters,
and detailed direction for one shot.

The normal Shot card is split into two sides. The left side shows the Shot
prompt. The right side shows Used elements: the connected Location followed by
connected Characters. Each item uses the first Image child of the connected
Location or Character as its preview. Missing connections or missing
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
- Seed
- Description
- Duration in seconds
- Duration start as a comma-separated time value, for example `3,250` means 3 seconds and 250 milliseconds
- Duration end as a comma-separated time value, for example `8,000` means 8 seconds
- Framing
- Camera movement
- Lens
- Lighting
- Action
- Performance mode
- Character assignments with timed cues

Performance mode is one of `performance`, `instrumental`, `visual_only`, or
`b_roll`. Singing and dialogue are cue types, not separate Shot modes.

Each connected Character may have an ordered list of Shot-local cues. A cue
contains a start and end offset in milliseconds internally, edited as
comma-separated millisecond values, a type (`singing`, `dialogue`,
`reaction`, `silent`, or `instrumental_action`), and optional text. Cue timing
uses absolute timeline milliseconds and must stay within the Shot's
`duration_start` and `duration_end` range.
Explicit cues take precedence over inferred lyric or dialogue assignments.

The Timeline owns default `Video style`, `Temporal/world effect`, and `Camera
flow` values. A newly created Shot copies those values. Later Timeline changes
do not modify existing Shots; each Shot can override its copied values.

Quick toolbar properties are `Performance mode`, `Camera flow`, and `Framing`.
All other Shot properties remain available in Edit mode.

`Camera flow preset` is a high-level coverage/movement strategy copied from
the Timeline and optionally overridden per Shot. `Exact camera movement` is
the concrete movement instruction for this Shot, such as `slow orbit left` or
`track backward`. When both are present, the exact Shot movement takes
precedence; the preset remains contextual guidance.

Shot cards are arranged vertically in their Scene. They can be dragged to a
different Scene or reordered within the current Scene. The Scene assigns the
automatic display label `Shot X` based on the current order.
## Visual identity

Shot belongs to the Production visual family. It uses the strongest card
elevation, a cinematic header treatment, duration and creative-state metadata,
raised Used elements, and a clearly divided soft paper Prompt panel.
