// The hills south of the vale: moors and the ruins of an old kingdom.
import type { Row } from '../levels.ts'

export let HILLS: Record<string, Row> = {
  stonestep: {
    name: 'Stonestep',
    seed: 71,
    arrive: 'steps',
    places: {
      moor: { kind: 'moor', at: [84, 40] },
      crags: { kind: 'crags', at: [36, 36] },
      meadow: { kind: 'meadow', at: [36, 90] },
      woods: { kind: 'woods', at: [96, 92] },
      steps: { kind: 'village', at: [60, 64] },
    },
    roads: {
      north: 'mossvale',
      south: 'heatherfell',
    },
  },
  heatherfell: {
    name: 'Heatherfell',
    seed: 73,
    arrive: 'moor',
    places: {
      moor: { kind: 'moor', at: [64, 64] },
      fell: { kind: 'crags', at: [92, 36] },
      scree: { kind: 'crags', at: [36, 92] },
      tarn: { kind: 'lake', at: [38, 40] },
    },
    roads: {
      north: 'stonestep',
      south: 'oldwall',
    },
  },
  oldwall: {
    name: 'Oldwall',
    seed: 79,
    arrive: 'ruins',
    places: {
      moor: { kind: 'moor', at: [50, 78] },
      ruins: { kind: 'ruins', at: [64, 56] },
      crags: { kind: 'crags', at: [96, 40] },
      woods: { kind: 'woods', at: [96, 94] },
      tarn: { kind: 'lake', at: [30, 40] },
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
    arrive: 'moor',
    places: {
      moor: { kind: 'moor', at: [64, 64] },
      barrow: { kind: 'ruins', at: [60, 42] },
      hall: { kind: 'ruins', at: [88, 84] },
      crags: { kind: 'crags', at: [34, 34] },
      scree: { kind: 'crags', at: [36, 94] },
    },
    roads: {
      east: 'oldwall',
      west: 'giantsteps',
    },
  },
  giantsteps: {
    name: 'Giantsteps',
    seed: 89,
    arrive: 'moor',
    places: {
      moor: { kind: 'moor', at: [64, 64] },
      crags: { kind: 'crags', at: [40, 40] },
      steps: { kind: 'crags', at: [92, 92] },
      fell: { kind: 'crags', at: [96, 34] },
      scree: { kind: 'crags', at: [34, 94] },
    },
    roads: {
      east: 'kingsbarrow',
      west: 'emberfall',
    },
  },
}
