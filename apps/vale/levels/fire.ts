// The fire, furthest south-west: Emberfall's forges under a falling of
// embers, the black reach of Cinderreach, grey Ashkeep and its last knight,
// and the Maw at the end of the world.
import type { Row } from '../levels.ts'

export let FIRE: Record<string, Row> = {
  emberfall: {
    name: 'Emberfall',
    seed: 167,
    cell: [-3, 3],
    arrive: 'forge',
    places: {
      ash: { kind: 'emberash', at: [128, 128] },
      volcano: { kind: 'lavafall', at: [160, 98] },
      moor: { kind: 'cinderheath', at: [94, 104] },
      forge: { kind: 'forgetown', at: [122, 134] },
      northwest: { kind: 'emberash', at: [50, 46] },
      northeast: { kind: 'cinderheath', at: [210, 51] },
      southwest: { kind: 'volcano', at: [51, 209] },
      southeast: { kind: 'emberash', at: [211, 214] },
    },
    roads: {
      east: 'giantsteps',
      west: 'cinderreach',
    },
  },
  cinderreach: {
    name: 'Cinderreach',
    seed: 173,
    cell: [-4, 3],
    arrive: 'ash',
    places: {
      ash: { kind: 'cinderflats', at: [128, 128] },
      volcano: { kind: 'volcano', at: [102, 102] },
      cone: { kind: 'vents', at: [160, 156] },
      northwest: { kind: 'cinderflats', at: [43, 51] },
      northeast: { kind: 'volcano', at: [216, 43] },
      southwest: { kind: 'vents', at: [44, 214] },
      southeast: { kind: 'cinderflats', at: [217, 206] },
    },
    roads: {
      north: 'tombsands',
      east: 'emberfall',
      south: 'ashkeep',
      west: 'maw',
    },
  },
  ashkeep: {
    name: 'Ashkeep',
    seed: 179,
    cell: [-4, 4],
    arrive: 'keep',
    places: {
      ash: { kind: 'ashfield', at: [128, 128] },
      keep: { kind: 'keep', at: [128, 118] },
      gate: { kind: 'ashgate', at: [154, 152] },
      volcano: { kind: 'coldcone', at: [100, 154] },
      northwest: { kind: 'ashfield', at: [49, 43] },
      northeast: { kind: 'coldcone', at: [209, 48] },
      southwest: { kind: 'volcano', at: [50, 206] },
      southeast: { kind: 'ashfield', at: [210, 211] },
    },
    roads: {
      north: 'cinderreach',
    },
  },
  maw: {
    name: 'The Maw',
    seed: 181,
    cell: [-5, 3],
    arrive: 'ash',
    places: {
      ash: { kind: 'scorch', at: [128, 134] },
      maw: { kind: 'maw', at: [128, 114] },
      cone: { kind: 'spatter', at: [94, 152] },
      northwest: { kind: 'scorch', at: [51, 49] },
      northeast: { kind: 'spatter', at: [211, 41] },
      southwest: { kind: 'volcano', at: [39, 212] },
      southeast: { kind: 'scorch', at: [212, 217] },
    },
    roads: {
      east: 'cinderreach',
    },
  },
}
