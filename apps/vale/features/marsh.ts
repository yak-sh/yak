// The kinds of place of the marshes, and each of its levels' own:
// Reedmarsh's reed beds and village on stilts; Mirewood's mire and drowned
// woods; Fenhollow's fen of cotton grass and peat, and the dig in its ruins;
// the Sunken Kirk and its churchyard; Bogheart's bog and the briar's root;
// Sporefen's fen and its wood of ink caps and puffballs.
import { fbm, lerp, smooth } from '../rand.ts'
import type { Prop } from '../terrain.ts'
import { DEEP } from './deep.ts'
import { HILLS } from './hills.ts'
import { bump, type Feature, Top, wide } from './kit.ts'
import { VALE } from './vale.ts'

let { village, woods } = VALE
let { moor, ruins } = HILLS
let { shroomwood } = DEEP

// Low wet ground: the land sunk to about `at` metres, give or take noise
// `wet` metres either way, so the lowest of it stands in water.
let low =
  (at: number, wet: number, salt: number) =>
  (h: number, d: number, x: number, z: number, s: number) =>
    lerp(h, at + (fbm(x / 7, z / 7, salt + s) - 0.5) * wet, smooth(60, 30, d))

// Low wet ground at the water's edge, pools among mud and reeds.
let marsh: Feature = {
  shape: low(4.72, 2.6, 43),
  hold: wide,
  cover: (n) => n > 0.55 ? Top.lush : Top.mud,
  shore: Top.mud,
  trees: 0.14,
  rocks: -0.02,
  grows: ['birch', 'deadtree', 'birch'],
  decor: [['reed', 0.07], ['tuft', 0.04], ['mushroom', 0.004]],
}

/** Reedmarsh's village: huts on stilts round the fire, boardwalks between. */
let STILTS: Prop[] = [
  { kind: 'fire', x: 0, z: 0, seed: 1 },
  { kind: 'stilthut', x: -8, z: -8, seed: 11 },
  { kind: 'stilthut', x: 9, z: -9, seed: 12 },
  { kind: 'stilthut', x: 9, z: 9.5, seed: 13 },
  { kind: 'stilthut', x: -9, z: 9, seed: 14 },
  { kind: 'boardwalk', x: 0.5, z: -10, seed: 0 },
  { kind: 'boardwalk', x: 13, z: 0.5, seed: 1 },
  { kind: 'board', x: -3.5, z: 2.5, seed: 3 },
  { kind: 'lamp', x: -4, z: -4, seed: 4 },
  { kind: 'lamp', x: 4.5, z: 4.5, seed: 5 },
  { kind: 'lamp', x: -5, z: 5.5, seed: 6 },
  { kind: 'lamp', x: 5.5, z: -5, seed: 7 },
]

/** The Sunken Kirk: the walls of its nave, roofless, the bell tower at its
 * east end, and graves in the grass round it, south of where the roads
 * meet. */
let KIRK: Prop[] = [
  ...[-6.1, -3.3, 2.3].flatMap((x, i) => [
    { kind: 'ruin', x, z: 8.5, seed: i },
    { kind: 'ruin', x, z: 15.5, seed: i + 3 },
  ]),
  { kind: 'belltower', x: 6.5, z: 12, seed: 0 },
  ...[-8, -5, -2, 1, 4].flatMap((x, i) => [
    { kind: 'grave', x, z: 19.5 + (i % 2) * 0.5, seed: i },
    { kind: 'grave', x: x + 1, z: 22.5, seed: i + 5 },
  ]),
]

/** The churchyard: the crypt under the old chapel, graves in rows. */
let YARD: Prop[] = [
  { kind: 'crypt', x: 0, z: 0, seed: 0 },
  ...Array.from({ length: 12 }, (_, i): Prop => ({
    kind: 'grave',
    x: -7.5 + (i % 6) * 3,
    z: i < 6 ? 6 : 9.5,
    seed: i * 7,
  })),
]

export let MARSH: Record<string, Feature> = {
  marsh,
  // Reedmarsh's reed beds: gold reeds taller than a hero over channels of
  // open water, and eel traps along them.
  reedbed: {
    ...marsh,
    like: 'marsh',
    shape: low(4.6, 2.2, 45),
    trees: -0.05,
    grows: ['birch'],
    decor: [['goldreed', 0.14], ['reed', 0.03], ['eeltrap', 0.004]],
  },
  // A village on stilts over the mud.
  stilts: {
    ...village,
    like: 'village',
    shape: (h, d) => lerp(h, 5.3, smooth(14, 7.5, d)),
    builds: STILTS,
  },
  // Mirewood's mire: black water under swamp cypresses hung with moss,
  // bramble thick with berries, and the old cypress.
  mire: {
    ...marsh,
    like: 'marsh',
    shape: low(4.6, 2.4, 47),
    cover: (n) => n > 0.5 ? Top.lush : Top.mud,
    trees: 0.35,
    rocks: 0.06,
    grows: ['swamptree', 'swamptree', 'deadtree'],
    stones: ['berrybush'],
    decor: [['reed', 0.03], ['fern', 0.03], ['mushroom', 0.01]],
    builds: [{ kind: 'oldcypress', x: 13, z: -7, seed: 0 }],
  },
  // A wood drowned in the mire.
  drownedwood: {
    ...woods,
    like: 'woods',
    cover: (n) => n > 0.4 ? Top.lush : Top.mud,
    trees: 0.7,
    rocks: 0.1,
    grows: ['swamptree'],
    stones: ['berrybush'],
    decor: [['fern', 0.04], ['reed', 0.02], ['mushroom', 0.012]],
  },
  // Fenhollow's fen: peat and tawny grass, white with cotton grass, and
  // turves stacked to dry.
  fen: {
    ...marsh,
    like: 'marsh',
    cover: (n) => n > 0.6 ? Top.dry : Top.mud,
    trees: -0.05,
    rocks: 0.1,
    grows: ['birch'],
    stones: ['peatstack'],
    decor: [['cottongrass', 0.1], ['tuft', 0.03]],
  },
  // A moor cut for peat.
  turfmoor: {
    ...moor,
    like: 'moor',
    stones: ['peatstack', 'rock'],
    decor: [['cottongrass', 0.05], ['heather', 0.04]],
    builds: undefined,
  },
  // The ruins at Fenhollow, being dug: a pit in their middle, the spoil
  // heaped by it, and the digger's tent.
  dig: {
    ...ruins,
    like: 'ruins',
    shape: (h, d, x, z, s) =>
      ruins.shape(h, d, x, z, s) - smooth(4.5, 3.5, d) * 1.2,
    builds: [
      ...ruins.builds!,
      { kind: 'digtent', x: 10, z: -5, seed: 0 },
      { kind: 'spoil', x: 4, z: 3.5, seed: 0 },
      { kind: 'spoil', x: -4.5, z: -3, seed: 1 },
    ],
  },
  // The Sunken Kirk, sinking into the marsh.
  kirk: {
    ...ruins,
    like: 'ruins',
    shape: (h, d) => lerp(h, 5.5, smooth(26, 16, d)),
    hold: (d) => bump(d, 22),
    cover: (n, d) => d < 20 && n > 0.5 ? Top.stone : undefined,
    trees: -0.1,
    rocks: 0.05,
    stones: ['grave'],
    builds: KIRK,
  },
  // The churchyard round the old chapel: yews, graves, and the crypt.
  churchyard: {
    ...ruins,
    like: 'ruins',
    cover: () => Top.grass,
    trees: 0.15,
    grows: ['yew'],
    stones: ['grave'],
    builds: YARD,
  },
  // Bogheart's bog: black water and red moss, dead trees standing in it,
  // Granny Rush's hut, and the briar's root coiled out of the heart of it.
  bog: {
    ...marsh,
    like: 'marsh',
    shape: low(4.5, 2.6, 49),
    cover: (n) => n > 0.72 ? Top.lush : Top.mud,
    trees: 0.06,
    grows: ['deadtree'],
    decor: [['sphagnum', 0.1], ['reed', 0.03]],
    builds: [
      { kind: 'briarroot', x: 0, z: 15, seed: 0 },
      { kind: 'hut', x: 10, z: 7, seed: 0 },
    ],
  },
  // Sporefen's wood: ink caps and puffballs on ground yellow with spore.
  sporewood: {
    ...shroomwood,
    like: 'shroomwood',
    grows: ['inkcap', 'inkcap', 'puffball'],
    decor: [['mushroom', 0.05], ['tuft', 0.02]],
  },
  // The fen at Sporefen, and the great puffball in it.
  sporemarsh: {
    ...marsh,
    like: 'marsh',
    cover: (n) => n > 0.5 ? Top.spore : Top.mud,
    trees: 0.1,
    grows: ['inkcap', 'deadtree'],
    rocks: 0.08,
    stones: ['puffball'],
    decor: [['reed', 0.04], ['mushroom', 0.03]],
    builds: [{ kind: 'bigpuff', x: 0, z: 0, seed: 0 }],
  },
}
