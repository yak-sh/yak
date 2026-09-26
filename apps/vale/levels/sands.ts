// The sands, south-west past the coast.
import type { Row } from '../levels.ts'

export let SANDS: Record<string, Row> = {
  dustmere: {
    name: 'Dustmere',
    seed: 109,
    arrive: 'well',
    places: {
      dunes: { kind: 'dunes', at: [64, 64] },
      mesa: { kind: 'mesa', at: [96, 36] },
      oasis: { kind: 'oasis', at: [90, 88] },
      well: { kind: 'village', at: [58, 62] },
    },
    roads: {
      north: 'driftwood',
      south: 'sunscar',
      west: 'palmwell',
    },
  },
  palmwell: {
    name: 'Palmwell',
    seed: 113,
    arrive: 'camp',
    places: {
      dunes: { kind: 'dunes', at: [64, 64] },
      oasis: { kind: 'oasis', at: [50, 52] },
      mesa: { kind: 'mesa', at: [96, 96] },
      camp: { kind: 'village', at: [72, 72] },
    },
    roads: {
      east: 'dustmere',
      south: 'redmesa',
    },
  },
  sunscar: {
    name: 'Sunscar Dunes',
    seed: 127,
    arrive: 'dunes',
    places: {
      dunes: { kind: 'dunes', at: [64, 64] },
      east: { kind: 'dunes', at: [94, 40] },
      buried: { kind: 'ruins', at: [40, 40] },
      mesa: { kind: 'mesa', at: [96, 94] },
    },
    roads: {
      north: 'dustmere',
      west: 'redmesa',
    },
  },
  redmesa: {
    name: 'Redmesa',
    seed: 131,
    arrive: 'mesa',
    places: {
      dunes: { kind: 'dunes', at: [64, 100] },
      mesa: { kind: 'mesa', at: [64, 64] },
      west: { kind: 'mesa', at: [36, 36] },
      east: { kind: 'mesa', at: [94, 92] },
      oasis: { kind: 'oasis', at: [90, 40] },
    },
    roads: {
      north: 'palmwell',
      east: 'sunscar',
      west: 'tombsands',
    },
  },
  tombsands: {
    name: 'Tombsands',
    seed: 137,
    arrive: 'tombs',
    places: {
      dunes: { kind: 'dunes', at: [64, 64] },
      tombs: { kind: 'ruins', at: [64, 48] },
      sunken: { kind: 'ruins', at: [38, 86] },
      mesa: { kind: 'mesa', at: [96, 92] },
    },
    roads: {
      east: 'redmesa',
      south: 'cinderreach',
    },
  },
}
