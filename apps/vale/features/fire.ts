// The kinds of place of the fire country, and each of its levels' own:
// Emberfall's forge town, its burnt heath, glowing ash and the lava falling
// down its volcano; Cinderreach's black flats and vents; Ashkeep's keep, its
// gate and its cold cone; the Maw itself, the scorch before it and the cone
// that spits.
import { fbm, smooth } from '../rand.ts'
import type { Prop } from '../terrain.ts'
import { HILLS } from './hills.ts'
import { bump, type Feature, hamlet, Top, wide } from './kit.ts'
import { VALE } from './vale.ts'

let { village } = VALE
let { moor, ruins } = HILLS

/** Ashkeep: its tower west of where the road comes in, its walls round the
 * court, open north to the road, and its banners. */
let KEEP: Prop[] = [
  { kind: 'keeptower', x: -9, z: -6, seed: 0 },
  ...[-10.5, -7.5, -4.5, 4.5, 7.5, 10.5].map((x, i): Prop => ({
    kind: 'curtain',
    x,
    z: -13,
    seed: i,
  })),
  ...[-10.5, -7.5, -4.5, -1.5, 1.5, 4.5, 7.5, 10.5].map((x, i): Prop => ({
    kind: 'curtain',
    x,
    z: 13,
    seed: i + 6,
  })),
  { kind: 'banner', x: -3, z: -11, seed: 0 },
  { kind: 'banner', x: 3, z: -11, seed: 1 },
  { kind: 'banner', x: 6, z: 6, seed: 2 },
]

// A cone of ash with a glowing crater.
let volcano: Feature = {
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
}
// Plains of cinder, split by glowing cracks, and basalt standing up.
let ashfield: Feature = {
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
}

export let FIRE: Record<string, Feature> = {
  volcano,
  ashfield,
  // Emberfall's forge town.
  forgetown: {
    ...village,
    like: 'village',
    builds: hamlet('forgehouse', 'anvil'),
    dress: 'stone',
  },
  // The volcano over Emberfall, lava running down its south flank.
  lavafall: {
    ...volcano,
    like: 'volcano',
    builds: [{ kind: 'lavafall', x: 0, z: 13, seed: 0 }],
  },
  // A heath the fire went through: heather burnt black, trees standing
  // charred.
  cinderheath: {
    ...moor,
    like: 'moor',
    trees: 0.08,
    grows: ['chartree'],
    stones: ['cinder'],
    decor: [],
  },
  // Emberfall's ash, glowing where it lies thin.
  emberash: {
    ...ashfield,
    like: 'ashfield',
    cover: (n, d) =>
      n > 0.68 && d < 44 ? Top.ember : n > 0.3 ? Top.ash : Top.stone,
    grows: ['chartree'],
  },
  // Cinderreach: flats of black cinder, nothing growing, basalt and cinder
  // heaped on them.
  cinderflats: {
    ...ashfield,
    like: 'ashfield',
    cover: (n, d) =>
      n > 0.8 && d < 44 ? Top.ember : n > 0.45 ? Top.ash : Top.stone,
    trees: -0.05,
    rocks: 0.14,
    grows: [],
    stones: ['cinder', 'cinder', 'basalt'],
  },
  // A field of vents, crusted yellow with brimstone.
  vents: {
    ...volcano,
    like: 'volcano',
    shape: (h, d, x, z, s) =>
      h + smooth(24, 8, d) * (3 + fbm(x / 5, z / 5, 73 + s) * 2),
    cover: (n) => n > 0.6 ? Top.clay : Top.ash,
    rocks: 0.25,
    grows: [],
    stones: ['fumarole', 'fumarole', 'cinder'],
  },
  // Ashkeep's keep.
  keep: {
    ...ruins,
    like: 'ruins',
    shape: (h, d) => h + smooth(22, 14, d) * 0.5,
    hold: (d) => bump(d, 20),
    cover: (n, d) => d < 14 && n > 0.35 ? Top.stone : Top.ash,
    rocks: 0.05,
    stones: ['cinder'],
    decor: [],
    builds: KEEP,
  },
  // The ruined gate on the road to the Maw.
  ashgate: {
    ...ruins,
    like: 'ruins',
    cover: (n, d) => d < 10 && n > 0.4 ? Top.stone : Top.ash,
    decor: [],
    builds: [{ kind: 'ashgate', x: 0, z: 0, seed: 0 }],
  },
  // A cone gone cold, grey, dead trees on it.
  coldcone: {
    ...volcano,
    like: 'volcano',
    shape: (h, d, x, z, s) =>
      h + smooth(26, 6, d) * (7 + fbm(x / 5, z / 5, 75 + s) * 1.5),
    cover: (n) => n > 0.6 ? Top.stone : Top.ash,
    trees: 0.1,
  },
  // The Maw: a crater of lava, its rim a wall of black rock, and the thorn
  // standing up out of the middle of it.
  maw: {
    ...volcano,
    like: 'volcano',
    shape: (h, d, x, z, s) =>
      h + smooth(24, 14, d) * (6.5 + fbm(x / 4, z / 4, 77 + s) * 1.5) -
      smooth(13, 9, d) * 5.5,
    hold: (d) => bump(d, 24),
    cover: (n, d) => d < 11 ? Top.ember : n > 0.55 ? Top.stone : Top.ash,
    grows: [],
    stones: ['obsidian', 'basalt'],
    builds: [{ kind: 'thornspire', x: 0, z: 0, seed: 0 }],
  },
  // Before the Maw: ground scorched to glass, glowing in its cracks.
  scorch: {
    ...ashfield,
    like: 'ashfield',
    cover: (n, d) => n > 0.7 && d < 44 ? Top.ember : Top.ash,
    trees: -0.05,
    grows: [],
    stones: ['obsidian', 'obsidian', 'cinder'],
  },
  // A small cone that spits, its crater wide and bright.
  spatter: {
    ...volcano,
    like: 'volcano',
    shape: (h, d, x, z, s) =>
      h + smooth(18, 5, d) * (6 + fbm(x / 4, z / 4, 79 + s)) -
      smooth(8, 3, d) * 3,
    cover: (n, d) => d < 7 ? Top.ember : n > 0.7 ? Top.stone : Top.ash,
    grows: [],
  },
}
