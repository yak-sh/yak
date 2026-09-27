// The general store keeps goods in bins and on the walls. Its keeper sleeps
// in the small loft over the shop.
import type { Plan } from './kit.ts'
import {
  barrel,
  bed,
  chest,
  counter,
  goods,
  lamp,
  rug,
  shelf,
  table,
} from './pieces.ts'

export let STORE: Plan = {
  name: 'store',
  size: [9, 7],
  works: 'store',
  storeys: [
    {
      height: 3,
      doors: [{ side: 'south', at: -1.5, wide: 1.5 }],
      windows: [
        { side: 'south', at: 2.5 },
        { side: 'north', at: -2.5 },
        { side: 'west', at: 0.5 },
      ],
      stairs: { on: 'east', from: 1.75, to: 'north' },
      furnish: [
        { piece: counter, on: 'north', at: -1.5 },
        { piece: goods, on: 'west', at: -1.75 },
        { piece: shelf, on: 'west', at: 1.75 },
        { piece: barrel, at: [0.25, -1.75] },
        { piece: chest, on: 'south', at: 2.25 },
        { piece: lamp, on: 'south', at: -3.25 },
      ],
    },
    {
      height: 2.5,
      windows: [
        { side: 'south', at: -2.5 },
        { side: 'north', at: -2.5 },
        { side: 'west', at: 1.5 },
      ],
      furnish: [
        { piece: bed, on: 'north', at: -2 },
        { piece: chest, on: 'west', at: -1.5 },
        { piece: rug, at: [-0.5, 1] },
        { piece: table, at: [1, 1.75] },
        { piece: lamp, on: 'south', at: -2.75 },
      ],
    },
  ],
}
