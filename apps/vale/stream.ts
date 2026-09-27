// Which chunks the page draws, and how finely. Every chunk whose nearest
// point lies within sight of where the page looks is drawn, finer the nearer:
// a voxel's step is a few pixels wherever it is drawn, so the ground near the
// hero shows every quarter metre and the hills at the edge of the fog every
// metre. Chunks further off than sight are let go. Plain numbers, so the page
// asks it every frame (world.ts).
import { CHUNK } from './terrain.ts'

/** How near a chunk's nearest point must be, in metres, to be drawn at each
 * detail: the finest within the first ring, the next within the second, and
 * the coarsest out to the edge of sight. */
export let RINGS = [40, 72]
/** How much coarser each detail's voxels are than the finest's. */
export let COARSER = [1, 2, 4]
// How far past a ring's line a chunk keeps the detail it is drawn at, and
// past sight how far it stays drawn, in metres, so a chunk on the line does
// not flicker between two.
let SLACK = 6

/** A chunk to draw, `ci` across and `ck` down, at a detail (0 the finest),
 * and how far its nearest point is, in metres. */
export type Want = { ci: number; ck: number; lod: number; d: number }

// How far (x, z) is from the nearest point of chunk (ci, ck).
let gap = (x: number, z: number, ci: number, ck: number) => {
  let dx = Math.max(ci * CHUNK - x, 0, x - (ci + 1) * CHUNK)
  let dz = Math.max(ck * CHUNK - z, 0, z - (ck + 1) * CHUNK)
  return Math.sqrt(dx * dx + dz * dz)
}

// Whether a chunk's index is within a world `per` chunks across.
let within = (c: number, per: number) => per == Infinity || (c >= 0 && c < per)

// The detail a chunk this far off is drawn at, given the one it has: kept
// while it is within SLACK of its own ring.
let detail = (d: number, has?: number) => {
  if (has != null) {
    let inner = RINGS[has - 1] ?? -Infinity, outer = RINGS[has] ?? Infinity
    if (d >= inner - SLACK && d < outer + SLACK) return has
  }
  let i = RINGS.findIndex((r) => d < r)
  return i < 0 ? RINGS.length : i
}

/**
 * Every chunk to draw from (x, z), nearest first: each one within `sight`
 * metres, at its detail, and each drawn one still within `sight` and SLACK,
 * at the detail it has unless it strayed past its ring. `has` says what a
 * chunk is drawn at now; `per`, when the world has edges, keeps to chunks 0
 * to `per` − 1 each way.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let at = (x: number, z: number, has = () => undefined as number | undefined) =>
 *   wanted(x, z, 110, has)
 * let of = (w: Want[], ci: number, ck: number) =>
 *   w.find((c) => c.ci == ci && c.ck == ck)?.lod
 * // Standing in chunk (0, 0): it is drawn finest, a chunk 50 m off coarser,
 * // one 90 m off coarser again, and one past sight not at all.
 * let w = at(8, 8)
 * assertEquals([of(w, 0, 0), of(w, 3, 0), of(w, 6, 0), of(w, 8, 0)], [0, 1, 2, undefined])
 * assertEquals(w[0], { ci: 0, ck: 0, lod: 0, d: 0 })
 * // A chunk just past the first ring keeps the finest detail it has.
 * assertEquals([of(at(5, 8), 3, 0), of(at(5, 8, () => 0), 3, 0)], [1, 0])
 * // A world with edges draws nothing past them.
 * assertEquals(wanted(8, 8, 110, () => undefined, 8).every((c) => c.ci >= 0 && c.ci < 8), true)
 * ```
 */
export let wanted = (
  x: number,
  z: number,
  sight: number,
  has: (ci: number, ck: number) => number | undefined,
  per = Infinity,
): Want[] => {
  let r = Math.ceil((sight + SLACK) / CHUNK)
  let fi = Math.floor(x / CHUNK), fk = Math.floor(z / CHUNK)
  let out: Want[] = []
  for (let ck = fk - r; ck <= fk + r; ck++) {
    for (let ci = fi - r; ci <= fi + r; ci++) {
      if (!within(ci, per) || !within(ck, per)) continue
      let d = gap(x, z, ci, ck), now = has(ci, ck)
      if (d < sight || (now != null && d < sight + SLACK)) {
        out.push({ ci, ck, lod: detail(d, now), d })
      }
    }
  }
  return out.sort((a, b) => a.d - b.d)
}
