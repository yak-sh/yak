// The sands, south-west past the coast: Dustmere's dust where a mere dried,
// Palmwell's green water and caravans, the white glare of the Sunscar Dunes,
// Redmesa's red rock, and the tombs of Tombsands at dusk.
import type { Row } from '../levels.ts'

export let SANDS: Record<string, Row> = {
  dustmere: {
    name: 'Dustmere',
    seed: 109,
    arrive: 'well',
    places: {
      dunes: { kind: 'dustpan', at: [64, 64] },
      mesa: { kind: 'oldshore', at: [96, 36] },
      oasis: { kind: 'lastpool', at: [90, 88] },
      well: { kind: 'welltown', at: [58, 62] },
    },
    roads: {
      north: 'driftwood',
      south: 'sunscar',
      west: 'palmwell',
    },
    wild: 'dustpan',
    look: {
      ground: {
        dry: 0xd4c4a0,
        mud: 0x9a8868,
        sand: 0xd8c8a4,
        stone: 0xb8ab94,
        snow: 0xcfc2a4,
      },
      water: [0x4a3e2c, 0x6e5e44, 0xb0a080],
      sky: 0xd8c4a0,
      tint: 0.45,
      haze: 1.9,
      air: 'dust',
    },
  },
  palmwell: {
    name: 'Palmwell',
    seed: 113,
    arrive: 'camp',
    places: {
      dunes: { kind: 'golddunes', at: [64, 64] },
      oasis: { kind: 'palmgrove', at: [50, 52] },
      mesa: { kind: 'mesa', at: [96, 96] },
      camp: { kind: 'caravan', at: [72, 72] },
    },
    roads: {
      east: 'dustmere',
      south: 'redmesa',
    },
    wild: 'golddunes',
    look: {
      ground: {
        sand: 0xf2d690,
        lush: 0x3a9a44,
        grass: 0x6ab050,
        snow: 0xeedcb0,
      },
      water: [0x0a4a5a, 0x1a9aa8, 0xc8fff0],
      sky: 0xfff0c8,
      tint: 0.3,
    },
  },
  sunscar: {
    name: 'Sunscar Dunes',
    seed: 127,
    arrive: 'dunes',
    places: {
      dunes: { kind: 'greatdunes', at: [64, 64] },
      east: { kind: 'bonedunes', at: [94, 40] },
      buried: { kind: 'buried', at: [40, 40] },
      mesa: { kind: 'scar', at: [86, 90] },
    },
    roads: {
      north: 'dustmere',
      west: 'redmesa',
    },
    wild: 'greatdunes',
    look: {
      ground: {
        sand: 0xf4dc98,
        ash: 0x243432,
        stone: 0xd8c8a0,
        snow: 0xf8ecc8,
      },
      sky: 0xfff4d0,
      tint: 0.35,
      haze: 1.2,
      air: 'heat',
    },
  },
  redmesa: {
    name: 'Redmesa',
    seed: 131,
    arrive: 'mesa',
    places: {
      dunes: { kind: 'dunes', at: [64, 100] },
      mesa: { kind: 'redrock', at: [64, 64] },
      west: { kind: 'buttes', at: [36, 36] },
      east: { kind: 'buttes', at: [94, 92] },
      oasis: { kind: 'spring', at: [90, 40] },
    },
    roads: {
      north: 'palmwell',
      east: 'sunscar',
      west: 'tombsands',
    },
    wild: 'buttes',
    look: {
      ground: {
        sand: 0xd88a5a,
        clay: 0xb85a38,
        dry: 0xc8905a,
        grass: 0x9aa050,
        lush: 0x6a9040,
        stone: 0xa86a4a,
        snow: 0xc87850,
      },
      water: [0x2a4a4a, 0x4a7a6a, 0xb8d8c0],
      sky: 0xf0b088,
      tint: 0.4,
      haze: 1.2,
    },
  },
  tombsands: {
    name: 'Tombsands',
    seed: 137,
    arrive: 'tombs',
    places: {
      dunes: { kind: 'tombdunes', at: [64, 64] },
      tombs: { kind: 'necropolis', at: [64, 48] },
      sunken: { kind: 'sunkentomb', at: [38, 86] },
      mesa: { kind: 'tombcliffs', at: [96, 92] },
    },
    roads: {
      east: 'redmesa',
      south: 'cinderreach',
    },
    wild: 'tombdunes',
    look: {
      ground: {
        sand: 0xe8d0a0,
        stone: 0xd8c098,
        clay: 0xc8a878,
        snow: 0xe0c8a0,
      },
      sky: 0xe8a868,
      tint: 0.4,
      haze: 1.3,
    },
  },
}
