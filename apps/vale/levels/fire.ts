// The fire, furthest south-west: ash and fire, and the Maw at the end.
import type { Row } from '../levels.ts'

export let FIRE: Record<string, Row> = {
  emberfall: {
    name: 'Emberfall',
    seed: 167,
    arrive: 'forge',
    places: {
      ash: { kind: 'ashfield', at: [64, 64] },
      volcano: { kind: 'volcano', at: [96, 34] },
      moor: { kind: 'moor', at: [30, 40] },
      forge: { kind: 'village', at: [58, 70] },
    },
    roads: {
      east: 'giantsteps',
      west: 'cinderreach',
    },
  },
  cinderreach: {
    name: 'Cinderreach',
    seed: 173,
    arrive: 'ash',
    places: {
      ash: { kind: 'ashfield', at: [64, 64] },
      volcano: { kind: 'volcano', at: [38, 38] },
      cone: { kind: 'volcano', at: [96, 92] },
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
    arrive: 'keep',
    places: {
      ash: { kind: 'ashfield', at: [64, 64] },
      keep: { kind: 'ruins', at: [64, 54] },
      gate: { kind: 'ruins', at: [90, 88] },
      volcano: { kind: 'volcano', at: [36, 90] },
    },
    roads: {
      north: 'cinderreach',
    },
  },
  maw: {
    name: 'The Maw',
    seed: 181,
    arrive: 'ash',
    places: {
      ash: { kind: 'ashfield', at: [64, 70] },
      maw: { kind: 'volcano', at: [64, 50] },
      cone: { kind: 'volcano', at: [30, 88] },
    },
    roads: {
      east: 'cinderreach',
    },
  },
}
