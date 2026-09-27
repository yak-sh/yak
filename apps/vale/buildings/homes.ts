// Homes from a one-room cottage to a farmhouse with a sleeping loft. Each
// opens toward the south, with a hearth on the west wall and room to walk
// between the door, the table, and the beds.
import type { Plan } from './kit.ts'
import {
  bed,
  chest,
  hearth,
  lamp,
  rug,
  shelf,
  stool,
  table,
  woodpile,
} from './pieces.ts'

export let COTTAGE: Plan = {
  name: 'cottage',
  size: [5.5, 5],
  chimney: { on: 'west', at: -0.5 },
  storeys: [{
    height: 2.75,
    doors: [{ side: 'south', at: 0 }],
    windows: [
      { side: 'east', at: 0 },
      { side: 'north', at: 1.25 },
    ],
    furnish: [
      { piece: hearth, on: 'west', at: -0.5 },
      { piece: bed, on: 'north', at: 0.25 },
      { piece: table, at: [0, 0.25] },
      { piece: stool, at: [1.25, 1.25], face: 'south' },
      { piece: chest, on: 'east', at: 1.25 },
      { piece: lamp, on: 'south', at: -1.5 },
    ],
  }],
  more: (k) => k.place(woodpile, [0, -3]),
}

export let HOUSE: Plan = {
  name: 'house',
  size: [7, 6],
  chimney: { on: 'west', at: -0.75 },
  storeys: [
    {
      height: 2.75,
      doors: [{ side: 'south', at: 0 }],
      windows: [
        { side: 'south', at: -2.25 },
        { side: 'north', at: 1.5 },
        { side: 'west', at: 1.5 },
      ],
      stairs: { on: 'east', from: 2, to: 'north' },
      furnish: [
        { piece: hearth, on: 'west', at: -0.75 },
        { piece: table, at: [0.25, -0.5] },
        { piece: stool, at: [1.5, 0.75], face: 'south' },
        { piece: shelf, on: 'north', at: 0 },
        { piece: chest, on: 'south', at: -2.5 },
        { piece: lamp, on: 'north', at: 2.5 },
      ],
    },
    {
      height: 2.25,
      windows: [
        { side: 'south', at: -2.25 },
        { side: 'north', at: 1.5 },
        { side: 'west', at: 1.5 },
      ],
      furnish: [
        { piece: bed, on: 'north', at: -2.25 },
        { piece: bed, on: 'south', at: 0.25 },
        { piece: chest, on: 'west', at: 1.5 },
        { piece: rug, at: [0, 0] },
        { piece: lamp, on: 'south', at: 1.5 },
      ],
    },
  ],
}

export let FARMHOUSE: Plan = {
  name: 'farmhouse',
  size: [9, 6.5],
  chimney: { on: 'west', at: -1 },
  storeys: [
    {
      height: 3,
      doors: [{ side: 'south', at: 0, wide: 1.25 }],
      windows: [
        { side: 'south', at: -2.75 },
        { side: 'south', at: 2.75 },
        { side: 'north', at: -2.75 },
        { side: 'west', at: 2 },
      ],
      stairs: { on: 'east', from: 2.25, to: 'north' },
      furnish: [
        { piece: hearth, on: 'west', at: -1 },
        { piece: table, at: [-0.5, -0.75] },
        { piece: stool, at: [-1.5, 0.25], face: 'north' },
        { piece: stool, at: [0.5, 0.25], face: 'north' },
        { piece: shelf, on: 'north', at: 0.5 },
        { piece: chest, on: 'south', at: -3 },
        { piece: lamp, on: 'south', at: 3 },
      ],
    },
    {
      height: 2.5,
      windows: [
        { side: 'south', at: -2.75 },
        { side: 'south', at: 2.75 },
        { side: 'north', at: -2.75 },
        { side: 'west', at: 1.75 },
      ],
      furnish: [
        { piece: bed, on: 'north', at: -3 },
        { piece: bed, on: 'south', at: -3 },
        { piece: bed, on: 'north', at: 0.5 },
        { piece: chest, on: 'south', at: 3 },
        { piece: rug, at: [-1, 0] },
        { piece: lamp, on: 'south', at: 1.25 },
      ],
    },
  ],
  more: (k) => k.place(woodpile, [0, -4]),
}
