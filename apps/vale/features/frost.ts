// The kinds of place of the frost, and each of its levels' own: Frostmoor's
// wind-scoured moor, stunted pines and the cutters' ice; Rimeholt's woods
// white with rime and its stockaded holt; Frostpine's deep spruce and the
// woodcutters' clearing; Icefall's frozen fall, crevasses and fields of
// ice; Whitepeak's peak, cornices and high snow.
import { fbm, lerp, smooth } from '../rand.ts'
import type { Prop } from '../terrain.ts'
import { bump, type Feature, hamlet, ring, Top, wide } from './kit.ts'
import { VALE } from './vale.ts'

let { village, pinewood, lake } = VALE

/** Rimeholt's holt: longhouses round the fire, woodpiles, and a stockade
 * round it all, open where its roads and lanes run. */
let HOLT: Prop[] = hamlet('longhouse', 'well', [
  { kind: 'woodpile', x: -4, z: -12, seed: 0 },
  { kind: 'woodpile', x: 14, z: 3, seed: 1 },
  ...ring('stake', 17, 96, [
    ...[94, 95, 0, 1, 2, 9, 10, 11, 12, 22, 23, 24, 25, 26],
    ...[57, 58, 59, 60, 70, 71, 72, 73, 74, 84, 85, 86, 87],
  ]),
])

// Rolling snow, snow-laden spruce.
let snowfield: Feature = {
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
}
// A sheet of ice, cracked by crevasses, and seracs standing on it.
let glacier: Feature = {
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
}

export let FROST: Record<string, Feature> = {
  snowfield,
  glacier,
  // A cold tarn, its edge frozen, spruce down to it.
  tarn: {
    ...lake,
    like: 'lake',
    shore: Top.ice,
    grows: ['spruce'],
  },
  // Frostmoor: a moor the wind has scoured, heather black through the snow,
  // hardly a tree.
  snowmoor: {
    ...snowfield,
    like: 'snowfield',
    cover: (n) => n > 0.72 ? Top.stone : n > 0.55 ? Top.heath : Top.snow,
    trees: -0.08,
    rocks: 0.08,
    grows: ['stuntpine'],
    decor: [['rimeheather', 0.08]],
  },
  // Pines the wind has bent low.
  stuntpines: {
    ...pinewood,
    like: 'pinewood',
    cover: () => Top.snow,
    trees: 0.3,
    grows: ['stuntpine'],
    stones: ['snowrock'],
    decor: [['rimeheather', 0.03]],
  },
  // The glacier the ice-cutters work, blocks of it stacked for the sledge.
  icecut: {
    ...glacier,
    like: 'glacier',
    builds: [
      { kind: 'iceblocks', x: -12, z: 10, seed: 0 },
      { kind: 'iceblocks', x: -7, z: 14, seed: 1 },
    ],
  },
  // Rimeholt's woods, every spruce white with rime.
  rimewood: {
    ...snowfield,
    like: 'snowfield',
    trees: 0.45,
    grows: ['rimespruce'],
  },
  // The holt, inside its stockade.
  holt: { ...village, like: 'village', builds: HOLT, dress: 'turf' },
  // Frostpine's snow under close spruce.
  snowpines: {
    ...snowfield,
    like: 'snowfield',
    cover: (n) => n > 0.7 ? Top.lush : Top.snow,
    trees: 0.35,
    grows: ['spruce', 'spruce', 'bigspruce'],
  },
  // Spruce older than the holt, taller than any tree in the south.
  deeppines: {
    ...pinewood,
    like: 'pinewood',
    cover: (n) => n > 0.55 ? Top.lush : Top.snow,
    trees: 0.7,
    grows: ['bigspruce'],
    stones: ['snowrock'],
  },
  // The woodcutters' clearing: stumps, and the wood stacked to season.
  loggers: {
    ...pinewood,
    like: 'pinewood',
    cover: () => Top.snow,
    trees: 0.1,
    rocks: 0.3,
    grows: ['spruce'],
    stones: ['stump', 'stump', 'stump', 'woodpile'],
  },
  // Icefall's cliff of ice, and the fall frozen down its face.
  icefall: {
    ...glacier,
    like: 'glacier',
    shape: (h, d, x, z, s) =>
      h + smooth(20, 13, d) * (11 + fbm(x / 8, z / 8, 67 + s) * 2),
    hold: (d) => bump(d, 22),
    builds: [{ kind: 'frozenfall', x: 0, z: 18.5, seed: 0 }],
  },
  // A glacier cut deep with crevasses.
  crevasses: {
    ...glacier,
    like: 'glacier',
    shape: (h, d, x, z, s) =>
      glacier.shape(h, d, x, z, s) -
      bump(d, 28) *
        smooth(0.08, 0, Math.abs(fbm(x / 7, z / 7, 69 + s) - 0.5)) * 3,
    rocks: 0.18,
  },
  // Snow blown off into sheets of ice, polished by the wind.
  icefield: {
    ...snowfield,
    like: 'snowfield',
    cover: (n) => n > 0.62 ? Top.ice : Top.snow,
    trees: -0.05,
    rocks: 0.08,
    stones: ['serac', 'snowrock'],
  },
  // Whitepeak: the peak itself, and the cairn and flags on its top.
  peak: {
    ...glacier,
    like: 'glacier',
    shape: (h, d, x, z, s) =>
      h + bump(d, 14) * 25 * (0.7 + fbm(x / 4, z / 4, 71 + s) * 0.6),
    hold: (d) => bump(d, 18),
    cover: (n) => n > 0.62 ? Top.stone : Top.snow,
    cliff: Top.stone,
    rocks: 0.05,
    stones: ['snowrock'],
    builds: [{ kind: 'flagcairn', x: 0, z: 0, seed: 0 }],
  },
  // Ridges of snow the wind has built out over the drops.
  cornice: {
    ...glacier,
    like: 'glacier',
    cover: (n) => n > 0.3 ? Top.snow : Top.ice,
    rocks: 0.06,
  },
  // The high snow, deep and clean, and Aud's hut in it.
  highsnow: {
    ...snowfield,
    like: 'snowfield',
    cover: () => Top.snow,
    trees: -0.1,
    rocks: 0.04,
    builds: [{ kind: 'stonehut', x: -31, z: -6, seed: 0 }],
  },
}
