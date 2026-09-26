// The kinds of place of the sands, and each of its levels' own: Dustmere's
// cracked pan where the mere was, its well town, its old shore and the last
// pool; Palmwell's palm grove, caravan camp and golden dunes; Sunscar's great
// dunes, the bones in them, the buried town and the scar; Redmesa's red rock,
// buttes and spring; Tombsands' necropolis, sunken tomb, dunes and cliffs.
import { fbm, lerp, smooth } from '../rand.ts'
import type { Prop } from '../terrain.ts'
import { HILLS } from './hills.ts'
import { bump, crest, type Feature, hamlet, ring, Top, wide } from './kit.ts'
import { VALE } from './vale.ts'

let { village } = VALE
let { ruins } = HILLS

/** Tombsands' necropolis: the pyramid north-west of where the roads meet,
 * obelisks either side of the road south, and tombs in rows. */
let NECROPOLIS: Prop[] = [
  { kind: 'pyramid', x: -17, z: -15, seed: 0 },
  { kind: 'obelisk', x: -3, z: 6, seed: 0 },
  { kind: 'obelisk', x: 3, z: 6, seed: 1 },
  { kind: 'obelisk', x: -3, z: 13, seed: 2 },
  { kind: 'obelisk', x: 3, z: 13, seed: 3 },
  { kind: 'mastaba', x: -12, z: 6, seed: 0 },
  { kind: 'mastaba', x: -12, z: 14, seed: 1 },
  { kind: 'mastaba', x: 12, z: -9, seed: 2 },
]

// Sand in long crests, cactus and bleached stone.
let dunes: Feature = {
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
}
// Red buttes, flat on top and sheer at the sides.
let mesa: Feature = {
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
}
// A pool in the sand, ringed with palms and green.
let oasis: Feature = {
  shape: (h, d) => lerp(h, 3, bump(d, 8)),
  hold: (d) => bump(d, 16),
  last: true,
  cover: () => Top.lush,
  trees: 0.6,
  grows: ['palm'],
  decor: [['tuft', 0.05], ['flower', 0.012]],
}

export let SANDS: Record<string, Feature> = {
  dunes,
  mesa,
  oasis,
  // Dustmere's pan: the bed of the mere, flat and cracked, dead thorn on it
  // and the boat the water left.
  dustpan: {
    ...dunes,
    like: 'dunes',
    shape: (h, d, x, z, s) =>
      lerp(h, 6.2 + fbm(x / 20, z / 20, 59 + s) * 0.5, smooth(64, 34, d)),
    cover: (_n, _d, x, z) =>
      crest(fbm(x / 2.2, z / 2.2, 91)) > 0.9 ? Top.mud : Top.dry,
    trees: 0.03,
    rocks: 0.02,
    grows: ['thornbush'],
    stones: ['bones'],
    builds: [{ kind: 'hull', x: 20, z: 9, seed: 0 }],
  },
  // Dustmere's town round its well, of mud brick, the windpump over it.
  welltown: {
    ...village,
    like: 'village',
    builds: hamlet('adobe', 'windpump', [
      { kind: 'jars', x: 6.5, z: -3.5, seed: 0 },
      { kind: 'jars', x: -11, z: -3, seed: 1 },
    ]),
  },
  // Where the mere's shore was, a bank of dry mud above the pan.
  oldshore: {
    ...mesa,
    like: 'mesa',
    cover: () => Top.dry,
    cliff: Top.mud,
    grows: ['thornbush'],
    stones: ['sandstone', 'bones'],
  },
  // The last of the mere: a pool of mud, dead trees standing in it.
  lastpool: {
    ...oasis,
    like: 'oasis',
    cover: () => Top.mud,
    shore: Top.mud,
    trees: 0.3,
    grows: ['deadtree'],
    decor: [['reed', 0.05]],
  },
  // Palmwell's grove: a wide pool under date palms, reeds at its edge.
  palmgrove: {
    ...oasis,
    like: 'oasis',
    shape: (h, d) => lerp(h, 3, bump(d, 12)),
    hold: (d) => bump(d, 22),
    trees: 0.85,
    grows: ['datepalm'],
    decor: [['tuft', 0.06], ['flower', 0.02], ['reed', 0.03]],
  },
  // The caravans' camp: tents round the fire and the well.
  caravan: {
    ...village,
    like: 'village',
    builds: hamlet('tent', 'well'),
  },
  // Golden dunes, a date palm here and there.
  golddunes: {
    ...dunes,
    like: 'dunes',
    trees: 0.04,
    grows: ['datepalm', 'cactus'],
  },
  // Sunscar's dunes: great crests of bare sand, nothing growing.
  greatdunes: {
    ...dunes,
    like: 'dunes',
    shape: (h, d, x, z, s) =>
      lerp(
        h,
        7 + crest(fbm(x / 22 + z / 60, z / 13, 61 + s, 3)) * 5.5,
        smooth(64, 34, d),
      ),
    trees: -0.05,
    rocks: -0.01,
    grows: [],
  },
  // Bones in the dunes, and the great ribcage.
  bonedunes: {
    ...dunes,
    like: 'dunes',
    trees: -0.05,
    rocks: 0.05,
    grows: [],
    stones: ['bones'],
    builds: [{ kind: 'ribcage', x: 0, z: 0, seed: 0 }],
  },
  // The town the sand buried: its gate, columns standing out of the sand.
  buried: {
    ...ruins,
    like: 'ruins',
    shape: (h, d) => lerp(h, 7.4, smooth(18, 10, d)),
    cover: () => Top.sand,
    rocks: 0.05,
    decor: [],
    builds: [
      { kind: 'buriedgate', x: 0, z: 0, seed: 0 },
      ...ring('pillar', 10, 8, [1, 2]),
    ],
  },
  // The scar: sand the sun fused to black glass.
  scar: {
    ...mesa,
    like: 'mesa',
    shape: (h, d) => lerp(h, 5.8, smooth(18, 10, d)),
    hold: (d) => bump(d, 20),
    cover: (_n, d) => d < 11 ? Top.ash : undefined,
    cliff: Top.ash,
    trees: -0.2,
    rocks: 0.3,
    grows: [],
    stones: ['glassrock'],
  },
  // Redmesa's red rock, and its arch south of where the roads meet.
  redrock: {
    ...mesa,
    like: 'mesa',
    stones: ['hoodoo', 'sandstone'],
    builds: [{ kind: 'arch', x: 0, z: 15, seed: 0 }],
  },
  // Buttes of red rock, sheer and flat-topped, hoodoos round their feet.
  buttes: {
    ...mesa,
    like: 'mesa',
    shape: (h, d, x, z, s) =>
      h + bump(d, 26) * smooth(0.46, 0.5, fbm(x / 12, z / 12, 63 + s)) * 11,
    grows: ['hoodoo'],
    rocks: 0.15,
    stones: ['hoodoo'],
  },
  // The spring under the cottonwoods where the hawks come to drink.
  spring: {
    ...oasis,
    like: 'oasis',
    grows: ['cottonwood'],
    decor: [['tuft', 0.06], ['reed', 0.03]],
  },
  // Tombsands' necropolis.
  necropolis: {
    ...ruins,
    like: 'ruins',
    shape: (h, d) => lerp(h, 7, smooth(30, 20, d)),
    hold: (d) => bump(d, 26),
    cover: (n, d) => d < 16 && n > 0.45 ? Top.stone : Top.sand,
    rocks: 0.05,
    stones: ['urn'],
    decor: [],
    builds: NECROPOLIS,
  },
  // The sunken tomb: the colossus sunk to his chin, columns round him.
  sunkentomb: {
    ...ruins,
    like: 'ruins',
    shape: (h, d) => lerp(h, 6.2, smooth(16, 10, d)),
    cover: () => Top.sand,
    decor: [],
    builds: [
      { kind: 'colossus', x: 0, z: 0, seed: 0 },
      ...ring('pillar', 9, 7, [2]),
    ],
  },
  // Pale dunes, broken obelisks and urns in them.
  tombdunes: {
    ...dunes,
    like: 'dunes',
    grows: [],
    stones: ['sandstone', 'sandstone', 'urn', 'obelisk'],
  },
  // Cliffs of pale stone, tombs at their feet.
  tombcliffs: {
    ...mesa,
    like: 'mesa',
    cover: (n) => n > 0.3 ? Top.stone : Top.sand,
    cliff: Top.stone,
    grows: [],
    stones: ['urn', 'sandstone'],
    builds: [
      { kind: 'mastaba', x: -8, z: 20, seed: 3 },
      { kind: 'mastaba', x: 8, z: 20, seed: 4 },
    ],
  },
}
