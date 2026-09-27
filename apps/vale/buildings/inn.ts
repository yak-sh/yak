// The inn opens onto the square. Its common room has a serving counter,
// tables and a barrel by the wall; beds upstairs look out over the street.
import { facade } from './facade.ts'
import type { Plan } from './kit.ts'
import {
  barrel,
  bed,
  chest,
  counter,
  lamp,
  rug,
  shelf,
  stool,
  table,
} from './pieces.ts'

export let INN: Plan = {
  name: 'inn',
  size: [12, 9],
  works: 'inn',
  storeys: [
    {
      height: 3.5,
      doors: [{ side: 'south', at: -2.5, wide: 1.5 }],
      windows: [
        { side: 'south', at: 2.5 },
        { side: 'north', at: -3.5 },
        { side: 'north', at: 3.5 },
        { side: 'west', at: 0 },
      ],
      stairs: { on: 'east', from: 2.75, to: 'north' },
      furnish: [
        { piece: counter, on: 'north', at: -1.5 },
        { piece: shelf, on: 'north', at: 2.5 },
        { piece: table, at: [-2, -0.5] },
        { piece: stool, at: [-3, 0.5], face: 'west' },
        { piece: table, at: [1.5, 1] },
        { piece: stool, at: [2.75, 1], face: 'east' },
        { piece: barrel, on: 'west', at: 2.75 },
        { piece: lamp, on: 'south', at: 3.5 },
        { piece: lamp, on: 'north', at: -4.5 },
      ],
    },
    {
      height: 2.75,
      windows: [
        { side: 'south', at: -3.5 },
        { side: 'south', at: 2.5 },
        { side: 'north', at: -3.5 },
        { side: 'west', at: 0 },
      ],
      furnish: [
        { piece: bed, on: 'north', at: -3.75 },
        { piece: bed, on: 'west', at: -0.5 },
        { piece: chest, at: [0, -2.5] },
        { piece: rug, at: [-1, 1] },
        { piece: table, at: [1, 2.5] },
        { piece: lamp, on: 'south', at: -0.5 },
      ],
    },
  ],
  more: (k) => {
    facade(k, {
      mark: {
        at: 4.5,
        icon: ['.XXX.', 'XX..X', 'XX..X', 'XX..X', '.XXX.'],
        ink: 0xf3d79a,
        board: 0x68382d,
      },
      awning: { at: -2.5, wide: 3.5, colors: [0x9e3f36, 0xe8c593] },
    })
    k.place(barrel, [-4.5, 5.5])
    k.place(barrel, [-3.75, 5.5])
  },
}
