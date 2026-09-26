// The vale: Mossvale, where every hero starts, and the green country and
// the woods north of it.
import type { Row } from '../levels.ts'

export let VALE: Record<string, Row> = {
  mossvale: {
    name: 'Mossvale',
    seed: 0,
    arrive: 'plaza',
    places: {
      crags: { kind: 'crags', at: [30, 98] },
      ridge: { kind: 'ridge', at: [102, 100] },
      woods: { kind: 'woods', at: [66, 25] },
      lake: { kind: 'lake', at: [26, 49] },
      fields: { kind: 'fields', at: [99, 52] },
      plaza: { kind: 'village', at: [64, 64] },
    },
    roads: {
      north: 'fernwood',
      east: 'reedmarsh',
      south: 'stonestep',
      west: 'birchmere',
    },
  },
  birchmere: {
    name: 'Birchmere',
    seed: 7,
    arrive: 'green',
    places: {
      mere: { kind: 'lake', at: [48, 75] },
      woods: { kind: 'woods', at: [85, 35] },
      east: { kind: 'woods', at: [98, 85] },
      fields: { kind: 'fields', at: [40, 35] },
      green: { kind: 'village', at: [69, 62] },
    },
    roads: {
      north: 'clovermead',
      east: 'mossvale',
      west: 'gullwick',
    },
  },
  clovermead: {
    name: 'Clovermead',
    seed: 11,
    arrive: 'meadow',
    places: {
      meadow: { kind: 'meadow', at: [60, 62] },
      woods: { kind: 'woods', at: [34, 38] },
      pond: { kind: 'lake', at: [90, 86] },
      copse: { kind: 'woods', at: [98, 40] },
    },
    roads: {
      east: 'fernwood',
      south: 'birchmere',
    },
  },
  fernwood: {
    name: 'Fernwood',
    seed: 13,
    arrive: 'glade',
    places: {
      woods: { kind: 'woods', at: [40, 36] },
      deep: { kind: 'woods', at: [94, 42] },
      meadow: { kind: 'meadow', at: [36, 88] },
      pond: { kind: 'lake', at: [90, 90] },
      glade: { kind: 'village', at: [62, 66] },
    },
    roads: {
      north: 'elderglade',
      east: 'greypine',
      south: 'mossvale',
      west: 'clovermead',
    },
  },
  elderglade: {
    name: 'Elderglade',
    seed: 17,
    arrive: 'heart',
    places: {
      heart: { kind: 'woods', at: [64, 62] },
      west: { kind: 'woods', at: [34, 40] },
      east: { kind: 'woods', at: [94, 84] },
      pool: { kind: 'lake', at: [38, 90] },
      meadow: { kind: 'meadow', at: [92, 36] },
    },
    roads: {
      south: 'fernwood',
      west: 'glowcap',
    },
  },
  greypine: {
    name: 'Greypine',
    seed: 19,
    arrive: 'pines',
    places: {
      pines: { kind: 'pinewood', at: [60, 58] },
      tarn: { kind: 'lake', at: [90, 84] },
      crags: { kind: 'crags', at: [34, 92] },
      high: { kind: 'pinewood', at: [96, 34] },
    },
    roads: {
      east: 'wolfden',
      west: 'fernwood',
    },
  },
  wolfden: {
    name: 'Wolfden',
    seed: 23,
    arrive: 'pines',
    places: {
      pines: { kind: 'pinewood', at: [50, 50] },
      crags: { kind: 'crags', at: [92, 40] },
      scree: { kind: 'crags', at: [44, 96] },
      tarn: { kind: 'lake', at: [94, 90] },
    },
    roads: {
      east: 'frostmoor',
      west: 'greypine',
    },
  },
}
