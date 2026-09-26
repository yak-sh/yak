// What each chunk of a level draws, meshed and packed: the ground and what
// stands on it, with a foundation of stone under each structure, and apart
// from those the flowers and grass, which the page draws only near the
// player. No three.js and no page: a worker runs it (grow.ts), and the page
// turns each packed chunk into meshes (world.ts).
import { CHUNK, groundChunk } from './ground.ts'
import { cuboid, out, pack, type Packed, place } from './mesh.ts'
import { KINDS, model } from './props.ts'
import { foundation, type Prop, SIZE, standAt, type Vale } from './terrain.ts'

/** A chunk, `ci` across and `ck` down: what casts shadows, and its small
 * things, or null when it has none. */
export type Chunk = {
  ci: number
  ck: number
  solid: Packed
  small: Packed | null
}

// The stone a structure's foundation is laid in.
let FOUND = 0x8e8b82

/** Every chunk of the level, row by row. */
export let chunks = (v: Vale): Chunk[] => {
  let per = SIZE / CHUNK
  let byChunk = new Map<number, Prop[]>()
  for (let p of v.props) {
    let c = Math.floor(p.x / CHUNK) + Math.floor(p.z / CHUNK) * per
    if (!byChunk.has(c)) byChunk.set(c, [])
    byChunk.get(c)!.push(p)
  }
  let all: Chunk[] = []
  for (let ck = 0; ck < per; ck++) {
    for (let ci = 0; ci < per; ci++) {
      let solid = groundChunk(v, ci, ck, out())
      let small = out()
      for (let p of byChunk.get(ci + ck * per) ?? []) {
        place(KINDS[p.kind].small ? small : solid, model(p.kind, p.seed), [
          p.x,
          standAt(v, p),
          p.z,
        ])
        let base = foundation(v, p)
        if (base) cuboid(solid, base[0], base[1], FOUND, 0.25, 0.04)
      }
      all.push({
        ci,
        ck,
        solid: pack(solid),
        small: small.idx.length ? pack(small) : null,
      })
    }
  }
  return all
}
