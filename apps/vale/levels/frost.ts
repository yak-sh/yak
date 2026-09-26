// The frost, north-east past the pines: snow, then ice.
import type { Row } from '../levels.ts'

export let FROST: Record<string, Row> = {
  frostmoor: {
    name: 'Frostmoor',
    seed: 139,
    arrive: 'snow',
    places: {
      snow: { kind: 'snowfield', at: [64, 64] },
      pines: { kind: 'pinewood', at: [40, 40] },
      tarn: { kind: 'lake', at: [92, 86] },
      glacier: { kind: 'glacier', at: [96, 36] },
    },
    roads: {
      south: 'rimeholt',
      west: 'wolfden',
    },
  },
  rimeholt: {
    name: 'Rimeholt',
    seed: 149,
    arrive: 'holt',
    places: {
      snow: { kind: 'snowfield', at: [64, 64] },
      tarn: { kind: 'lake', at: [36, 40] },
      pines: { kind: 'pinewood', at: [96, 90] },
      glacier: { kind: 'glacier', at: [96, 34] },
      holt: { kind: 'village', at: [62, 62] },
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
    arrive: 'snow',
    places: {
      snow: { kind: 'snowfield', at: [64, 64] },
      pines: { kind: 'pinewood', at: [60, 38] },
      east: { kind: 'pinewood', at: [92, 84] },
      tarn: { kind: 'lake', at: [36, 86] },
    },
    roads: {
      west: 'rimeholt',
    },
  },
  icefall: {
    name: 'Icefall',
    seed: 157,
    arrive: 'snow',
    places: {
      snow: { kind: 'snowfield', at: [64, 64] },
      glacier: { kind: 'glacier', at: [82, 36] },
      west: { kind: 'glacier', at: [36, 44] },
      south: { kind: 'glacier', at: [36, 92] },
      tarn: { kind: 'lake', at: [94, 90] },
    },
    roads: {
      north: 'rimeholt',
      east: 'whitepeak',
      west: 'shardvault',
    },
  },
  whitepeak: {
    name: 'Whitepeak',
    seed: 163,
    arrive: 'snow',
    places: {
      snow: { kind: 'snowfield', at: [64, 72] },
      glacier: { kind: 'glacier', at: [64, 50] },
      west: { kind: 'glacier', at: [34, 38] },
      east: { kind: 'glacier', at: [96, 94] },
    },
    roads: {
      west: 'icefall',
    },
  },
}
