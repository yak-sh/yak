// The kinds of place of the sands.
import { fbm, lerp, smooth } from '../rand.ts'
import { bump, crest, type Feature, Top, wide } from './kit.ts'

export let SANDS: Record<string, Feature> = {
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
}
