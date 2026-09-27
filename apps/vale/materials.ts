// What a hero gathers (gather.ts): the logs, ores, herbs and fish each land's
// nodes give, one row per kind, as items.ts has them. Each is drawn from one
// of four shapes in its own colours: a log, a lump of ore, a sprig, a fish.
// Iron ore and the mushroom cap were creature drops before there was
// gathering, and stay in items.ts.
import type { Box } from './boxes.ts'
import type { Thing, View } from './items.ts'
import { metal } from './mesh.ts'
>>>>>>> 7e18319f (Mossvale: a model built of boxes never draws two faces in one plane. Its boxes are one solid (boxes.ts): each is worn over those before it, a side within a step (5 mm, mesh.ts STEP) of an earlier box's same side standing a step outside it, or flush where both are the same stuff; and a face is drawn only where it shows, cut where another box lies against it or over it. A figure's parts are worn over the parts before them that stand square to them as it is built (parts.ts knit), so a thigh no longer flickers against a flank. Figures, a thing's look, logs and stumps and a foundation all go through it; mesh.ts `fights` finds any two faces the depth buffer cannot tell apart, and tests over every creature, every hero's dress, every look and every prop find none (T-40879))

// A look and how its picture sees it.
type Made = { look: Box[]; view: View }

// A log on its side, its cut end toward you showing its rings, a stub of a
// branch on top.
let log = (bark: number, wood: number): Made => ({
  view: 'front',
  look: [
    [[-0.1, 0.03, -0.2], [0.2, 0.14, 0.4], bark],
    [[-0.07, 0, -0.2], [0.14, 0.2, 0.4], bark],
    [[-0.08, 0.04, 0.2], [0.16, 0.12, 0.01], wood],
    [[-0.05, 0.015, 0.2], [0.1, 0.17, 0.006], wood],
    [[-0.04, 0.06, 0.21], [0.08, 0.08, 0.01], bark],
    [[-0.015, 0.085, 0.22], [0.03, 0.03, 0.01], wood],
    [[-0.025, 0.19, -0.12], [0.05, 0.06, 0.05], bark],
  ],
})
/** A craggy rock with the metal in it glinting from its faces: every ore,
 * iron ore in items.ts too. */
export let lump = (stone: number, fleck: number): Made => ({
  view: 'corner',
  look: [
    [[-0.13, 0, -0.1], [0.26, 0.12, 0.2], stone],
    [[-0.08, 0.1, -0.08], [0.15, 0.08, 0.14], stone],
    [[0.04, 0.02, -0.14], [0.08, 0.08, 0.06], stone],
    [[-0.05, 0.16, -0.03], [0.06, 0.05, 0.06], metal(fleck)],
    [[0.03, 0.04, 0.08], [0.06, 0.05, 0.04], metal(fleck)],
    [[0.11, 0.06, -0.06], [0.04, 0.04, 0.05], metal(fleck)],
    [[-0.11, 0.05, 0.08], [0.04, 0.04, 0.04], metal(fleck)],
  ],
})
// A sprig: a stem, a leaf either side, and its flower or berries on top.
let sprig = (leaf: number, bloom: number): Made => ({
  view: 'front',
  look: [
    [[-0.015, 0, -0.015], [0.03, 0.24, 0.03], leaf],
    [[-0.11, 0.06, -0.025], [0.1, 0.035, 0.05], leaf],
    [[-0.11, 0.095, -0.025], [0.035, 0.04, 0.05], leaf],
    [[0.015, 0.12, -0.025], [0.1, 0.035, 0.05], leaf],
    [[0.08, 0.155, -0.025], [0.035, 0.04, 0.05], leaf],
    [[-0.07, 0.24, -0.04], [0.14, 0.06, 0.08], bloom],
    [[-0.035, 0.2, -0.04], [0.07, 0.14, 0.08], bloom],
  ],
})
// A fish, its head toward +z: a body over a pale belly, a forked tail, a fin
// on its back and an eye.
let fish = (back: number, belly: number): Made => ({
  view: 'side',
  look: [
    [[-0.04, 0.05, -0.12], [0.08, 0.09, 0.22], back],
    [[-0.035, 0.02, -0.1], [0.07, 0.04, 0.18], belly],
    [[-0.03, 0.04, 0.1], [0.06, 0.08, 0.05], back],
    [[-0.02, 0.06, -0.17], [0.04, 0.05, 0.06], back],
    [[-0.012, 0.1, -0.25], [0.024, 0.07, 0.09], back],
    [[-0.012, 0, -0.25], [0.024, 0.07, 0.09], back],
    [[-0.01, 0.14, -0.07], [0.02, 0.04, 0.1], back],
    [[0.04, 0.09, 0.07], [0.01, 0.03, 0.03], 0x1a1410],
  ],
})

let row = (name: string, made: Made): Thing => ({ name, ...made })

export let MATERIALS: Record<string, Thing> = {
  // Logs.
  oaklog: row('Oak log', log(0x6e4a30, 0xd8b078)),
  pinelog: row('Pine log', log(0x5a3e2a, 0xe8c890)),
  driftwood: row('Driftwood', log(0xb8ab98, 0xd8ccb8)),
  stalkwood: row('Stalkwood', log(0xe8e0cc, 0xf6f0e0)),
  rimewood: row('Rimewood', log(0x4a4038, 0xdce8f0)),
  palmwood: row('Palmwood', log(0x8a6a44, 0xe0c8a0)),
  sprucelog: row('Old spruce log', log(0x3e2e22, 0xd8b880)),
  charwood: row('Charwood', log(0x221e1c, 0xe8622a)),
  // Ores.
  copper: row('Copper ore', lump(0x7a6a5a, 0xc8783a)),
  silver: row('Silver ore', lump(0x6a6a70, 0xe0e4ea)),
  gold: row('Gold ore', lump(0x7a6a58, 0xf2c14e)),
  gleamstone: row('Gleamstone', lump(0x4a4a6a, 0x9ad8ff)),
  iceore: row('Ice ore', lump(0x8aa0b0, 0xc8f0ff)),
  sunstone: row('Sunstone', lump(0xa0704a, 0xffa040)),
  starsilver: row('Starsilver', lump(0x505868, 0xf0f8ff)),
  obsidian: row('Obsidian', lump(0x1a1622, 0x5a4a7a)),
  emberstone: row('Emberstone', lump(0x3a2420, 0xff5a2a)),
  // Herbs.
  mossberry: row('Mossberries', sprig(0x4f8f3c, 0xc0406a)),
  myrtle: row('Bog myrtle', sprig(0x5a7a3a, 0xc8a050)),
  marigold: row('Marigold', sprig(0x5a9a44, 0xf2a030)),
  samphire: row('Samphire', sprig(0x6aa04a, 0x8ac060)),
  snowbell: row('Snowbell', sprig(0x5a8a6a, 0xf4f8ff)),
  sage: row('Desert sage', sprig(0x8aa07a, 0xb8a0d8)),
  wolfsbane: row('Wolfsbane', sprig(0x4a6a3a, 0x6a4ab8)),
  firebloom: row('Firebloom', sprig(0x3a3a2a, 0xff5a2a)),
  // Fish.
  perch: row('Perch', fish(0x6a8a4a, 0xe8d8a0)),
  pike: row('Pike', fish(0x4a6a4a, 0xd8d8b8)),
  mackerel: row('Mackerel', fish(0x3a6a8a, 0xe8eef0)),
  eel: row('Mire eel', fish(0x3a3a2a, 0x8a8a5a)),
  char: row('Tarn char', fish(0x5a6a7a, 0xe86a4a)),
  carp: row('Oasis carp', fish(0xd8883a, 0xf8e0b0)),
}
