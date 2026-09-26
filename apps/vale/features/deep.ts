// The kinds of place of the deep country: toadstool woods and crystal.
import { fbm } from '../rand.ts'
import { bump, type Feature, Top, wide } from './kit.ts'

export let DEEP: Record<string, Feature> = {
  // A wood of giant toadstools on soft violet ground.
  shroomwood: {
    shape: (h, d, x, z, s) =>
      h + bump(d, 36) * (fbm(x / 8, z / 8, 49 + s) - 0.4) * 3.5,
    hold: wide,
    cover: (n) => n > 0.62 ? Top.lush : Top.spore,
    trees: 0.5,
    rocks: 0.02,
    grows: ['toadstool', 'toadstool', 'toadstool', 'oak'],
    decor: [['mushroom', 0.05], ['tuft', 0.02]],
  },
  // Crystals grown up out of the stone.
  crystals: {
    shape: (h, d, x, z, s) => h + bump(d, 20) * fbm(x / 6, z / 6, 69 + s) * 2.5,
    hold: (d) => bump(d, 22),
    cover: (n) => n > 0.45 ? Top.stone : undefined,
    trees: -0.1,
    rocks: 0.35,
    stones: ['crystal'],
  },
}
