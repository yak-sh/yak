// The kinds of place of the frost.
import { fbm, lerp, smooth } from '../rand.ts'
import { bump, type Feature, Top, wide } from './kit.ts'

export let FROST: Record<string, Feature> = {
  // Rolling snow, snow-laden spruce.
  snowfield: {
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
  },
  // A sheet of ice, cracked by crevasses, and seracs standing on it.
  glacier: {
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
  },
}
