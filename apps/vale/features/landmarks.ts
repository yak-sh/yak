// Valleys and castles beyond the authored lands. They are places, so their
// shape and their standing stones grow from the same world position on every
// page and at every terrain detail.
import { fbm, lerp, smooth } from '../rand.ts'
import type { Prop } from '../terrain.ts'
import { type Feature, Top } from './kit.ts'

let walls: Prop[] = [
  ...[-14, 14].flatMap((z) =>
    [-9, -6, -3, 0, 3, 6, 9].filter((x) => z < 0 || Math.abs(x) > 3)
      .map((x) => ({ kind: 'rampart', x, z, seed: x + z + 40 }))
  ),
  ...[-14, 14].flatMap((x) =>
    [-9, -6, -3, 0, 3, 6, 9].map((z) => ({
      kind: 'rampart',
      x,
      z,
      seed: x + z + 80,
      turn: 1,
    }))
  ),
  ...[-14, 14].flatMap((x) =>
    [-14, 14].map((z) => ({ kind: 'walltower', x, z, seed: x + z + 100 }))
  ),
  { kind: 'walltower', x: 0, z: -5, seed: 4 },
]

let valley: Feature = {
  shape: (h, d, x, z, s) =>
    lerp(
      h + 3 * smooth(18, 30, d) * smooth(55, 40, d),
      5.7 + (fbm(x / 15, z / 15, s + 19) - 0.5) * 0.8,
      smooth(30, 16, d),
    ),
  hold: (d) => smooth(55, 20, d),
  last: true,
  like: 'woods',
  cover: (n) => n > 0.3 ? Top.lush : Top.grass,
  trees: 0.03,
  grows: ['oak', 'birch'],
  decor: [['flower', 0.04], ['tuft', 0.06]],
}

let castle: Feature = {
  shape: (h, d) => lerp(h, 8.5, smooth(30, 22, d)),
  hold: (d) => smooth(35, 24, d),
  last: true,
  like: 'ruins',
  cover: (_, d) => d < 19 ? Top.stone : undefined,
  trees: -0.2,
  rocks: -0.2,
  builds: walls,
}

export let LANDMARKS: Record<string, Feature> = { valley, castle }
