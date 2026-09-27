// The deep country east of the marshes: Glowcap's blue dusk under its
// toadstools, the violet of Gleamdeep, and the cold shards of the vault.
import type { Row } from '../levels.ts'

export let DEEP: Record<string, Row> = {
  glowcap: {
    name: 'Glowcap Hollow',
    seed: 97,
    cell: [-1, -2],
    arrive: 'hollow',
    places: {
      toadstools: { kind: 'glowcaps', at: [128, 128] },
      pool: { kind: 'lake', at: [156, 104] },
      mere: { kind: 'lake', at: [100, 154] },
      hollow: { kind: 'capvillage', at: [120, 134] },
    },
    roads: {
      east: 'elderglade',
      south: 'sporefen',
      west: 'gleamdeep',
    },
    wild: 'glowcaps',
    look: {
      ground: {
        snow: 0x4a5478,
        spore: 0x34386a,
        path: 0x7a7a98,
        lush: 0x2e5a62,
        grass: 0x3e6a6e,
        dry: 0x4e6a68,
        stone: 0x5a6478,
      },
      water: [0x0a1a3a, 0x1a3a6a, 0x6ac8f0],
      sky: 0x2a3460,
      tint: 0.65,
      haze: 1.4,
      air: 'glowspores',
    },
  },
  gleamdeep: {
    name: 'Gleamdeep',
    seed: 103,
    cell: [-2, -2],
    arrive: 'toadstools',
    places: {
      toadstools: { kind: 'gleamwood', at: [128, 128] },
      gleam: { kind: 'gleam', at: [108, 108] },
      deep: { kind: 'amethyst', at: [154, 150] },
      pool: { kind: 'lake', at: [156, 100] },
    },
    roads: {
      north: 'shardvault',
      east: 'glowcap',
    },
    wild: 'gleamwood',
    look: {
      ground: {
        snow: 0xc8b0e8,
        spore: 0x6a55a0,
        lush: 0x5a5a8a,
        grass: 0x6a7a8a,
        dry: 0x8a7a9a,
        stone: 0x6a5a7a,
      },
      water: [0x2a1a4a, 0x4a3a7a, 0xd0b8f8],
      sky: 0xb8a0e0,
      tint: 0.35,
      air: 'sparkle',
    },
  },
  shardvault: {
    name: 'Shardvault',
    seed: 107,
    cell: [-2, -3],
    arrive: 'vault',
    places: {
      toadstools: { kind: 'palecaps', at: [128, 134] },
      vault: { kind: 'vault', at: [128, 124] },
      west: { kind: 'shards', at: [102, 104] },
      east: { kind: 'shards', at: [156, 152] },
      north: { kind: 'shards', at: [160, 100] },
    },
    roads: {
      south: 'gleamdeep',
    },
    wild: 'shards',
    look: {
      ground: {
        stone: 0x9aa8b6,
        dry: 0xa8b4b4,
        grass: 0x8aa0a0,
        lush: 0x7a9494,
        spore: 0xb8c8d8,
        path: 0xb0bcc4,
        snow: 0xd0e8f4,
      },
      water: [0x2a5a7a, 0x5a9aba, 0xf0ffff],
      sky: 0xd0e8f8,
      tint: 0.3,
      haze: 1.2,
      air: 'shimmer',
    },
  },
}
