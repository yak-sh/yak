// What a chunk of the world draws: the ground and non-building props are
// meshed and packed, with a foundation of stone under each structure. Its
// buildings are placements of shared shapes (world.ts). Flowers and grass
// are drawn only near the player. A worker runs this without three.js, and
// the page turns each packed chunk into meshes and keeps its ground.
import { groundChunk } from './ground.ts'
import { cuboids } from './boxes.ts'
import { out, pack, type Packed, place, type Vec } from './mesh.ts'
import { KINDS, model } from './props.ts'
import type { Natural } from './nature.ts'
import { baseline, natureMesh } from './nature_mesh.ts'
import { off, propAt, spacer, step, type Stood, thingAt } from './stand.ts'
import {
  adopt,
  CHUNK,
  decor,
  foundation,
  type Patch,
  standAt,
  type Vale,
} from './terrain.ts'

/** A chunk, `ci` across and `ck` down: what casts shadows, and its small
 * things, or null when it has none or none were asked for; and its ground,
 * as grown. */
export type Chunk = {
  ci: number
  ck: number
  solid: Packed
  small: Packed | null
  buildings: { kind: string; seed: number; turn: number; at: Vec }[]
  natural?: Natural[]
  nature?: Packed | null
  stood?: Stood[]
  patch: Patch
}

// The stone a structure's foundation is laid in.
let FOUND = 0x8e8b82

/** Chunk (ci, ck) of vale `v`, grown and meshed about its north-west corner:
 * its small things too when `small` asks for them.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { vale } from './terrain.ts'
 * let c = chunk(vale(1), 4, 4, true)
 * // Every corner lies within the chunk's square, give or take a prop's reach.
 * let xs = [...c.solid.pos].filter((_, i) => i % 3 == 0)
 * assertEquals(Math.min(...xs) > -4 && Math.max(...xs) < 20, true)
 * assertEquals(chunk(vale(1), 4, 4, false).small, null)
 * ```
 */
export let chunk = (v: Vale, ci: number, ck: number, small: boolean): Chunk => {
  let ox = ci * CHUNK, oz = ck * CHUNK
  let patch = v.grow(ci, ck)
  adopt(v, patch)
  let solid = groundChunk(patch, out())
  let bits = out()
  let buildings: Chunk['buildings'] = []
  let props = v.plant(ci, ck)
  let stood: Stood[] = props.map((prop) => ({ prop, step: step(v, prop) }))
  let steps = new Map(stood.map(({ prop, step }) => [prop, step]))
  let natural: Natural[] = []
  let smallSpace = small ? spacer(v.voxel) : null
  for (let p of small ? [...props, ...decor(patch)] : props) {
    if (p.natural) {
      let at = steps.get(p)!
      smallSpace?.add(propAt(v, p), at)
      let [dx, dy, dz] = off(at)
      natural.push({
        prop: p,
        at: [p.x + dx, standAt(v, p) + dy, p.z + dz],
      })
      continue
    }
    let kind = KINDS[p.kind], tiny = kind.small
    if (tiny && !small) continue
    let y = standAt(v, p)
    let mesh = tiny ? model(p.kind, p.seed, p.turn, small) : null
    let n = tiny
      ? smallSpace!(thingAt([p.x, y, p.z], [mesh!], v.voxel))
      : steps.get(p) ?? step(v, p)
    if (!tiny) smallSpace?.add(propAt(v, p), n)
    let [dx, dy, dz] = off(n)
    if (kind.raise) {
      buildings.push({
        kind: p.kind,
        seed: p.seed,
        turn: p.turn ?? 0,
        at: [p.x + dx, y + dy, p.z + dz],
      })
    } else {
      place(tiny ? bits : solid, mesh ?? model(p.kind, p.seed, p.turn, small), [
        p.x - ox + dx,
        y + dy,
        p.z - oz + dz,
      ])
    }
    let base = foundation(v, p)
    if (base) {
      let [[x, y, z], size] = base
      cuboids(
        solid,
        [[[x - ox + dx, y + dy, z - oz + dz], size, FOUND]],
        0.25,
        0.04,
      )
    }
  }
  return {
    ci,
    ck,
    solid: pack(solid),
    small: bits.idx.length ? pack(bits) : null,
    buildings,
    natural,
    nature: natureMesh(ci, ck, natural.map(baseline)),
    stood,
    patch,
  }
}
