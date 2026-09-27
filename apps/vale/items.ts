// What a player can carry: one row per kind of thing, with its name, what it
// does (a tonic heals, a sword is worn in the hand), and how it is drawn, a
// few soft boxes, lying on the ground and in the bag (sprites.ts). A new kind of loot or
// gift is a row here; beasts.ts says what drops it and quests.ts what gives
// it. The arms and armour of every tier are rows of arms.ts, and what a hero
// gathers is a row of materials.ts, both listed here too.
import { ARMS, forged, type Slot, wield } from './arms.ts'
import { lump, MATERIALS } from './materials.ts'
import { cuboid, metal, type Out, out, type Vec } from './mesh.ts'

/** One box of a model: its low corner, its size, its colour, and how wide
 * the rounding of its edges is, when not a small thing's usual. */
export type Box = [Vec, Vec, number, number?]

/** How a thing's picture sees it (sprites.ts), its front toward +z: from a
 * corner above, the most of it at once; from the `front`, for what is worn
 * on a chest or a head; from the `side`, for a boot or a fish; from the
 * `top`, for what lies flat; `lying` corner to corner, for a blade or a
 * staff. */
export type View = 'corner' | 'front' | 'side' | 'top' | 'lying'

export type Thing = {
  name: string
  /** health a drink gives back */
  heals?: number
  /** where it is worn (gear.ts); a thing without one is only carried */
  slot?: Slot
  /** how strong it is, 1 to 5, by the country it comes from (arms.ts) */
  tier?: number
  /** the family of weapon, or of what is held in the other hand */
  family?: string
  /** the weight of armour: plate, leather or cloth */
  weight?: string
  /** how hard a weapon's blow lands, against bare level */
  dmg?: number
  /** how much of every bite it turns */
  armour?: number
  /** health it adds */
  hp?: number
  /** how much faster its wearer runs, as a share */
  speed?: number
  /** how much sooner each blow comes, as a share */
  haste?: number
  /** how much harder every blow lands, as a share */
  force?: number
  /** how much likelier a great blow is */
  luck?: number
  look: Box[]
  /** how its picture sees it; from a corner unless it says */
  view?: View
}

// Colours a few things share: gold that shines, a bottle's glass and cork.
let GOLD = metal(0xf2c14e)
let GLASS = 0xe8e0d0
let CORK = 0x8a5a3c
let CHITIN = metal(0x2e5a4e)

// A skin stretched flat, its legs out at its corners, head toward +z, and
// `spine` down its back.
let skin = (c: number, spine: number, thick: number): Box[] => [
  [[-0.12, 0, -0.14], [0.24, thick, 0.28], c],
  [[-0.2, 0, 0.06], [0.08, thick - 0.005, 0.08], c],
  [[0.12, 0, 0.06], [0.08, thick - 0.005, 0.08], c],
  [[-0.19, 0, -0.17], [0.07, thick - 0.005, 0.08], c],
  [[0.12, 0, -0.17], [0.07, thick - 0.005, 0.08], c],
  [[-0.05, 0, 0.14], [0.1, thick - 0.005, 0.07], c],
  [[-0.03, thick, -0.13], [0.06, 0.01, 0.26], spine],
]

// A round scale facing +z, about its middle.
let plate = (x: number, y: number, z: number, c: number): Box[] => [
  [[x - 0.07, y - 0.05, z], [0.14, 0.1, 0.02], c],
  [[x - 0.05, y - 0.07, z - 0.002], [0.1, 0.14, 0.02], c],
]

export let ITEMS: Record<string, Thing> = {
  jelly: {
    name: 'Slime jelly',
    look: [
      [[-0.15, 0, -0.15], [0.3, 0.16, 0.3], 0x86d65c],
      [[-0.11, 0.16, -0.11], [0.22, 0.08, 0.22], 0x86d65c],
      [[-0.07, 0.2, 0.05], [0.06, 0.05, 0.07], 0xd8ffc0],
      [[0.05, 0.02, 0.15], [0.05, 0.08, 0.02], 0x5aa83e],
    ],
  },
  tusk: {
    name: 'Boar tusk',
    view: 'side',
    look: [
      [[-0.045, 0, -0.16], [0.09, 0.08, 0.1], 0xf2ead6],
      [[-0.04, 0.03, -0.07], [0.08, 0.075, 0.08], 0xf2ead6],
      [[-0.035, 0.08, 0], [0.07, 0.07, 0.06], 0xf2ead6],
      [[-0.028, 0.14, 0.05], [0.056, 0.07, 0.05], 0xf2ead6],
      [[-0.02, 0.2, 0.08], [0.04, 0.05, 0.04], 0xfaf6ec],
      [[-0.05, 0, -0.2], [0.1, 0.085, 0.045], 0xc8b890],
    ],
  },
  shard: {
    name: 'Crag shard',
    look: [
      [[-0.06, 0, -0.06], [0.12, 0.26, 0.12], 0x6fb8f0],
      [[-0.04, 0.26, -0.04], [0.08, 0.08, 0.08], 0x6fb8f0],
      [[-0.02, 0.34, -0.02], [0.04, 0.06, 0.04], 0x9ad4ff],
      [[0.05, 0, 0], [0.07, 0.16, 0.07], 0x9ad4ff],
      [[0.065, 0.16, 0.015], [0.04, 0.05, 0.04], 0x9ad4ff],
      [[-0.12, 0, -0.03], [0.06, 0.1, 0.06], 0x9ad4ff],
    ],
  },
  crown: {
    name: 'Thorn crown',
    view: 'front',
    look: [
      [[-0.16, 0, -0.16], [0.32, 0.08, 0.32], GOLD],
      [[-0.16, 0.08, 0.1], [0.06, 0.08, 0.06], GOLD],
      [[0.1, 0.08, 0.1], [0.06, 0.08, 0.06], GOLD],
      [[-0.03, 0.08, 0.1], [0.06, 0.12, 0.06], GOLD],
      [[-0.16, 0.08, -0.16], [0.06, 0.08, 0.06], GOLD],
      [[0.1, 0.08, -0.16], [0.06, 0.08, 0.06], GOLD],
      [[-0.035, 0.02, 0.16], [0.07, 0.05, 0.01], 0xe0573f],
    ],
  },
  coin: {
    name: 'Coin',
    view: 'front',
    look: [
      [[-0.12, 0.06, -0.02], [0.24, 0.12, 0.04], GOLD],
      [[-0.1, 0.02, -0.018], [0.2, 0.2, 0.036], GOLD],
      [[-0.06, 0, -0.015], [0.12, 0.24, 0.03], GOLD],
      [[-0.05, 0.07, 0.02], [0.1, 0.1, 0.012], metal(0xd8a030)],
    ],
  },
  tonic: {
    name: 'Mossberry tonic',
    heals: 60,
    view: 'front',
    look: [
      [[-0.1, 0.02, -0.1], [0.2, 0.14, 0.2], 0xc0406a],
      [[-0.075, 0, -0.075], [0.15, 0.18, 0.15], 0xc0406a],
      [[-0.035, 0.18, -0.035], [0.07, 0.07, 0.07], GLASS],
      [[-0.045, 0.25, -0.045], [0.09, 0.045, 0.09], CORK],
      [[-0.07, 0.1, 0.1], [0.03, 0.04, 0.01], 0xf4c0d0],
    ],
  },
  draught: {
    name: 'Hearty draught',
    heals: 150,
    view: 'front',
    look: [
      [[-0.09, 0, -0.09], [0.18, 0.2, 0.18], 0x4a8ad8],
      [[-0.06, 0.2, -0.06], [0.12, 0.04, 0.12], 0x4a8ad8],
      [[-0.035, 0.24, -0.035], [0.07, 0.06, 0.07], GLASS],
      [[-0.045, 0.3, -0.045], [0.09, 0.045, 0.09], CORK],
      [[0.09, 0.05, -0.02], [0.05, 0.03, 0.04], GLASS],
      [[0.12, 0.05, -0.02], [0.03, 0.15, 0.04], GLASS],
      [[0.09, 0.17, -0.02], [0.05, 0.03, 0.04], GLASS],
      [[-0.09, 0.06, 0.09], [0.18, 0.06, 0.01], 0xf0e6c8],
    ],
  },
  elixir: {
    name: 'Vale elixir',
    heals: 400,
    view: 'front',
    look: [
      [[-0.12, 0, -0.12], [0.24, 0.07, 0.24], 0xe8c040],
      [[-0.085, 0.07, -0.085], [0.17, 0.07, 0.17], 0xe8c040],
      [[-0.05, 0.14, -0.05], [0.1, 0.06, 0.1], 0xe8c040],
      [[-0.025, 0.2, -0.025], [0.05, 0.1, 0.05], GLASS],
      [[-0.04, 0.3, -0.04], [0.08, 0.05, 0.08], 0x5a3a8a],
      [[-0.02, 0.35, -0.02], [0.04, 0.03, 0.04], GOLD],
    ],
  },
  blade2: {
    name: 'Boarsbane',
    ...wield('sword', 1, 1.1),
    ...forged('sword', 1, { metal: metal(0xdfe6ee), trim: 0xe2b64c }),
  },
  blade3: {
    name: 'Cragcleaver',
    ...wield('sword', 2, 1.1),
    ...forged('sword', 2, { metal: metal(0xbfe2ff), trim: 0x8fd46a }),
  },
  blade4: {
    name: 'Barkbiter',
    ...wield('axe', 3, 1.1),
    ...forged('axe', 3, { metal: metal(0xc8d0d8), wood: 0x6a4a30 }),
  },
  blade5: {
    name: 'Skyspear',
    ...wield('staff', 4, 1.1),
    view: 'lying',
    look: [
      [[-0.022, 0, -0.022], [0.044, 0.96, 0.044], 0xe8dcc0],
      [[-0.1, 0.9, -0.02], [0.2, 0.03, 0.04], 0x9ad8ff],
      [[-0.032, 0.92, -0.032], [0.064, 0.05, 0.064], 0x9ad8ff],
      [[-0.015, 0.97, -0.06], [0.03, 0.14, 0.12], metal(0x9ad8ff), 0.012],
      [[-0.012, 1.11, -0.035], [0.024, 0.07, 0.07], metal(0x9ad8ff), 0.012],
    ],
  },
  blade6: {
    name: 'Wyrmfire',
    ...wield('sword', 5, 1.1),
    ...forged('sword', 5, {
      metal: metal(0xff7a2a),
      trim: 0xffd040,
      wood: 0x2a2020,
    }),
  },
  egg: {
    name: 'Speckled egg',
    view: 'front',
    look: [
      [[-0.09, 0.03, -0.08], [0.18, 0.14, 0.16], 0xf0e6d2],
      [[-0.07, 0, -0.07], [0.14, 0.22, 0.14], 0xf0e6d2],
      [[-0.045, 0.22, -0.045], [0.09, 0.04, 0.09], 0xf0e6d2],
      [[-0.05, 0.08, 0.08], [0.025, 0.025, 0.01], 0xa0845c],
      [[0.03, 0.13, 0.08], [0.025, 0.025, 0.01], 0xa0845c],
      [[-0.01, 0.18, 0.07], [0.02, 0.02, 0.01], 0xa0845c],
    ],
  },
  feather: {
    name: 'Feather',
    view: 'lying',
    look: [
      [[-0.012, 0, -0.012], [0.024, 0.44, 0.024], 0xb8ac98],
      [[-0.07, 0.08, -0.008], [0.14, 0.06, 0.016], 0xe4dccc],
      [[-0.11, 0.14, -0.008], [0.22, 0.16, 0.016], 0xe4dccc],
      [[-0.08, 0.3, -0.008], [0.16, 0.08, 0.016], 0xe4dccc],
      [[-0.045, 0.38, -0.008], [0.09, 0.06, 0.016], 0x8a7a64],
    ],
  },
  hide: {
    name: 'Soft hide',
    view: 'top',
    look: skin(0xb8906a, 0xa07a58, 0.03),
  },
  pelt: {
    name: 'Thick pelt',
    view: 'top',
    look: [
      ...skin(0x8a6a4a, 0x6e5236, 0.05),
      [[-0.035, 0, -0.26], [0.07, 0.045, 0.12], 0x6e5236],
    ],
  },
  fleece: {
    name: 'Fleece',
    look: [
      [[-0.14, 0, -0.1], [0.28, 0.1, 0.2], 0xf0ebe0],
      [[-0.11, 0.08, -0.07], [0.11, 0.08, 0.11], 0xf8f4ec],
      [[0, 0.09, -0.04], [0.1, 0.07, 0.1], 0xe8e2d4],
      [[-0.17, 0.02, -0.02], [0.06, 0.06, 0.09], 0xe8e2d4],
      [[0.1, 0.03, -0.07], [0.07, 0.06, 0.09], 0xf8f4ec],
      [[-0.04, 0.03, 0.08], [0.09, 0.06, 0.05], 0xf8f4ec],
    ],
  },
  horn: {
    name: 'Horn',
    view: 'side',
    look: [
      [[-0.06, 0, 0.02], [0.12, 0.11, 0.12], 0xd8c8a8],
      [[-0.05, 0.11, 0.03], [0.1, 0.07, 0.1], 0xa89878],
      [[-0.042, 0.17, -0.04], [0.084, 0.07, 0.09], 0xd8c8a8],
      [[-0.034, 0.16, -0.11], [0.068, 0.06, 0.07], 0xa89878],
      [[-0.026, 0.1, -0.13], [0.052, 0.07, 0.05], 0xd8c8a8],
      [[-0.018, 0.05, -0.12], [0.036, 0.06, 0.035], 0x5a4a38],
    ],
  },
  antler: {
    name: 'Antler',
    view: 'side',
    look: [
      [[-0.03, 0, 0.08], [0.06, 0.12, 0.06], 0xe0d0b0],
      [[-0.028, 0.1, 0.02], [0.056, 0.1, 0.08], 0xe0d0b0],
      [[-0.026, 0.18, -0.14], [0.052, 0.05, 0.18], 0xe0d0b0],
      [[-0.024, 0.2, -0.19], [0.048, 0.14, 0.05], 0xd4c4a4],
      [[-0.02, 0.23, -0.07], [0.04, 0.11, 0.04], 0xd4c4a4],
      [[-0.02, 0.19, 0.06], [0.04, 0.1, 0.04], 0xd4c4a4],
      [[-0.045, 0, 0.065], [0.09, 0.04, 0.09], 0xb8a888],
    ],
  },
  fang: {
    name: 'Wolf fang',
    view: 'front',
    look: [
      [[-0.06, 0.2, -0.045], [0.12, 0.08, 0.09], 0xf2ead6],
      [[-0.045, 0.13, -0.04], [0.09, 0.07, 0.08], 0xf2ead6],
      [[-0.025, 0.07, -0.03], [0.065, 0.06, 0.06], 0xf2ead6],
      [[-0.005, 0.02, -0.02], [0.04, 0.05, 0.04], 0xfaf6ec],
      [[0.015, 0, -0.01], [0.02, 0.02, 0.02], 0xfaf6ec],
    ],
  },
  claw: {
    name: 'Bear claw',
    view: 'top',
    look: [
      [[-0.1, 0, -0.1], [0.2, 0.06, 0.14], 0x5a3a24],
      [[-0.1, 0, 0.04], [0.055, 0.055, 0.05], 0x5a3a24],
      [[-0.0275, 0, 0.04], [0.055, 0.055, 0.05], 0x5a3a24],
      [[0.045, 0, 0.04], [0.055, 0.055, 0.05], 0x5a3a24],
      [[-0.09, 0.01, 0.09], [0.035, 0.035, 0.09], 0xe8dcc0],
      [[-0.0175, 0.01, 0.09], [0.035, 0.035, 0.11], 0xe8dcc0],
      [[0.055, 0.01, 0.09], [0.035, 0.035, 0.09], 0xe8dcc0],
    ],
  },
  quill: {
    name: 'Quill',
    view: 'lying',
    look: [
      [[-0.015, 0, -0.015], [0.03, 0.34, 0.03], 0xe0d0b0],
      [[-0.018, 0.12, -0.018], [0.036, 0.06, 0.036], 0x3a3028],
      [[-0.018, 0.24, -0.018], [0.036, 0.06, 0.036], 0x3a3028],
      [[-0.009, 0.34, -0.009], [0.018, 0.06, 0.018], 0x3a3028],
    ],
  },
  talon: {
    name: 'Talon',
    view: 'side',
    look: [
      [[-0.03, 0.2, -0.16], [0.06, 0.06, 0.08], 0x4a4440],
      [[-0.028, 0.21, -0.09], [0.056, 0.06, 0.07], 0x3a3a3a],
      [[-0.025, 0.19, -0.03], [0.05, 0.06, 0.06], 0x3a3a3a],
      [[-0.022, 0.14, 0.02], [0.044, 0.06, 0.05], 0x2a2a2a],
      [[-0.018, 0.08, 0.05], [0.036, 0.07, 0.04], 0x2a2a2a],
      [[-0.012, 0.03, 0.06], [0.024, 0.06, 0.03], 0x1a1a1a],
      [[-0.008, 0, 0.055], [0.016, 0.04, 0.02], 0x1a1a1a],
    ],
  },
  plume: {
    name: 'Great plume',
    view: 'front',
    look: [
      [[-0.012, 0, -0.012], [0.024, 0.46, 0.024], 0x8a6a3a],
      [[-0.1, 0.12, -0.01], [0.2, 0.22, 0.02], 0xe8943a],
      [[-0.07, 0.34, -0.01], [0.14, 0.07, 0.02], 0xe8943a],
      [[-0.035, 0.41, -0.01], [0.07, 0.04, 0.02], 0xe8943a],
      [[-0.07, 0.06, -0.01], [0.14, 0.06, 0.02], 0xe8943a],
      [[-0.055, 0.25, 0.01], [0.11, 0.1, 0.01], 0x2a8a9a],
      [[-0.025, 0.275, 0.02], [0.05, 0.05, 0.01], 0x1a2a6a],
    ],
  },
  silk: {
    name: 'Spider silk',
    view: 'front',
    look: [
      [[-0.075, 0.03, -0.075], [0.15, 0.16, 0.15], 0xf4f2ec],
      [[-0.1, 0, -0.1], [0.2, 0.03, 0.2], 0x9a7a52],
      [[-0.1, 0.19, -0.1], [0.2, 0.03, 0.2], 0x9a7a52],
      [[-0.075, 0.08, 0.075], [0.15, 0.012, 0.01], 0xd8d4c8],
      [[-0.075, 0.13, 0.075], [0.15, 0.012, 0.01], 0xd8d4c8],
      [[0.075, 0, 0.06], [0.012, 0.1, 0.012], 0xf4f2ec],
    ],
  },
  chitin: {
    name: 'Chitin plate',
    view: 'top',
    look: [
      [[-0.1, 0, -0.14], [0.095, 0.05, 0.28], CHITIN],
      [[0.005, 0, -0.14], [0.095, 0.05, 0.28], CHITIN],
      [[-0.075, 0, 0.14], [0.07, 0.045, 0.05], CHITIN],
      [[0.005, 0, 0.14], [0.07, 0.045, 0.05], CHITIN],
      [[-0.075, 0, -0.21], [0.15, 0.04, 0.07], metal(0x4a7a6a)],
    ],
  },
  sting: {
    name: 'Sting',
    view: 'lying',
    look: [
      [[-0.05, 0, -0.05], [0.1, 0.1, 0.1], 0x2a2218],
      [[-0.052, 0.04, -0.052], [0.104, 0.03, 0.104], 0xe8c040],
      [[-0.035, 0.1, -0.035], [0.07, 0.08, 0.07], 0x2a2218],
      [[-0.02, 0.18, -0.02], [0.04, 0.07, 0.04], 0x1a1410],
      [[-0.008, 0.25, -0.008], [0.016, 0.06, 0.016], 0x1a1410],
    ],
  },
  venom: {
    name: 'Venom sac',
    look: [
      [[-0.1, 0.04, -0.09], [0.2, 0.12, 0.18], 0x8a4ab8],
      [[-0.08, 0.02, -0.07], [0.16, 0.18, 0.14], 0x8a4ab8],
      [[-0.03, 0.2, -0.03], [0.06, 0.05, 0.06], 0x6a3a90],
      [[0.03, 0, 0.06], [0.04, 0.04, 0.04], 0x9ad040],
      [[-0.07, 0.12, 0.09], [0.04, 0.03, 0.01], 0xc890e8],
    ],
  },
  scale: {
    name: 'Serpent scale',
    view: 'front',
    look: [
      ...plate(-0.07, 0.17, -0.03, 0x4a7a2e),
      ...plate(0.07, 0.17, -0.03, 0x4a7a2e),
      ...plate(0, 0.08, 0, 0x6a9a4a),
    ],
  },
  shell: {
    name: 'Crab shell',
    look: [
      [[-0.14, 0, -0.1], [0.28, 0.08, 0.18], 0xc8603a],
      [[-0.1, 0.08, -0.07], [0.2, 0.04, 0.12], 0xd87a50],
      [[-0.19, 0.02, -0.04], [0.05, 0.04, 0.05], 0xc8603a],
      [[0.14, 0.02, -0.04], [0.05, 0.04, 0.05], 0xc8603a],
      [[-0.13, 0, 0.08], [0.07, 0.06, 0.08], 0xd87a50],
      [[0.06, 0, 0.08], [0.07, 0.06, 0.08], 0xd87a50],
      [[-0.05, 0.06, 0.08], [0.025, 0.04, 0.02], 0x1a1410],
      [[0.025, 0.06, 0.08], [0.025, 0.04, 0.02], 0x1a1410],
    ],
  },
  pearl: {
    name: 'Mere pearl',
    view: 'front',
    look: [
      [[-0.065, 0.05, -0.05], [0.13, 0.1, 0.12], 0xf4eef0],
      [[-0.05, 0.035, -0.065], [0.1, 0.13, 0.14], 0xf4eef0],
      [[-0.15, 0, -0.1], [0.3, 0.05, 0.2], 0xc8a8b4],
      [[-0.14, 0.05, -0.13], [0.28, 0.1, 0.03], 0xb898a8],
      [[-0.1, 0.15, -0.13], [0.2, 0.05, 0.03], 0xb898a8],
      [[-0.05, 0.2, -0.13], [0.1, 0.03, 0.03], 0xb898a8],
      [[-0.035, 0.12, 0.075], [0.03, 0.03, 0.01], 0xffffff],
    ],
  },
  toadstone: {
    name: 'Toadstone',
    look: [
      [[-0.1, 0, -0.08], [0.2, 0.06, 0.16], 0x5a8a6a],
      [[-0.08, 0.06, -0.06], [0.16, 0.05, 0.12], 0x5a8a6a],
      [[-0.05, 0.11, -0.035], [0.1, 0.03, 0.07], 0x6a9a7a],
      [[-0.06, 0.02, 0.08], [0.03, 0.02, 0.01], 0x8ad0a0],
      [[0.02, 0.07, 0.06], [0.03, 0.02, 0.01], 0x8ad0a0],
      [[0.01, 0.14, -0.01], [0.03, 0.01, 0.03], 0x8ad0a0],
    ],
  },
  cap: {
    name: 'Mushroom cap',
    view: 'front',
    look: [
      [[-0.14, 0.12, -0.14], [0.28, 0.08, 0.28], 0xd8483a],
      [[-0.1, 0.2, -0.1], [0.2, 0.04, 0.2], 0xd8483a],
      [[-0.045, 0, -0.045], [0.09, 0.13, 0.09], 0xefe4cc],
      [[-0.09, 0.15, 0.14], [0.04, 0.03, 0.01], 0xf8f2e2],
      [[0.04, 0.14, 0.14], [0.03, 0.03, 0.01], 0xf8f2e2],
      [[-0.02, 0.24, -0.02], [0.05, 0.01, 0.05], 0xf8f2e2],
    ],
  },
  spore: {
    name: 'Glowspore',
    look: [
      [[-0.09, 0, -0.07], [0.1, 0.1, 0.1], 0xb8a8d8],
      [[0.01, 0, -0.03], [0.08, 0.08, 0.08], 0xd8ccf0],
      [[-0.05, 0.08, -0.05], [0.09, 0.09, 0.09], 0xd8ccf0],
      [[-0.07, 0, 0.05], [0.06, 0.06, 0.06], 0xb8a8d8],
      [[0.02, 0.15, 0], [0.02, 0.02, 0.02], 0xffffff],
    ],
  },
  bark: {
    name: 'Tough bark',
    look: [
      [[-0.18, 0, -0.08], [0.36, 0.04, 0.16], 0x6a5234],
      [[-0.18, 0.04, -0.08], [0.36, 0.06, 0.03], 0x6a5234],
      [[-0.18, 0.04, 0.05], [0.36, 0.05, 0.03], 0x6a5234],
      [[-0.17, 0.04, -0.05], [0.34, 0.01, 0.1], 0xb8905a],
      [[-0.08, 0.1, -0.08], [0.12, 0.02, 0.03], 0x5a8a3a],
    ],
  },
  heartwood: {
    name: 'Heartwood',
    view: 'front',
    look: [
      [[-0.1, 0.03, -0.06], [0.2, 0.2, 0.12], 0x8a6a3a],
      [[-0.07, 0, -0.06], [0.14, 0.26, 0.12], 0x8a6a3a],
      [[-0.07, 0.06, 0.06], [0.14, 0.14, 0.01], 0xc8a060],
      [[-0.035, 0.095, 0.07], [0.07, 0.07, 0.01], 0xffd24a],
    ],
  },
  acorn: {
    name: 'Golden acorn',
    view: 'front',
    look: [
      [[-0.065, 0.02, -0.065], [0.13, 0.12, 0.13], 0xd8a040],
      [[-0.025, 0, -0.025], [0.05, 0.03, 0.05], 0xd8a040],
      [[-0.08, 0.13, -0.08], [0.16, 0.05, 0.16], 0x7a5a30],
      [[-0.05, 0.18, -0.05], [0.1, 0.02, 0.1], 0x7a5a30],
      [[-0.012, 0.19, -0.012], [0.024, 0.05, 0.024], 0x5a4020],
    ],
  },
  honey: {
    name: 'Honeycomb',
    view: 'front',
    look: [
      [[-0.14, 0.03, -0.04], [0.28, 0.2, 0.08], 0xf0b840],
      [[-0.11, 0.14, 0.04], [0.06, 0.06, 0.01], 0xc8841e],
      [[-0.03, 0.14, 0.04], [0.06, 0.06, 0.01], 0xc8841e],
      [[0.05, 0.14, 0.04], [0.06, 0.06, 0.01], 0xc8841e],
      [[-0.07, 0.06, 0.04], [0.06, 0.06, 0.01], 0xc8841e],
      [[0.01, 0.06, 0.04], [0.06, 0.06, 0.01], 0xc8841e],
      [[0.08, 0, 0], [0.035, 0.04, 0.035], 0xf8d070],
    ],
  },
  glow: {
    name: 'Wisplight',
    view: 'front',
    look: [
      [[-0.14, 0.14, -0.06], [0.14, 0.1, 0.12], 0xa8e4ff],
      [[-0.12, 0.12, -0.05], [0.1, 0.14, 0.1], 0xa8e4ff],
      [[-0.1, 0.16, 0.06], [0.06, 0.06, 0.01], 0xffffff],
      [[-0.01, 0.1, -0.04], [0.08, 0.08, 0.08], 0xc0ecff],
      [[0.06, 0.06, -0.03], [0.06, 0.05, 0.06], 0xd8f6ff],
      [[0.1, 0.02, -0.02], [0.04, 0.04, 0.04], 0xeafaff],
      [[0.13, 0, -0.015], [0.03, 0.03, 0.03], 0xeafaff],
    ],
  },
  dust: {
    name: 'Wing dust',
    look: [
      [[-0.13, 0, -0.11], [0.26, 0.04, 0.22], 0xe8dcc0],
      [[-0.09, 0.04, -0.07], [0.18, 0.04, 0.14], 0xe8dcc0],
      [[-0.05, 0.08, -0.04], [0.1, 0.04, 0.08], 0xf0e6d0],
      [[-0.02, 0.12, -0.01], [0.04, 0.03, 0.03], 0xf8f0e0],
      [[0.07, 0.07, 0.06], [0.025, 0.025, 0.025], 0xffffff],
      [[-0.1, 0.09, 0.02], [0.02, 0.02, 0.02], 0xffffff],
    ],
  },
  ore: {
    name: 'Iron ore',
    ...lump(0x6a6460, 0xb87a4a),
  },
  gem: {
    name: 'Hollow heart',
    view: 'front',
    look: [
      [[-0.12, 0.12, -0.12], [0.24, 0.05, 0.24], 0x8ad8f0],
      [[-0.09, 0.17, -0.09], [0.18, 0.04, 0.18], 0xc0f0ff],
      [[-0.055, 0.21, -0.055], [0.11, 0.025, 0.11], 0xe0f8ff],
      [[-0.09, 0.06, -0.09], [0.18, 0.06, 0.18], 0x6ac0e0],
      [[-0.05, 0.02, -0.05], [0.1, 0.04, 0.1], 0x5ab0d8],
      [[-0.02, 0, -0.02], [0.04, 0.02, 0.04], 0x4aa0c8],
    ],
  },
  ember: {
    name: 'Ember core',
    view: 'front',
    look: [
      [[-0.1, 0, -0.08], [0.2, 0.1, 0.16], 0xe8622a],
      [[-0.07, 0.1, -0.06], [0.14, 0.08, 0.12], 0xe8622a],
      [[-0.04, 0.18, -0.04], [0.08, 0.07, 0.08], 0xf07a2a],
      [[0, 0.25, -0.02], [0.04, 0.06, 0.04], 0xf07a2a],
      [[-0.12, 0.08, -0.03], [0.04, 0.07, 0.04], 0xf07a2a],
      [[-0.05, 0.02, 0.08], [0.1, 0.08, 0.01], 0xffd040],
      [[-0.025, 0.1, 0.06], [0.05, 0.07, 0.01], 0xffd040],
    ],
  },
  frost: {
    name: 'Frost crystal',
    view: 'front',
    look: [
      [[-0.02, 0, -0.02], [0.04, 0.36, 0.04], 0xa8e0ff],
      [[-0.18, 0.16, -0.015], [0.36, 0.04, 0.03], 0xa8e0ff],
      [[-0.06, 0.29, -0.012], [0.12, 0.03, 0.024], 0xd8f4ff],
      [[-0.06, 0.04, -0.012], [0.12, 0.03, 0.024], 0xd8f4ff],
      [[-0.15, 0.12, -0.012], [0.03, 0.12, 0.024], 0xd8f4ff],
      [[0.12, 0.12, -0.012], [0.03, 0.12, 0.024], 0xd8f4ff],
      [[-0.04, 0.14, 0.02], [0.08, 0.08, 0.01], 0xeafaff],
    ],
  },
  bone: {
    name: 'Old bone',
    view: 'front',
    look: [
      [[-0.14, 0.035, -0.025], [0.28, 0.05, 0.05], 0xe8dcc0],
      [[-0.2, 0, -0.035], [0.07, 0.055, 0.07], 0xe0d4b8],
      [[-0.2, 0.065, -0.035], [0.07, 0.055, 0.07], 0xe0d4b8],
      [[0.13, 0, -0.035], [0.07, 0.055, 0.07], 0xe0d4b8],
      [[0.13, 0.065, -0.035], [0.07, 0.055, 0.07], 0xe0d4b8],
    ],
  },
  ivory: {
    name: 'Mammoth ivory',
    view: 'side',
    look: [
      [[-0.06, 0, -0.28], [0.12, 0.1, 0.14], 0xf4ecd8],
      [[-0.055, 0.03, -0.15], [0.11, 0.1, 0.12], 0xf4ecd8],
      [[-0.05, 0.08, -0.04], [0.1, 0.1, 0.1], 0xece2c8],
      [[-0.042, 0.16, 0.04], [0.084, 0.09, 0.08], 0xece2c8],
      [[-0.034, 0.24, 0.08], [0.068, 0.08, 0.06], 0xe4d8bc],
      [[-0.025, 0.3, 0.06], [0.05, 0.06, 0.05], 0xe4d8bc],
      [[-0.065, 0, -0.32], [0.13, 0.11, 0.05], 0xa89878],
    ],
  },
  ...ARMS,
  ...MATERIALS,
}

/** A look as triangles to draw (mesh.ts), in voxels 5 cm across, each box as
 * soft at its edges as a small thing is unless it says: what lies on the
 * ground (cast.ts) and what flies to a hero (nodes.ts). */
export let meshed = (look: Box[]): Out => {
  let o = out()
  for (let [min, size, hex, round = 0.02] of look) {
    cuboid(o, min, size, hex, 0.05, round)
  }
  return o
}

/** How much larger than itself a thing lying on the ground is drawn: a small
 * thing, a coin or a jelly, grown so it is seen from where the camera looks,
 * and arms at their own size, the size they are in a hero's hand.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(onGround(ITEMS.jelly.look) > 1, true)
 * assertEquals([onGround(ITEMS.sword1.look), onGround(ITEMS.staff3.look)], [
 *   1,
 *   1,
 * ])
 * ```
 */
export let onGround = (look: Box[]) => {
  let span = [0, 1, 2].map((a) =>
    Math.max(...look.map(([min, size]) => min[a] + size[a])) -
    Math.min(...look.map(([min]) => min[a]))
  )
  return Math.min(1.6, Math.max(1, 0.5 / Math.max(...span)))
}
