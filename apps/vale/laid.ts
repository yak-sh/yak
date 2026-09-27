// What is laid over the ground without being part of it: the arcs round the
// creature I have targeted, the ring of ground a creature's bite takes and
// the disc filling it, the glow under a piece of loot, the ripples over a
// shoal. Each lies a lift above the highest ground it covers, so no column of
// the ground pokes through it and the depth buffer never takes the one for
// the other. None of them writes depth, so where they lie over each other
// their render order says which is drawn over which, never a nudge up.
import { groundAt, type Vale } from './terrain.ts'

/** How far above what it covers an overlay lies, in metres. */
export let LIFT = 0.05

/** Where an overlay `r` metres across, laid at (x, z), lies: a lift above
 * the highest ground within `r` of it, on a slope as on the flat, or above
 * `floor` where that is higher, a floor the thing it marks stands on.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { flat } from './terrain.ts'
 * let v = flat((x) => x >= 50.5 && x < 51.5 ? 6 : 5)
 * assertEquals(laid(v, 50, 50), 5 + LIFT)
 * // A step up a metre off, under the ring: it lies over the step.
 * assertEquals(laid(v, 50, 50, 1), 6 + LIFT)
 * // A high column between the ring's sample points still lifts the disc.
 * let between = flat((x, z) => x >= 50.5 && x < 50.75 &&
 *   z >= 50.25 && z < 50.5 ? 8 : 5)
 * assertEquals(laid(between, 50, 50, 1), 8 + LIFT)
 * assertEquals(laid(v, 50, 50, 0, 7), 7 + LIFT)
 * ```
 */
export let laid = (v: Vale, x: number, z: number, r = 0, floor = -Infinity) => {
  let y = Math.max(floor, groundAt(v, x, z))
  let g = v.voxel
  for (let iz = Math.floor((z - r) / g); iz <= Math.floor((z + r) / g); iz++) {
    for (
      let ix = Math.floor((x - r) / g);
      ix <= Math.floor((x + r) / g);
      ix++
    ) {
      let dx = Math.max(ix * g - x, 0, x - (ix + 1) * g)
      let dz = Math.max(iz * g - z, 0, z - (iz + 1) * g)
      if (dx * dx + dz * dz > r * r) continue
      y = Math.max(y, groundAt(v, (ix + 0.5) * g, (iz + 0.5) * g))
    }
  }
  return y + LIFT
}
