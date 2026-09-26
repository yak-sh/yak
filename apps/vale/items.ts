// What a player can carry: one row per kind of thing, with its name, its icon
// in the bag, what it does (a tonic heals, a blade has an edge), and how it
// is drawn lying on the ground, a few soft boxes. A new kind of loot or gift
// is a row here; beasts.ts says what drops it and quests.ts what gives it.

type Vec = [number, number, number]
/** One box of a model: its low corner, its size, and its colour. */
export type Box = [Vec, Vec, number]

export type Thing = {
  name: string
  icon: string
  /** health a drink gives back */
  heals?: number
  /** how much harder a blow lands while it is carried */
  edge?: number
  look: Box[]
}

export let ITEMS: Record<string, Thing> = {
  jelly: {
    name: 'Slime jelly',
    icon: '🟢',
    look: [
      [[-0.15, 0, -0.15], [0.3, 0.26, 0.3], 0x86d65c],
      [[-0.1, 0.26, -0.1], [0.2, 0.06, 0.2], 0x5aa83e],
    ],
  },
  tusk: {
    name: 'Boar tusk',
    icon: '🦷',
    look: [
      [[-0.05, 0, -0.14], [0.1, 0.1, 0.28], 0xf2ead6],
      [[-0.05, 0.08, 0.1], [0.1, 0.18, 0.08], 0xf2ead6],
    ],
  },
  shard: {
    name: 'Crag shard',
    icon: '🔷',
    look: [
      [[-0.08, 0, -0.08], [0.16, 0.42, 0.16], 0x6fb8f0],
      [[0.06, 0, -0.02], [0.1, 0.26, 0.1], 0x9ad4ff],
    ],
  },
  crown: {
    name: 'Thorn crown',
    icon: '👑',
    look: [
      [[-0.18, 0, -0.18], [0.36, 0.1, 0.36], 0xf2c14e],
      [[-0.18, 0.1, -0.18], [0.07, 0.12, 0.07], 0xf2c14e],
      [[0.11, 0.1, 0.11], [0.07, 0.12, 0.07], 0xf2c14e],
      [[-0.035, 0.1, 0.11], [0.07, 0.16, 0.07], 0xe0573f],
    ],
  },
  coin: {
    name: 'Coin',
    icon: '🪙',
    look: [
      [[-0.13, 0, -0.13], [0.26, 0.06, 0.26], 0xf2c14e],
      [[-0.1, 0.06, -0.1], [0.2, 0.05, 0.2], 0xe8b43a],
    ],
  },
  tonic: {
    name: 'Mossberry tonic',
    icon: '🧪',
    heals: 60,
    look: [
      [[-0.1, 0, -0.1], [0.2, 0.24, 0.2], 0xc0406a],
      [[-0.05, 0.24, -0.05], [0.1, 0.1, 0.1], 0xe8e0d0],
      [[-0.04, 0.34, -0.04], [0.08, 0.05, 0.08], 0x8a5a3c],
    ],
  },
  blade2: {
    name: 'Boarsbane',
    icon: '🗡️',
    edge: 1.4,
    look: [
      [[-0.02, 0, -0.02], [0.04, 0.5, 0.04], 0xdfe6ee],
      [[-0.1, 0.1, -0.03], [0.2, 0.04, 0.06], 0xe2b64c],
    ],
  },
  blade3: {
    name: 'Cragcleaver',
    icon: '⚔️',
    edge: 1.9,
    look: [
      [[-0.03, 0, -0.03], [0.06, 0.56, 0.06], 0xbfe2ff],
      [[-0.12, 0.12, -0.04], [0.24, 0.05, 0.08], 0x8fd46a],
    ],
  },
}
