// The carpenter's workshop: a broad bench beneath the back windows, tools
// on the wall and stock ready at hand. The bench is the village's Woodworking
// station, with its working position left clear between it and the door.
import type { Plan } from './kit.ts'
import {
  barrel,
  chest,
  joinerbench,
  lamp,
  shelf,
  toolrack,
  woodpile,
} from './pieces.ts'

export let CARPENTRY: Plan = {
  name: 'carpentry',
  size: [8, 6],
  works: 'carpenter',
  storeys: [{
    height: 3.25,
    doors: [{ side: 'south', at: 1.5, wide: 1.5 }],
    windows: [
      { side: 'south', at: -2.5 },
      { side: 'north', at: 2.5 },
      { side: 'west', at: -1.5 },
    ],
    furnish: [
      { piece: joinerbench, on: 'north', at: -1.25 },
      { piece: toolrack, on: 'west', at: -1.5 },
      { piece: woodpile, on: 'east', at: -1.5 },
      { piece: barrel, at: [-2.5, 1.75] },
      { piece: chest, on: 'east', at: 1.75 },
      { piece: shelf, on: 'north', at: 2.5 },
      { piece: lamp, on: 'south', at: -2.5 },
    ],
  }],
}
