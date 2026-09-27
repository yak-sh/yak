// The tailor's shop: a loom by the light, a cutting table, bolts and a
// fitting rug. The loom becomes the Tailoring station with T-40826.
import type { Plan } from './kit.ts'
import { chest, lamp, loom, rug, shelf, table } from './pieces.ts'

export let TAILOR: Plan = {
  name: 'tailor',
  size: [8, 6],
  works: 'tailor',
  storeys: [{
    height: 3,
    doors: [{ side: 'south', at: 1.5 }],
    windows: [
      { side: 'south', at: -2.5 },
      { side: 'north', at: 2.5 },
      { side: 'west', at: -1.5 },
    ],
    furnish: [
      { piece: loom, on: 'north', at: -1 },
      { piece: table, at: [-2, 1] },
      { piece: chest, on: 'east', at: 1.5 },
      { piece: shelf, on: 'east', at: -1.5 },
      { piece: rug, at: [0.5, 0.25] },
      { piece: lamp, on: 'north', at: 2.5 },
    ],
  }],
}
