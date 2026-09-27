// A broad civic room, with the council table visible from the double doors,
// banners behind it, and a bench for visitors beside the entry.
import { banners, facade } from './facade.ts'
import type { Plan } from './kit.ts'
import {
  banner,
  chest,
  council,
  lamp,
  rug,
  shelf,
  stool,
  table,
} from './pieces.ts'

export let HALL: Plan = {
  name: 'hall',
  size: [13, 9],
  works: 'hall',
  storeys: [{
    height: 4,
    walls: 'stone',
    doors: [{ side: 'south', at: 0, wide: 2 }],
    windows: [
      { side: 'south', at: -4 },
      { side: 'south', at: 4 },
      { side: 'north', at: -4 },
      { side: 'north', at: 4 },
      { side: 'east', at: -0.5 },
      { side: 'west', at: -0.5 },
    ],
    furnish: [
      { piece: council, at: [0, -1.25] },
      { piece: banner, on: 'north', at: -2 },
      { piece: banner, on: 'north', at: 2 },
      { piece: shelf, on: 'east', at: -2.5 },
      { piece: chest, on: 'west', at: -2.5 },
      { piece: rug, at: [0, 2.25] },
      { piece: table, at: [-4, 1.5] },
      { piece: stool, at: [-4.75, 2.5], face: 'west' },
      { piece: lamp, on: 'south', at: -5 },
      { piece: lamp, on: 'south', at: 5 },
    ],
  }],
  more: (k) => {
    facade(k, {
      mark: {
        at: 0,
        height: 10,
        icon: ['X...X', 'XX.XX', 'XXXXX', '.XXX.', '..X..'],
        ink: 0xefcb70,
        board: 0x3c536b,
      },
    })
    banners(k, [-2.75, 2.75], 0x8e4142)
  },
}
