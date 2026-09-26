// The vale: Mossvale, where every hero starts, and the green country and
// the woods north of it.
import type { Row } from '../levels.ts'

export let VALE: Record<string, Row> = {
  mossvale: {
    name: 'Mossvale',
    seed: 0,
    arrive: 'plaza',
    places: {
      crags: { kind: 'crags', at: [30, 98] },
      ridge: { kind: 'ridge', at: [102, 100] },
      woods: { kind: 'woods', at: [66, 25] },
      lake: { kind: 'lake', at: [26, 49] },
      fields: { kind: 'fields', at: [99, 52] },
      plaza: { kind: 'village', at: [64, 64] },
    },
    roads: {
      north: 'fernwood',
      east: 'reedmarsh',
      south: 'stonestep',
      west: 'birchmere',
    },
  },
  birchmere: {
    name: 'Birchmere',
    seed: 7,
    arrive: 'green',
    places: {
      mere: { kind: 'mere', at: [48, 75] },
      woods: { kind: 'birchwood', at: [85, 35] },
      east: { kind: 'birchwood', at: [98, 85] },
      fields: { kind: 'fields', at: [40, 35] },
      green: { kind: 'village', at: [69, 62] },
    },
    roads: {
      north: 'clovermead',
      east: 'mossvale',
      west: 'gullwick',
    },
    look: {
      ground: { grass: 0x9ccf6e, lush: 0x7fbd5c },
      sky: 0xe8f4ff,
      tint: 0.15,
      air: 'fluff',
    },
  },
  clovermead: {
    name: 'Clovermead',
    seed: 11,
    arrive: 'meadow',
    places: {
      meadow: { kind: 'clover', at: [60, 62] },
      woods: { kind: 'woods', at: [34, 38] },
      pond: { kind: 'lake', at: [90, 86] },
      copse: { kind: 'woods', at: [98, 40] },
    },
    roads: {
      east: 'fernwood',
      south: 'birchmere',
    },
    look: {
      ground: { grass: 0x86d468, lush: 0x6cc45a },
      sky: 0xfff0c8,
      tint: 0.12,
      air: 'pollen',
    },
  },
  fernwood: {
    name: 'Fernwood',
    seed: 13,
    arrive: 'glade',
    places: {
      woods: { kind: 'fernwood', at: [40, 36] },
      deep: { kind: 'fernheart', at: [94, 42] },
      meadow: { kind: 'meadow', at: [36, 88] },
      pond: { kind: 'lake', at: [90, 90] },
      glade: { kind: 'village', at: [62, 66] },
    },
    roads: {
      north: 'elderglade',
      east: 'greypine',
      south: 'mossvale',
      west: 'clovermead',
    },
    look: {
      ground: { grass: 0x5c9e46, lush: 0x3f8a3c },
      sky: 0xa8d8a0,
      tint: 0.14,
      haze: 1.3,
      air: 'leaves',
    },
  },
  elderglade: {
    name: 'Elderglade',
    seed: 17,
    arrive: 'heart',
    places: {
      heart: { kind: 'eldergrove', at: [64, 62] },
      west: { kind: 'elders', at: [34, 40] },
      east: { kind: 'elders', at: [94, 84] },
      pool: { kind: 'lake', at: [38, 90] },
      meadow: { kind: 'meadow', at: [92, 36] },
    },
    roads: {
      south: 'fernwood',
      west: 'glowcap',
    },
    look: {
      ground: { grass: 0xa8c85a, lush: 0x86b04c },
      sky: 0xffd890,
      tint: 0.2,
      air: 'motes',
    },
  },
  greypine: {
    name: 'Greypine',
    seed: 19,
    arrive: 'pines',
    places: {
      pines: { kind: 'greypines', at: [60, 58] },
      tarn: { kind: 'lake', at: [90, 84] },
      crags: { kind: 'watchcrag', at: [34, 92] },
      high: { kind: 'greypines', at: [96, 34] },
    },
    roads: {
      east: 'wolfden',
      west: 'fernwood',
    },
    look: {
      ground: { grass: 0x8e9e80, lush: 0x6f8a6a, dry: 0xa0a08a },
      water: [0x4a6a78, 0x6a8a94, 0xc8d2d6],
      sky: 0xb8c0c4,
      tint: 0.4,
      haze: 2,
    },
  },
  wolfden: {
    name: 'Wolfden',
    seed: 23,
    arrive: 'pines',
    places: {
      pines: { kind: 'hollow', at: [50, 50] },
      crags: { kind: 'lair', at: [92, 40] },
      scree: { kind: 'dens', at: [44, 96] },
      tarn: { kind: 'lake', at: [94, 90] },
    },
    roads: {
      east: 'frostmoor',
      west: 'greypine',
    },
    look: {
      ground: {
        grass: 0x4d6440,
        lush: 0x3c5434,
        dry: 0x6a6a50,
        stone: 0x6f6e68,
      },
      water: [0x1e2e34, 0x34464c, 0x8a98a0],
      sky: 0x4a5068,
      tint: 0.5,
      haze: 1.8,
    },
  },
}
