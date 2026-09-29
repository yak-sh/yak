// The marshes, east and south of the vale, sinking into bog: Reedmarsh's
// reeds and stilts, drowned Mirewood, the peat and the dig at Fenhollow, the
// Sunken Kirk, Bogheart and the briar's root, and Sporefen.
import type { Row } from '../levels.ts'

export let MARSH: Record<string, Row> = {
  reedmarsh: {
    name: 'Reedmarsh',
    seed: 29,
    cell: [1, 0],
    arrive: 'stilts',
    places: {
      marsh: { kind: 'reedbed', at: [124, 128] },
      meadow: { kind: 'meadow', at: [104, 100] },
      pool: { kind: 'lake', at: [100, 154] },
      woods: { kind: 'woods', at: [160, 154] },
      stilts: { kind: 'stilts', at: [134, 120] },
      northwest: { kind: 'reedbed', at: [42, 48] },
      northeast: { kind: 'meadow', at: [215, 40] },
      southwest: { kind: 'lake', at: [43, 211] },
      southeast: { kind: 'woods', at: [216, 216] },
    },
    roads: {
      south: 'mirewood',
      west: 'mossvale',
    },
  },
  mirewood: {
    name: 'Mirewood',
    seed: 31,
    cell: [1, 1],
    arrive: 'marsh',
    places: {
      marsh: { kind: 'mire', at: [124, 128] },
      woods: { kind: 'drownedwood', at: [156, 104] },
      west: { kind: 'drownedwood', at: [100, 100] },
      pool: { kind: 'lake', at: [152, 156] },
      northwest: { kind: 'drownedwood', at: [44, 41] },
      northeast: { kind: 'marsh', at: [217, 46] },
      southwest: { kind: 'drownedwood', at: [45, 217] },
      southeast: { kind: 'lake', at: [205, 209] },
    },
    roads: {
      north: 'reedmarsh',
      south: 'fenhollow',
    },
  },
  fenhollow: {
    name: 'Fenhollow',
    seed: 37,
    cell: [1, 2],
    arrive: 'marsh',
    places: {
      marsh: { kind: 'fen', at: [128, 128] },
      ruins: { kind: 'dig', at: [108, 108] },
      pool: { kind: 'lake', at: [156, 150] },
      moor: { kind: 'turfmoor', at: [158, 102] },
      northwest: { kind: 'fen', at: [50, 46] },
      northeast: { kind: 'turfmoor', at: [210, 51] },
      southwest: { kind: 'lake', at: [51, 209] },
      southeast: { kind: 'fen', at: [211, 214] },
    },
    roads: {
      north: 'mirewood',
      south: 'sunkenkirk',
    },
  },
  sunkenkirk: {
    name: 'Sunken Kirk',
    seed: 41,
    cell: [1, 3],
    arrive: 'kirk',
    places: {
      marsh: { kind: 'marsh', at: [128, 130] },
      kirk: { kind: 'kirk', at: [124, 112] },
      chapel: { kind: 'churchyard', at: [154, 152] },
      pool: { kind: 'lake', at: [100, 150] },
      mere: { kind: 'lake', at: [98, 104] },
      northwest: { kind: 'marsh', at: [41, 45] },
      northeast: { kind: 'lake', at: [214, 50] },
      southwest: { kind: 'marsh', at: [42, 208] },
      southeast: { kind: 'lake', at: [215, 213] },
    },
    roads: {
      north: 'fenhollow',
      west: 'oldwall',
    },
  },
  bogheart: {
    name: 'Bogheart',
    seed: 43,
    cell: [-3, -1],
    arrive: 'marsh',
    places: {
      marsh: { kind: 'bog', at: [128, 128] },
      pool: { kind: 'lake', at: [104, 156] },
      mere: { kind: 'lake', at: [98, 102] },
      toadstools: { kind: 'shroomwood', at: [158, 104] },
      northwest: { kind: 'shroomwood', at: [43, 51] },
      northeast: { kind: 'marsh', at: [216, 43] },
      southwest: { kind: 'lake', at: [44, 214] },
      southeast: { kind: 'shroomwood', at: [217, 206] },
    },
    roads: {
      east: 'sporefen',
    },
  },
  sporefen: {
    name: 'Sporefen',
    seed: 101,
    cell: [-2, -1],
    arrive: 'toadstools',
    places: {
      marsh: { kind: 'sporemarsh', at: [124, 144] },
      toadstools: { kind: 'sporewood', at: [128, 120] },
      east: { kind: 'sporewood', at: [160, 100] },
      pool: { kind: 'lake', at: [94, 104] },
      northwest: { kind: 'sporewood', at: [49, 43] },
      northeast: { kind: 'marsh', at: [209, 48] },
      southwest: { kind: 'lake', at: [50, 206] },
      southeast: { kind: 'sporewood', at: [210, 211] },
    },
    roads: {
      north: 'glowcap',
      west: 'bogheart',
    },
  },
}
