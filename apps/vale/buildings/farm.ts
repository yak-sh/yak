// Stables keep a clear aisle from the broad doors to the feed along the
// north wall. The barn has room for hay and stores at its edges.
import { facade } from './facade.ts'
import type { Plan } from './kit.ts'
import { barrel, haybale, lamp, manger, trough } from './pieces.ts'

export let STABLE: Plan = {
  name: 'stable',
  size: [9, 6],
  storeys: [{
    height: 3.25,
    doors: [{ side: 'south', at: 0, wide: 2.5, tall: 2.75 }],
    windows: [
      { side: 'north', at: -2.75 },
      { side: 'north', at: 2.75 },
      { side: 'west', at: 0 },
      { side: 'east', at: 0 },
    ],
    furnish: [
      { piece: manger, on: 'north', at: -2.5 },
      { piece: manger, on: 'north', at: 2.5 },
      { piece: trough, on: 'west', at: 1.25 },
      { piece: haybale, at: [-3, 1.75] },
      { piece: lamp, on: 'south', at: -3.5 },
      { piece: lamp, on: 'south', at: 3.5 },
    ],
  }],
  more: (k) =>
    facade(k, {
      mark: {
        at: 4,
        height: 8,
        icon: ['X...X', 'X...X', '.X.X.', '.XXX.', '..X..'],
        ink: 0xe2c180,
        board: 0x4d3b2c,
      },
      awning: { at: 0, wide: 3.5, height: 13, colors: [0x74543a, 0x9e794d] },
    }),
}

export let BARN: Plan = {
  name: 'barn',
  size: [11, 8],
  storeys: [{
    height: 4,
    doors: [{ side: 'south', at: 0, wide: 3, tall: 3 }],
    windows: [
      { side: 'north', at: -3.5 },
      { side: 'north', at: 3.5 },
      { side: 'east', at: -2.25 },
      { side: 'west', at: 2.25 },
    ],
    furnish: [
      { piece: manger, on: 'north', at: -3.5 },
      { piece: manger, on: 'north', at: 3.5 },
      { piece: haybale, at: [-3.75, -0.5] },
      { piece: haybale, at: [-3.75, 0.5] },
      { piece: haybale, at: [3.75, 0] },
      { piece: trough, on: 'east', at: 2 },
      { piece: barrel, at: [3.75, 2.75] },
      { piece: lamp, on: 'south', at: -4 },
      { piece: lamp, on: 'south', at: 4 },
    ],
  }],
  more: (k) =>
    facade(k, {
      mark: {
        at: 4.5,
        height: 9,
        icon: ['..X..', '.XXX.', 'XXXXX', '..X..', '.X.X.'],
        ink: 0xe7bd63,
        board: 0x684934,
      },
      awning: { at: 0, wide: 4, height: 15, colors: [0x715232, 0x987043] },
    }),
}
