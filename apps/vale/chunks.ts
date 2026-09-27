// What a chunk of the world draws, meshed and packed: the ground and what
// stands on it, with a foundation of stone under each structure, and apart
// from those the flowers and grass, which the page draws only near the
// player. All of it about the chunk's north-west corner, where the page
// stands the chunk. No three.js and no page: a worker runs it (grow.ts), a
// chunk at a time as the page asks (stream.ts), and the page turns each packed
// chunk into meshes (world.ts), and keeps the ground it was grown from.
import { groundChunk } from './ground.ts'
import { cuboids } from './boxes.ts'
import { out, pack, type Packed, place } from './mesh.ts'
>>>>>>> 7e18319f (Mossvale: a model built of boxes never draws two faces in one plane. Its boxes are one solid (boxes.ts): each is worn over those before it, a side within a step (5 mm, mesh.ts STEP) of an earlier box's same side standing a step outside it, or flush where both are the same stuff; and a face is drawn only where it shows, cut where another box lies against it or over it. A figure's parts are worn over the parts before them that stand square to them as it is built (parts.ts knit), so a thigh no longer flickers against a flank. Figures, a thing's look, logs and stumps and a foundation all go through it; mesh.ts `fights` finds any two faces the depth buffer cannot tell apart, and tests over every creature, every hero's dress, every look and every prop find none (T-40879))
import { KINDS, model } from './props.ts'
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
  let props = v.plant(ci, ck)
  for (let p of small ? [...props, ...decor(patch)] : props) {
    let tiny = KINDS[p.kind].small
    if (tiny && !small) continue
    place(tiny ? bits : solid, model(p.kind, p.seed, p.turn), [
      p.x - ox,
      standAt(v, p),
      p.z - oz,
    ])
    let base = foundation(v, p)
    if (base) {
      let [[x, y, z], size] = base
      cuboids(solid, [[[x - ox, y, z - oz], size, FOUND]], 0.25, 0.04)
    }
  }
  return {
    ci,
    ck,
    solid: pack(solid),
    small: bits.idx.length ? pack(bits) : null,
    patch,
  }
}
