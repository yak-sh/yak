// What a chunk of a level draws, meshed and packed: the ground and what
// stands on it, with a foundation of stone under each structure, and apart
// from those the flowers and grass, which the page draws only near the
// player. All of it about the chunk's north-west corner, where the page
// stands the chunk. No three.js and no page: a worker runs it (grow.ts), a
// chunk at a time as the page asks (stream.ts), and the page turns each packed
// chunk into meshes (world.ts).
import { CHUNK, groundChunk } from './ground.ts'
import { cuboid, out, pack, type Packed, place } from './mesh.ts'
import { KINDS, model } from './props.ts'
import { foundation, type Prop, standAt, type Vale } from './terrain.ts'

/** A chunk, `ci` across and `ck` down: what casts shadows, and its small
 * things, or null when it has none or none were asked for. */
export type Chunk = {
  ci: number
  ck: number
  solid: Packed
  small: Packed | null
}

// The stone a structure's foundation is laid in.
let FOUND = 0x8e8b82

// Each vale's props by the chunk they stand in.
let sorted = new WeakMap<Vale, Map<string, Prop[]>>()
let propsIn = (v: Vale, ci: number, ck: number) => {
  let by = sorted.get(v)
  if (!by) {
    sorted.set(v, by = new Map())
    for (let p of v.props) {
      let key = `${Math.floor(p.x / CHUNK)} ${Math.floor(p.z / CHUNK)}`
      if (!by.has(key)) by.set(key, [])
      by.get(key)!.push(p)
    }
  }
  return by.get(`${ci} ${ck}`) ?? []
}

/** Chunk (ci, ck) of vale `v`, meshed about its north-west corner: its small
 * things too when `small` asks for them.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { vale } from './terrain.ts'
 * let v = vale('mossvale', 1)
 * let c = chunk(v, 4, 4, true)
 * // Every corner lies within the chunk's square, give or take a prop's reach.
 * let xs = [...c.solid.pos].filter((_, i) => i % 3 == 0)
 * assertEquals(Math.min(...xs) > -4 && Math.max(...xs) < 20, true)
 * assertEquals(chunk(v, 4, 4, false).small, null)
 * ```
 */
export let chunk = (v: Vale, ci: number, ck: number, small: boolean): Chunk => {
  let ox = ci * CHUNK, oz = ck * CHUNK
  let solid = groundChunk(v, ci, ck, out())
  let bits = out()
  for (let p of propsIn(v, ci, ck)) {
    let tiny = KINDS[p.kind].small
    if (tiny && !small) continue
    place(tiny ? bits : solid, model(p.kind, p.seed), [
      p.x - ox,
      standAt(v, p),
      p.z - oz,
    ])
    let base = foundation(v, p)
    if (base) {
      let [[x, y, z], size] = base
      cuboid(solid, [x - ox, y, z - oz], size, FOUND, 0.25, 0.04)
    }
  }
  return {
    ci,
    ck,
    solid: pack(solid),
    small: bits.idx.length ? pack(bits) : null,
  }
}
