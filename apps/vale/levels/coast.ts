// The coast, west of the vale: harbours, beaches and headlands.
import type { Row } from '../levels.ts'

export let COAST: Record<string, Row> = {
  gullwick: {
    name: 'Gullwick',
    seed: 47,
    arrive: 'harbour',
    places: {
      coast: { kind: 'coast', at: [66, 14] },
      meadow: { kind: 'meadow', at: [36, 40] },
      woods: { kind: 'woods', at: [36, 92] },
      harbour: { kind: 'village', at: [60, 62] },
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
    arrive: 'wharf',
    places: {
      coast: { kind: 'coast', at: [20, 64] },
      woods: { kind: 'woods', at: [92, 38] },
      meadow: { kind: 'meadow', at: [92, 92] },
      wharf: { kind: 'village', at: [68, 66] },
    },
    roads: {
      east: 'gullwick',
      south: 'dustmere',
    },
  },
  saltreach: {
    name: 'Saltreach',
    seed: 53,
    arrive: 'moor',
    places: {
      coast: { kind: 'coast', at: [108, 76] },
      moor: { kind: 'moor', at: [62, 56] },
      crags: { kind: 'crags', at: [30, 50] },
      head: { kind: 'crags', at: [98, 44] },
    },
    roads: {
      north: 'gullwick',
      south: 'shellstrand',
    },
  },
  shellstrand: {
    name: 'Shellstrand',
    seed: 59,
    arrive: 'isles',
    places: {
      isles: { kind: 'isles', at: [64, 64] },
      coast: { kind: 'coast', at: [100, 96] },
      meadow: { kind: 'meadow', at: [36, 40] },
    },
    roads: {
      north: 'saltreach',
      east: 'stormhead',
    },
  },
  stormhead: {
    name: 'Stormhead',
    seed: 67,
    arrive: 'moor',
    places: {
      coast: { kind: 'coast', at: [64, 18] },
      moor: { kind: 'moor', at: [64, 60] },
      crags: { kind: 'crags', at: [38, 84] },
      head: { kind: 'crags', at: [96, 80] },
    },
    roads: {
      west: 'shellstrand',
    },
  },
}
