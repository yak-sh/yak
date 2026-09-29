// Cave sites and their open space. A cave is a floor height map below the
// surface, with the surface's rock as its ceiling. The short unroofed mouth
// joins that floor to the land outside without a portal or a second world.
import { spotOf } from './regions.ts'
import { fbm, lerp, smooth } from './rand.ts'

export type Cave = {
  floor: number
  ceiling: number | null
  mouth: boolean
}

let RIDGE = spotOf('mossvale', 'ridge')!

/** The cave open at a column, if one runs under it. Heights are metres. */
export let caveAt = (x: number, z: number, surface: number): Cave | null => {
  let dx = x - RIDGE[0], dz = z - RIDGE[1]
  let inside = dx * dx / (14 * 14) + dz * dz / (16 * 16) < 1
  let mouth = Math.abs(dx) < 2.75 && dz >= -25 && dz < -11
  if (!inside && !mouth) return null
  let floor = 7.25 + (fbm(x / 5, z / 5, 311, 2) - 0.5) * 0.35
  if (mouth) {
    let t = smooth(-25, -11, dz)
    floor = lerp(7, floor, t)
    return { floor, ceiling: null, mouth: true }
  }
  let ceiling = surface - 0.5
  if (ceiling - floor < 2.2) return null
  return { floor, ceiling, mouth: false }
}
