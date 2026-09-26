// The kinds of place of the fire country.
import { fbm, smooth } from '../rand.ts'
import { bump, type Feature, Top, wide } from './kit.ts'

export let FIRE: Record<string, Feature> = {
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
}
