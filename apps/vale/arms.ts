// The arms and armour a hero can wear: a kind for every weapon, every thing
// held in the other hand, every piece of armour and every ring, at each of
// five tiers. A tier follows the country a thing comes from, as a creature's
// level does (`tierOf`): copper and ash about Mossvale, cinder and emberwood
// out by the Maw. What a kind does comes from what it is (`HANDLES` for a
// weapon, `WEIGHTS` for armour) scaled by its tier, and how it looks from a
// few boxes in its tier's colours. items.ts lists them beside everything
// else a hero carries; gear.ts says what a hero wears of them.
//
// There is no class to pick. A weapon's family says how it handles: a sword
// is quick and even, an axe sweeps wide, a hammer is slow and heavy in both
// hands, a dagger is quick and short and often lands a great blow, a bow and
// a staff strike from afar. Armour comes in three weights: plate turns the
// most of a bite and adds the most health, leather less but runs faster, and
// cloth least but every blow lands harder.
import type { Box, Thing } from './items.ts'

export type Slot = 'main' | 'off' | 'head' | 'body' | 'feet' | 'trinket'

/** Every slot, in the order a sheet lists them. */
export let SLOTS: Slot[] = ['main', 'off', 'head', 'body', 'feet', 'trinket']

/** How a family of weapon handles. */
export type Handle = {
  name: string
  /** ms from one blow to the next */
  pace: number
  /** how far a blow reaches, in metres from the hero's middle to the foe's
   * edge; a shot flies this far */
  reach: number
  /** how far either side of ahead a blow still takes a foe, in radians */
  arc: number
  /** how hard a blow lands, against a sword's */
  dmg: number
  hands: 1 | 2
  /** what it looses, when it strikes from afar */
  shot?: 'arrow' | 'bolt'
  /** how much likelier a great blow is */
  luck?: number
}

/** Each family of weapon, and bare hands. */
export let HANDLES: Record<string, Handle> = {
  fists: {
    name: 'Fists',
    pace: 450,
    reach: 1.4,
    arc: 1.2,
    dmg: 0.5,
    hands: 1,
  },
  sword: {
    name: 'Sword',
    pace: 520,
    reach: 1.7,
    arc: 1.2,
    dmg: 1,
    hands: 1,
  },
  axe: {
    name: 'Axe',
    pace: 640,
    reach: 1.8,
    arc: 1.6,
    dmg: 1.2,
    hands: 1,
  },
  hammer: {
    name: 'Hammer',
    pace: 900,
    reach: 2,
    arc: 1.4,
    dmg: 1.85,
    hands: 2,
  },
  dagger: {
    name: 'Dagger',
    pace: 340,
    reach: 1.35,
    arc: 1,
    dmg: 0.62,
    hands: 1,
    luck: 0.18,
  },
  bow: {
    name: 'Bow',
    pace: 780,
    reach: 13,
    arc: 0.5,
    dmg: 1.05,
    hands: 2,
    shot: 'arrow',
  },
  staff: {
    name: 'Staff',
    pace: 760,
    reach: 10,
    arc: 0.5,
    dmg: 1,
    hands: 1,
    shot: 'bolt',
  },
}

/** The tier of what a creature of level `lvl` leaves, or of the country it
 * lives in: four levels to a tier, to the fifth.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([1, 4, 5, 12, 13, 20].map(tierOf), [1, 1, 2, 3, 4, 5])
 * ```
 */
export let tierOf = (lvl: number): number =>
  Math.max(1, Math.min(5, Math.ceil(lvl / 4)))

// What each tier is made of, and its colours.
let METAL = ['Copper', 'Iron', 'Steel', 'Glimmer', 'Cinder']
let WOOD = ['Ash', 'Yew', 'Ironwood', 'Rimewood', 'Emberwood']
let LEATHER = ['Hide', 'Boarhide', 'Wolfhide', 'Drakehide', 'Wyrmhide']
let CLOTH = ['Linen', 'Wool', 'Silk', 'Moonsilk', 'Emberweave']
let LORE = ['Worn', 'Wise', 'Deep', 'Starlit', 'Burning']
let C = {
  metal: [0xc8804a, 0x9aa2aa, 0xdfe6ee, 0x9ad8ff, 0xff7a2a],
  wood: [0x9a7a52, 0x7a4a2a, 0x4a3a30, 0xcfe0e8, 0x3a2020],
  leather: [0xb8906a, 0x8a5a3a, 0x6a6a70, 0x3a6a5a, 0x7a2a20],
  cloth: [0xe8e0cc, 0x5a7ab8, 0xf4f2ec, 0x8a7ad8, 0xe8622a],
  trim: [0xe2b64c, 0x6a4a30, 0x8fd46a, 0xf4f8ff, 0xffd040],
}

/** How hard a tier's weapons land, against bare level. */
export let GRADE = [1.2, 1.7, 2.3, 2.9, 3.5]

type Paint = {
  metal: number
  wood: number
  leather: number
  cloth: number
  trim: number
}

// Each kind's look, lying on the ground, upright from its grip: the same
// boxes a hero holds (figures.ts).
let LOOKS: Record<string, (p: Paint) => Box[]> = {
  sword: (p) => [
    [[-0.025, 0, -0.025], [0.05, 0.12, 0.05], p.wood],
    [[-0.1, 0.12, -0.03], [0.2, 0.04, 0.06], p.trim],
    [[-0.03, 0.16, -0.01], [0.06, 0.42, 0.02], p.metal],
  ],
  axe: (p) => [
    [[-0.025, 0, -0.025], [0.05, 0.56, 0.05], p.wood],
    [[0.02, 0.36, -0.02], [0.17, 0.18, 0.04], p.metal],
  ],
  hammer: (p) => [
    [[-0.03, 0, -0.03], [0.06, 0.62, 0.06], p.wood],
    [[-0.14, 0.54, -0.09], [0.28, 0.16, 0.18], p.metal],
  ],
  dagger: (p) => [
    [[-0.02, 0, -0.02], [0.04, 0.08, 0.04], p.wood],
    [[-0.06, 0.08, -0.02], [0.12, 0.03, 0.04], p.trim],
    [[-0.02, 0.11, -0.008], [0.04, 0.2, 0.016], p.metal],
  ],
  bow: (p) => [
    [[-0.035, 0.34, -0.035], [0.07, 0.16, 0.07], p.trim],
    [[-0.03, 0.5, -0.07], [0.06, 0.2, 0.06], p.wood],
    [[-0.03, 0.68, -0.16], [0.06, 0.18, 0.06], p.wood],
    [[-0.03, 0.14, -0.07], [0.06, 0.2, 0.06], p.wood],
    [[-0.03, 0, -0.16], [0.06, 0.18, 0.06], p.wood],
    [[-0.008, 0.03, -0.17], [0.016, 0.78, 0.016], 0xf4f2ec],
  ],
  staff: (p) => [
    [[-0.03, 0, -0.03], [0.06, 1.0, 0.06], p.wood],
    [[-0.07, 1.0, -0.07], [0.14, 0.14, 0.14], p.trim],
  ],
  shield: (p) => [
    [[-0.2, 0, -0.03], [0.4, 0.46, 0.06], p.wood],
    [[-0.22, 0.2, -0.04], [0.44, 0.06, 0.08], p.metal],
    [[-0.06, 0.17, 0.03], [0.12, 0.12, 0.04], p.metal],
  ],
  tome: (p) => [
    [[-0.14, 0, -0.1], [0.28, 0.06, 0.2], p.leather],
    [[-0.13, 0.06, -0.09], [0.26, 0.04, 0.18], 0xf4ecd8],
    [[-0.03, 0.1, -0.1], [0.06, 0.01, 0.2], p.trim],
  ],
  torch: (p) => [
    [[-0.025, 0, -0.025], [0.05, 0.36, 0.05], p.wood],
    [[-0.045, 0.32, -0.045], [0.09, 0.08, 0.09], p.cloth],
    [[-0.05, 0.4, -0.05], [0.1, 0.1, 0.1], 0xff8a1a],
    [[-0.03, 0.5, -0.03], [0.06, 0.08, 0.06], 0xffe060],
  ],
  helm: (p) => [
    [[-0.14, 0, -0.14], [0.28, 0.2, 0.28], p.metal],
    [[-0.03, 0.2, -0.12], [0.06, 0.06, 0.24], p.trim],
  ],
  cuirass: (p) => [
    [[-0.18, 0, -0.1], [0.36, 0.34, 0.2], p.metal],
    [[-0.19, 0.04, -0.11], [0.38, 0.05, 0.22], p.trim],
  ],
  greaves: (p) => [
    [[-0.15, 0, -0.08], [0.12, 0.2, 0.16], p.metal],
    [[0.03, 0, -0.08], [0.12, 0.2, 0.16], p.metal],
  ],
  cowl: (p) => [
    [[-0.14, 0, -0.14], [0.28, 0.16, 0.28], p.leather],
    [[-0.1, 0, 0.14], [0.2, 0.06, 0.06], p.leather],
  ],
  jerkin: (p) => [
    [[-0.18, 0, -0.1], [0.36, 0.32, 0.2], p.leather],
    [[-0.02, 0.05, 0.1], [0.04, 0.24, 0.01], p.trim],
  ],
  boots: (p) => [
    [[-0.15, 0, -0.08], [0.12, 0.18, 0.16], p.leather],
    [[0.03, 0, -0.08], [0.12, 0.18, 0.16], p.leather],
  ],
  hood: (p) => [
    [[-0.14, 0, -0.14], [0.28, 0.18, 0.28], p.cloth],
    [[-0.06, 0.18, -0.06], [0.12, 0.1, 0.12], p.cloth],
  ],
  robe: (p) => [
    [[-0.2, 0, -0.12], [0.4, 0.44, 0.24], p.cloth],
    [[-0.21, 0.24, -0.13], [0.42, 0.05, 0.26], p.trim],
  ],
  sandals: (p) => [
    [[-0.15, 0, -0.08], [0.12, 0.05, 0.18], p.cloth],
    [[0.03, 0, -0.08], [0.12, 0.05, 0.18], p.cloth],
  ],
  ring: (p) => [
    [[-0.08, 0, -0.08], [0.16, 0.04, 0.16], p.metal],
    [[-0.03, 0.04, -0.03], [0.06, 0.05, 0.06], p.trim],
  ],
}

/** The three weights of armour, and what each piece of each adds on top of
 * turning bites: plate the most armour and health, leather half as much and
 * speed, cloth a quarter and force. */
export let WEIGHTS = {
  plate: {
    name: 'Plate',
    head: 'helm',
    body: 'cuirass',
    feet: 'greaves',
    k: 1,
  },
  leather: {
    name: 'Leather',
    head: 'cowl',
    body: 'jerkin',
    feet: 'boots',
    k: 0.5,
    speed: 0.04,
  },
  cloth: {
    name: 'Cloth',
    head: 'hood',
    body: 'robe',
    feet: 'sandals',
    k: 0.25,
    force: 0.05,
  },
}

// A tier's armour and health on a plate piece, by slot, and on a shield.
let ARMOUR = {
  head: [1, 2, 3, 3, 4],
  body: [2, 3, 5, 7, 8],
  feet: [1, 2, 3, 3, 4],
}
let HEALTH = {
  head: [5, 8, 12, 16, 20],
  body: [10, 16, 24, 32, 40],
  feet: [5, 8, 12, 16, 20],
}

let cap = (s: string) => s[0].toUpperCase() + s.slice(1)

// Every kind, for each tier.
let tiers = (make: (t: number, p: Paint) => [string, Thing][]) =>
  Object.fromEntries([1, 2, 3, 4, 5].flatMap((t) => {
    let i = t - 1
    return make(t, {
      metal: C.metal[i],
      wood: C.wood[i],
      leather: C.leather[i],
      cloth: C.cloth[i],
      trim: C.trim[i],
    })
  }))

let MADE: Record<string, string[]> = {
  sword: METAL,
  axe: METAL,
  hammer: METAL,
  dagger: METAL,
  bow: WOOD,
  staff: WOOD,
}

/** What makes a kind a weapon of a family and tier: a quest's gift is one,
 * `fine` times as hard as a plain one, with a name and a look of its own. */
export let wield = (family: string, t: number, fine = 1) => ({
  slot: 'main' as const,
  family,
  tier: t,
  dmg: Math.round(GRADE[t - 1] * HANDLES[family].dmg * fine * 100) / 100,
})

let weapon = (family: string, t: number, p: Paint): Thing => ({
  name: `${MADE[family][t - 1]} ${family}`,
  ...wield(family, t),
  look: LOOKS[family](p),
})

/** Every kind of arms and armour, by id: the noun and its tier, `sword1` to
 * `ring5`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(ARMS.sword1.name, 'Copper sword')
 * assertEquals([ARMS.hammer5.slot, ARMS.robe3.slot, ARMS.shield2.slot], [
 *   'main',
 *   'body',
 *   'off',
 * ])
 * // The Maw's arms beat Mossvale's.
 * assertEquals(ARMS.axe5.dmg! > ARMS.axe1.dmg!, true)
 * ```
 */
export let ARMS: Record<string, Thing> = tiers((t, p) => {
  let i = t - 1
  let arms: [string, Thing][] = Object.keys(MADE).map((f) => [
    `${f}${t}`,
    weapon(f, t, p),
  ])
  let worn: [string, Thing][] = Object.entries(WEIGHTS).flatMap((
    [weight, w],
  ) =>
    (['head', 'body', 'feet'] as const).map((slot): [string, Thing] => {
      let noun = w[slot]
      let made = weight == 'plate'
        ? METAL
        : weight == 'leather'
        ? LEATHER
        : CLOTH
      return [`${noun}${t}`, {
        name: `${made[i]} ${noun}`,
        slot,
        weight,
        tier: t,
        armour: Math.round(ARMOUR[slot][i] * w.k),
        hp: Math.round(HEALTH[slot][i] * w.k),
        speed: 'speed' in w ? w.speed : undefined,
        force: 'force' in w ? w.force : undefined,
        look: LOOKS[noun](p),
      }]
    })
  )
  let off: [string, Thing][] = [
    [`shield${t}`, {
      name: `${WOOD[i]} shield`,
      slot: 'off',
      family: 'shield',
      tier: t,
      armour: ARMOUR.body[i],
      look: LOOKS.shield(p),
    }],
    [`tome${t}`, {
      name: `${LORE[i]} tome`,
      slot: 'off',
      family: 'tome',
      tier: t,
      force: 0.06 + 0.02 * t,
      look: LOOKS.tome(p),
    }],
    [`torch${t}`, {
      name: `${WOOD[i]} torch`,
      slot: 'off',
      family: 'torch',
      tier: t,
      luck: 0.04 + 0.02 * t,
      look: LOOKS.torch(p),
    }],
    [`ring${t}`, {
      name: `${METAL[i]} ring`,
      slot: 'trinket',
      tier: t,
      luck: 0.02 + 0.01 * t,
      hp: HEALTH.head[i],
      look: LOOKS.ring(p),
    }],
  ]
  return [...arms, ...off, ...worn]
})

/** A piece of gear of tier `t` a fall leaves: a weapon, most often of the
 * `family` the hero holds, a thing for the other hand, a piece of armour, or
 * now and then a ring. `r` gives numbers in [0, 1).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let seq = (...xs: number[]) => () => xs.shift() ?? 0
 * assertEquals(spoil(2, seq(0.1, 0.3), 'bow'), 'bow2')
 * assertEquals(spoil(3, seq(0.7, 0, 0.5)), 'cuirass3')
 * assertEquals(spoil(5, seq(0.99)), 'ring5')
 * ```
 */
export let spoil = (t: number, r: () => number, family = ''): string => {
  let pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  let k = r()
  if (k < 0.4) {
    let own = MADE[family] && r() < 0.6
    return `${own ? family : pick(Object.keys(MADE))}${t}`
  }
  if (k < 0.55) return `${pick(['shield', 'tome', 'torch'])}${t}`
  if (k < 0.95) {
    let w = pick(Object.values(WEIGHTS))
    return `${w[pick(['head', 'body', 'feet'] as const)]}${t}`
  }
  return `ring${t}`
}

/** What a slot is called on a hero's sheet. */
export let SLOT_NAMES: Record<Slot, string> = {
  main: 'Weapon',
  off: 'Other hand',
  head: 'Head',
  body: 'Body',
  feet: 'Feet',
  trinket: 'Ring',
}

/** What a kind is, in a word or two: its family, or its weight and slot. */
export let sortOf = (t: Thing): string =>
  t.family
    ? HANDLES[t.family]?.name ?? cap(t.family)
    : t.weight
    ? `${WEIGHTS[t.weight as keyof typeof WEIGHTS]?.name ?? cap(t.weight)} ${
      t.slot == 'body' ? 'armour' : t.slot
    }`
    : t.slot == 'trinket'
    ? 'Ring'
    : ''
