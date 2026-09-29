// The frost, north-east past the pines: Frostmoor's scoured moor in the wind,
// the rime of Rimeholt round its holt, the deep spruce of Frostpine, the ice
// of Icefall, and Whitepeak above them all.
import type { Row } from '../levels.ts'

export let FROST: Record<string, Row> = {
  frostmoor: {
    name: 'Frostmoor',
    seed: 139,
    cell: [3, -1],
    arrive: 'snow',
    places: {
      snow: { kind: 'snowmoor', at: [128, 128] },
      pines: { kind: 'stuntpines', at: [104, 104] },
      tarn: { kind: 'tarn', at: [156, 150] },
      glacier: { kind: 'icecut', at: [160, 100] },
      northwest: { kind: 'snowmoor', at: [48, 40] },
      northeast: { kind: 'stuntpines', at: [208, 45] },
      southwest: { kind: 'tarn', at: [49, 216] },
      southeast: { kind: 'snowmoor', at: [209, 208] },
    },
    roads: {
      south: 'rimeholt',
      west: 'wolfden',
    },
  },
  rimeholt: {
    name: 'Rimeholt',
    seed: 149,
    cell: [3, 0],
    arrive: 'holt',
    places: {
      snow: { kind: 'rimewood', at: [128, 128] },
      tarn: { kind: 'tarn', at: [100, 104] },
      pines: { kind: 'rimewood', at: [160, 154] },
      glacier: { kind: 'glacier', at: [160, 98] },
      holt: { kind: 'holt', at: [126, 126] },
      northwest: { kind: 'rimewood', at: [45, 44] },
      northeast: { kind: 'glacier', at: [205, 49] },
      southwest: { kind: 'tarn', at: [46, 207] },
      southeast: { kind: 'rimewood', at: [206, 212] },
    },
    roads: {
      north: 'frostmoor',
      east: 'frostpine',
      south: 'icefall',
    },
  },
  frostpine: {
    name: 'Frostpine',
    seed: 151,
    cell: [4, 0],
    arrive: 'snow',
    places: {
      snow: { kind: 'snowpines', at: [128, 128] },
      pines: { kind: 'deeppines', at: [124, 102] },
      east: { kind: 'loggers', at: [156, 148] },
      tarn: { kind: 'tarn', at: [100, 150] },
      northwest: { kind: 'snowpines', at: [47, 50] },
      northeast: { kind: 'deeppines', at: [207, 42] },
      southwest: { kind: 'tarn', at: [48, 213] },
      southeast: { kind: 'snowpines', at: [208, 205] },
    },
    roads: {
      west: 'rimeholt',
    },
  },
  icefall: {
    name: 'Icefall',
    seed: 157,
    cell: [3, 1],
    arrive: 'snow',
    places: {
      snow: { kind: 'icefield', at: [128, 128] },
      glacier: { kind: 'icefall', at: [146, 100] },
      west: { kind: 'crevasses', at: [100, 108] },
      south: { kind: 'crevasses', at: [100, 156] },
      tarn: { kind: 'tarn', at: [158, 154] },
      northwest: { kind: 'icefield', at: [40, 42] },
      northeast: { kind: 'crevasses', at: [213, 47] },
      southwest: { kind: 'tarn', at: [41, 205] },
      southeast: { kind: 'icefield', at: [214, 210] },
    },
    roads: {
      north: 'rimeholt',
      east: 'whitepeak',
    },
  },
  whitepeak: {
    name: 'Whitepeak',
    seed: 163,
    cell: [4, 1],
    arrive: 'snow',
    places: {
      snow: { kind: 'highsnow', at: [128, 136] },
      glacier: { kind: 'peak', at: [128, 114] },
      west: { kind: 'cornice', at: [98, 102] },
      east: { kind: 'cornice', at: [160, 158] },
      northwest: { kind: 'snowfield', at: [46, 47] },
      northeast: { kind: 'cornice', at: [206, 39] },
      southwest: { kind: 'cornice', at: [47, 210] },
      southeast: { kind: 'snowfield', at: [207, 215] },
    },
    roads: {
      west: 'icefall',
    },
  },
}
