// The hills south of the vale, and the ruins of an old kingdom: Stonestep's
// quarry, Heatherfell's heather and stones, the old wall at Oldwall in
// autumn, the king's barrow, and the giants' basalt stair.
import type { Row } from '../levels.ts'

export let HILLS: Record<string, Row> = {
  stonestep: {
    name: 'Stonestep',
    seed: 71,
    cell: [0, 1],
    arrive: 'steps',
    places: {
      moor: { kind: 'watchmoor', at: [148, 104] },
      crags: { kind: 'quarry', at: [100, 100] },
      meadow: { kind: 'meadow', at: [100, 154] },
      woods: { kind: 'woods', at: [160, 156] },
      steps: { kind: 'stonetown', at: [124, 128] },
      northwest: { kind: 'moor', at: [45, 44] },
      northeast: { kind: 'crags', at: [205, 49] },
      southwest: { kind: 'meadow', at: [46, 207] },
      southeast: { kind: 'woods', at: [206, 212] },
    },
    roads: {
      north: 'mossvale',
      south: 'heatherfell',
    },
  },
  heatherfell: {
    name: 'Heatherfell',
    seed: 73,
    cell: [0, 2],
    arrive: 'moor',
    places: {
      moor: { kind: 'moor', at: [128, 128] },
      fell: { kind: 'fell', at: [156, 100] },
      scree: { kind: 'scree', at: [100, 156] },
      tarn: { kind: 'lake', at: [102, 104] },
      northwest: { kind: 'moor', at: [47, 50] },
      northeast: { kind: 'scree', at: [207, 42] },
      southwest: { kind: 'lake', at: [48, 213] },
      southeast: { kind: 'moor', at: [208, 205] },
    },
    roads: {
      north: 'stonestep',
      south: 'oldwall',
    },
  },
  oldwall: {
    name: 'Oldwall',
    seed: 79,
    cell: [0, 3],
    arrive: 'ruins',
    places: {
      moor: { kind: 'bracken', at: [114, 142] },
      ruins: { kind: 'oldwall', at: [128, 120] },
      crags: { kind: 'crags', at: [160, 104] },
      woods: { kind: 'autumnwood', at: [160, 158] },
      tarn: { kind: 'lake', at: [94, 104] },
      northwest: { kind: 'bracken', at: [40, 42] },
      northeast: { kind: 'crags', at: [213, 47] },
      southwest: { kind: 'lake', at: [41, 205] },
      southeast: { kind: 'autumnwood', at: [214, 210] },
    },
    roads: {
      north: 'heatherfell',
      east: 'sunkenkirk',
      west: 'kingsbarrow',
    },
  },
  kingsbarrow: {
    name: 'Kingsbarrow',
    seed: 83,
    cell: [-1, 3],
    arrive: 'moor',
    places: {
      moor: { kind: 'barrowmoor', at: [128, 128] },
      barrow: { kind: 'barrow', at: [124, 106] },
      hall: { kind: 'meadhall', at: [152, 148] },
      crags: { kind: 'crags', at: [98, 98] },
      scree: { kind: 'crags', at: [100, 158] },
      northwest: { kind: 'barrowmoor', at: [44, 41] },
      northeast: { kind: 'crags', at: [217, 46] },
      southwest: { kind: 'barrowmoor', at: [45, 217] },
      southeast: { kind: 'crags', at: [205, 209] },
    },
    roads: {
      east: 'oldwall',
      west: 'giantsteps',
    },
  },
  giantsteps: {
    name: 'Giantsteps',
    seed: 89,
    cell: [-2, 3],
    arrive: 'moor',
    places: {
      moor: { kind: 'stonefield', at: [128, 128] },
      crags: { kind: 'basaltcrags', at: [104, 104] },
      steps: { kind: 'giantstair', at: [156, 156] },
      fell: { kind: 'basaltcrags', at: [160, 98] },
      scree: { kind: 'basaltcrags', at: [98, 158] },
      northwest: { kind: 'stonefield', at: [50, 46] },
      northeast: { kind: 'basaltcrags', at: [210, 51] },
      southwest: { kind: 'basaltcrags', at: [51, 209] },
      southeast: { kind: 'stonefield', at: [211, 214] },
    },
    roads: {
      east: 'kingsbarrow',
      west: 'emberfall',
    },
  },
}
