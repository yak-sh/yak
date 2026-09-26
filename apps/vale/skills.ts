// The skill board: three disciplines, Might, Finesse and Arcana, each a few
// rows of skills, a deeper one needing the one above it. A hero has a point
// for every level and spends it on a skill: a passive, which makes them
// better with what they carry (a family of weapon harder or quicker, more
// health, armour, speed, great blows), or a stronger form of one of their
// abilities (abilities.ts). There is no class: a point goes anywhere on the
// board, and what a hero is comes from what they carry and what they chose.
//
// Learning writes a `learned` row, and a `respec` row, written by a village
// fire, forgets everything learned before it. What a hero knows is worked
// out from the rows alone (`learnedOf`), the same on every page, so a row
// for a skill they could not learn then counts for nothing.
import { ABILITIES, type Ability } from './abilities.ts'
import type { Kit } from './gear.ts'

export type Discipline = 'might' | 'finesse' | 'arcana'

export let DISCIPLINES: Record<
  Discipline,
  { name: string; icon: string; says: string }
> = {
  might: {
    name: 'Might',
    icon: '💪',
    says: 'Heavy weapons, armour and health',
  },
  finesse: { name: 'Finesse', icon: '🎯', says: 'Blades, bows and speed' },
  arcana: {
    name: 'Arcana',
    icon: '✨',
    says: 'Staves, tomes, healing and wards',
  },
}

/** What a passive adds, each a share: blows harder (`force`) or quicker
 * (`pace`), more health or armour, faster running, likelier great blows. */
export type Boon = {
  force?: number
  pace?: number
  health?: number
  armour?: number
  speed?: number
  luck?: number
}

export type Skill = {
  name: string
  icon: string
  /** what it does, in a few words */
  says: string
  discipline: Discipline
  /** its row on the board, 1 at the top */
  row: number
  /** the skill it needs first */
  after?: string
  /** a passive: what it adds, with a weapon of one of the families in
   * `with`, or with anything */
  boon?: Boon
  with?: string[]
  /** the ability it makes stronger, and how */
  ability?: string
  form?: Partial<Ability>
}

let HEAVY = ['hammer', 'axe']

/** Every skill, by id, row by row. */
export let SKILLS: Record<string, Skill> = {
  brawn: {
    name: 'Brawn',
    icon: '❤️',
    says: '10% more health.',
    discipline: 'might',
    row: 1,
    boon: { health: 0.1 },
  },
  heft: {
    name: 'Heft',
    icon: '🔨',
    says: 'Hammers and axes hit 12% harder.',
    discipline: 'might',
    row: 1,
    boon: { force: 0.12 },
    with: HEAVY,
  },
  hide: {
    name: 'Iron hide',
    icon: '🦺',
    says: 'Your armour turns 25% more of every bite.',
    discipline: 'might',
    row: 2,
    after: 'brawn',
    boon: { armour: 0.25 },
  },
  aftershock: {
    name: 'Aftershock',
    icon: '💥',
    says: 'Quake shakes further, and stuns for 3 s.',
    discipline: 'might',
    row: 2,
    after: 'heft',
    ability: 'quake',
    form: { far: 4.2, held: 3000 },
  },
  butcher: {
    name: "Butcher's cut",
    icon: '🩸',
    says: 'Rend bleeds twice as hard.',
    discipline: 'might',
    row: 2,
    after: 'heft',
    ability: 'rend',
    form: { bleed: 3.2 },
  },
  bulwark: {
    name: 'Bulwark',
    icon: '🛡️',
    says: 'Block holds for 2.5 s, and is ready again sooner.',
    discipline: 'might',
    row: 3,
    after: 'hide',
    ability: 'block',
    form: { guard: 2500, cool: 4500 },
  },
  momentum: {
    name: 'Momentum',
    icon: '⚙️',
    says: 'Hammers and axes swing 12% quicker.',
    discipline: 'might',
    row: 3,
    after: 'aftershock',
    boon: { pace: 0.12 },
    with: HEAVY,
  },
  cyclone: {
    name: 'Cyclone',
    icon: '🌀',
    says: 'Whirl reaches further, hits harder, and is ready sooner.',
    discipline: 'might',
    row: 3,
    after: 'butcher',
    ability: 'whirl',
    form: { far: 3.6, dmg: 1.5, cool: 6000 },
  },
  titan: {
    name: 'Titan',
    icon: '🗿',
    says: '15% more health, and armour turns 15% more.',
    discipline: 'might',
    row: 4,
    after: 'bulwark',
    boon: { health: 0.15, armour: 0.15 },
  },
  earthbreaker: {
    name: 'Earthbreaker',
    icon: '💢',
    says: 'Crush lands harder still, and leaves the foe senseless.',
    discipline: 'might',
    row: 4,
    after: 'momentum',
    ability: 'crush',
    form: { dmg: 3.2, held: 1500 },
  },

  fleet: {
    name: 'Fleet',
    icon: '💨',
    says: 'Run 8% faster.',
    discipline: 'finesse',
    row: 1,
    boon: { speed: 0.08 },
  },
  keen: {
    name: 'Keen edge',
    icon: '🔪',
    says: 'Swords and daggers hit 12% harder.',
    discipline: 'finesse',
    row: 1,
    boon: { force: 0.12 },
    with: ['sword', 'dagger'],
  },
  steady: {
    name: 'Steady hand',
    icon: '🏹',
    says: 'Bows hit 12% harder.',
    discipline: 'finesse',
    row: 1,
    boon: { force: 0.12 },
    with: ['bow'],
  },
  sweep: {
    name: 'Wide sweep',
    icon: '🌙',
    says: 'Cleave sweeps wider and cuts deeper.',
    discipline: 'finesse',
    row: 2,
    after: 'keen',
    ability: 'cleave',
    form: { arc: 1.9, dmg: 1.5 },
  },
  cuts: {
    name: 'Thousand cuts',
    icon: '🗡️',
    says: 'Flurry stabs five times.',
    discipline: 'finesse',
    row: 2,
    after: 'keen',
    ability: 'flurry',
    form: { hits: 5, time: 800 },
  },
  deadeye: {
    name: 'Deadeye',
    icon: '🍀',
    says: 'With a bow, great blows come 10% more often.',
    discipline: 'finesse',
    row: 2,
    after: 'steady',
    boon: { luck: 0.1 },
    with: ['bow'],
  },
  nimble: {
    name: 'Nimble',
    icon: '🦶',
    says: 'Run 8% faster, and great blows come 5% more often.',
    discipline: 'finesse',
    row: 3,
    after: 'fleet',
    boon: { speed: 0.08, luck: 0.05 },
  },
  charge: {
    name: 'Charge',
    icon: '⚡',
    says: 'Lunge reaches a foe further off, and lands harder.',
    discipline: 'finesse',
    row: 3,
    after: 'sweep',
    ability: 'lunge',
    form: { dash: 7, dmg: 2.5 },
  },
  rain: {
    name: 'Rain of arrows',
    icon: '🌧️',
    says: 'Volley looses more arrows over a wider place, harder.',
    discipline: 'finesse',
    row: 3,
    after: 'deadeye',
    ability: 'volley',
    form: { shots: 10, far: 4, dmg: 1.1 },
  },
  assassin: {
    name: 'Assassin',
    icon: '👤',
    says: 'Shadowstep stabs harder, and is ready sooner.',
    discipline: 'finesse',
    row: 4,
    after: 'nimble',
    ability: 'shadowstep',
    form: { dmg: 1.6, cool: 7000 },
  },
  pinpoint: {
    name: 'Pinpoint',
    icon: '📌',
    says: 'Pinning shot holds for 4.5 s, harder, and is ready sooner.',
    discipline: 'finesse',
    row: 4,
    after: 'rain',
    ability: 'pin',
    form: { held: 4500, dmg: 1.5, cool: 7000 },
  },

  focus: {
    name: 'Focus',
    icon: '🪄',
    says: 'Staves hit 12% harder.',
    discipline: 'arcana',
    row: 1,
    boon: { force: 0.12 },
    with: ['staff'],
  },
  kindness: {
    name: 'Kindness',
    icon: '💚',
    says: 'Mend gives back almost half your health.',
    discipline: 'arcana',
    row: 1,
    ability: 'mend',
    form: { heal: 0.45 },
  },
  inferno: {
    name: 'Inferno',
    icon: '🔥',
    says: 'Blaze bursts wider and burns harder.',
    discipline: 'arcana',
    row: 2,
    after: 'focus',
    ability: 'blaze',
    form: { far: 3.5, dmg: 1.8 },
  },
  wildfire: {
    name: 'Wildfire',
    icon: '☄️',
    says: 'Scorch reaches further, and what it catches burns twice as hard.',
    discipline: 'arcana',
    row: 2,
    after: 'focus',
    ability: 'scorch',
    form: { far: 1.8, bleed: 2.4 },
  },
  aegis: {
    name: 'Aegis',
    icon: '🔮',
    says: 'Ward takes half your health in bites.',
    discipline: 'arcana',
    row: 2,
    after: 'kindness',
    ability: 'ward',
    form: { ward: 0.5 },
  },
  flow: {
    name: 'Flow',
    icon: '🌊',
    says: 'Staves strike 12% quicker.',
    discipline: 'arcana',
    row: 3,
    after: 'inferno',
    boon: { pace: 0.12 },
    with: ['staff'],
  },
  vigil: {
    name: 'Vigil',
    icon: '🕯️',
    says: '10% more health, and armour turns 10% more.',
    discipline: 'arcana',
    row: 3,
    after: 'aegis',
    boon: { health: 0.1, armour: 0.1 },
  },
  archmage: {
    name: 'Archmage',
    icon: '🌟',
    says: 'Every blow lands 10% harder.',
    discipline: 'arcana',
    row: 4,
    after: 'flow',
    boon: { force: 0.1 },
  },
  sanctuary: {
    name: 'Sanctuary',
    icon: '⛲',
    says: 'Mend gives back more still, and is ready sooner.',
    discipline: 'arcana',
    row: 4,
    after: 'vigil',
    ability: 'mend',
    form: { heal: 0.6, cool: 12000 },
  },
}

/** How many points a hero of level `lvl` has: one for every level. */
export let pointsOf = (lvl: number): number => lvl

/** What a hero knows, in the order they learned it: every `learned` row since
 * their last `respec`, in the order written, each counting only if the
 * skill is on the board, not already known, its `after` is known, and a
 * point is left for it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let rows = (...skills: string[]) => skills.map((skill, at) => ({ skill, at }))
 * assertEquals(learnedOf(rows('brawn', 'hide'), [], 5), ['brawn', 'hide'])
 * // Not before what it needs, not twice, not past the points.
 * assertEquals(learnedOf(rows('hide', 'brawn', 'brawn'), [], 5), ['brawn'])
 * assertEquals(learnedOf(rows('brawn', 'fleet', 'focus'), [], 2), ['brawn', 'fleet'])
 * // A respec forgets what came before it.
 * assertEquals(learnedOf(rows('brawn', 'fleet', 'focus'), [1.5], 5), ['focus'])
 * ```
 */
export let learnedOf = (
  rows: { skill: string; at: number }[],
  respecs: number[],
  lvl: number,
): string[] => {
  let since = Math.max(-Infinity, ...respecs)
  let known: string[] = []
  let ordered = rows.filter((r) => r.at > since).sort((a, b) =>
    a.at - b.at || (a.skill < b.skill ? -1 : 1)
  )
  for (let { skill } of ordered) {
    let s = SKILLS[skill]
    if (!s || known.includes(skill) || known.length >= pointsOf(lvl)) continue
    if (s.after && !known.includes(s.after)) continue
    known.push(skill)
  }
  return known
}

/** Whether a hero who knows `known`, at level `lvl`, can learn `skill` now.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(canLearn('hide', ['brawn'], 2), true)
 * assertEquals(canLearn('hide', [], 2), false)
 * assertEquals(canLearn('fleet', ['brawn', 'hide'], 2), false)
 * ```
 */
export let canLearn = (skill: string, known: string[], lvl: number) => {
  let s = SKILLS[skill]
  return !!s && !known.includes(skill) &&
    known.length < pointsOf(lvl) && (!s.after || known.includes(s.after))
}

/** An ability as a hero who knows `known` does it: its row, made stronger by
 * every skill they know for it, in the order learned.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(formOf('mend', [])?.heal, 0.3)
 * assertEquals(formOf('mend', ['kindness'])?.heal, 0.45)
 * assertEquals(formOf('mend', ['kindness', 'aegis', 'vigil', 'sanctuary'])?.heal, 0.6)
 * assertEquals(formOf('nothing', []), undefined)
 * ```
 */
export let formOf = (id: string, known: string[]): Ability | undefined => {
  let a = ABILITIES[id]
  if (!a) return undefined
  for (let k of known) {
    let s = SKILLS[k]
    if (s?.ability == id) a = { ...a, ...s.form }
  }
  return a
}

/** A hero's kit with what their passives add: each passive whose `with`
 * holds the family of the weapon in hand, or that has none. `base` is the
 * health their level gives, for the passives that add a share of it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { ITEMS } from './items.ts'
 * import { kitOf } from './gear.ts'
 * let kit = (kinds: string[], known: string[]) =>
 *   skilled(kitOf(Object.fromEntries(
 *     kinds.map((kind) => [ITEMS[kind].slot!, { eid: kind, kind, n: 1 }]),
 *   )), known, 100)
 * assertEquals(kit(['hammer1'], ['heft']).force, 0.12)
 * // Heft is for heavy weapons; a sword gets nothing of it.
 * assertEquals(kit(['sword1'], ['heft']).force, 0)
 * assertEquals(kit([], ['brawn']).hp, 10)
 * assertEquals(kit(['cuirass5'], ['brawn', 'hide']).armour, 10)
 * assertEquals(kit(['staff1'], ['focus', 'inferno', 'flow']).pace, 669)
 * ```
 */
export let skilled = (kit: Kit, known: string[], base: number): Kit => {
  let k = { ...kit }
  for (let id of known) {
    let s = SKILLS[id], b = s?.boon
    if (!b || (s.with && !s.with.includes(kit.family))) continue
    k.force += b.force ?? 0
    k.pace *= 1 - (b.pace ?? 0)
    k.hp += (base + kit.hp) * (b.health ?? 0)
    k.armour += kit.armour * (b.armour ?? 0)
    k.speed += b.speed ?? 0
    k.luck += b.luck ?? 0
  }
  let two = (n: number) => Math.round(n * 100) / 100
  return {
    ...k,
    pace: Math.round(k.pace),
    hp: Math.round(k.hp),
    armour: Math.round(k.armour),
    force: two(k.force),
    speed: two(k.speed),
    luck: two(k.luck),
  }
}
