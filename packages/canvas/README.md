# @yaks/canvas

Graph components and geometry helpers for spatial and split-pane interfaces. The
package stores layout state; applications render it and handle input.

## Install

```sh
deno add jsr:@yaks/canvas
# or: npx jsr add @yaks/canvas
```

## Components and graph setup

A `canvas` groups spatial content. A `card` references the displayed entity; a
`pin` gives its position and stacking order. A `camera` stores viewport centre,
scale and dimensions, and a `cursor` stores the current selection. A `layout`
groups split-screen `pane`s. A `fold` records collapsed sections, and a `shelf`
records set-aside items. A `client` identifies an open window.

The following setup assumes application vocabulary `mine` and a compatible graph
storage adapter `storage`:

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { canvas, canvasDoc } from '@yaks/canvas'

let vocab = loadVocab([canvasDoc, mine])
let g = graph({ storage, vocab, plugins: [canvas()] })
```

Layout state is stored as graph entities, so other clients and tools can query
and update it through the same graph API as application content.

## Reference deletion

`card.target` declares `death: cascade`: deleting the referenced entity also
deletes its card in the graph transaction. The plugin does not add a cleanup
hook; reference deletion is enforced by the graph vocabulary.

## Where each piece lives

Every component declares a [@yaks/sync](https://jsr.io/@yaks/sync) `persist`
tier, and all of them are `wire`.

| component                                     | tier   | why                                                  |
| --------------------------------------------- | ------ | ---------------------------------------------------- |
| `canvas`, `card`, `pin`                       | `wire` | shared spatial content                               |
| `layout`, `pane`                              | `wire` | a named arrangement, meant to be reopened and shared |
| `client`, `camera`, `cursor`, `fold`, `shelf` | `wire` | per-window, but something else has to read them      |

Per-window components also use `wire`, allowing another client to restore or
inspect a viewport and tools to update a selection. Applications should use
local persistence for transient state that should not be replicated, such as an
in-progress drag.

## The geometry is plain functions

No DOM, no matrices, no units — a canvas unit is whatever you decide one is. A
browser and a terminal share one answer instead of drifting apart.

```ts
import { frame, place, visible } from '@yaks/canvas'

visible(camera, pins) // what is on screen — asked every frame
place(pins, { w: 320, h: 200 }) // where the next card goes
frame(pins, { w: 1200, h: 800 }) // the camera that fits everything
```

`place` searches candidate positions left to right, then top to bottom, within
the existing bounds. If none is free it places the card to the right; an empty
canvas starts at the origin. The default candidate spacing includes a 24-unit
gap. The function is deterministic and does not modify the pins.

## Exports

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

**Layout algorithms.** `place` computes a default position for a new card. A
client that knows a drop point should use it.

## Where it sits

A component domain over [@yaks/graph](https://jsr.io/@yaks/graph), the same
shape any application's own plugin has — like
[@yaks/member](https://jsr.io/@yaks/member) and
[@yaks/edge](https://jsr.io/@yaks/edge), it ships components and nothing
privileged.

## Compatibility

Pure TypeScript, no platform API — the geometry is arithmetic and the vocabulary
is JSON. Runs on **Deno**, **Node**, and in the **browser**.
