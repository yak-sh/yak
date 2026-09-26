// The kinds of place of the hills and moors, and the ruins on them.
import { fbm, lerp, smooth } from '../rand.ts'
import type { Prop } from '../terrain.ts'
import { bump, type Feature, ring, Top, wide } from './kit.ts'

/** A ruin: a broken ring of columns, and what stands of the walls round it. */
let RUINS: Prop[] = [
  ...ring('pillar', 7, 8, [3, 6]),
  { kind: 'ruin', x: -2, z: -11, seed: 1 },
  { kind: 'ruin', x: 5, z: 11, seed: 2 },
  { kind: 'ruin', x: -11.5, z: 4, seed: 3 },
]

/** Standing stones in a ring. */
let STONES: Prop[] = ring('menhir', 5.5, 7, [4])

export let HILLS: Record<string, Feature> = {
  // Rolling heath, heather and standing stones, hardly a tree.
  moor: {
    shape: (h, d, x, z, s) =>
      h + bump(d, 44) * (fbm(x / 12, z / 12, 47 + s) - 0.4) * 5,
    hold: wide,
    cover: (n) => n > 0.3 ? Top.heath : Top.dry,
    trees: -0.03,
    rocks: 0.06,
    grows: ['birch'],
    stones: ['rock', 'rock', 'rock', 'rock', 'rock', 'menhir'],
    decor: [['heather', 0.07], ['tuft', 0.03]],
    builds: STONES,
  },
  // What is left of an old hall: a floor of flags, a ring of columns.
  ruins: {
    shape: (h, d) => lerp(h, 6.8, smooth(16, 8, d)),
    hold: (d) => bump(d, 16),
    last: true,
    cover: (n, d) => d < 12 && n > 0.42 ? Top.stone : undefined,
    trees: -0.2,
    rocks: 0.15,
    decor: [['tuft', 0.05], ['flower', 0.008]],
    builds: RUINS,
  },
}
