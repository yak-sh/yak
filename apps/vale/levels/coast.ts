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
      northwest: { kind: 'woods', at: [47, 50] },
      northeast: { kind: 'meadow', at: [207, 42] },
      southwest: { kind: 'coast', at: [48, 213] },
      southeast: { kind: 'woods', at: [208, 205] },
    },
    roads: {
      east: 'birchmere',
      south: 'saltreach',
      west: 'driftwood',
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
      northwest: { kind: 'shorewood', at: [48, 40] },
      northeast: { kind: 'marram', at: [208, 45] },
      southwest: { kind: 'coast', at: [49, 216] },
      southeast: { kind: 'shorewood', at: [209, 208] },
    },
    roads: {
      east: 'gullwick',
      south: 'dustmere',
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
      northwest: { kind: 'bluffs', at: [40, 42] },
      northeast: { kind: 'tideline', at: [213, 47] },
      southwest: { kind: 'bluffs', at: [41, 205] },
      southeast: { kind: 'tideline', at: [214, 210] },
    },
    roads: {
      north: 'gullwick',
      south: 'shellstrand',
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
      northwest: { kind: 'thrift', at: [46, 47] },
      northeast: { kind: 'shellbeach', at: [206, 39] },
      southwest: { kind: 'thrift', at: [47, 210] },
      southeast: { kind: 'shellbeach', at: [207, 215] },
    },
    roads: {
      north: 'saltreach',
      east: 'stormhead',
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
      northwest: { kind: 'windmoor', at: [41, 45] },
      northeast: { kind: 'headland', at: [214, 50] },
      southwest: { kind: 'surf', at: [42, 208] },
      southeast: { kind: 'windmoor', at: [215, 213] },
    },
    roads: {
      west: 'shellstrand',
    },
  },
}
