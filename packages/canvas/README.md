# @yaks/canvas

Graph components and geometry helpers for spatial and split-pane interfaces. The
package defines the stored layout schema; a graph storage adapter persists it.
Applications render the layout and handle input. An entity is a record
identified by `entity.eid`; its components are named objects such as
`pin: {x, y, w, h}`.

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

Create an in-memory graph:

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { canvas, canvasDoc } from '@yaks/canvas'
import { ram } from '@yaks/ram'

let vocab = loadVocab([canvasDoc])
let g = graph({ storage: ram(vocab), vocab, plugins: [canvas()] })
await g.apply([{ entity: { eid: 'workspace' }, canvas: {} }])
console.log(await g.read('.canvas'))
```

Layout state is stored as graph entities, so other clients and tools can query
and update it through the same graph API as application content.

## Reference deletion

`card.target` declares `death: cascade`: deleting the referenced entity also
deletes its card in the graph transaction. The plugin does not add a cleanup
hook; reference deletion is enforced by the graph vocabulary.

## Where each piece lives

Every component declares `sync: "server"`, making it eligible for replication to
the server when the application configures [@yaks/sync](../sync). The schema
does not establish a network connection by itself.

| component                                     | sync     | why                                                  |
| --------------------------------------------- | -------- | ---------------------------------------------------- |
| `canvas`, `card`, `pin`                       | `server` | shared spatial content                               |
| `layout`, `pane`                              | `server` | a named arrangement, meant to be reopened and shared |
| `client`, `camera`, `cursor`, `fold`, `shelf` | `server` | per-window, but something else has to read them      |

Per-window components also sync to the `server`, allowing another client to
restore or inspect a viewport and tools to update a selection. Applications
should declare `sync: none` for transient state that should not be replicated,
such as an in-progress drag.

## The geometry is plain functions

These functions use numbers without assuming pixels or another unit. They need
no DOM or transformation matrices, so browser and terminal clients can use the
same calculations. Below, `camera` is a `Camera` and `pins` are `Pin`s.

```ts
import { frame, place, visible } from '@yaks/canvas'

let pins = [{ x: 0, y: 0, w: 320, h: 200 }, { x: 400, y: 0, w: 320, h: 200 }]
let camera = { x: 0, y: 0, zoom: 1, w: 1200, h: 800 }

visible(camera, pins) // what is on screen — called every frame
place(pins, { w: 320, h: 200 }) // where the next card goes
frame(pins, { w: 1200, h: 800 }) // the camera that fits everything
```

`place` searches candidate positions left to right, then top to bottom, within
the existing bounds. If none is free it places the card to the right; an empty
canvas starts at the origin. The default candidate spacing includes a 24-unit
gap. The function is deterministic and does not modify the pins.

## Exports

| export                            | is                                                    |
| --------------------------------- | ----------------------------------------------------- |
| `canvasDoc`                       | the components, to load beside your own               |
| `canvas()`                        | the @yaks/graph plugin                                |
| `CANVAS`, `CARD`, `PIN`, …        | their names; `PER_CLIENT` is the per-window set       |
| `Card`, `Pin`, `Camera`, `Cursor` | the component types                                   |
| `Point`, `Size`, `Rect`           | the geometry types                                    |
| `rect`, `bounds`, `overlaps`      | a pin's box, the box around many, whether two overlap |
| `top(pins)`                       | the frontmost stacking order in use                   |
| `world(camera)`                   | the part of the plane a camera can see                |
| `visible(camera, pins)`           | the pins on screen                                    |
| `frame(pins, size)`               | the camera that fits everything                       |
| `place(pins, size)`               | where the next card goes                              |
| `zoomed`, `ZOOM_MIN`, `ZOOM_MAX`  | the one zoom range every camera move shares           |

## What is deliberately not here

**Rendering.** This package records what the pieces are and where they sit;
drawing them is a client's job, and the two should be replaceable independently.

**A `before` ordering.** `before` names another kind, and only a vocabulary that
combines these components with its own content component can decide which of the
two wins. A package cannot order itself against a kind it does not ship — it
would not load on its own.

**Layout algorithms.** `place` computes a default position for a new card. A
client that knows a drop point should use it.

## Dependencies

A component package over [@yaks/graph](https://jsr.io/@yaks/graph), built the
same way any application's own plugin is — like
[@yaks/member](https://jsr.io/@yaks/member) and
[@yaks/edge](https://jsr.io/@yaks/edge), it uses the public graph plugin
interface.

## Compatibility

Pure TypeScript, no platform API — the geometry is arithmetic and the vocabulary
is JSON. Runs on **Deno**, **Node**, and in the **browser**.
