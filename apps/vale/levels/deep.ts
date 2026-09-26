// The deep country east of the marshes: toadstools, then crystal.
import type { Row } from '../levels.ts'

export let DEEP: Record<string, Row> = {
  glowcap: {
    name: 'Glowcap Hollow',
    seed: 97,
    arrive: 'hollow',
    places: {
      toadstools: { kind: 'shroomwood', at: [64, 64] },
      pool: { kind: 'lake', at: [92, 40] },
      mere: { kind: 'lake', at: [36, 90] },
      hollow: { kind: 'village', at: [56, 70] },
    },
    roads: {
      east: 'elderglade',
      south: 'sporefen',
      west: 'gleamdeep',
    },
  },
  gleamdeep: {
    name: 'Gleamdeep',
    seed: 103,
    arrive: 'toadstools',
    places: {
      toadstools: { kind: 'shroomwood', at: [64, 64] },
      gleam: { kind: 'crystals', at: [44, 44] },
      deep: { kind: 'crystals', at: [90, 86] },
      pool: { kind: 'lake', at: [92, 36] },
    },
    roads: {
      north: 'shardvault',
      east: 'glowcap',
    },
  },
  shardvault: {
    name: 'Shardvault',
    seed: 107,
    arrive: 'vault',
    places: {
      toadstools: { kind: 'shroomwood', at: [64, 70] },
      vault: { kind: 'crystals', at: [64, 60] },
      west: { kind: 'crystals', at: [38, 40] },
      east: { kind: 'crystals', at: [92, 88] },
      north: { kind: 'crystals', at: [96, 36] },
    },
    roads: {
      east: 'icefall',
      south: 'gleamdeep',
    },
  },
}
