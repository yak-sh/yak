// How the arms and armour in item designs work: weapon handling, armour
// weights, tier levels, and the kinds a creature may drop. The items and
// their looks live in the store; gear.ts says what a hero wears of them.
//
// There is no class to pick. A weapon's family says how it handles: a sword
// is quick and even, an axe sweeps wide, a hammer is slow and heavy in both
// hands, a dagger is quick and short and often lands a great blow, a bow and
// a staff strike from afar. Armour comes in three weights: plate turns the
// most of a bite and adds the most health, leather less but runs faster, and
// cloth least but its force and haste make every blow land harder and sooner.
import { ITEMS, type Thing } from './items.ts'

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

/** Five material tiers span the sixty levels of the vale. A tier names the
 * material and recipes of a piece; level says how dangerous a creature is.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([1, 12, 13, 24, 25, 60].map(tierOf), [1, 1, 2, 2, 3, 5])
 * ```
 */
export let tierOf = (lvl: number): number =>
  Math.max(1, Math.min(5, Math.ceil(lvl / 12)))

/** The first and last item levels of a material tier. */
export let tierRange = (
  tier: number,
): [number, number] => [12 * (tier - 1) + 1, 12 * tier]

/** A material tier as it appears on equipment and at stations. */
export let tierName = (tier: number): string =>
  ['I', 'II', 'III', 'IV', 'V'][tier - 1] ?? String(tier)

/** How hard a tier's weapons land, against bare level. */
export let GRADE = [1.2, 1.7, 2.3, 2.9, 3.5]

/** The three weights of armour and their piece names. */
export let WEIGHTS = {
  plate: {
    name: 'Plate',
    head: 'helm',
    body: 'cuirass',
    feet: 'greaves',
  },
  leather: {
    name: 'Leather',
    head: 'cowl',
    body: 'jerkin',
    feet: 'boots',
  },
  cloth: {
    name: 'Cloth',
    head: 'hood',
    body: 'robe',
    feet: 'sandals',
  },
}

let cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** A piece of gear of tier `t` a fall leaves: a weapon, most often of the
 * `family` the hero holds, a thing for the other hand, a piece of armour, or
 * now and then a ring. `r` gives numbers in [0, 1).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { seedItems } from './items_fixture.ts'
 * seedItems()
 * let seq = (...xs: number[]) => () => xs.shift() ?? 0
 * assertEquals(spoil(2, seq(0.1, 0.3), 'bow'), 'bow2')
 * assertEquals(spoil(3, seq(0.7, 0, 0.5)), 'cuirass3')
 * assertEquals(spoil(5, seq(0.99)), 'ring5')
 * ```
 */
export let spoil = (t: number, r: () => number, family = ''): string => {
  let pieces = Object.entries(ITEMS).filter(([, item]) =>
    item.plain && item.tier == t
  )
  let pick = <T>(xs: T[]): T => {
    if (!xs.length) throw new Error(`No item designs for tier ${t}`)
    return xs[Math.floor(r() * xs.length)]
  }
  let of = (slot: Slot) => pieces.filter(([, item]) => item.slot == slot)
  let k = r()
  if (k < 0.4) {
    let weapons = of('main')
    let own = weapons.find(([, item]) => item.family == family)
    return own && r() < 0.6 ? own[0] : pick(weapons)[0]
  }
  if (k < 0.55) return pick(of('off'))[0]
  if (k < 0.95) {
    let armour = pieces.filter(([, item]) => item.weight)
    let slots: Slot[] = ['head', 'body', 'feet']
    let weights = [...new Set(armour.map(([, item]) => item.weight))]
      .filter((weight) =>
        slots.every((slot) =>
          armour.some(([, item]) => item.weight == weight && item.slot == slot)
        )
      )
    let weight = pick(weights)
    let slot = pick(slots)
    let found = armour.find(([, item]) =>
      item.weight == weight && item.slot == slot
    )
    if (!found) throw new Error(`No ${weight} ${slot} design for tier ${t}`)
    return found[0]
  }
  let ring = of('trinket')[0]
  if (!ring) throw new Error(`No trinket design for tier ${t}`)
  return ring[0]
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
