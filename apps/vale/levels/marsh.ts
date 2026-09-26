// The marshes, east and south of the vale, sinking into bog.
import type { Row } from '../levels.ts'

export let MARSH: Record<string, Row> = {
  reedmarsh: {
    name: 'Reedmarsh',
    seed: 29,
    arrive: 'stilts',
    places: {
      marsh: { kind: 'marsh', at: [60, 64] },
      meadow: { kind: 'meadow', at: [40, 36] },
      pool: { kind: 'lake', at: [36, 90] },
      woods: { kind: 'woods', at: [96, 90] },
      stilts: { kind: 'village', at: [70, 56] },
    },
    roads: {
      south: 'mirewood',
      west: 'mossvale',
    },
  },
  mirewood: {
    name: 'Mirewood',
    seed: 31,
    arrive: 'marsh',
    places: {
      marsh: { kind: 'marsh', at: [60, 64] },
      woods: { kind: 'woods', at: [92, 40] },
      west: { kind: 'woods', at: [36, 36] },
      pool: { kind: 'lake', at: [88, 92] },
    },
    roads: {
      north: 'reedmarsh',
      south: 'fenhollow',
    },
  },
  fenhollow: {
    name: 'Fenhollow',
    seed: 37,
    arrive: 'marsh',
    places: {
      marsh: { kind: 'marsh', at: [64, 64] },
      ruins: { kind: 'ruins', at: [44, 44] },
      pool: { kind: 'lake', at: [92, 86] },
      moor: { kind: 'moor', at: [94, 38] },
    },
    roads: {
      north: 'mirewood',
      south: 'sunkenkirk',
    },
  },
  sunkenkirk: {
    name: 'Sunken Kirk',
    seed: 41,
    arrive: 'kirk',
    places: {
      marsh: { kind: 'marsh', at: [64, 66] },
      kirk: { kind: 'ruins', at: [60, 48] },
      chapel: { kind: 'ruins', at: [90, 88] },
      pool: { kind: 'lake', at: [36, 86] },
      mere: { kind: 'lake', at: [34, 40] },
    },
    roads: {
      north: 'fenhollow',
      east: 'bogheart',
      west: 'oldwall',
    },
  },
  bogheart: {
    name: 'Bogheart',
    seed: 43,
    arrive: 'marsh',
    places: {
      marsh: { kind: 'marsh', at: [64, 64] },
      pool: { kind: 'lake', at: [40, 92] },
      mere: { kind: 'lake', at: [34, 38] },
      toadstools: { kind: 'shroomwood', at: [94, 40] },
    },
    roads: {
      east: 'sporefen',
      west: 'sunkenkirk',
    },
  },
  sporefen: {
    name: 'Sporefen',
    seed: 101,
    arrive: 'toadstools',
    places: {
      marsh: { kind: 'marsh', at: [60, 80] },
      toadstools: { kind: 'shroomwood', at: [64, 56] },
      east: { kind: 'shroomwood', at: [96, 36] },
      pool: { kind: 'lake', at: [30, 40] },
    },
    roads: {
      north: 'glowcap',
      west: 'bogheart',
    },
  },
}
