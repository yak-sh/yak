// The skill board: three disciplines, Might, Finesse and Arcana, each a few
// rows of skills, a deeper one needing the one above it. A hero has a point
// for every level and spends it on a skill: a passive, which makes them
// better with what they carry (a family of weapon harder or quicker, more
// health, armour, speed, great blows), a stronger form of one of their
// abilities (abilities.ts), or a second blade in the other hand (`hand`,
// gear.ts). There is no class: a point goes anywhere on the board, and what
// a hero is comes from what they carry and what they chose.
//
// Learning writes a `learned` row, and a `respec` row, written by a village
// fire, forgets everything learned before it. What a hero knows is worked
// out from the rows alone (`learnedOf`), the same on every page, so a row
// for a skill they could not learn then counts for nothing.
import { ABILITIES, type Ability } from './abilities.ts'
import { changed, type Effect } from './ability-effects.ts'
import type { Kit } from './gear.ts'
import type { Glyph } from './glyphs.ts'

export type Discipline = 'might' | 'finesse' | 'arcana'

export let DISCIPLINES: Record<
  Discipline,
  { name: string; icon: Glyph; says: string }
> = {
  might: {
    name: 'Might',
    icon: 'bicepsFlexed',
    says: 'Heavy weapons, armour and health',
  },
  finesse: { name: 'Finesse', icon: 'target', says: 'Blades, bows and speed' },
  arcana: {
    name: 'Arcana',
    icon: 'sparkles',
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
  icon: Glyph
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
  form?: Partial<Omit<Ability, 'effects'>> & { effects?: Effect[] }
  /** the family of weapon it lets the other hand hold too, beside one of its
   * own in the first (gear.ts) */
  hand?: string
}

let HEAVY = ['hammer', 'axe']

/** Every skill, by id, row by row. */
export let SKILLS: Record<string, Skill> = {
  brawn: {
    name: 'Brawn',
    icon: 'heartPlus',
    says: '10% more health.',
    discipline: 'might',
    row: 1,
    boon: { health: 0.1 },
  },
  heft: {
    name: 'Heft',
    icon: 'hammer',
    says: 'Hammers and axes hit 12% harder.',
    discipline: 'might',
    row: 1,
    boon: { force: 0.12 },
    with: HEAVY,
  },
  hide: {
    name: 'Iron hide',
    icon: 'shieldPlus',
    says: 'Your armour turns 25% more of every bite.',
    discipline: 'might',
    row: 2,
    after: 'brawn',
    boon: { armour: 0.25 },
  },
  aftershock: {
    name: 'Aftershock',
    icon: 'activity',
    says: 'Quake shakes further, and stuns for 3 s.',
    discipline: 'might',
    row: 2,
    after: 'heft',
    ability: 'quake',
    form: { far: 4.2, effects: [{ kind: 'stun', ms: 3000 }] },
  },
  butcher: {
    name: "Butcher's cut",
    icon: 'droplet',
    says: 'Rend bleeds twice as hard.',
    discipline: 'might',
    row: 2,
    after: 'heft',
    ability: 'rend',
    form: { effects: [{ kind: 'bleed', scale: 3.2 }] },
  },
  bulwark: {
    name: 'Bulwark',
    icon: 'shield',
    says: 'Block holds for 2.5 s, and is ready again sooner.',
    discipline: 'might',
    row: 3,
    after: 'hide',
    ability: 'block',
    form: { cool: 4500, effects: [{ kind: 'guard', ms: 2500 }] },
  },
  momentum: {
    name: 'Momentum',
    icon: 'cog',
    says: 'Hammers and axes swing 12% quicker.',
    discipline: 'might',
    row: 3,
    after: 'aftershock',
    boon: { pace: 0.12 },
    with: HEAVY,
  },
  cyclone: {
    name: 'Cyclone',
    icon: 'tornado',
    says: 'Whirl reaches further, hits harder, and is ready sooner.',
    discipline: 'might',
    row: 3,
    after: 'butcher',
    ability: 'whirl',
    form: { far: 3.6, cool: 6000, effects: [{ kind: 'damage', scale: 1.5 }] },
  },
  titan: {
    name: 'Titan',
    icon: 'mountain',
    says: '15% more health, and armour turns 15% more.',
    discipline: 'might',
    row: 4,
    after: 'bulwark',
    boon: { health: 0.15, armour: 0.15 },
  },
  earthbreaker: {
    name: 'Earthbreaker',
    icon: 'pickaxe',
    says: 'Crush lands harder still, and leaves the foe senseless.',
    discipline: 'might',
    row: 4,
    after: 'momentum',
    ability: 'crush',
    form: {
      effects: [{ kind: 'damage', scale: 3.2 }, { kind: 'stun', ms: 1500 }],
    },
  },

  fleet: {
    name: 'Fleet',
    icon: 'wind',
    says: 'Run 8% faster.',
    discipline: 'finesse',
    row: 1,
    boon: { speed: 0.08 },
  },
  keen: {
    name: 'Keen edge',
    icon: 'slice',
    says: 'Swords and daggers hit 12% harder.',
    discipline: 'finesse',
    row: 1,
    boon: { force: 0.12 },
    with: ['sword', 'dagger'],
  },
  steady: {
    name: 'Steady hand',
    icon: 'bowArrow',
    says: 'Bows hit 12% harder.',
    discipline: 'finesse',
    row: 1,
    boon: { force: 0.12 },
    with: ['bow'],
  },
  sweep: {
    name: 'Wide sweep',
    icon: 'rainbow',
    says: 'Cleave sweeps wider and cuts deeper.',
    discipline: 'finesse',
    row: 2,
    after: 'keen',
    ability: 'cleave',
    form: { arc: 1.9, effects: [{ kind: 'damage', scale: 1.5 }] },
  },
  cuts: {
    name: 'Thousand cuts',
    icon: 'strike',
    says: 'Flurry stabs five times.',
    discipline: 'finesse',
    row: 2,
    after: 'keen',
    ability: 'flurry',
    form: {
      time: 800,
      effects: [{ kind: 'damage', scale: 0.8, hits: 5, sure: true }],
    },
  },
  deadeye: {
    name: 'Deadeye',
    icon: 'eye',
    says: 'With a bow, great blows come 10% more often.',
    discipline: 'finesse',
    row: 2,
    after: 'steady',
    boon: { luck: 0.1 },
    with: ['bow'],
  },
  nimble: {
    name: 'Nimble',
    icon: 'footprints',
    says: 'Run 8% faster, and great blows come 5% more often.',
    discipline: 'finesse',
    row: 3,
    after: 'fleet',
    boon: { speed: 0.08, luck: 0.05 },
  },
  charge: {
    name: 'Charge',
    icon: 'zap',
    says: 'Lunge reaches a foe further off, and lands harder.',
    discipline: 'finesse',
    row: 3,
    after: 'sweep',
    ability: 'lunge',
    form: {
      effects: [{ kind: 'damage', scale: 2.5 }, { kind: 'dash', metres: 7 }],
    },
  },
  rain: {
    name: 'Rain of arrows',
    icon: 'cloudRain',
    says: 'Volley looses more arrows over a wider place, harder.',
    discipline: 'finesse',
    row: 3,
    after: 'deadeye',
    ability: 'volley',
    form: { shots: 10, far: 4, effects: [{ kind: 'damage', scale: 1.1 }] },
  },
  assassin: {
    name: 'Assassin',
    icon: 'mask',
    says: 'Shadowstep stabs harder, and is ready sooner.',
    discipline: 'finesse',
    row: 4,
    after: 'nimble',
    ability: 'shadowstep',
    form: { cool: 7000, effects: [{ kind: 'damage', scale: 1.6, sure: true }] },
  },
  twin: {
    name: 'Twin daggers',
    icon: 'blow',
    says:
      'Hold a second dagger in your other hand: blows come quicker, a hand at a time.',
    discipline: 'finesse',
    row: 4,
    after: 'cuts',
    hand: 'dagger',
  },
  pinpoint: {
    name: 'Pinpoint',
    icon: 'locateFixed',
    says: 'Pinning shot holds for 4.5 s, harder, and is ready sooner.',
    discipline: 'finesse',
    row: 4,
    after: 'rain',
    ability: 'pin',
    form: {
      cool: 7000,
      effects: [{ kind: 'damage', scale: 1.5 }, { kind: 'stun', ms: 4500 }],
    },
  },
  relentless: {
    name: 'Relentless',
    icon: 'refresh',
    says: 'A Lunge that kills is ready again at once.',
    discipline: 'finesse',
    row: 5,
    after: 'charge',
    ability: 'lunge',
    form: { effects: [{ kind: 'renew' }] },
  },

  focus: {
    name: 'Focus',
    icon: 'wand',
    says:
      'With a staff equipped, strikes and damaging abilities deal 12% more damage.',
    discipline: 'arcana',
    row: 1,
    boon: { force: 0.12 },
    with: ['staff'],
  },
  kindness: {
    name: 'Kindness',
    icon: 'handHeart',
    says: 'Mend gives back almost half your health.',
    discipline: 'arcana',
    row: 1,
    ability: 'mend',
    form: { effects: [{ kind: 'heal', share: 0.45 }] },
  },
  inferno: {
    name: 'Inferno',
    icon: 'flame',
    says: 'Blaze bursts wider and burns harder.',
    discipline: 'arcana',
    row: 2,
    after: 'focus',
    ability: 'blaze',
    form: { far: 3.5, effects: [{ kind: 'damage', scale: 1.8 }] },
  },
  wildfire: {
    name: 'Wildfire',
    icon: 'flameKindling',
    says: 'Scorch reaches further, and what it catches burns twice as hard.',
    discipline: 'arcana',
    row: 2,
    after: 'focus',
    ability: 'scorch',
    form: { far: 1.8, effects: [{ kind: 'bleed', scale: 2.4 }] },
  },
  aegis: {
    name: 'Aegis',
    icon: 'shieldCheck',
    says: 'Ward takes half your health in bites.',
    discipline: 'arcana',
    row: 2,
    after: 'kindness',
    ability: 'ward',
    form: { effects: [{ kind: 'ward', share: 0.5 }] },
  },
  flow: {
    name: 'Flow',
    icon: 'infinity',
    says: 'Staves strike 12% quicker.',
    discipline: 'arcana',
    row: 3,
    after: 'inferno',
    boon: { pace: 0.12 },
    with: ['staff'],
  },
  vigil: {
    name: 'Vigil',
    icon: 'lamp',
    says: '10% more health, and armour turns 10% more.',
    discipline: 'arcana',
    row: 3,
    after: 'aegis',
    boon: { health: 0.1, armour: 0.1 },
  },
  archmage: {
    name: 'Archmage',
    icon: 'star',
    says: 'Every blow lands 10% harder.',
    discipline: 'arcana',
    row: 4,
    after: 'flow',
    boon: { force: 0.1 },
  },
  sanctuary: {
    name: 'Sanctuary',
    icon: 'heartPulse',
    says: 'Mend gives back more still, and is ready sooner.',
    discipline: 'arcana',
    row: 4,
    after: 'vigil',
    ability: 'mend',
    form: { cool: 12000, effects: [{ kind: 'heal', share: 0.6 }] },
  },
}

/** How many points a hero of level `lvl` has: one for every level. */
export let pointsOf = (lvl: number): number => lvl

/** A skill a hero knows, and when they learned it. */
export type Learned = { skill: string; at: number }

/** What a hero knows, in the order they learned it: every `learned` row since
 * their last `respec`, in the order written, each counting only if the
 * skill is on the board, not already known, its `after` is known, and a
 * point is left for it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let rows = (...skills: string[]) => skills.map((skill, at) => ({ skill, at }))
 * let known = (...args: Parameters<typeof learnedOf>) =>
 *   learnedOf(...args).map((l) => l.skill)
 * assertEquals(known(rows('brawn', 'hide'), [], 5), ['brawn', 'hide'])
 * // Not before what it needs, not twice, not past the points.
 * assertEquals(known(rows('hide', 'brawn', 'brawn'), [], 5), ['brawn'])
 * assertEquals(known(rows('brawn', 'fleet', 'focus'), [], 2), ['brawn', 'fleet'])
 * // A respec forgets what came before it.
 * assertEquals(learnedOf(rows('brawn', 'fleet', 'focus'), [1.5], 5), [
 *   { skill: 'focus', at: 2 },
 * ])
 * ```
 */
export let learnedOf = (
  rows: Learned[],
  respecs: number[],
  lvl: number,
): Learned[] => {
  let since = Math.max(-Infinity, ...respecs)
  let known: Learned[] = []
  let ordered = rows.filter((r) => r.at > since).sort((a, b) =>
    a.at - b.at || (a.skill < b.skill ? -1 : 1)
  )
  for (let r of ordered) {
    let s = SKILLS[r.skill],
      has = (id: string) => known.some((k) => k.skill == id)
    if (!s || has(r.skill) || known.length >= pointsOf(lvl)) continue
    if (s.after && !has(s.after)) continue
    known.push({ skill: r.skill, at: r.at })
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
 * import { effect } from './ability-effects.ts'
 * import { seedAbilities } from './abilities_fixture.ts'
 * seedAbilities()
 * assertEquals(effect(formOf('mend', [])!.effects, 'heal')?.share, 0.3)
 * assertEquals(effect(formOf('mend', ['kindness'])!.effects, 'heal')?.share, 0.45)
 * assertEquals(effect(formOf('mend', ['kindness', 'aegis', 'vigil', 'sanctuary'])!.effects, 'heal')?.share, 0.6)
 * assertEquals(formOf('nothing', []), undefined)
 * ```
 */
export let formOf = (id: string, known: string[]): Ability | undefined => {
  let a = ABILITIES[id]
  if (!a) return undefined
  for (let k of known) {
    let s = SKILLS[k]
    if (s?.ability == id && s.form) {
      a = { ...a, ...s.form, effects: changed(a.effects, s.form.effects ?? []) }
    }
  }
  return a
}

/** A hero's kit with what their passives add: each passive whose `with`
 * holds the family of the weapon in hand, or that has none. `base` is the
 * health their level gives, for the passives that add a share of it.
 *
 * ```ts
 * import { seedItems } from './items_fixture.ts'
 * seedItems()
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
