// The hills south of the vale, and the ruins of an old kingdom: Stonestep's
// quarry, Heatherfell's heather and stones, the old wall at Oldwall in
// autumn, the king's barrow, and the giants' basalt stair.
import type { Row } from '../levels.ts'

export let HILLS: Record<string, Row> = {
  stonestep: {
    name: 'Stonestep',
    seed: 71,
    arrive: 'steps',
    places: {
      moor: { kind: 'watchmoor', at: [84, 40] },
      crags: { kind: 'quarry', at: [36, 36] },
      meadow: { kind: 'meadow', at: [36, 90] },
      woods: { kind: 'woods', at: [96, 92] },
      steps: { kind: 'stonetown', at: [60, 64] },
    },
    roads: {
      north: 'mossvale',
      south: 'heatherfell',
    },
    look: {
      ground: {
        stone: 0xc8bea4,
        dry: 0xb8b078,
        grass: 0x8cb866,
        lush: 0x74a456,
        heath: 0xa89a70,
      },
      sky: 0xf0f4ff,
      tint: 0.1,
    },
  },
  heatherfell: {
    name: 'Heatherfell',
    seed: 73,
    arrive: 'moor',
    places: {
      moor: { kind: 'moor', at: [64, 64] },
      fell: { kind: 'fell', at: [92, 36] },
      scree: { kind: 'scree', at: [36, 92] },
      tarn: { kind: 'lake', at: [38, 40] },
    },
    roads: {
      north: 'stonestep',
      south: 'oldwall',
    },
    look: {
      ground: { heath: 0x8e4a8e, grass: 0x7a9a5a, dry: 0x9a9a6a },
      sky: 0xe8e0f8,
      tint: 0.15,
    },
  },
  oldwall: {
    name: 'Oldwall',
    seed: 79,
    arrive: 'ruins',
    places: {
      moor: { kind: 'bracken', at: [50, 78] },
      ruins: { kind: 'oldwall', at: [64, 56] },
      crags: { kind: 'crags', at: [96, 40] },
      woods: { kind: 'autumnwood', at: [96, 94] },
      tarn: { kind: 'lake', at: [30, 40] },
    },
    roads: {
      north: 'heatherfell',
      east: 'sunkenkirk',
      west: 'kingsbarrow',
    },
    look: {
      ground: {
        grass: 0xa8a050,
        lush: 0x8a9040,
        dry: 0xb89a5a,
        heath: 0x8a5a3a,
      },
      sky: 0xffe0b0,
      tint: 0.2,
      air: 'leaves',
    },
  },
  kingsbarrow: {
    name: 'Kingsbarrow',
    seed: 83,
    arrive: 'moor',
    places: {
      moor: { kind: 'barrowmoor', at: [64, 64] },
      barrow: { kind: 'barrow', at: [60, 42] },
      hall: { kind: 'meadhall', at: [88, 84] },
      crags: { kind: 'crags', at: [34, 34] },
      scree: { kind: 'crags', at: [36, 94] },
    },
    roads: {
      east: 'oldwall',
      west: 'giantsteps',
    },
    look: {
      ground: {
        grass: 0x6a8a5a,
        lush: 0x5a7a4a,
        heath: 0x70665a,
        dry: 0x8a8a6a,
      },
      sky: 0xb0a0c8,
      tint: 0.35,
      haze: 1.3,
    },
  },
  giantsteps: {
    name: 'Giantsteps',
    seed: 89,
    arrive: 'moor',
    places: {
      moor: { kind: 'stonefield', at: [64, 64] },
      crags: { kind: 'basaltcrags', at: [40, 40] },
      steps: { kind: 'giantstair', at: [92, 92] },
      fell: { kind: 'basaltcrags', at: [96, 34] },
      scree: { kind: 'basaltcrags', at: [34, 94] },
    },
    roads: {
      east: 'kingsbarrow',
      west: 'emberfall',
    },
    look: {
      ground: {
        stone: 0x3e3e46,
        grass: 0x6a8a5a,
        dry: 0x7a7a5a,
        heath: 0x5a5a4a,
        snow: 0x6a6a72,
      },
      sky: 0xb8c8d8,
      tint: 0.2,
      haze: 1.3,
    },
  },
}
