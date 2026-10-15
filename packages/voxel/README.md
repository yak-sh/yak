# @yaks/voxel

Voxel geometry over plain values. Mesh a voxel grid or a set of boxes into
packed quads, select chunks by distance and detail, and cache heightfield charts
for a map. The package has no runtime dependencies, renderer, graph or game
world; its exports run in a page or a worker.

The page reads its game's graph and passes values here. A renderer consumes the
packed arrays; a game supplies chunk and sheet sizes. There are no stored words
or save migrations.

## Geometry

`@yaks/voxel/mesh` supplies the quad writer (`out`, `quad`, `pack`), voxel
shapes (`box`, `ball`, `blob`) and the packed representation.
`@yaks/voxel/boxes` turns box models into that representation, including flush
surfaces, worn pieces and shaped surfaces. Both are also exported from
`@yaks/voxel`.

## Chunk detail

`@yaks/voxel/stream` selects chunks nearest first. Supply the chunk's side in
metres, the focus, sight distance and each chunk's current detail. `RINGS` and
`COARSER` describe the detail levels; a hysteresis margin keeps chunks on a ring
or sight boundary from flickering. An optional final argument bounds a world to
indices zero through that many chunks minus one.

```ts
import { wanted } from '@yaks/voxel/stream'

let chunks = wanted(32, -16, -16, 1, () => undefined)
console.log(chunks) // [{ ci: -1, ck: -1, lod: 0, d: 0 }]
```

## Charts

`@yaks/voxel/chartbook` keeps completed and concurrent chunk charts. Create a
`chartbook<T>(chunkSize)`, `keep(cell, make)` charts produced during growth,
then `read(box, visible, load)` to load only missing visible cells. A rejected
load can be tried again. `clear()` retires charts when the source designs
change. `cellsOf(box, chunkSize)` enumerates cells intersecting a square,
including negative coordinates. Boxes are `[x, z, side]` and cells are
`[ci, ck]`.

`@yaks/voxel/chartsheet` places chart pixels into larger sheets once. Supply the
sheet side and a canvas factory to `chartsheet(size, make)`. The factory returns
`{ image, put(pixels, x, z) }`; the package never creates or owns a DOM canvas.
The returned function accepts pixel charts and returns visible sheet charts,
reusing canvases and repainting a cell only when its pixel array changes.

In a hosted app, declare `"@yaks/voxel": "platform"` in `package.json` and
import the root or the subpaths above. The running platform compiler must carry
the package before deploying an app that imports it.

## Tests

```sh
deno task test packages/voxel
```
