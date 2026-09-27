// What stands on the ground: trees, rocks, flowers, what each land grows and
// builds, the village, its buildings (buildings.ts), and the signpost at the
// head of each road. Each kind is a row in its land's file under props/: a
// small voxel model built by hand out of balls and boxes, and what a walker
// makes of it. A model is meshed once per shape and turn and copied wherever
// a level places one (terrain.ts `props`), and measured, so what a walker
// bumps into or stands on is the size it is drawn (`bulk`).
import { BUILDINGS } from './buildings.ts'
import { type Glow, type Raised, spin, spun } from './buildings/kit.ts'
import { light } from './buildings/light.ts'
import { blob, type Out, out, type Profile, profileOf, unkey } from './mesh.ts'
import { COAST } from './props/coast.ts'
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
  ...COAST,
  ...MARSH,
  ...HILLS,
  ...SANDS,
  ...DEEP,
  ...FROST,
  ...FIRE,
  ...BUILDINGS,
}

// Which of its kind's shapes a prop is, as `kind:shape`, the seed that shape
// is made from, and the shape, built once.
let shapeOf = (kind: string, seed: number) => {
  let k = KINDS[kind]
  let n = k.shapes ? seed % k.shapes : seed
  let id = `${kind}:${n}`, salt = n * 7919 + 17
  return {
    id,
    salt,
    shape: () => {
      let got = made.get(id)
      if (!got) made.set(id, got = k.make(salt))
      return got
    },
  }
}
let made = new Map<string, Model>()

let meshed = new Map<string, Out>()
let profiled = new Map<string, Profile>()

/** The same model wherever its kind, shape, turn and detail are drawn. */
export let modelKey = (kind: string, seed: number, turn = 0, near = true) =>
  `${shapeOf(kind, seed).id}:${((turn % 4) + 4) % 4}${
    KINDS[kind].raise ? `:${near}` : ''
  }`

// Mesh once for drawing, or briefly to measure where its faces lie.
let makeModel = (kind: string, seed: number, turn: number, near: boolean) => {
  let { shape } = shapeOf(kind, seed)
  let { vox, size, at = [-size / 2, 0, -size / 2] } = shape()
  let raised = KINDS[kind].raise ? raisedOf(kind, seed) : null
  if (raised && !near) vox = raised.shell
  let o = blob(out(), spun(vox, turn, 1 + (at[0] + at[2]) / size), size, at)
  if (raised?.glows.length) {
    let glows = raised.glows.map((g): Glow => {
      let [x, z] = spin(g.at[0], g.at[2], turn)
      return { ...g, at: [x, g.at[1], z] }
    })
    light(o, glows)
  }
  return o
}

/** A prop's triangles, placed with the middle of its base at the origin and
 * turned `turn` quarter turns (a building faces its square). Buildings draw
 * their interiors only at the nearest detail. */
export let model = (kind: string, seed: number, turn = 0, near = true): Out => {
  let look = modelKey(kind, seed, turn, near)
  let o = meshed.get(look)
  if (!o) meshed.set(look, o = makeModel(kind, seed, turn, near))
  return o
}

/** A model's face planes for spacing, without retaining its triangles. */
export let modelProfile = (
  kind: string,
  seed: number,
  turn = 0,
  near = true,
): Profile => {
  let look = modelKey(kind, seed, turn, near)
  let p = profiled.get(look)
  if (!p) {
    p = profileOf(meshed.get(look) ?? makeModel(kind, seed, turn, near))
    profiled.set(look, p)
  }
  return p
}

/** A building's shape, raised (buildings.ts), for a prop of its kind; or
 * null for a prop that is not a building. */
export let raisedOf = (kind: string, seed: number): Raised | null => {
  let raise = KINDS[kind].raise
  return raise ? raise(shapeOf(kind, seed).salt) : null
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
