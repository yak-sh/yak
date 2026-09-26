// What a hero gathers (gather.ts): the logs, ores, herbs and fish each land's
// nodes give, one row per kind, as items.ts has them. Each is drawn from one
// of four shapes in its own colours: a log, a lump of ore, a sprig, a fish.
// Iron ore and the mushroom cap were creature drops before there was
// gathering, and stay in items.ts.
import type { Box, Thing } from './items.ts'

// A log on its side, its cut ends showing the wood.
let log = (bark: number, wood: number): Box[] => [
  [[-0.22, 0, -0.08], [0.44, 0.16, 0.16], bark],
  [[0.22, 0.02, -0.06], [0.02, 0.12, 0.12], wood],
  [[-0.24, 0.02, -0.06], [0.02, 0.12, 0.12], wood],
]
// A lump of stone flecked with what is in it.
let lump = (stone: number, fleck: number): Box[] => [
  [[-0.12, 0, -0.1], [0.24, 0.14, 0.2], stone],
  [[-0.06, 0.1, -0.04], [0.08, 0.07, 0.08], fleck],
  [[0.05, 0.04, 0.07], [0.06, 0.06, 0.05], fleck],
]
// A sprig: a stem, a leaf either side, and its flower or berries.
let sprig = (leaf: number, bloom: number): Box[] => [
  [[-0.02, 0, -0.02], [0.04, 0.24, 0.04], leaf],
  [[-0.11, 0.08, -0.03], [0.22, 0.05, 0.06], leaf],
  [[-0.07, 0.22, -0.07], [0.14, 0.09, 0.14], bloom],
]
// A fish on its side, its tail up.
let fish = (back: number, belly: number): Box[] => [
  [[-0.06, 0, -0.17], [0.12, 0.08, 0.28], back],
  [[-0.05, 0.08, -0.14], [0.1, 0.03, 0.2], belly],
  [[-0.08, 0, 0.11], [0.16, 0.12, 0.05], back],
]

let row = (name: string, icon: string, look: Box[]): Thing => ({
  name,
  icon,
  look,
})

export let MATERIALS: Record<string, Thing> = {
  // Logs.
  oaklog: row('Oak log', '🪵', log(0x6e4a30, 0xd8b078)),
  pinelog: row('Pine log', '🌲', log(0x5a3e2a, 0xe8c890)),
  driftwood: row('Driftwood', '🪵', log(0xb8ab98, 0xd8ccb8)),
  stalkwood: row('Stalkwood', '🍄', log(0xe8e0cc, 0xf6f0e0)),
  rimewood: row('Rimewood', '❄️', log(0x4a4038, 0xdce8f0)),
  palmwood: row('Palmwood', '🌴', log(0x8a6a44, 0xe0c8a0)),
  sprucelog: row('Old spruce log', '🌲', log(0x3e2e22, 0xd8b880)),
  charwood: row('Charwood', '🔥', log(0x221e1c, 0xe8622a)),
  // Ores.
  silver: row('Silver ore', '⚪', lump(0x6a6a70, 0xe0e4ea)),
  gold: row('Gold ore', '🟡', lump(0x7a6a58, 0xf2c14e)),
  gleamstone: row('Gleamstone', '💠', lump(0x4a4a6a, 0x9ad8ff)),
  iceore: row('Ice ore', '🧊', lump(0x8aa0b0, 0xc8f0ff)),
  sunstone: row('Sunstone', '🟠', lump(0xa0704a, 0xffa040)),
  starsilver: row('Starsilver', '⭐', lump(0x505868, 0xf0f8ff)),
  obsidian: row('Obsidian', '⬛', lump(0x1a1622, 0x5a4a7a)),
  emberstone: row('Emberstone', '♦️', lump(0x3a2420, 0xff5a2a)),
  // Herbs.
  mossberry: row('Mossberries', '🫐', sprig(0x4f8f3c, 0xc0406a)),
  myrtle: row('Bog myrtle', '🌿', sprig(0x5a7a3a, 0xc8a050)),
  marigold: row('Marigold', '🌼', sprig(0x5a9a44, 0xf2a030)),
  samphire: row('Samphire', '🌱', sprig(0x6aa04a, 0x8ac060)),
  snowbell: row('Snowbell', '🔔', sprig(0x5a8a6a, 0xf4f8ff)),
  sage: row('Desert sage', '🍃', sprig(0x8aa07a, 0xb8a0d8)),
  wolfsbane: row('Wolfsbane', '🪻', sprig(0x4a6a3a, 0x6a4ab8)),
  firebloom: row('Firebloom', '🌺', sprig(0x3a3a2a, 0xff5a2a)),
  // Fish.
  perch: row('Perch', '🐠', fish(0x6a8a4a, 0xe8d8a0)),
  pike: row('Pike', '🐟', fish(0x4a6a4a, 0xd8d8b8)),
  mackerel: row('Mackerel', '🐟', fish(0x3a6a8a, 0xe8eef0)),
  eel: row('Mire eel', '🪱', fish(0x3a3a2a, 0x8a8a5a)),
  char: row('Tarn char', '🐟', fish(0x5a6a7a, 0xe86a4a)),
  carp: row('Oasis carp', '🎏', fish(0xd8883a, 0xf8e0b0)),
}
