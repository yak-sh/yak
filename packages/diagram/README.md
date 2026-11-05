# @yaks/diagram

Draws the [entities](../graph/README.md#data-model) a query selects, and the
references between them, as SVG. A drawing keeps each entity where it was as the
graph changes, so what a write adds is drawn in beside what it names.

- `layout(bundles, options?)` places a selection. It is pure: bundles in, a
  `Layout` of nodes and links with positions out.
- `svg(layout, options?)` draws a layout as one `<svg>` string.
- `progress(layout, reached)` and `tip(layout, drawn)` say how far a pen has
  drawn each part as a reader moves through a story, and where the pen is. Both
  are pure.
- `ink(svg, layout, drawn)` puts that on a drawing in a page.
- `mount(sheet, { graph, query })` keeps an element drawing a graph's answer to
  a query, again after every commit.
- `css` is the stylesheet a drawing is meant to wear.

```ts
import { layout, svg } from '@yaks/diagram'
import { assert, assertEquals } from '@std/assert'

let book = { entity: { eid: '0a' }, doc: { title: 'Dune' } }
let review = { entity: { eid: '0b' }, review: { of: '0a', stars: 5 } }
let drawn = layout([book, review])
assertEquals(drawn.links.map((l) => l.name), ['review.of'])
assert(svg(drawn).includes('>Dune</text>'))
```

## What is drawn

A **node** is an entity drawn as a shape: its short id (`label`), its title, and
its components. The title is `doc.title`, else the first line of `doc.body`,
else `file.path`, cut to fit its shape. The components `entity`, `created` and
`updated` are left off the list (`quiet` changes that).

Its shape comes from its components (`SHAPES`, or `options.shapes`): a person is
a circle, a persona or session a hexagon, a comment a note with a folded corner,
and anything else a box. A component's `status` (a task's) is written at the
box's top right beside a mark.

A **link** is a line between two drawn entities. It is one of:

- an entity with `edge{from, to}`, drawn as a line rather than a box, with a
  diamond, its other components as its name (`contains`, `requires`) and its
  short id;
- a property whose value, or one of whose values, is another drawn entity's eid,
  named `comp.prop` (`comment.target`). `updated` and every `via` are not drawn,
  since they would join everything to its writer.

A reference to an entity outside the selection draws nothing, so the query
decides how much of the graph is on the sheet.

## Places

`layout(bundles, { was })` keeps every entity of `was` where it was, with its
`order`. A new entity `at` gives a place (fractions of the sheet's width and
height, by eid or label) goes there. Each other new entity, in the order given,
takes the cheapest free spot: one that overlaps no shape, crosses few lines,
sits a short reach from the entities it names, and is not far from the sheet's
middle. When no spot is free the sheet grows downward, so `height` can come back
larger than asked. An entity that leaves the selection gives up its place.

Every node and link carries `fresh`, true when it joined in this layout, and
`stage`, the `options.stage` it joined in (default 0).

`label` names a bundle's short id. Its default is the eid's handle
(`#a3f19c024b`); `mount` passes [@yaks/id](../id/README.md)'s `human(vocab)`, so
a numbered task reads `T-7`.

## The drawing

`svg()` emits classes and custom properties, never colours:

| class                                                | what it is                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `Diagram`                                            | the `<svg>` (or `options.class`)                                     |
| `Diagram_Node`, `-box` / `-round` / `-hex` / `-note` | a shape's group, with `data-key`, `data-eid` and `data-comps`        |
| `Diagram_Fill`, `Diagram_Stroke`                     | a shape's inside and outline                                         |
| `Diagram_Id`, `Diagram_Title`, `Diagram_Comps`       | a shape's three lines of text                                        |
| `Diagram_Mark`, `Diagram_State`, `is-<status>`       | a status's mark and word                                             |
| `Diagram_Link`, `-edge` / `-ref`                     | a line's group, with `data-key`, `data-from`, `data-to`, `data-name` |
| `Diagram_Line`, `Diagram_Name`, `Diagram_Sub`        | a line, its name and an edge's short id                              |
| `Diagram_Dia`                                        | an edge's diamond                                                    |
| `Diagram_Pen`                                        | the pen, hidden until `ink()` puts it on a stroke                    |
| `is-new`, `--i`                                      | joined in this layout; `--i` is its turn to be drawn                 |

Each stroke has `pathLength="1"`, so a stylesheet draws it in with
`stroke-dashoffset`. `css` does that: each new shape, then the lines to it, is
drawn in one after another like a pen. It reads `--diagram-line`,
`--diagram-soft`, `--diagram-fill`, `--diagram-paper`, `--diagram-glow`,
`--diagram-font` and `--diagram-pen` (a stroke's duration), and draws nothing in
under `prefers-reduced-motion`.

## Drawing it in as a reader goes

A page that tells a story in stages (steps a reader scrolls through) stamps what
each stage adds with `stage`, then says how far each stage has come in:

- `progress(layout, reached)` gives each item (by its key: a node's eid, a
  link's key) how far it is drawn, 0 to 1, when stage `s` has come `reached(s)`
  of the way. A stage's items are drawn one after another, each shape followed
  by the lines that now reach it (`strokes`).
- `tip(layout, drawn)` is where the pen is: the latest item still being drawn,
  as far along its outline or line as it has come, with its `stage`, so a page
  can point from the step to the part it draws.
- `ink(svg, layout, drawn)` puts it on a drawing in a page: each item gets
  `is-gone`, `is-drawing` or `is-drawn` and its stroke's dash offset, and the
  pen moves to the tip. The drawing gets `is-inked`, which turns off the
  time-driven drawing in of `css`.

## Mounting

`mount(sheet, { graph, query, width?, height?, at?, shapes?, stage?, drawn?, failed? })`
writes the drawing into `sheet.innerHTML` and draws again after every commit,
seen through an `effect` hook on the graph (one per graph, however many
drawings). Commits that land while it reads are drawn by one more read. It
returns:

- `query(q, stage?)`: draw another query's answer, keeping the places of what
  both select. It refuses as the graph refuses the query, and the old drawing
  stays.
- `redraw()`: read and draw again.
- `layout`: the layout last drawn.
- `stop()`: stop following the graph.

`stage()` is asked as each commit lands, and what the commit adds is stamped
with its answer. `drawn(layout)` is told each layout once it is in the sheet.
`failed(err)` is told when a redraw after a commit fails; its default is
`reportError`.

A page wires clicks itself, from `data-eid` on the box it reaches.
