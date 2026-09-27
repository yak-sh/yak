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
      snow: { kind: 'snowmoor', at: [64, 64] },
      pines: { kind: 'stuntpines', at: [40, 40] },
      tarn: { kind: 'tarn', at: [92, 86] },
      glacier: { kind: 'icecut', at: [96, 36] },
    },
    roads: {
      south: 'rimeholt',
      west: 'wolfden',
    },
    wild: 'snowmoor',
    look: {
      ground: {
        snow: 0xdfe6ee,
        heath: 0x5a4a58,
        stone: 0x7a7a7e,
        path: 0xa89a88,
      },
      water: [0x1a2a3a, 0x3a5060, 0x9ab0c0],
      sky: 0x9aa8b8,
      tint: 0.5,
      haze: 1.7,
      air: 'blizzard',
    },
  },
  rimeholt: {
    name: 'Rimeholt',
    seed: 149,
    cell: [3, 0],
    arrive: 'holt',
    places: {
      snow: { kind: 'rimewood', at: [64, 64] },
      tarn: { kind: 'tarn', at: [36, 40] },
      pines: { kind: 'rimewood', at: [96, 90] },
      glacier: { kind: 'glacier', at: [96, 34] },
      holt: { kind: 'holt', at: [62, 62] },
    },
    roads: {
      north: 'frostmoor',
      east: 'frostpine',
      south: 'icefall',
    },
    wild: 'rimewood',
    look: {
      ground: { snow: 0xf4f8fc, path: 0xb8a890 },
      sky: 0xe0e8f0,
      tint: 0.3,
    },
  },
  frostpine: {
    name: 'Frostpine',
    seed: 151,
    cell: [4, 0],
    arrive: 'snow',
    places: {
      snow: { kind: 'snowpines', at: [64, 64] },
      pines: { kind: 'deeppines', at: [60, 38] },
      east: { kind: 'loggers', at: [92, 84] },
      tarn: { kind: 'tarn', at: [36, 86] },
    },
    roads: {
      west: 'rimeholt',
    },
    wild: 'snowpines',
    look: {
      ground: { snow: 0xe4ecee, lush: 0x2a4a3a, path: 0xb0a080 },
      sky: 0x8a9aa0,
      tint: 0.5,
      haze: 1.8,
      air: 'snow',
    },
  },
  icefall: {
    name: 'Icefall',
    seed: 157,
    cell: [3, 1],
    arrive: 'snow',
    places: {
      snow: { kind: 'icefield', at: [64, 64] },
      glacier: { kind: 'icefall', at: [82, 36] },
      west: { kind: 'crevasses', at: [36, 44] },
      south: { kind: 'crevasses', at: [36, 92] },
      tarn: { kind: 'tarn', at: [94, 90] },
    },
    roads: {
      north: 'rimeholt',
      east: 'whitepeak',
    },
    wild: 'icefield',
    look: {
      ground: {
        ice: 0x8ac4e4,
        snow: 0xe0eef8,
        stone: 0x8a9aa8,
        path: 0xb8c8d0,
      },
      water: [0x0a2a4a, 0x2a6a9a, 0xc8f0ff],
      sky: 0xb8d8f0,
      tint: 0.4,
    },
  },
  whitepeak: {
    name: 'Whitepeak',
    seed: 163,
    cell: [4, 1],
    arrive: 'snow',
    places: {
      snow: { kind: 'highsnow', at: [64, 72] },
      glacier: { kind: 'peak', at: [64, 50] },
      west: { kind: 'cornice', at: [34, 38] },
      east: { kind: 'cornice', at: [96, 94] },
    },
    roads: {
      west: 'icefall',
    },
    wild: 'highsnow',
    look: {
      ground: { snow: 0xfafcff, stone: 0x6a6a72, path: 0xc8c0b0 },
      sky: 0xf0f6ff,
      tint: 0.25,
      haze: 0.8,
    },
  },
}
