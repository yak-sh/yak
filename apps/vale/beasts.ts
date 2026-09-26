// The creatures of the vale: one row per kind. A row says what the creature
// is in a fight, what it leaves behind, where it lives, and how it is drawn:
// a body plan from figures.ts in colours of its own. A new creature is a row
// here, and a new body plan, when none of the existing ones will do, is one
// more plan in figures.ts.
//
// Where it lives is by the kind of place (`haunts`): every level that has a
// place of that kind (levels.ts) grows that many of it around each one, so a
// new creature appears wherever it belongs without any level naming it.

/** How a creature is drawn: which body plan, in which colours. */
export type Look =
  | { plan: 'slime'; body: number; moss: number; bloom: number }
  | { plan: 'crag'; stone: number; light: number; moss: number; eye: number }
  | {
    plan: 'quadruped'
    hide: number
    ridge: number
    snout: number
    tusk: number
    eye: number
    scale: number
    thorns?: boolean
  }

/** Where a creature lives: around each place of a kind (terrain.ts
 * `FEATURES`), between `beyond` and `within` columns of it, `apart` columns
 * from its own kind, wandering `roam` metres from home. */
export type Haunt = {
  near: string
  count: number
  within: number
  beyond?: number
  apart: number
  roam: number
}

export type Beast = {
  name: string
  lvl: number
  hp: number
  dmg: number
  /** metres a second when it means it */
  speed: number
  xp: number
  /** how close it must be to bite */
  reach: number
  /** how near a player wakes it; 0 is never, until struck */
  aggro: number
  /** seconds from a fall until it is up again */
  respawn: number
  /** item kinds (items.ts), each with the chance of one dropping */
  loot: [string, number][]
  /** how big it is drawn, and how far a blow must reach it */
  size: number
  /** the colour of the dust a blow knocks off it */
  dust: number
  haunts: Haunt[]
  look: Look
}

export let BEASTS: Record<string, Beast> = {
  slime: {
    name: 'Moss slime',
    lvl: 1,
    hp: 32,
    dmg: 4,
    speed: 2.2,
    xp: 14,
    reach: 1.3,
    aggro: 0,
    respawn: 20,
    loot: [['jelly', 0.8], ['coin', 0.5]],
    size: 0.9,
    dust: 0x86d65c,
    haunts: [
      {
        near: 'village',
        count: 16,
        beyond: 34,
        within: 80,
        apart: 12,
        roam: 5,
      },
    ],
    look: { plan: 'slime', body: 0x7ccc55, moss: 0x4f9a3a, bloom: 0xe7d45a },
  },
  boar: {
    name: 'Bristleboar',
    lvl: 3,
    hp: 80,
    dmg: 8,
    speed: 4,
    xp: 34,
    reach: 1.7,
    aggro: 7,
    respawn: 30,
    loot: [['tusk', 0.65], ['coin', 0.7], ['tonic', 0.12]],
    size: 1.1,
    dust: 0x8a5a3c,
    haunts: [{ near: 'woods', count: 11, within: 40, apart: 11, roam: 7 }],
    look: {
      plan: 'quadruped',
      hide: 0x8a5a3c,
      ridge: 0x5a3a26,
      snout: 0xd99a8a,
      tusk: 0xf4ecd8,
      eye: 0x2b2020,
      scale: 1,
    },
  },
  crag: {
    name: 'Cragback',
    lvl: 5,
    hp: 170,
    dmg: 13,
    speed: 2.4,
    xp: 80,
    reach: 2,
    aggro: 6,
    respawn: 40,
    loot: [['shard', 0.6], ['coin', 0.9], ['tonic', 0.25]],
    size: 1.5,
    dust: 0x9a9890,
    haunts: [{ near: 'crags', count: 7, within: 36, apart: 12, roam: 5 }],
    look: {
      plan: 'crag',
      stone: 0x8e8c84,
      light: 0xa4a298,
      moss: 0x6a9a48,
      eye: 0xffb347,
    },
  },
  thornback: {
    name: 'Old Thornback',
    lvl: 8,
    hp: 1100,
    dmg: 21,
    speed: 3.6,
    xp: 600,
    reach: 3,
    aggro: 10,
    respawn: 180,
    loot: [['crown', 1], ['coin', 1], ['tonic', 1]],
    size: 2.4,
    dust: 0x7a3f2f,
    haunts: [{ near: 'ridge', count: 1, within: 6, apart: 1, roam: 5 }],
    look: {
      plan: 'quadruped',
      hide: 0x7a3f2f,
      ridge: 0x4a2419,
      snout: 0xb87a6a,
      tusk: 0xf1e6cf,
      eye: 0xff5a3a,
      scale: 2.3,
      thorns: true,
    },
  },
}
