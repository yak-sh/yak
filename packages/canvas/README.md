# @yaks/canvas

The **spatial-UI** component domain for a
[@yaks/graph](https://jsr.io/@yaks/graph): the interface is data.

## Install

```sh
deno add jsr:@yaks/canvas
# or: npx jsr add @yaks/canvas
```

## A wall of sticky notes

The wall is a **`canvas`**. Each note is a **`card`** showing something, and its
**`pin`** says where on the wall it sits. Whoever is looking has a **`camera`**
— a centre, a scale, and the size of their window — and a **`cursor`** naming
what they have open.

There is a second way to arrange the same things: a **`layout`** of **`pane`**s,
a split of the screen rather than a plane. A **`fold`** remembers which sections
someone collapsed, and a **`shelf`** holds what they picked up off the wall. All
of them belong to a **`client`**: one open window.

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { canvas, canvasDoc } from '@yaks/canvas'

let vocab = loadVocab([canvasDoc, mine])
let g = graph({ storage, vocab, plugins: [canvas()] })
```

A note is an entity, not a private view-model. That is the whole idea: the
layout is stored, queried, shared and undone exactly like the content it frames,
and something other than the window that drew it — a second tab, a script, an
assistant — can read it and move it.

## One rule, declared not enforced

A card dies with the thing it shows. That is `death: cascade` on `card.target`,
so the graph's own reaper handles it in the same transaction as the delete that
caused it. This package ships **no hook**: a pass that went looking for widowed
cards afterwards would be a second, slower, wronger copy of a rule the
vocabulary already states.

## Where each piece lives

Every component declares a [@yaks/sync](https://jsr.io/@yaks/sync) `persist`
tier, and all of them are `wire`.

| component                                     | tier   | why                                                  |
| --------------------------------------------- | ------ | ---------------------------------------------------- |
| `canvas`, `card`, `pin`                       | `wire` | the wall and what is on it — shared is the point     |
| `layout`, `pane`                              | `wire` | a named arrangement, meant to be reopened and shared |
| `client`, `camera`, `cursor`, `fold`, `shelf` | `wire` | per-window, but something else has to read them      |

That last row is the interesting call. Those five describe **one window**, so
`local` looks right — and it is wrong. A second tab restoring the viewport it
left, a directory of who is looking at what, a tool that moves somebody's open
card by writing their `cursor`: none of that works on state that never leaves
the tab. Per-viewer is not the same question as per-process.

If you add a component that genuinely dies with the render — a drag in flight, a
marquee — declare it `persist: "none"`. This package ships none, because nothing
it models is that short-lived.

## The geometry is plain functions

No DOM, no matrices, no units — a canvas unit is whatever you decide one is. A
browser and a terminal share one answer instead of drifting apart.

```ts
import { frame, place, visible } from '@yaks/canvas'

visible(camera, pins) // what is on screen — asked every frame
place(pins, { w: 320, h: 200 }) // where the next card goes
frame(pins, { w: 1200, h: 800 }) // the camera that fits everything
```

`place` fills the wall the way you would: the first gap, reading left to right
and top to bottom, and when there is no gap left, beside everything else. It is
deterministic, so two windows given the same wall choose the same spot.

## The surface

| export                            | is                                              |
| --------------------------------- | ----------------------------------------------- |
| `canvasDoc`                       | the components, to load beside your own         |
| `canvas()`                        | the @yaks/graph plugin                          |
| `CANVAS`, `CARD`, `PIN`, …        | their names; `PER_CLIENT` is the per-window set |
| `Card`, `Pin`, `Camera`, `Cursor` | the component shapes                            |
| `Point`, `Size`, `Rect`           | the geometry's vocabulary                       |
| `rect`, `bounds`, `overlaps`      | a pin's box, the box around many, do two meet   |
| `top(pins)`                       | the frontmost stacking order in use             |
| `world(camera)`                   | the part of the plane a camera can see          |
| `visible(camera, pins)`           | the pins on screen                              |
| `frame(pins, size)`               | the camera that fits everything                 |
| `place(pins, size)`               | where the next card goes                        |
| `zoomed`, `ZOOM_MIN`, `ZOOM_MAX`  | the one zoom range every camera move shares     |

## What is deliberately not here

**Rendering.** This says what the pieces are and where they sit; drawing them is
a client's job, and the two should be replaceable independently.

**A `before` ordering.** `before` names another kind, and a vocabulary that
pairs these components with its own content component is the one that can say
which of the two wins. A package cannot order itself against a kind it does not
ship — it would not load on its own.

**Layout algorithms.** `place` answers "somewhere sensible" for a keyboard, a
search result or a script. A client that knows a drop point should use it.

## Where it sits

A component domain over [@yaks/graph](https://jsr.io/@yaks/graph), the same
shape any application's own plugin has — like
[@yaks/member](https://jsr.io/@yaks/member) and
[@yaks/edge](https://jsr.io/@yaks/edge), it ships components and nothing
privileged.

## Compatibility

Pure TypeScript, no platform API — the geometry is arithmetic and the vocabulary
is JSON. Runs on **Deno**, **Node**, and in the **browser**.
