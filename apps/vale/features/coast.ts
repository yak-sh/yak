// The kinds of place of the coast: the sea's edge and its islets.
import { fbm, lerp, smooth } from '../rand.ts'
import { bump, type Feature, Top, wide } from './kit.ts'

export let COAST: Record<string, Feature> = {
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
}
