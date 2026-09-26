// The kinds of place a level is made of (levels.ts names one at each point):
// how each shapes the ground, what it covers the ground with, what grows
// there, and what stands at its middle. terrain.ts grows a level from them.
// A new kind of place is a row of FEATURES; creatures find it by its name
// (beasts.ts `haunts`).
import { fbm, lerp, smooth } from './rand.ts'
import type { Prop } from './terrain.ts'

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

let bump = (d: number, r: number) => Math.exp(-(d * d) / (r * r))
// How a place that spreads over a whole level holds it: most of it within 50
// metres of its middle, fading out by 100; a little less the further out, so
// where two meet the nearer holds; and less than a smaller place does at its
// own middle, so one standing inside it is still itself.
let wide = (d: number) => (0.66 - d * 0.0015) * smooth(100, 50, d)
// Noise folded into crests: 1 along a line through the middle, 0 far off.
let crest = (n: number) => 1 - Math.abs(2 * n - 1)

/** A kind of place: how it shapes the ground `d` metres from its middle, at
 * (x, z) (`s` salts its noise), and how strongly a point there is its own
 * (`hold`). A place that shapes `last` flattens what the others raised.
 *
 * Where it holds a point, a place decides what the ground is topped with:
 * `cover`, from noise `n` in [0, 1) and the distance to its middle, or none
 * to leave it to the next place; `shore` where the ground is low and `cliff`
 * where it is steep. It decides how much likelier a tree or a rock is there
 * (`trees`, `rocks`), which ones grow (`grows`, `stones`), and what grows
 * underfoot (`decor`: each kind with its chance in a half-metre cell). What
 * it `builds` stands around its middle, by where from it. Heights are in
 * metres. */
export type Feature = {
  shape: (h: number, d: number, x: number, z: number, s: number) => number
  hold: (d: number) => number
  last?: boolean
  cover?: (n: number, d: number) => number | undefined
  shore?: number
  cliff?: number
  trees?: number
  rocks?: number
  grows?: string[]
  stones?: string[]
  decor?: [string, number][]
  builds?: Prop[]
}

/** A village's buildings, by where each stands from the village's middle. */
export let VILLAGE: Prop[] = [
  { kind: 'fire', x: 0, z: 0, seed: 1 },
  { kind: 'cottage', x: -8, z: -8, seed: 11 },
  { kind: 'cottage', x: 9, z: -9, seed: 12 },
  { kind: 'hall', x: 9, z: 9.5, seed: 13 },
  { kind: 'cottage', x: -9, z: 9, seed: 14 },
  { kind: 'well', x: 4, z: -2, seed: 2 },
  { kind: 'board', x: -3.5, z: 2.5, seed: 3 },
  { kind: 'lamp', x: -4, z: -4, seed: 4 },
  { kind: 'lamp', x: 4.5, z: 4.5, seed: 5 },
  { kind: 'lamp', x: -5, z: 5.5, seed: 6 },
  { kind: 'lamp', x: 5.5, z: -5, seed: 7 },
]

// Props set in a ring `r` metres round a middle, one every `n`th of a turn,
// but for the ones fallen (`gone`).
let ring = (kind: string, r: number, n: number, gone: number[] = []) =>
  Array.from({ length: n }, (_, i): Prop => ({
    kind,
    x: Math.round(Math.cos((i / n) * Math.PI * 2) * r * 2) / 2,
    z: Math.round(Math.sin((i / n) * Math.PI * 2) * r * 2) / 2,
    seed: i,
  })).filter((_, i) => !gone.includes(i))

/** A ruin: a broken ring of columns, and what stands of the walls round it. */
export let RUINS: Prop[] = [
  ...ring('pillar', 7, 8, [3, 6]),
  { kind: 'ruin', x: -2, z: -11, seed: 1 },
  { kind: 'ruin', x: 5, z: 11, seed: 2 },
  { kind: 'ruin', x: -11.5, z: 4, seed: 3 },
]

/** Standing stones in a ring. */
export let STONES: Prop[] = ring('menhir', 5.5, 7, [4])

export let FEATURES: Record<string, Feature> = {
  crags: {
    shape: (h, d, x, z, s) =>
      h + bump(d, 25) * (1.5 + fbm(x / 6.5, z / 6.5, 3 + s) * 12),
    hold: (d) => bump(d, 23),
    cover: (n) => n > 0.62 ? Top.stone : Top.dry,
    trees: -0.05,
    rocks: 0.45,
    grows: ['pine'],
    stones: ['rock'],
    decor: [['flower', 0.006], ['tuft', 0.044]],
  },
  ridge: {
    shape: (h, d) => h + smooth(18, 10, d) * 6,
    hold: (d) => bump(d, 15),
    rocks: 0.2,
    stones: ['rock'],
  },
  woods: {
    shape: (h, d, x, z, s) =>
      h + bump(d, 28) * (fbm(x / 8, z / 8, 7 + s) - 0.35) * 3.5,
    hold: (d) => bump(d, 26),
    cover: () => Top.lush,
    trees: 0.75,
    decor: [['flower', 0.018], ['tuft', 0.032], ['mushroom', 0.012]],
  },
  lake: {
    shape: (h, d) => h - bump(d, 12.5) * 6,
    hold: (d) => bump(d, 15),
    trees: 0.2,
    grows: ['birch'],
  },
  fields: { shape: (h) => h, hold: () => 0 },
  village: {
    shape: (h, d) => lerp(h, 6.5, smooth(14, 7.5, d)),
    hold: (d) => bump(d, 13),
    last: true,
    trees: -0.3,
    builds: VILLAGE,
  },
  // Open grass thick with flowers, the hills smoothed low.
  meadow: {
    shape: (h, d, x, z, s) =>
      lerp(h, 7 + (fbm(x / 14, z / 14, 41 + s) - 0.5) * 1.6, bump(d, 30) * 0.8),
    hold: (d) => bump(d, 30),
    cover: (n) => n > 0.78 ? Top.lush : Top.grass,
    trees: -0.03,
    decor: [['flower', 0.07], ['tuft', 0.05]],
  },
  // Low wet ground at the water's edge, pools among mud and reeds.
  marsh: {
    shape: (h, d, x, z, s) =>
      lerp(
        h,
        4.72 + (fbm(x / 7, z / 7, 43 + s) - 0.5) * 2.6,
        smooth(60, 30, d),
      ),
    hold: wide,
    cover: (n) => n > 0.55 ? Top.lush : Top.mud,
    shore: Top.mud,
    trees: 0.14,
    rocks: -0.02,
    grows: ['birch', 'deadtree', 'birch'],
    decor: [['reed', 0.07], ['tuft', 0.04], ['mushroom', 0.004]],
  },
  // A dark forest of pines on rolling ground.
  pinewood: {
    shape: (h, d, x, z, s) =>
      h + bump(d, 30) * (fbm(x / 9, z / 9, 45 + s) - 0.3) * 5,
    hold: (d) => bump(d, 30),
    cover: (n) => n > 0.45 ? Top.lush : undefined,
    trees: 0.8,
    rocks: 0.06,
    grows: ['pine'],
    decor: [['tuft', 0.03], ['mushroom', 0.01]],
  },
  // Rolling heath, heather and standing stones, hardly a tree.
  moor: {
    shape: (h, d, x, z, s) =>
      h + bump(d, 44) * (fbm(x / 12, z / 12, 47 + s) - 0.4) * 5,
    hold: wide,
    cover: (n) => n > 0.3 ? Top.heath : Top.dry,
    trees: -0.03,
    rocks: 0.06,
    grows: ['birch'],
    stones: ['rock', 'rock', 'rock', 'rock', 'rock', 'menhir'],
    decor: [['heather', 0.07], ['tuft', 0.03]],
    builds: STONES,
  },
  // What is left of an old hall: a floor of flags, a ring of columns.
  ruins: {
    shape: (h, d) => lerp(h, 6.8, smooth(16, 8, d)),
    hold: (d) => bump(d, 16),
    last: true,
    cover: (n, d) => d < 12 && n > 0.42 ? Top.stone : undefined,
    trees: -0.2,
    rocks: 0.15,
    decor: [['tuft', 0.05], ['flower', 0.008]],
    builds: RUINS,
  },
  // A wood of giant toadstools on soft violet ground.
  shroomwood: {
    shape: (h, d, x, z, s) =>
      h + bump(d, 36) * (fbm(x / 8, z / 8, 49 + s) - 0.4) * 3.5,
    hold: wide,
    cover: (n) => n > 0.62 ? Top.lush : Top.spore,
    trees: 0.5,
    rocks: 0.02,
    grows: ['toadstool', 'toadstool', 'toadstool', 'oak'],
    decor: [['mushroom', 0.05], ['tuft', 0.02]],
  },
  // The sea, and a beach of sand and dune grass down to it.
  coast: {
    shape: (h, d, x, z, s) =>
      h - bump(d, 30) * (6.5 + fbm(x / 9, z / 9, 51 + s) * 2),
    hold: (d) => bump(d, 34),
    cover: (n) => n > 0.62 ? Top.dry : Top.sand,
    trees: 0.1,
    rocks: 0.06,
    grows: ['palm'],
    decor: [['tuft', 0.02]],
  },
  // Shallow sea broken into islets.
  isles: {
    shape: (h, d, x, z, s) =>
      lerp(h, 2.2 + fbm(x / 7, z / 7, 53 + s) * 5.2, smooth(60, 30, d)),
    hold: wide,
    cover: (n) => n > 0.5 ? Top.grass : Top.sand,
    trees: 0.1,
    rocks: 0.08,
    grows: ['palm'],
    decor: [['tuft', 0.03], ['flower', 0.01]],
  },
  // Sand in long crests, cactus and bleached stone.
  dunes: {
    shape: (h, d, x, z, s) =>
      lerp(
        h,
        6.8 + crest(fbm(x / 18 + z / 50, z / 10, 55 + s, 3)) * 3.2,
        smooth(64, 34, d),
      ),
    hold: wide,
    cover: () => Top.sand,
    trees: 0.02,
    rocks: 0.03,
    grows: ['cactus'],
    stones: ['sandstone'],
    decor: [],
  },
  // Red buttes, flat on top and sheer at the sides.
  mesa: {
    shape: (h, d, x, z, s) =>
      h + bump(d, 30) * smooth(0.5, 0.56, fbm(x / 11, z / 11, 57 + s)) * 6,
    hold: (d) => bump(d, 30),
    cover: (n) => n > 0.3 ? Top.clay : Top.sand,
    cliff: Top.clay,
    trees: 0.02,
    rocks: 0.1,
    grows: ['cactus'],
    stones: ['sandstone'],
    decor: [],
  },
  // A pool in the sand, ringed with palms and green.
  oasis: {
    shape: (h, d) => lerp(h, 3, bump(d, 8)),
    hold: (d) => bump(d, 16),
    last: true,
    cover: () => Top.lush,
    trees: 0.6,
    grows: ['palm'],
    decor: [['tuft', 0.05], ['flower', 0.012]],
  },
  // Rolling snow, snow-laden spruce.
  snowfield: {
    shape: (h, d, x, z, s) =>
      h + bump(d, 44) * (fbm(x / 13, z / 13, 59 + s) - 0.4) * 4,
    hold: wide,
    cover: (n) => n > 0.8 ? Top.stone : Top.snow,
    shore: Top.ice,
    trees: 0.15,
    rocks: 0.05,
    grows: ['spruce'],
    stones: ['snowrock'],
    decor: [],
  },
  // A sheet of ice, cracked by crevasses, and seracs standing on it.
  glacier: {
    shape: (h, d, x, z, s) =>
      lerp(
        h,
        9 + fbm(x / 10, z / 10, 61 + s) * 3 -
          smooth(0.05, 0, Math.abs(fbm(x / 9, z / 9, 63 + s) - 0.5)) * 2,
        bump(d, 28),
      ),
    hold: (d) => bump(d, 28),
    cover: (n) => n > 0.75 ? Top.snow : Top.ice,
    cliff: Top.ice,
    trees: -0.2,
    rocks: 0.1,
    stones: ['serac'],
    decor: [],
  },
  // A cone of ash with a glowing crater.
  volcano: {
    shape: (h, d, x, z, s) =>
      h + smooth(26, 6, d) * (8.5 + fbm(x / 5, z / 5, 65 + s) * 1.5) -
      smooth(7, 2, d) * 4,
    hold: (d) => bump(d, 24),
    cover: (n, d) => d < 5 ? Top.ember : n > 0.7 ? Top.stone : Top.ash,
    cliff: Top.ash,
    trees: -0.1,
    rocks: 0.08,
    grows: ['deadtree'],
    stones: ['basalt', 'cinder'],
    decor: [],
  },
  // Plains of cinder, split by glowing cracks, and basalt standing up.
  ashfield: {
    shape: (h, d, x, z, s) =>
      h + bump(d, 44) * (fbm(x / 10, z / 10, 67 + s) - 0.45) * 3,
    hold: wide,
    cover: (n, d) =>
      n > 0.76 && d < 44 ? Top.ember : n > 0.3 ? Top.ash : Top.stone,
    cliff: Top.ash,
    shore: Top.ash,
    trees: 0.03,
    rocks: 0.09,
    grows: ['deadtree'],
    stones: ['basalt', 'cinder'],
    decor: [],
  },
  // Crystals grown up out of the stone.
  crystals: {
    shape: (h, d, x, z, s) => h + bump(d, 20) * fbm(x / 6, z / 6, 69 + s) * 2.5,
    hold: (d) => bump(d, 22),
    cover: (n) => n > 0.45 ? Top.stone : undefined,
    trees: -0.1,
    rocks: 0.35,
    stones: ['crystal'],
  },
}
