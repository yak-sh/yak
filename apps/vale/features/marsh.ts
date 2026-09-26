// The kinds of place of the marshes.
import { fbm, lerp, smooth } from '../rand.ts'
import { type Feature, Top, wide } from './kit.ts'

export let MARSH: Record<string, Feature> = {
  // Low wet ground at the water's edge, pools among mud and reeds.
  marsh: {
    shape: (h, d, x, z, s) =>
      lerp(
        h,
        4.72 + (fbm(x / 7, z / 7, 43 + s) - 0.5) * 2.6,
        smooth(60, 30, d),
      ),
    hold: wide,
    cover: (n) => n > 0.55 ? Top.lush : Top.mud,
    shore: Top.mud,
    trees: 0.14,
    rocks: -0.02,
    grows: ['birch', 'deadtree', 'birch'],
    decor: [['reed', 0.07], ['tuft', 0.04], ['mushroom', 0.004]],
  },
}
