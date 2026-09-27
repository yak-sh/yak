// The coast, west of the vale: Gullwick's harbour and fields, Driftwood's
// wild strand, the salt pans of Saltreach, Shellstrand's lagoon and
// Stormhead's light.
import type { Row } from '../levels.ts'

export let COAST: Record<string, Row> = {
  gullwick: {
    name: 'Gullwick',
    seed: 47,
    cell: [-2, 0],
    arrive: 'harbour',
    places: {
      coast: { kind: 'bay', at: [130, 78] },
      meadow: { kind: 'farmland', at: [100, 104] },
      woods: { kind: 'woods', at: [100, 156] },
      harbour: { kind: 'fishtown', at: [124, 126] },
    },
    roads: {
      east: 'birchmere',
      south: 'saltreach',
      west: 'driftwood',
    },
    look: {
      ground: {
        grass: 0x8cc070,
        lush: 0x76b25e,
        sand: 0xa9a296,
        mud: 0x7a6248,
      },
      water: [0x1f5a7a, 0x3f86a0, 0xd8eef6],
      sky: 0xd8ecf8,
      tint: 0.1,
    },
  },
  driftwood: {
    name: 'Driftwood Bay',
    seed: 61,
    cell: [-3, 0],
    arrive: 'wharf',
    places: {
      coast: { kind: 'strand', at: [84, 128] },
      woods: { kind: 'shorewood', at: [156, 102] },
      meadow: { kind: 'marram', at: [156, 156] },
      wharf: { kind: 'shacks', at: [132, 130] },
    },
    roads: {
      east: 'gullwick',
      south: 'dustmere',
    },
    look: {
      ground: {
        sand: 0xece0c4,
        grass: 0xa8b878,
        lush: 0x8aa868,
        dry: 0xc8c498,
        snow: 0xc8c8c0,
      },
      water: [0x3a5a66, 0x6a8e94, 0xe0eae8],
      sky: 0xd8dcd8,
      tint: 0.25,
      haze: 1.3,
      air: 'spray',
    },
  },
  saltreach: {
    name: 'Saltreach',
    seed: 53,
    cell: [-2, 1],
    arrive: 'moor',
    places: {
      coast: { kind: 'tideline', at: [172, 140] },
      moor: { kind: 'saltflat', at: [126, 120] },
      crags: { kind: 'bluffs', at: [94, 114] },
      head: { kind: 'bluffs', at: [162, 108] },
    },
    roads: {
      north: 'gullwick',
      south: 'shellstrand',
    },
    look: {
      ground: {
        sand: 0xf0ebe0,
        dry: 0xd8d2bc,
        grass: 0xb8c098,
        lush: 0xa0b088,
        stone: 0xcfc6b2,
        mud: 0x9a9486,
        snow: 0xd8d0bc,
      },
      water: [0x3a7a8a, 0x7ab8c0, 0xf0ffff],
      sky: 0xfff4e0,
      tint: 0.2,
      haze: 0.9,
      air: 'glints',
    },
  },
  shellstrand: {
    name: 'Shellstrand',
    seed: 59,
    cell: [-2, 2],
    arrive: 'isles',
    places: {
      isles: { kind: 'shellisles', at: [128, 128] },
      coast: { kind: 'shellbeach', at: [164, 160] },
      meadow: { kind: 'thrift', at: [100, 104] },
    },
    roads: {
      north: 'saltreach',
      east: 'stormhead',
    },
    look: {
      ground: {
        sand: 0xf4d8cc,
        grass: 0x8ccf7a,
        lush: 0x74c06a,
        snow: 0xe0d4cc,
      },
      water: [0x1a9aae, 0x5ad8d0, 0xe8fff8],
      sky: 0xbfefff,
      tint: 0.12,
    },
  },
  stormhead: {
    name: 'Stormhead',
    seed: 67,
    cell: [-1, 2],
    arrive: 'moor',
    places: {
      coast: { kind: 'surf', at: [128, 82] },
      moor: { kind: 'windmoor', at: [128, 124] },
      crags: { kind: 'headland', at: [102, 148] },
      head: { kind: 'beacon', at: [164, 94] },
    },
    roads: {
      west: 'shellstrand',
    },
    look: {
      ground: {
        grass: 0x6f8a5a,
        lush: 0x5a7a4c,
        dry: 0x8a8a6a,
        heath: 0x6a5a68,
        sand: 0x8a8070,
        stone: 0x6a6c70,
        snow: 0x7e8288,
      },
      water: [0x22404c, 0x44626c, 0xa8bcc4],
      sky: 0x505a68,
      tint: 0.7,
      haze: 2.2,
      air: 'rain',
    },
  },
}
