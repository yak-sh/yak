// The apothecary: a pot under its chimney, herbs and jars round the walls,
// and the village's Brewing station within reach of the entrance.
import type { Plan } from './kit.ts'
import { barrel, cauldron, chest, lamp, shelf, table } from './pieces.ts'

export let APOTHECARY: Plan = {
  name: 'apothecary',
  size: [7, 6],
  works: 'apothecary',
  chimney: { on: 'north', at: 0 },
  storeys: [{
    height: 3.25,
    doors: [{ side: 'south', at: 0 }],
    windows: [
      { side: 'south', at: -2.25 },
      { side: 'south', at: 2.25 },
      { side: 'west', at: -1.25 },
      { side: 'east', at: 1.25 },
    ],
    furnish: [
      { piece: cauldron, on: 'north', at: 0 },
      { piece: shelf, on: 'west', at: 1.5 },
      { piece: shelf, on: 'east', at: -1.5 },
      { piece: chest, on: 'west', at: -1.75 },
      { piece: barrel, on: 'east', at: 1.75 },
      { piece: table, at: [-1.5, 1.5] },
      { piece: lamp, on: 'north', at: 2 },
    ],
  }],
}
