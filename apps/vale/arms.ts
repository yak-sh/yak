// The arms and armour a hero can wear: a kind for every weapon, every thing
// held in the other hand, every piece of armour and every ring, at each of
// five tiers. A tier follows the country a thing comes from, as a creature's
// level does (`tierOf`): copper and ash about Mossvale, cinder and emberwood
// out by the Maw. What a kind does comes from what it is (`HANDLES` for a
// weapon, `WEIGHTS` for armour) scaled by its tier, and how it looks from a
// few boxes in its tier's colours, its metal shining (mesh.ts `metal`).
// items.ts lists them beside everything else a hero carries; gear.ts says
// what a hero wears of them.
//
// There is no class to pick. A weapon's family says how it handles: a sword
// is quick and even, an axe sweeps wide, a hammer is slow and heavy in both
// hands, a dagger is quick and short and often lands a great blow, a bow and
// a staff strike from afar. Armour comes in three weights: plate turns the
// most of a bite and adds the most health, leather less but runs faster, and
// cloth least but every blow lands harder.
import type { Box } from './boxes.ts'
import type { Thing, View } from './items.ts'
>>>>>>> 7e18319f (Mossvale: a model built of boxes never draws two faces in one plane. Its boxes are one solid (boxes.ts): each is worn over those before it, a side within a step (5 mm, mesh.ts STEP) of an earlier box's same side standing a step outside it, or flush where both are the same stuff; and a face is drawn only where it shows, cut where another box lies against it or over it. A figure's parts are worn over the parts before them that stand square to them as it is built (parts.ts knit), so a thigh no longer flickers against a flank. Figures, a thing's look, logs and stumps and a foundation all go through it; mesh.ts `fights` finds any two faces the depth buffer cannot tell apart, and tests over every creature, every hero's dress, every look and every prop find none (T-40879))
import { metal } from './mesh.ts'

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
  metal: [0xc8804a, 0x9aa2aa, 0xdfe6ee, 0x9ad8ff, 0xff7a2a].map(metal),
  wood: [0x9a7a52, 0x7a4a2a, 0x4a3a30, 0xcfe0e8, 0x3a2020],
  leather: [0xb8906a, 0x8a5a3a, 0x6a6a70, 0x3a6a5a, 0x7a2a20],
  cloth: [0xe8e0cc, 0x5a7ab8, 0xf4f2ec, 0x8a7ad8, 0xe8622a],
  trim: [0xe2b64c, 0x6a4a30, 0x8fd46a, 0xf4f8ff, 0xffd040],
  gem: [0xe0405a, 0x3a7ae0, 0x3ac87a, 0xf4f8ff, 0xffd040],
}

// The shadow inside a hood, a slit or under a sole, and a sandal's sole.
let HOLLOW = 0x2e2419
let SOLE = 0xc08c5a

/** How hard a tier's weapons land, against bare level. */
export let GRADE = [1.2, 1.7, 2.3, 2.9, 3.5]

type Paint = {
  metal: number
  wood: number
  leather: number
  cloth: number
  trim: number
  gem: number
}

// Each kind's look, upright from its foot: the same boxes a hero holds
// (figures.ts), lying on the ground and in the bag. A weapon is sized for a
// hand of the vale's people (figures.ts `BUILD`), and
// swings its edge forward, toward −z: a blade and its guard run from −z to
// +z, its flats to either side; a box's fourth number is how round its edges
// are, crisp for a blade.
let LOOKS: Record<string, (p: Paint) => Box[]> = {
  sword: (p) => [
    [[-0.04, 0, -0.04], [0.08, 0.05, 0.08], p.trim],
    [[-0.027, 0.05, -0.027], [0.054, 0.15, 0.054], p.wood],
    [[-0.04, 0.2, -0.15], [0.08, 0.05, 0.3], p.trim],
    [[-0.015, 0.25, -0.05], [0.03, 0.53, 0.1], p.metal, 0.012],
    [[-0.013, 0.78, -0.03], [0.026, 0.08, 0.06], p.metal, 0.012],
  ],
  axe: (p) => [
    [[-0.033, 0, -0.033], [0.066, 0.8, 0.066], p.wood],
    [[-0.03, 0.52, -0.2], [0.06, 0.22, 0.17], p.metal],
    [[-0.02, 0.46, -0.27], [0.04, 0.34, 0.07], p.metal, 0.012],
    [[-0.035, 0.57, 0.03], [0.07, 0.12, 0.08], p.metal],
  ],
  hammer: (p) => [
    [[-0.036, 0, -0.036], [0.072, 0.86, 0.072], p.wood],
    [[-0.1, 0.7, -0.19], [0.2, 0.22, 0.38], p.metal],
    [[-0.115, 0.685, -0.23], [0.23, 0.25, 0.06], p.metal],
    [[-0.115, 0.685, 0.17], [0.23, 0.25, 0.06], p.metal],
  ],
  dagger: (p) => [
    [[-0.032, 0, -0.032], [0.064, 0.04, 0.064], p.trim],
    [[-0.023, 0.04, -0.023], [0.046, 0.11, 0.046], p.wood],
    [[-0.03, 0.15, -0.11], [0.06, 0.045, 0.22], p.trim],
    [[-0.013, 0.195, -0.04], [0.026, 0.24, 0.08], p.metal, 0.01],
    [[-0.011, 0.435, -0.024], [0.022, 0.065, 0.048], p.metal, 0.01],
  ],
  bow: (p) => [
    [[-0.04, 0.38, -0.04], [0.08, 0.18, 0.08], p.trim],
    [[-0.035, 0.56, -0.1], [0.07, 0.24, 0.07], p.wood],
    [[-0.035, 0.78, -0.2], [0.07, 0.26, 0.07], p.wood],
    [[-0.035, 0.18, -0.1], [0.07, 0.22, 0.07], p.wood],
    [[-0.035, 0, -0.2], [0.07, 0.2, 0.07], p.wood],
    [[-0.01, 0.03, -0.215], [0.02, 0.98, 0.02], 0xf4f2ec],
  ],
  staff: (p) => [
    [[-0.037, 0, -0.037], [0.074, 1.3, 0.074], p.wood],
    [[-0.055, 1.24, -0.055], [0.11, 0.06, 0.11], p.trim],
    [[-0.085, 1.3, -0.085], [0.17, 0.17, 0.17], p.trim],
  ],
  shield: (p) => [
    [[-0.25, 0.14, -0.03], [0.5, 0.44, 0.06], p.wood, 0.03],
    [[-0.18, 0.05, -0.03], [0.36, 0.09, 0.06], p.wood, 0.03],
    [[-0.09, 0, -0.03], [0.18, 0.05, 0.06], p.wood, 0.03],
    [[-0.265, 0.54, -0.04], [0.53, 0.06, 0.08], p.metal],
    [[-0.03, 0.02, -0.035], [0.06, 0.56, 0.07], p.metal],
    [[-0.08, 0.24, 0.03], [0.16, 0.16, 0.05], p.metal],
  ],
  tome: (p) => [
    [[-0.16, 0, -0.12], [0.32, 0.07, 0.24], p.leather],
    [[-0.15, 0.07, -0.11], [0.3, 0.045, 0.22], 0xf4ecd8],
    [[-0.035, 0.115, -0.12], [0.07, 0.012, 0.24], p.trim],
  ],
  torch: (p) => [
    [[-0.03, 0, -0.03], [0.06, 0.48, 0.06], p.wood],
    [[-0.055, 0.42, -0.055], [0.11, 0.1, 0.11], p.cloth],
    [[-0.065, 0.52, -0.065], [0.13, 0.13, 0.13], 0xff8a1a],
    [[-0.04, 0.65, -0.04], [0.08, 0.1, 0.08], 0xffe060],
  ],
  // Armour faces +z, and each look's first box is the stuff it is made of
  // and its second its trim, the colours a hero wears it in (figures.ts
  // `tone`). Plate has bands and pauldrons, leather laces and buckles, cloth
  // hems and a sash.
  helm: (p) => [
    [[-0.13, 0, -0.13], [0.26, 0.23, 0.26], p.metal],
    [[-0.14, 0.15, -0.14], [0.28, 0.035, 0.28], p.trim],
    [[-0.1, 0.23, -0.1], [0.2, 0.04, 0.2], p.metal],
    [[-0.02, 0.24, -0.12], [0.04, 0.06, 0.24], p.trim],
    [[-0.1, 0.1, 0.13], [0.2, 0.03, 0.01], HOLLOW],
    [[-0.016, 0.03, 0.13], [0.032, 0.08, 0.01], HOLLOW],
  ],
  cuirass: (p) => [
    [[-0.15, 0, -0.09], [0.3, 0.28, 0.18], p.metal],
    [[-0.16, 0.04, -0.1], [0.32, 0.04, 0.2], p.trim],
    [[-0.25, 0.2, -0.1], [0.15, 0.1, 0.2], p.metal],
    [[0.1, 0.2, -0.1], [0.15, 0.1, 0.2], p.metal],
    [[-0.08, 0.26, -0.07], [0.16, 0.05, 0.14], p.trim],
    [[-0.05, 0.28, -0.045], [0.1, 0.035, 0.09], HOLLOW],
  ],
  greaves: (p) =>
    pair(0.16, 0, (x) => [
      [[x - 0.05, 0.04, -0.05], [0.1, 0.22, 0.1], p.metal],
      [[x - 0.06, 0.08, -0.06], [0.12, 0.03, 0.12], p.trim],
      [[x - 0.065, 0.22, -0.065], [0.13, 0.08, 0.13], p.metal],
      [[x - 0.055, 0, -0.04], [0.11, 0.05, 0.16], p.metal],
    ]),
  cowl: (p) => [
    [[-0.12, 0.07, -0.12], [0.24, 0.2, 0.24], p.leather],
    [[-0.03, 0.03, 0.12], [0.06, 0.07, 0.02], p.trim],
    [[-0.09, 0.27, -0.09], [0.18, 0.03, 0.18], p.leather],
    [[-0.075, 0.1, 0.12], [0.15, 0.13, 0.01], HOLLOW],
    [[-0.17, 0, -0.14], [0.34, 0.08, 0.26], p.leather],
  ],
  jerkin: (p) => [
    [[-0.14, 0, -0.08], [0.28, 0.26, 0.16], p.leather],
    [[-0.045, 0.19, 0.08], [0.09, 0.025, 0.015], p.trim],
    [[-0.045, 0.12, 0.08], [0.09, 0.025, 0.015], p.trim],
    [[-0.02, 0.07, 0.075], [0.04, 0.19, 0.01], HOLLOW],
    [[-0.14, 0.26, -0.07], [0.08, 0.06, 0.14], p.leather],
    [[0.06, 0.26, -0.07], [0.08, 0.06, 0.14], p.leather],
    [[-0.15, 0.02, -0.09], [0.3, 0.04, 0.18], HOLLOW],
    [[-0.035, 0.01, 0.09], [0.07, 0.06, 0.015], p.trim],
  ],
  boots: (p) =>
    pair(0.12, -0.12, (x) => [
      [[x - 0.045, 0.04, -0.07], [0.09, 0.15, 0.09], p.leather],
      [[x - 0.045, 0.02, -0.07], [0.09, 0.06, 0.18], p.leather],
      [[x - 0.055, 0.17, -0.08], [0.11, 0.05, 0.11], p.leather],
      [[x - 0.05, 0.09, -0.075], [0.1, 0.025, 0.1], p.trim],
      [[x - 0.05, 0, -0.075], [0.1, 0.025, 0.19], HOLLOW],
    ]),
  hood: (p) => [
    [[-0.13, 0.04, -0.12], [0.26, 0.2, 0.24], p.cloth],
    [[-0.11, 0.03, 0.12], [0.22, 0.19, 0.02], p.trim],
    [[-0.08, 0.05, 0.13], [0.16, 0.13, 0.02], HOLLOW],
    [[-0.09, 0.24, -0.11], [0.18, 0.05, 0.18], p.cloth],
    [[-0.06, 0.29, -0.13], [0.12, 0.05, 0.12], p.cloth],
    [[-0.035, 0.33, -0.18], [0.07, 0.05, 0.08], p.cloth],
    [[-0.16, 0, -0.14], [0.32, 0.05, 0.27], p.cloth],
  ],
  robe: (p) => [
    [[-0.11, 0.3, -0.08], [0.22, 0.18, 0.16], p.cloth],
    [[-0.12, 0.28, -0.09], [0.24, 0.045, 0.18], p.trim],
    [[-0.15, 0, -0.1], [0.3, 0.3, 0.2], p.cloth],
    [[-0.16, 0, -0.11], [0.32, 0.035, 0.22], p.trim],
    [[-0.2, 0.28, -0.07], [0.09, 0.2, 0.14], p.cloth],
    [[0.11, 0.28, -0.07], [0.09, 0.2, 0.14], p.cloth],
    [[0.04, 0.13, 0.1], [0.04, 0.15, 0.015], p.trim],
    [[-0.04, 0.43, 0.075], [0.08, 0.05, 0.01], HOLLOW],
  ],
  sandals: (p) =>
    pair(0.13, 0.03, (x) => [
      [[x - 0.06, 0.025, -0.01], [0.12, 0.03, 0.045], p.cloth],
      [[x - 0.012, 0.025, 0.035], [0.024, 0.03, 0.06], p.cloth],
      [[x - 0.05, 0, -0.03], [0.1, 0.025, 0.14], SOLE],
      [[x - 0.04, 0, -0.1], [0.08, 0.025, 0.08], SOLE],
      [[x - 0.045, 0.02, -0.105], [0.09, 0.06, 0.03], p.cloth],
    ]),
  ring: (p) => [
    [[-0.07, 0, -0.015], [0.14, 0.03, 0.03], p.metal],
    [[-0.04, 0.155, -0.025], [0.08, 0.025, 0.05], p.trim],
    [[-0.1, 0.03, -0.015], [0.03, 0.1, 0.03], p.metal],
    [[0.07, 0.03, -0.015], [0.03, 0.1, 0.03], p.metal],
    [[-0.07, 0.13, -0.015], [0.14, 0.03, 0.03], p.metal],
    [[-0.03, 0.175, -0.03], [0.06, 0.05, 0.06], p.gem],
  ],
}

// Two of a thing worn on the feet, each made about the `x` it stands at,
// `apart` from side to side and the right one `ahead` of the left: the left
// one's boxes first.
let pair = (apart: number, ahead: number, one: (x: number) => Box[]) =>
  [-1, 1].flatMap((side) =>
    one(side * apart / 2).map(([[x, y, z], ...rest]): Box => [
      [x, y, z + side * ahead / 2],
      ...rest,
    ])
  )

// How each kind's picture sees it (sprites.ts), when not from its corner.
let VIEWS: Record<string, View> = {
  sword: 'lying',
  axe: 'lying',
  hammer: 'lying',
  dagger: 'lying',
  bow: 'lying',
  staff: 'lying',
  torch: 'lying',
  shield: 'front',
  helm: 'front',
  cuirass: 'front',
  greaves: 'front',
  cowl: 'front',
  jerkin: 'front',
  boots: 'side',
  robe: 'front',
  sandals: 'top',
  ring: 'front',
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

// A tier's colours.
let paint = (t: number): Paint => ({
  metal: C.metal[t - 1],
  wood: C.wood[t - 1],
  leather: C.leather[t - 1],
  cloth: C.cloth[t - 1],
  trim: C.trim[t - 1],
  gem: C.gem[t - 1],
})

// Every kind, for each tier.
let tiers = (make: (t: number, p: Paint) => [string, Thing][]) =>
  Object.fromEntries([1, 2, 3, 4, 5].flatMap((t) => make(t, paint(t))))

/** The look of a kind of tier `t` in some colours of its own, for a gift
 * made after it (items.ts), and how its picture sees it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let gold = forged('sword', 1, { trim: 0xffd040 })
 * assertEquals(gold.look.length, ARMS.sword1.look.length)
 * assertEquals(gold.look.some((b) => b[2] == 0xffd040), true)
 * ```
 */
export let forged = (kind: string, t: number, p: Partial<Paint>) => ({
  look: LOOKS[kind]({ ...paint(t), ...p }),
  view: VIEWS[kind],
})

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
  view: VIEWS[family],
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
        view: VIEWS[noun],
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
      view: VIEWS.shield,
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
      view: VIEWS.torch,
    }],
    [`ring${t}`, {
      name: `${METAL[i]} ring`,
      slot: 'trinket',
      tier: t,
      luck: 0.02 + 0.01 * t,
      hp: HEALTH.head[i],
      look: LOOKS.ring(p),
      view: VIEWS.ring,
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
