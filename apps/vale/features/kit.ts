// What every land's kinds of place are made with: what tops the ground, a
// kind of place, and the shapes more than one land uses.
import type { Prop } from '../terrain.ts'
import { smooth } from '../rand.ts'

/** What a column is topped with. */
export let Top = {
  grass: 0,
  lush: 1,
  dry: 2,
  sand: 3,
  stone: 4,
  path: 5,
  snow: 6,
  mud: 7,
  heath: 8,
  spore: 9,
  ash: 10,
  ember: 11,
  clay: 12,
  ice: 13,
}

export let bump = (d: number, r: number) => Math.exp(-(d * d) / (r * r))
// How a place that spreads over a whole level holds it: most of it within 50
// metres of its middle, fading out by 100; a little less the further out, so
// where two meet the nearer holds; and less than a smaller place does at its
// own middle, so one standing inside it is still itself.
export let wide = (d: number) => (0.66 - d * 0.0015) * smooth(100, 50, d)
// Noise folded into crests: 1 along a line through the middle, 0 far off.
export let crest = (n: number) => 1 - Math.abs(2 * n - 1)

/** A kind of place: how it shapes the ground `d` metres from its middle, at
 * (x, z) (`s` salts its noise), and how strongly a point there is its own
 * (`hold`). A place that shapes `last` flattens what the others raised.
 *
 * Where it holds a point, a place decides what the ground is topped with:
 * `cover`, from noise `n` in [0, 1), the distance to its middle and where the
 * point is, or none to leave it to the next place; `shore` where the ground
 * is low and `cliff` where it is steep. It decides how much likelier a tree
 * or a rock is there (`trees`, `rocks`), which ones grow (`grows`, `stones`),
 * and what grows underfoot (`decor`: each kind with its chance in a
 * half-metre cell), on green ground only unless it lies `strewn` over sand
 * and stone as well (shells, weed at the tide). What it `builds` stands
 * around its middle, by where from it. Heights are in
 * metres. A kind of place one level has alone is `like` a kind more have
 * (a heather fell is a moor), so what lives in the one lives in the other. */
export type Feature = {
  shape: (h: number, d: number, x: number, z: number, s: number) => number
  hold: (d: number) => number
  last?: boolean
  cover?: (n: number, d: number, x: number, z: number) => number | undefined
  shore?: number
  cliff?: number
  trees?: number
  rocks?: number
  grows?: string[]
  stones?: string[]
  decor?: [string, number][]
  strewn?: boolean
  builds?: Prop[]
  like?: string
}

// Props set in a ring `r` metres round a middle, one every `n`th of a turn,
// but for the ones fallen (`gone`).
export let ring = (kind: string, r: number, n: number, gone: number[] = []) =>
  Array.from({ length: n }, (_, i): Prop => ({
    kind,
    x: Math.round(Math.cos((i / n) * Math.PI * 2) * r * 2) / 2,
    z: Math.round(Math.sin((i / n) * Math.PI * 2) * r * 2) / 2,
    seed: i,
  })).filter((_, i) => !gone.includes(i))
