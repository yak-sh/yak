// The kinds of place of the hills and moors, and the ruins on them; and each
// level's own: Stonestep's quarry, its village of the quarry's stone and the
// watch-fire on its moor;
// Heatherfell's heather, the stones on its fell and its scree; Oldwall's wall,
// bracken and autumn wood; Kingsbarrow's barrow, its moor of graves and the
// old king's hall; Giantsteps' stair of basalt and its columns.
import { fbm, lerp, smooth } from '../rand.ts'
import type { Prop } from '../terrain.ts'
import { bump, crest, type Feature, hamlet, ring, Top, wide } from './kit.ts'
import { VALE } from './vale.ts'

let { crags, woods, village } = VALE

/** A ruin: a broken ring of columns, and what stands of the walls round it. */
let RUINS: Prop[] = [
  ...ring('pillar', 7, 8, [3, 6]),
  { kind: 'ruin', x: -2, z: -11, seed: 1 },
  { kind: 'ruin', x: 5, z: 11, seed: 2 },
  { kind: 'ruin', x: -11.5, z: 4, seed: 3 },
]

/** Standing stones in a ring. */
let STONES: Prop[] = ring('menhir', 5.5, 7, [4])

/** The old kingdom's wall, running east and west across Oldwall south of
 * where its roads meet: stretch after stretch of rampart, a breach or two,
 * and a tower either side of the gate. */
let WALL: Prop[] = [
  ...Array.from({ length: 12 }, (_, k) => k).flatMap((k): Prop[] => [
    { kind: 'rampart', x: -6 - k * 2.9, z: 8, seed: k },
    { kind: 'rampart', x: 6 + k * 2.9, z: 8, seed: k + 12 },
  ]).filter((_, i) => i != 9 && i != 16),
  { kind: 'walltower', x: -3.5, z: 8, seed: 0 },
  { kind: 'walltower', x: 3.5, z: 8, seed: 1 },
]

/** The old king's hall: two rows of its posts, what stands of its end walls,
 * and his high seat. */
let HALL: Prop[] = [
  ...[-6, -3, 0, 3, 6].flatMap((x, i) => [
    { kind: 'hallpost', x, z: -4, seed: i },
    { kind: 'hallpost', x, z: 4, seed: i + 5 },
  ]),
  { kind: 'ruin', x: -9, z: 0, seed: 1 },
  { kind: 'throne', x: 9, z: 0, seed: 0 },
]

// Rolling heath, heather, hardly a tree.
let moor: Feature = {
  shape: (h, d, x, z, s) =>
    h + bump(d, 44) * (fbm(x / 12, z / 12, 47 + s) - 0.4) * 5,
  hold: wide,
  cover: (n) => n > 0.3 ? Top.heath : Top.dry,
  trees: -0.03,
  rocks: 0.06,
  grows: ['birch'],
  stones: ['rock', 'rock', 'rock', 'rock', 'rock', 'menhir'],
  decor: [['heather', 0.07], ['tuft', 0.03]],
}
// What is left of an old hall: a floor of flags, a ring of columns.
let ruins: Feature = {
  shape: (h, d) => lerp(h, 6.8, smooth(16, 8, d)),
  hold: (d) => bump(d, 16),
  last: true,
  cover: (n, d) => d < 12 && n > 0.42 ? Top.stone : undefined,
  trees: -0.2,
  rocks: 0.15,
  decor: [['tuft', 0.05], ['flower', 0.008]],
  builds: RUINS,
}
// Loose stone down a steep slope.
let scree: Feature = {
  ...crags,
  like: 'crags',
  cover: (n) => n > 0.2 ? Top.stone : Top.dry,
  trees: -0.2,
  rocks: 0.5,
  stones: ['rock'],
  decor: [['tuft', 0.01]],
}
// Crags of black basalt, broken into columns.
let basaltcrags: Feature = {
  ...crags,
  like: 'crags',
  cover: (n) => n > 0.4 ? Top.stone : Top.dry,
  trees: -0.1,
  rocks: 0.4,
  stones: ['columns'],
}

export let HILLS: Record<string, Feature> = {
  moor,
  ruins,
  // Stonestep's quarry: the crag cut back in terraces, blocks stacked on
  // them, and the derrick that lifts them.
  quarry: {
    ...crags,
    like: 'crags',
    shape: (h, d, x, z, s) => {
      let top = h + bump(d, 24) * (3 + fbm(x / 6.5, z / 6.5, 3 + s) * 9)
      return lerp(top, Math.floor(top / 1.5) * 1.5, smooth(30, 20, d))
    },
    cover: (n) => n > 0.3 ? Top.stone : Top.dry,
    trees: -0.2,
    rocks: 0.35,
    stones: ['block'],
    builds: [{ kind: 'derrick', x: 6, z: 6, seed: 0 }],
  },
  // The moor the wall-watch walks, and its watch-fire.
  watchmoor: {
    ...moor,
    like: 'moor',
    stones: ['rock'],
    builds: [{ kind: 'brazier', x: 0, z: 0, seed: 0 }],
  },
  // Heatherfell's fell: a round green hill, the old stones in a ring on its
  // top and a cairn by them.
  fell: {
    shape: (h, d, x, z, s) =>
      h + bump(d, 24) * (6 + fbm(x / 10, z / 10, 81 + s) * 2),
    hold: (d) => bump(d, 24),
    like: 'crags',
    cover: (n) => n > 0.5 ? Top.heath : Top.grass,
    trees: -0.1,
    rocks: 0.08,
    stones: ['rock'],
    decor: [['heather', 0.05], ['tuft', 0.04]],
    builds: [...STONES, { kind: 'cairn', x: 9, z: -4, seed: 0 }],
  },
  scree,
  // Oldwall's wall.
  oldwall: {
    ...ruins,
    like: 'ruins',
    builds: WALL,
  },
  // A moor of bracken gone rust-brown.
  bracken: {
    ...moor,
    like: 'moor',
    cover: (n) => n > 0.45 ? Top.heath : Top.dry,
    grows: ['autumnoak'],
    stones: ['rock'],
    decor: [['bracken', 0.1], ['tuft', 0.02]],
  },
  // Oaks in autumn, red and gold, their leaves in the grass.
  autumnwood: {
    ...woods,
    like: 'woods',
    cover: (n) => n > 0.5 ? Top.lush : Top.dry,
    grows: ['autumnoak'],
    decor: [['fallen', 0.08], ['mushroom', 0.012], ['tuft', 0.02]],
  },
  // The old king's barrow: a great round mound, its door in the south side
  // between standing stones.
  barrow: {
    ...ruins,
    like: 'ruins',
    shape: (h, d) => lerp(h, 6.8, smooth(20, 12, d)) + bump(d, 8) * 4.5,
    cover: () => Top.lush,
    rocks: 0.05,
    builds: [
      { kind: 'barrowdoor', x: 0, z: 9.5, seed: 0 },
      ...ring('menhir', 15, 9, [2]),
    ],
  },
  // Kingsbarrow's moor, humped with lesser barrows and marked with cairns.
  barrowmoor: {
    ...moor,
    like: 'moor',
    shape: (h, d, x, z, s) =>
      moor.shape(h, d, x, z, s) +
      bump(d, 44) * smooth(0.8, 0.95, crest(fbm(x / 9, z / 9, 83 + s))) * 1.5,
    stones: ['cairn', 'rock', 'rock'],
  },
  // The old king's hall, fallen.
  meadhall: {
    ...ruins,
    like: 'ruins',
    builds: HALL,
  },
  // Giantsteps' stair: a hill cut by giants into steps each taller than a
  // hero, of black basalt.
  giantstair: {
    ...basaltcrags,
    shape: (h, d) => h + Math.floor(bump(d, 20) * 9 / 1.2) * 1.2,
    hold: (d) => bump(d, 22),
    cover: () => Top.stone,
    rocks: 0.15,
  },
  basaltcrags,
  // A moor strewn with fallen columns.
  stonefield: {
    ...moor,
    like: 'moor',
    rocks: 0.12,
    stones: ['columns', 'rock'],
  },
  // Stonestep's village, built of the quarry's stone.
  stonetown: { ...village, like: 'village', builds: hamlet('stonehouse') },
}
