// The fire, furthest south-west: Emberfall's forges under a falling of
// embers, the black reach of Cinderreach, grey Ashkeep and its last knight,
// and the Maw at the end of the world.
import type { Row } from '../levels.ts'

export let FIRE: Record<string, Row> = {
  emberfall: {
    name: 'Emberfall',
    seed: 167,
    arrive: 'forge',
    places: {
      ash: { kind: 'emberash', at: [64, 64] },
      volcano: { kind: 'lavafall', at: [96, 34] },
      moor: { kind: 'cinderheath', at: [30, 40] },
      forge: { kind: 'forgetown', at: [58, 70] },
    },
    roads: {
      east: 'giantsteps',
      west: 'cinderreach',
    },
    wild: 'emberash',
    look: {
      ground: {
        ash: 0x5a4a44,
        heath: 0x3a2e2e,
        dry: 0x6a5a4a,
        grass: 0x6a6a44,
        snow: 0x6a5a54,
        path: 0x8a6a50,
      },
      water: [0x2a1a14, 0x4a2a1a, 0xc8703a],
      sky: 0xd88050,
      tint: 0.45,
      haze: 1.5,
      air: 'embers',
    },
  },
  cinderreach: {
    name: 'Cinderreach',
    seed: 173,
    arrive: 'ash',
    places: {
      ash: { kind: 'cinderflats', at: [64, 64] },
      volcano: { kind: 'volcano', at: [38, 38] },
      cone: { kind: 'vents', at: [96, 92] },
    },
    roads: {
      north: 'tombsands',
      east: 'emberfall',
      south: 'ashkeep',
      west: 'maw',
    },
    wild: 'cinderflats',
    look: {
      ground: {
        ash: 0x2e2c2a,
        stone: 0x44403c,
        clay: 0xc8b040,
        snow: 0x3a3634,
        path: 0x5a524a,
      },
      sky: 0x6a625e,
      tint: 0.55,
      haze: 1.9,
      air: 'ash',
    },
  },
  ashkeep: {
    name: 'Ashkeep',
    seed: 179,
    arrive: 'keep',
    places: {
      ash: { kind: 'ashfield', at: [64, 64] },
      keep: { kind: 'keep', at: [64, 54] },
      gate: { kind: 'ashgate', at: [90, 88] },
      volcano: { kind: 'coldcone', at: [36, 90] },
    },
    roads: {
      north: 'cinderreach',
    },
    wild: 'ashfield',
    look: {
      ground: {
        ash: 0x707070,
        stone: 0x5a5a5e,
        snow: 0x8a8a8e,
        path: 0x8a8278,
      },
      sky: 0x8a8a92,
      tint: 0.5,
      haze: 1.4,
    },
  },
  maw: {
    name: 'The Maw',
    seed: 181,
    arrive: 'ash',
    places: {
      ash: { kind: 'scorch', at: [64, 70] },
      maw: { kind: 'maw', at: [64, 50] },
      cone: { kind: 'spatter', at: [30, 88] },
    },
    roads: {
      east: 'cinderreach',
    },
    wild: 'scorch',
    look: {
      ground: {
        ash: 0x1e1a1a,
        stone: 0x2a2224,
        ember: 0xff5a1a,
        snow: 0x2a2020,
        path: 0x4a3a34,
      },
      water: [0x3a0a04, 0x6a1a08, 0xff8a3a],
      sky: 0x6a1a10,
      tint: 0.65,
      haze: 2.2,
      air: 'sparks',
    },
  },
}
