// The deep country east of the marshes: Glowcap's blue dusk under its
// toadstools, the violet of Gleamdeep, and the cold shards of the vault.
import type { Row } from '../levels.ts'

export let DEEP: Record<string, Row> = {
  glowcap: {
    name: 'Glowcap Hollow',
    seed: 97,
    cell: [-1, -2],
    arrive: 'hollow',
    places: {
      toadstools: { kind: 'glowcaps', at: [128, 128] },
      pool: { kind: 'lake', at: [156, 104] },
      mere: { kind: 'lake', at: [100, 154] },
      hollow: { kind: 'capvillage', at: [120, 134] },
      northwest: { kind: 'glowcaps', at: [45, 44] },
      northeast: { kind: 'lake', at: [205, 49] },
      southwest: { kind: 'lake', at: [46, 207] },
      southeast: { kind: 'glowcaps', at: [206, 212] },
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
    cell: [-2, -2],
    arrive: 'toadstools',
    places: {
      toadstools: { kind: 'gleamwood', at: [128, 128] },
      gleam: { kind: 'gleam', at: [108, 108] },
      deep: { kind: 'amethyst', at: [154, 150] },
      pool: { kind: 'lake', at: [156, 100] },
      northwest: { kind: 'gleamwood', at: [51, 49] },
      northeast: { kind: 'amethyst', at: [211, 41] },
      southwest: { kind: 'gleamwood', at: [39, 212] },
      southeast: { kind: 'amethyst', at: [212, 217] },
    },
    roads: {
      north: 'shardvault',
      east: 'glowcap',
    },
  },
  shardvault: {
    name: 'Shardvault',
    seed: 107,
    cell: [-2, -3],
    arrive: 'vault',
    places: {
      toadstools: { kind: 'palecaps', at: [128, 134] },
      vault: { kind: 'vault', at: [128, 124] },
      west: { kind: 'shards', at: [102, 104] },
      east: { kind: 'shards', at: [156, 152] },
      north: { kind: 'shards', at: [160, 100] },
      northwest: { kind: 'palecaps', at: [42, 48] },
      northeast: { kind: 'shards', at: [215, 40] },
      southwest: { kind: 'shards', at: [43, 211] },
      southeast: { kind: 'palecaps', at: [216, 216] },
    },
    roads: {
      south: 'gleamdeep',
    },
  },
}
