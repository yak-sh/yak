// The kinds of place of the deep country: toadstool woods and crystal; and
// each level's own: Glowcap's blue caps and its houses in their stems;
// Gleamdeep's violet caps, its amethyst and the great geode; Shardvault's
// pale caps, its shards and its vault.
import { fbm } from '../rand.ts'
import {
  bump,
  type Feature,
  ring,
  Top,
  village as makeVillage,
  wide,
} from './kit.ts'
import { VALE } from './vale.ts'

let { village } = VALE

// A wood of giant toadstools on soft violet ground.
let shroomwood: Feature = {
  shape: (h, d, x, z, s) =>
    h + bump(d, 36) * (fbm(x / 8, z / 8, 49 + s) - 0.4) * 3.5,
  hold: wide,
  cover: (n) => n > 0.62 ? Top.lush : Top.spore,
  trees: 0.5,
  rocks: 0.02,
  grows: ['toadstool', 'toadstool', 'toadstool', 'oak'],
  decor: [['mushroom', 0.05], ['tuft', 0.02]],
}
// Crystals grown up out of the stone.
let crystals: Feature = {
  shape: (h, d, x, z, s) => h + bump(d, 20) * fbm(x / 6, z / 6, 69 + s) * 2.5,
  hold: (d) => bump(d, 22),
  cover: (n) => n > 0.45 ? Top.stone : undefined,
  trees: -0.1,
  rocks: 0.35,
  stones: ['crystal'],
}
// Amethyst in clusters, chips of it in the grass.
let amethyst: Feature = {
  ...crystals,
  like: 'crystals',
  stones: ['amethyst'],
  decor: [['gemchip', 0.06]],
}

export let DEEP: Record<string, Feature> = {
  shroomwood,
  crystals,
  // Glowcap's wood: toadstools with caps of glowing blue.
  glowcaps: {
    ...shroomwood,
    like: 'shroomwood',
    grows: ['glowcap'],
    decor: [['mushroom', 0.02], ['tuft', 0.02]],
  },
  // Glowcap's village, in the stems of toadstools.
  capvillage: {
    ...village,
    like: 'village',
    builds: makeVillage('well', [
      { kind: 'shroomhouse', x: -30, z: 0, seed: 1 },
    ], 'wisplamp'),
    dress: 'stone',
  },
  // Gleamdeep's wood: toadstools with violet caps, amethyst underfoot.
  gleamwood: {
    ...shroomwood,
    like: 'shroomwood',
    trees: 0.3,
    rocks: 0.12,
    grows: ['violetcap'],
    stones: ['amethyst'],
    decor: [['gemchip', 0.03], ['mushroom', 0.02]],
  },
  amethyst,
  // The gleam, and the great geode split open in it.
  gleam: {
    ...amethyst,
    trees: -0.6,
    builds: [{ kind: 'geode', x: 0, z: 0, seed: 0 }],
  },
  // Toadstools gone pale in the vault's cold, on grey stone.
  palecaps: {
    ...shroomwood,
    like: 'shroomwood',
    cover: (n) => n > 0.55 ? Top.stone : Top.dry,
    grows: ['palecap'],
    decor: [],
  },
  // Shards of the vault's crystal, standing taller than trees.
  shards: {
    ...crystals,
    like: 'crystals',
    trees: 0.4,
    rocks: 0.2,
    grows: ['shard'],
    stones: ['clearstone'],
  },
  // The vault: a ring of shards round its door, open where the roads run
  // east and south.
  vault: {
    ...crystals,
    like: 'crystals',
    hold: (d) => bump(d, 26),
    cover: (n) => n > 0.3 ? Top.stone : undefined,
    rocks: 0.1,
    stones: ['clearstone'],
    builds: [
      ...ring('shard', 14, 12, [0, 3]),
      { kind: 'vaultdoor', x: 0, z: -11, seed: 0 },
    ],
  },
}
