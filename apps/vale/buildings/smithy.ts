// The smithy: a stone workshop with a timber loft over it, where the smith
// sleeps. The forge stands against the west gable under the chimney, the
// anvil before it with the quench tub at hand, tools hung on the wall and
// what was made racked by the window. Double doors on the south front open
// on the square, a sign with an anvil on it hangs beside them, and stairs
// along the east wall climb to the loft.
import type { Plan } from './kit.ts'
import {
  anvil,
  barrel,
  bed,
  chest,
  coal,
  forge,
  grindstone,
  lamp,
  quench,
  rug,
  shelf,
  smithbench,
  stool,
  table,
  toolrack,
  weapons,
  woodpile,
} from './pieces.ts'

export let SMITHY: Plan = {
  name: 'smithy',
  size: [8, 6],
  works: 'smith',
  chimney: { on: 'west', at: -0.25 },
  storeys: [
    {
      height: 3,
      walls: 'stone',
      doors: [{ side: 'south', at: 1.5, wide: 1.5 }],
      windows: [
        { side: 'south', at: -2.5 },
        { side: 'north', at: 2.5 },
        { side: 'east', at: -2 },
      ],
      stairs: { on: 'east', from: 2, to: 'north' },
      furnish: [
        { piece: forge, on: 'west', at: -0.25 },
        { piece: coal, on: 'west', at: -2.25 },
        { piece: anvil, at: [-1.25, 0], face: 'west' },
        { piece: quench, at: [-2.75, 1.75] },
        { piece: toolrack, on: 'north', at: -2.75 },
        { piece: smithbench, on: 'north', at: -0.25 },
        { piece: weapons, on: 'south', at: -0.75 },
        { piece: barrel, at: [0.75, 1.75] },
        { piece: lamp, on: 'north', at: 1 },
        { piece: lamp, on: 'south', at: -2.5 },
      ],
    },
    {
      height: 2,
      windows: [
        { side: 'south', at: -2.5 },
        { side: 'south', at: 1.5 },
        { side: 'north', at: -1 },
        { side: 'east', at: 0.5 },
      ],
      furnish: [
        { piece: bed, on: 'north', at: -2.75 },
        { piece: chest, at: [-2.75, 0.25], face: 'north' },
        { piece: rug, at: [-0.5, 0.25] },
        { piece: table, at: [0.75, 2.25] },
        { piece: stool, at: [0.75, 1.5], face: 'north' },
        { piece: shelf, on: 'west', at: 1.75 },
        { piece: lamp, on: 'south', at: -0.5 },
      ],
    },
  ],
  more: (k) => {
    // A sign hung from a bracket east of the doors, seen from along the
    // street either way: an anvil, dark on pale boards.
    let y = k.floors[0] + 10
    let at = (d: number, up: number): [number, number, number] => {
      let [x, z] = k.cell('south', 11, d)
      return [x, up, z]
    }
    for (let d = -1; d >= -5; d--) {
      k.put(...at(d, y), k.dress.timber, 'the sign')
    }
    for (let d of [-2, -4]) k.put(...at(d, y - 1), 0x3e3e46, 'the sign')
    let ANVIL = ['XXXX.', '.XX..', 'XXX..', '.....']
    ANVIL.forEach((row, r) =>
      [...row].forEach((c, i) =>
        k.put(
          ...at(-1 - i, y - 2 - r),
          c == 'X' ? 0x3a3a40 : 0xe8dcc0,
          'the sign',
        )
      )
    )
    // Split logs against the east wall, and out front a grindstone and a
    // water barrel.
    k.place(woodpile, [4.25, -1.5], 'east')
    k.place(grindstone, [-1.25, 3.75])
    k.place(barrel, [-3.5, 3.5])
  },
}
