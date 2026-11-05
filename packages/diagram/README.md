# @yaks/diagram

Draws the [entities](../graph/README.md#data-model) a query selects, and the
references between them, as SVG. A drawing keeps each entity where it was as the
graph changes, so what a write adds is drawn in beside what it names.

- `layout(bundles, options?)` places a selection. It is pure: bundles in, a
  `Layout` of nodes and links with positions out.
- `svg(layout, options?)` draws a layout as one `<svg>` string.
- `tangles(layout)` lists what makes a layout hard to read, as `svg()` draws it.
  It is pure.
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
`order`, and every line between two of them keeps its bend and the place of its
name. A new entity `at` gives a place (fractions of the sheet's width and
height, by its eid, label or bundle) goes there. Each other new entity is placed
one at a time, the one with the most lines to what is already placed first, at
the cheapest free spot. A spot costs more when:

- it is within `APART` of another shape;
- a line already drawn runs through it, or one of its own lines would cross a
  line, run through a shape, or leave a shape at nearly the angle of another;
- its lines are far from about 110 long between the shapes' rims, or too short
  to write their names on;
- a shape already placed cannot be reached from it in a straight line, since a
  later line to it would cross something;
- it is far from the sheet's middle, or below the sheet's bottom.

An actor (a round or hex shape: a person, persona or session) keeps to a side of
the sheet, the one with fewer actors, so what names both lands between them.
When no spot is free the sheet grows downward, so `height` can come back larger
than asked. An entity that leaves the selection gives up its place.

A line is straight unless something is in its way: once both its ends are placed
it takes the `bend` (how far its middle sits to one side) that runs through no
shape, crosses fewest lines and keeps clear of the lines beside it. Its `mid` is
how far along it its name is written, the spot nearest the middle that covers no
shape and no other name.

`tangles(layout)` names what is still tangled, with the short ids it involves:
shapes too close, a line through a shape, lines that cross or run over each
other, and a name written on a shape or another name.

The placement is greedy and keeps what is placed, so it cannot foresee a line
that arrives later between two entities already placed; a bend is how such a
line gets around. Libraries were weighed for this: dagre and elkjs lay out a
whole graph at once, so what is placed moves as the graph grows, and d3-force
can hold placed nodes still but does not weigh crossings.

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

`mount(sheet, { graph, query, width?, height?, at?, shapes?, stage?, drawn?, failed?, steered?, viewed? })`
writes the drawing into `sheet.innerHTML` and draws again after every commit,
seen through an `effect` hook on the graph (one per graph, however many
drawings). Commits that land while it reads are drawn by one more read. It
returns:

- `query(q, stage?)`: draw another query's answer, keeping the places of what
  both select. It refuses as the graph refuses the query, and the old drawing
  stays.
- `redraw()`: read and draw again.
- `layout`: the layout last drawn.
- `view` and `show(view)`: the part of the sheet in view, and showing another
  (`undefined` shows all of it).
- `stop()`: stop following the graph and the reader's gestures.

`stage()` is asked as each commit lands, and what the commit adds is stamped
with its answer. `drawn(layout)` is told each layout once it is in the sheet.
`failed(err)` is told when a redraw after a commit fails; its default is
`reportError`.

A page wires clicks itself, from `data-eid` on the box it reaches.

## Zooming and panning

A **view** is the part of the sheet in view, `[x, y, width, height]` in the
sheet's units. `zoom(layout, view, k, [fx, fy])` zooms by `k` about a point
given as fractions of the view, which stays where it is;
`pan(layout, view,
dx, dy)` moves it. Both are pure and keep the view on the
sheet, between all of it and a sixth of it across. `whole(layout)` is all of it,
`zoomed(layout,
view)` says whether less is shown, and `within(view, point)`
says where a point of the sheet is, as fractions of the view.

A drawing mounted in a page is steered by its reader
(`steer(el, { layout,
view, set })`, unless `steered: false`):

- a pinch, on a touch screen or a trackpad (which a browser reports as a wheel
  with ctrl held), or ctrl-scroll, zooms about where it happens;
- a drag pans, once zoomed in;
- plain scrolling scrolls the page, and so does one finger on a drawing shown
  whole (`touch-action: pan-x pan-y`, `none` once zoomed);
- the click that ends a drag or a pinch is stopped before it reaches the page.

The sheet gets `is-zoomed` while zoomed in, and `css` gives it a grab cursor.
What is in view is kept as the graph changes, and `viewed(view)` is told each
time it changes, so what a page draws over the drawing can follow it.
