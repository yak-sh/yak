// A building's lamps and fire light its own mesh. The light at each vertex is
// baked once per shape and turn into the unused high bits of its edge flags;
// soft.ts brings it up at dusk. Its facing keeps light inside the walls and
// under the ceiling, while the distance makes each source brightest nearby.
import type { Glow } from './kit.ts'
import { type Out, type Vec } from '../mesh.ts'

/** How much of the nearby lamps a face sees, before the day's light changes. */
export let warmth = (at: Vec, normal: Vec, glows: Glow[]) => {
  let light = 0
  for (let g of glows) {
    let dx = g.at[0] - at[0], dy = g.at[1] - at[1], dz = g.at[2] - at[2]
    let d = Math.hypot(dx, dy, dz)
    let reach = 1.5 + g.size * 1.5
    if (d >= reach) continue
    let face = Math.max(
      0,
      (dx * normal[0] + dy * normal[1] +
        dz * normal[2]) / Math.max(d, 0.01),
    )
    light += (1 - d / reach) ** 2 * face * 2.6
  }
  return Math.min(1, light)
}

/** A lamp lights the face toward it, strongest near its flame.
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * assert(warmth([0, 0, 0], [1, 0, 0], [{ at: [1, 0, 0], size: 2 }]) >
 *   warmth([-2, 0, 0], [1, 0, 0], [{ at: [1, 0, 0], size: 2 }]))
 * assertEquals(warmth([0, 0, 0], [-1, 0, 0], [
 *   { at: [1, 0, 0], size: 2 },
 * ]), 0)
 * ```
 */

/** Store a building's warm light in each vertex's edge-flag high nibble. */
export let light = (mesh: Out, glows: Glow[]) => {
  for (let i = 0; i < mesh.pos.length / 3; i++) {
    let p = i * 3, n = i * 4
    let at: Vec = [mesh.pos[p], mesh.pos[p + 1], mesh.pos[p + 2]]
    let face: Vec = [mesh.nrm[n], mesh.nrm[n + 1], mesh.nrm[n + 2]]
    mesh.edge[n + 2] |= Math.round(warmth(at, face, glows) * 15) << 4
  }
  return mesh
}
