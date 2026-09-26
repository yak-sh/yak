// What stands on the ground: trees, rocks, flowers, what each land grows and
// builds, the village, and the signpost at the head of each road. Each kind
// is a row in its land's file under props/: a small voxel model built by hand
// out of balls and boxes, and what a walker makes of it. A model is meshed
// once per shape and copied wherever a level places one (terrain.ts `props`),
// and measured, so what a walker bumps into or stands on is the size it is
// drawn (`bulk`).
import { blob, type Out, out, unkey } from './mesh.ts'
import { DEEP } from './props/deep.ts'
import { FIRE } from './props/fire.ts'
import { FROST } from './props/frost.ts'
import { HILLS } from './props/hills.ts'
import type { Kind, Model } from './props/kit.ts'
import { MARSH } from './props/marsh.ts'
import { SANDS } from './props/sands.ts'
import { VALE } from './props/vale.ts'
import { VILLAGE } from './props/village.ts'

export type { Kind }

/** Every kind of prop, by its name. */
export let KINDS: Record<string, Kind> = {
  ...VILLAGE,
  ...VALE,
  ...MARSH,
  ...HILLS,
  ...SANDS,
  ...DEEP,
  ...FROST,
  ...FIRE,
}

// Which of its kind's shapes a prop is, as `kind:shape`, and the shape, built
// once.
let shapeOf = (kind: string, seed: number) => {
  let k = KINDS[kind]
  let n = k.shapes ? seed % k.shapes : seed
  let id = `${kind}:${n}`
  return {
    id,
    shape: () => {
      let got = made.get(id)
      if (!got) made.set(id, got = k.make(n * 7919 + 17))
      return got
    },
  }
}
let made = new Map<string, Model>()

let meshed = new Map<string, Out>()

/** A prop's triangles, placed with the middle of its base at the origin. */
export let model = (kind: string, seed: number): Out => {
  let { id, shape } = shapeOf(kind, seed)
  let o = meshed.get(id)
  if (o) return o
  let { vox, size } = shape()
  o = blob(out(), vox, size, [-size / 2, 0, -size / 2])
  meshed.set(id, o)
  return o
}

let measured = new Map<string, { r: number; tall: number }>()

/** How much room a prop's model takes, in metres: the radius of the circle
 * its voxels stand in, and how tall it stands.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * let { r, tall } = bulk('rock', 3)
 * assert(r > 0.5 && r < 2.5 && tall >= 1 && tall <= 1.5)
 * ```
 */
export let bulk = (kind: string, seed: number) => {
  let { id, shape } = shapeOf(kind, seed)
  let got = measured.get(id)
  if (got) return got
  let { vox, size } = shape()
  let r = 0, tall = 0
  for (let k of vox.keys()) {
    let [x, y, z] = unkey(k)
    r = Math.max(r, Math.hypot(x, z) * size + size / 2)
    tall = Math.max(tall, (y + 1) * size)
  }
  measured.set(id, got = { r, tall })
  return got
}
