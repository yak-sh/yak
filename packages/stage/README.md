# @yaks/stage

Three.js presentation primitives over values: draw voxel meshes, animate box
rigs, orbit a camera, pick ground and objects, and play positional sound. A
stage knows neither a graph nor a game's world. The app reads its graph and
hands it geometry, animation, collision callbacks, clip URLs and volume values.

## A frame and a camera

```ts
import { pace } from '@yaks/stage'
import { groundRay } from '@yaks/stage/aim'

let draw = pace()
console.log([0, 8, 17, 25, 34].filter((t) => draw(t, 60))) // [0, 17, 34]
let point = groundRay(
  { x: 0, y: 4, z: 0 },
  { x: 0, y: -0.5, z: 0.5 },
  () => 0,
)
console.log(point) // { x: 0, y: 0, z: 4 }
```

`/render` creates a voxel-friendly WebGL renderer. `frameLoop` schedules the
next frame and supplies both elapsed seconds and a simulation step capped at 50
ms; the page decides when to start it.
`keepUp(quality(renderer, sun,
scene, density))` lowers pixel density and then
shadows over successive slow windows. Call it only while the app wants frame
performance measured.

`/cam` takes a camera state and a small camera intent, not an input controller.
`aim` takes a `blocked(point)` callback and an optional minimum pitch. The app
owns terrain, walls and indoor policy. `/aim` intersects a ray with a supplied
heightfield or a collection of bounding spheres.

## Geometry and animation

- `/soft`: packed-quad geometry and the voxel material, including cutaway,
  lighting and flash uniforms.
- `/parts`: assemble and move box-model parts from `@yaks/voxel`.
- `/puppet`: animate a caller-supplied box rig from actions and attachment
  values. Creature designs, equipment and animation policy stay with the app.
- `/instances`: batches of repeated geometry, keyed by a model-key function the
  caller supplies.
- `/light`: bake lamp light into packed quads.
- `/fx`, `/air`, `/halo`, `/flames`: particles, projected labels, glow,
  instanced air and flames. The app supplies colors, textures and motion.

## Sound

`/ears` spatializes audio relative to a camera. `/sound` manages sources that
follow their emitters. `/samples` loads clips by URL, plays one-shots and loops,
and falls back to a supplied voice when a clip is unavailable. `/bus` controls
volume by kind from supplied settings and an optional change callback; it never
chooses where settings are persisted.

Three.js is an ordinary npm dependency shared by the page and stage. Stage also
uses `@yaks/voxel`; it has no graph or application dependencies. The platform
compiler serves the browser exports from `browser.json`. An app opts in with
`"@yaks/stage": "platform"` in its `package.json` dependencies.

Mossvale (`apps/vale`) is a consumer. Its vocabulary, saved heroes, world,
procedural voices and design subscriptions remain in the app. The larger
world/sky/chunk-streaming shell is a separate extraction (T-125028).
