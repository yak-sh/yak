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
 * let v = flat(5)
 * assertEquals(laid(v, 50, 50), 5 + LIFT)
 * // A step up a metre off, under the ring: it lies over the step.
 * v.h[Math.floor(51 / v.voxel) + Math.floor(50 / v.voxel) * v.cols] =
 *   6 / v.voxel
 * assertEquals(laid(v, 50, 50, 1), 6 + LIFT)
 * assertEquals(laid(v, 50, 50, 0, 7), 7 + LIFT)
 * ```
 */
export let laid = (v: Vale, x: number, z: number, r = 0, floor = -Infinity) => {
  let y = Math.max(floor, groundAt(v, x, z))
  for (let i = 0; r && i < 16; i++) {
    let a = ((i % 8) / 4) * Math.PI, d = i < 8 ? r : r / 2
    y = Math.max(y, groundAt(v, x + Math.cos(a) * d, z + Math.sin(a) * d))
  }
  return y + LIFT
}
