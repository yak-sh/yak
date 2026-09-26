// The kinds of place of the green country round Mossvale.
import { fbm, lerp, smooth } from '../rand.ts'
import type { Prop } from '../terrain.ts'
import { bump, type Feature, Top } from './kit.ts'

/** A village's buildings, by where each stands from the village's middle. */
let VILLAGE: Prop[] = [
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

export let VALE: Record<string, Feature> = {
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
}
