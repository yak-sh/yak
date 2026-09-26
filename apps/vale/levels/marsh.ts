// The marshes, east and south of the vale, sinking into bog: Reedmarsh's
// reeds and stilts, drowned Mirewood, the peat and the dig at Fenhollow, the
// Sunken Kirk, Bogheart and the briar's root, and Sporefen.
import type { Row } from '../levels.ts'

export let MARSH: Record<string, Row> = {
  reedmarsh: {
    name: 'Reedmarsh',
    seed: 29,
    arrive: 'stilts',
    places: {
      marsh: { kind: 'reedbed', at: [60, 64] },
      meadow: { kind: 'meadow', at: [40, 36] },
      pool: { kind: 'lake', at: [36, 90] },
      woods: { kind: 'woods', at: [96, 90] },
      stilts: { kind: 'stilts', at: [70, 56] },
    },
    roads: {
      south: 'mirewood',
      west: 'mossvale',
    },
    look: {
      ground: { grass: 0xb0b060, lush: 0x98a050, dry: 0xc8b070, mud: 0x6a5a3a },
      water: [0x3a5a4a, 0x6a8a6a, 0xd8e0c0],
      sky: 0xfff0d0,
      tint: 0.15,
      air: 'down',
    },
  },
  mirewood: {
    name: 'Mirewood',
    seed: 31,
    arrive: 'marsh',
    places: {
      marsh: { kind: 'mire', at: [60, 64] },
      woods: { kind: 'drownedwood', at: [92, 40] },
      west: { kind: 'drownedwood', at: [36, 36] },
      pool: { kind: 'lake', at: [88, 92] },
    },
    roads: {
      north: 'reedmarsh',
      south: 'fenhollow',
    },
    look: {
      ground: { grass: 0x4a6a38, lush: 0x3a5a2e, dry: 0x5a5a3a, mud: 0x3a3226 },
      water: [0x141e14, 0x2a3424, 0x7a8a6a],
      sky: 0x6a7a5a,
      tint: 0.45,
      haze: 2,
      air: 'fireflies',
    },
  },
  fenhollow: {
    name: 'Fenhollow',
    seed: 37,
    arrive: 'marsh',
    places: {
      marsh: { kind: 'fen', at: [64, 64] },
      ruins: { kind: 'dig', at: [44, 44] },
      pool: { kind: 'lake', at: [92, 86] },
      moor: { kind: 'turfmoor', at: [94, 38] },
    },
    roads: {
      north: 'mirewood',
      south: 'sunkenkirk',
    },
    look: {
      ground: {
        grass: 0xa09a60,
        lush: 0x8a8a50,
        dry: 0xb8a870,
        mud: 0x4a3828,
        heath: 0x7a5a4a,
      },
      water: [0x2a2a1e, 0x4a4a34, 0xb0b098],
      sky: 0xd8d0c0,
      tint: 0.3,
      haze: 1.6,
    },
  },
  sunkenkirk: {
    name: 'Sunken Kirk',
    seed: 41,
    arrive: 'kirk',
    places: {
      marsh: { kind: 'marsh', at: [64, 66] },
      kirk: { kind: 'kirk', at: [60, 48] },
      chapel: { kind: 'churchyard', at: [90, 88] },
      pool: { kind: 'lake', at: [36, 86] },
      mere: { kind: 'lake', at: [34, 40] },
    },
    roads: {
      north: 'fenhollow',
      east: 'bogheart',
      west: 'oldwall',
    },
    look: {
      ground: {
        grass: 0x6a7a5a,
        lush: 0x5a6a4a,
        mud: 0x4a4238,
        stone: 0x8a8a88,
      },
      water: [0x22303a, 0x3a4a52, 0x9aa8b0],
      sky: 0x8a90a8,
      tint: 0.5,
      haze: 1.7,
      air: 'wisps',
    },
  },
  bogheart: {
    name: 'Bogheart',
    seed: 43,
    arrive: 'marsh',
    places: {
      marsh: { kind: 'bog', at: [64, 64] },
      pool: { kind: 'lake', at: [40, 92] },
      mere: { kind: 'lake', at: [34, 38] },
      toadstools: { kind: 'shroomwood', at: [94, 40] },
    },
    roads: {
      east: 'sporefen',
      west: 'sunkenkirk',
    },
    look: {
      ground: { grass: 0x7a8a3a, lush: 0x5a7a2a, dry: 0x8a7a4a, mud: 0x3a2e22 },
      water: [0x1a140e, 0x2e2418, 0x6a5a40],
      sky: 0x9a8a6a,
      tint: 0.35,
      haze: 1.5,
      air: 'midges',
    },
  },
  sporefen: {
    name: 'Sporefen',
    seed: 101,
    arrive: 'toadstools',
    places: {
      marsh: { kind: 'sporemarsh', at: [60, 80] },
      toadstools: { kind: 'sporewood', at: [64, 56] },
      east: { kind: 'sporewood', at: [96, 36] },
      pool: { kind: 'lake', at: [30, 40] },
    },
    roads: {
      north: 'glowcap',
      west: 'bogheart',
    },
    look: {
      ground: {
        spore: 0xb0b44a,
        grass: 0x9aa84a,
        lush: 0x8a9a3a,
        mud: 0x5a5030,
      },
      water: [0x3a4a2a, 0x6a7a3a, 0xd0e0a0],
      sky: 0xd8e0a0,
      tint: 0.3,
      haze: 1.5,
      air: 'spores',
    },
  },
}
