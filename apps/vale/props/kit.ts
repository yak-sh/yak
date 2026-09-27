// What every land's props are made with: a model and a kind of prop, and the
// few shapes more than one land builds from (a canopy, a heap of boulders).
import type { Raised } from '../buildings/kit.ts'
import { ball, type Vec, type Vox } from '../mesh.ts'
import { noise, stream } from '../rand.ts'
import type { Craft } from '../trades.ts'

/** A prop's voxels, how big each is, in metres, and where voxel (0, 0, 0)'s
 * lowest corner is, from the prop's foot: by default so that the voxel sits
 * over it. */
export type Model = { vox: Vox; size: number; at?: Vec }

/** A kind of prop: how to build one of its shapes from a seed, and how many
 * shapes it has. What a walker makes of it: `solid` all through, as wide and
 * tall as it is drawn, so a jump can land on one low enough; or a trunk or a
 * post `girth` metres wide at its foot, or a row of them `row` metres either
 * way along x (a wall, a log), as tall as it is drawn; or nothing. How much ground it takes
 * (`foot`, a radius in metres, where nothing else grows), and the ground a
 * structure stands on (`span`, metres east–west and north–south, a
 * foundation filling below). A `small` one grows underfoot: drawn only near,
 * and casting no shadow. One that `glow`s is lit at dusk: a lantern `at`
 * metres from its foot (east, up, south), in a halo `size` metres across, of
 * lamplight or its own `color`. One that stands `aside` is built at the
 * nearest spot to where it was planned that is off the roads and lanes and
 * clear of other builds (terrain.ts). A building is `raise`d (buildings.ts),
 * and one that is a `station` is worked at (craft.ts). */
export type Kind = {
  make: (seed: number) => Model
  raise?: (seed: number) => Raised
  station?: Craft
  shapes?: number
  solid?: boolean
  girth?: number
  row?: number
  foot?: number
  span?: [number, number]
  small?: boolean
  glow?: { at: [number, number, number]; size: number; color?: number }
  aside?: boolean
}

export let pickOf = <T>(r: () => number, xs: T[]) =>
  xs[Math.floor(r() * xs.length)]

/** A canopy: a lumpy ball, lighter toward the sun. */
export let canopy = (
  v: Vox,
  c: Vec,
  r: number,
  greens: number[],
  seed: number,
) =>
  ball(v, c, r, (x, y, z) => {
    let dx = x - c[0], dy = y - c[1], dz = z - c[2]
    let n = noise(x * 0.7 + seed, z * 0.7 + y * 0.3, seed)
    if (dx * dx + dy * dy + dz * dz > r * r * 0.6 && n < 0.3) return null
    let lift = dy / r
    return greens[lift > 0.35 ? 2 : lift > -0.3 ? 1 : 0]
  })

/** A heap of boulders in three shades, mossy on top where `moss` is. */
export let boulders =
  (greys: number[], moss: number | null) => (seed: number): Model => {
    let r = stream(seed), v: Vox = new Map()
    let lumps = 1 + Math.floor(r() * 3)
    for (let i = 0; i < lumps; i++) {
      let c: Vec = [Math.floor(r() * 3 - 1), 0, Math.floor(r() * 3 - 1)]
      ball(
        v,
        c,
        1.2 + r() * 1.1,
        (x, y, z) =>
          y < 0
            ? null
            : moss != null && y >= 1 && noise(x, z, seed) > 0.55
            ? moss
            : greys[(x + y + z) & 1 ? 0 : (x * 7 + z) % 3 == 0 ? 2 : 1],
      )
    }
    return { vox: v, size: 0.5 }
  }

/** The timber the vale builds with. */
export let TIMBER = 0x6a4b33
/** The stone a structure's footing is laid in. */
export let FOUND = 0x9c9a91
/** The old stone ruins are built of. */
export let OLD = [0xd6cfbd, 0xc8c0ac, 0xbdb5a0]
