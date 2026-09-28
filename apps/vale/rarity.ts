// How fine a piece of gear is: common, uncommon, rare, epic or legendary. A
// finer piece's own numbers are a little better, and it rolls bonuses of its
// own, more and bigger the rarer it is: harder or quicker blows, great blows,
// health, armour, speed. A legendary has a name and a power no other piece
// has. What a piece rolled comes from its own eid, so every page works out
// the same numbers from the same row. Its rarity and item level are kept on
// the item row; older rows without them are common and start at their tier's
// first level.
//
// Which rarity a piece is comes from where it came from: a fall, likelier
// fine the higher the creature's level and finer still from a boss
// (`dropped`), or a hero's own hands at a station, likelier fine the further
// their trade is past what the recipe asks (`made`).
import { type Slot, tierRange } from './arms.ts'
import type { Glyph } from './glyphs.ts'
import { ITEMS, type Thing } from './items.ts'
import { hashOf, stream } from './rand.ts'

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

/** Every rarity, the humblest first. */
export let RARITIES: Rarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
]

/** Each rarity: what it is called, how many bonuses a piece of it rolls and
 * how big against an uncommon's, how much finer its own numbers are, and the
 * light it gives off in the world. */
export let GRADES: Record<
  Rarity,
  { name: string; rolls: number; big: number; fine: number; light: number }
> = {
  common: { name: 'Common', rolls: 0, big: 0, fine: 1, light: 0xffe08a },
  uncommon: {
    name: 'Uncommon',
    rolls: 1,
    big: 1,
    fine: 1.06,
    light: 0x6ee05a,
  },
  rare: { name: 'Rare', rolls: 2, big: 1.25, fine: 1.12, light: 0x5a9aff },
  epic: { name: 'Epic', rolls: 3, big: 1.5, fine: 1.2, light: 0xc070ff },
  legendary: {
    name: 'Legendary',
    rolls: 3,
    big: 1.8,
    fine: 1.3,
    light: 0xff7010,
  },
}

/** A rarity from what a row says: anything else is common.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([rarityOf('epic'), rarityOf(''), rarityOf('mythic')], [
 *   'epic',
 *   'common',
 *   'common',
 * ])
 * ```
 */
export let rarityOf = (s: unknown): Rarity =>
  RARITIES.find((r) => r == s) ?? 'common'

// How likely each rarity is, the humblest first, from a creature of the first
// level or a hero new to a recipe (`LOW`), and from one of the last (`HIGH`);
// and how much likelier each is from a boss, which never leaves a common one.
let LOW = [100, 28, 8, 2.2, 0.7]
let HIGH = [100, 45, 22, 9, 4]
let BOSS = [0, 1, 1, 2, 3]

/** How likely each rarity is, the humblest first: `q`, from 0 to 1, is how
 * far along its source is, a creature's level or a hero's trade. A boss
 * never leaves a common piece, and leaves epics and legendaries far more
 * often; `find` makes every finer rarity likelier by that share.
 *
 * ```ts
 * import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
 * let sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
 * assertAlmostEquals(sum(oddsOf(0.5)), 1)
 * // Finer things come from further out, from bosses, and with a find.
 * assert(oddsOf(1)[4] > 3 * oddsOf(0)[4])
 * assertEquals(oddsOf(0, true)[0], 0)
 * assert(oddsOf(0, true)[4] > 5 * oddsOf(0)[4])
 * assert(oddsOf(0, false, 0.5)[3] > oddsOf(0)[3])
 * ```
 */
export let oddsOf = (q: number, boss = false, find = 0): number[] => {
  let k = Math.max(0, Math.min(1, q))
  let w = LOW.map((a, i) =>
    (a + (HIGH[i] - a) * k) * (boss ? BOSS[i] : 1) * (i ? 1 + find : 1)
  )
  let sum = w.reduce((a, b) => a + b, 0)
  return w.map((n) => n / sum)
}

/** The rarity a number `r` in [0, 1) lands on, given the odds of each.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let odds = [0.5, 0.3, 0.1, 0.07, 0.03]
 * assertEquals([0, 0.49, 0.5, 0.85, 0.99].map((r) => pick(odds, r)), [
 *   'common',
 *   'common',
 *   'uncommon',
 *   'rare',
 *   'legendary',
 * ])
 * ```
 */
export let pick = (odds: number[], r: number): Rarity => {
  let i = 0, acc = odds[0]
  while (r >= acc && i < odds.length - 1) acc += odds[++i]
  return RARITIES[i]
}

/** The rarity of a piece a creature of level `lvl` leaves, `r` in [0, 1).
 *
 * Over many falls, each rarity comes about as often as its odds say.
 *
 * ```ts
 * import { assertAlmostEquals } from '@std/assert'
 * import { stream } from './rand.ts'
 * let r = stream(7), n = 10000
 * let seen = Object.fromEntries(RARITIES.map((x) => [x, 0]))
 * for (let i = 0; i < n; i++) seen[dropped(r(), 12)]++
 * let odds = oddsOf(11 / 59)
 * RARITIES.forEach((x, i) =>
 *   assertAlmostEquals(seen[x] / n, odds[i], 0.006 + odds[i] * 0.08)
 * )
 * ```
 */
export let dropped = (r: number, lvl: number, boss = false, find = 0) =>
  pick(oddsOf((lvl - 1) / 59, boss, find), r)

/** The rarity of a piece made by a hero whose trade is at `lvl`, following
 * a recipe that asks `least` of it: likelier fine the further past it they
 * are, a dozen levels past it as fine as what the last lands leave.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * import { stream } from './rand.ts'
 * let fine = (lvl: number) => {
 *   let r = stream(3), n = 0
 *   for (let i = 0; i < 5000; i++) n += +(made(r(), lvl, 1) != 'common')
 *   return n
 * }
 * assert(fine(13) > fine(1) * 1.4)
 * ```
 */
export let made = (r: number, lvl: number, least: number) =>
  pick(oddsOf((lvl - least) / 12), r)

/** A number a bonus adds to. */
export type Stat = 'force' | 'luck' | 'hp' | 'armour' | 'speed' | 'haste'

/** Every number a bonus adds to. */
export let STATS: Stat[] = ['force', 'luck', 'hp', 'armour', 'speed', 'haste']

/** Each bonus a piece may roll: its slots, size, rounding, and the words it
 * adds to the piece's name. Display names and units live in compare.ts. */
export let BONUSES: Record<Stat, {
  on: Slot[]
  most: (t: number) => number
  whole?: boolean
  before: string
  after: string
}> = {
  force: {
    on: ['main', 'off', 'head', 'body', 'feet', 'trinket'],
    most: (t) => 0.02 + 0.01 * t,
    before: 'Fierce',
    after: 'of Might',
  },
  luck: {
    on: ['main', 'off', 'head', 'body', 'feet', 'trinket'],
    most: (t) => 0.015 + 0.005 * t,
    before: 'Lucky',
    after: 'of Fortune',
  },
  hp: {
    on: ['main', 'off', 'head', 'body', 'feet', 'trinket'],
    most: (t) => 4 + 4 * t,
    whole: true,
    before: 'Stout',
    after: 'of Vigour',
  },
  armour: {
    on: ['off', 'head', 'body', 'feet', 'trinket'],
    most: (t) => 1 + 0.6 * t,
    whole: true,
    before: 'Sturdy',
    after: 'of Warding',
  },
  speed: {
    on: ['body', 'feet', 'trinket'],
    most: (t) => 0.02 + 0.006 * t,
    before: 'Fleet',
    after: 'of the Hare',
  },
  haste: {
    on: ['main', 'off', 'trinket'],
    most: (t) => 0.02 + 0.008 * t,
    before: 'Quick',
    after: 'of Haste',
  },
}

/** A legendary's power: it mends by a share of every blow (`leech`), bites
 * back a share of every bite (`thorns`), holds a foe still for so many ms
 * with a great blow (`hold`), strikes twice this often (`echo`), sets the foe
 * burning for a share of a blow (`burn`), makes finer loot likelier
 * (`find`), wards a share of health once a minute when it falls under a
 * third (`rally`), or mends a share of health with each bite rolled clear of
 * (`dodge`). */
export type Power =
  | 'leech'
  | 'thorns'
  | 'hold'
  | 'echo'
  | 'burn'
  | 'find'
  | 'rally'
  | 'dodge'

/** How much of each power a piece or a hero has. */
export type Powers = Partial<Record<Power, number>>

/** Every power. */
export let POWERS: Power[] = [
  'leech',
  'thorns',
  'hold',
  'echo',
  'burn',
  'find',
  'rally',
  'dodge',
]

/** A legendary: its name, the families of arms and the slots of armour it
 * comes as, its power, and what that does, with a glyph. */
export type Legend = {
  name: string
  on: string[]
  powers: Powers
  says: string
  icon: Glyph
}

/** Every legendary, by id. */
export let LEGENDS: Record<string, Legend> = {
  dawnbreaker: {
    name: 'Dawnbreaker',
    on: ['sword', 'axe', 'hammer'],
    powers: { hold: 1200 },
    says: 'Great blows hold the foe still.',
    icon: 'zap',
  },
  redthirst: {
    name: 'Redthirst',
    on: ['sword', 'axe', 'dagger', 'body'],
    powers: { leech: 0.08 },
    says: 'Every blow mends you by a share of it.',
    icon: 'droplet',
  },
  emberfang: {
    name: 'Emberfang',
    on: ['axe', 'hammer', 'dagger', 'bow', 'staff', 'torch'],
    powers: { burn: 0.25 },
    says: 'Blows set the foe burning.',
    icon: 'flame',
  },
  twinwind: {
    name: 'Twinwind',
    on: ['bow', 'staff', 'dagger', 'trinket'],
    powers: { echo: 0.25 },
    says: 'One blow in four strikes twice.',
    icon: 'tornado',
  },
  thornwall: {
    name: 'Thornwall',
    on: ['shield', 'body'],
    powers: { thorns: 0.6 },
    says: 'What bites you takes most of it back.',
    icon: 'shield',
  },
  lastpage: {
    name: 'The Last Page',
    on: ['tome', 'head'],
    powers: { rally: 0.3 },
    says: 'Falling under a third of your health wards you, once a minute.',
    icon: 'shieldPlus',
  },
  windstride: {
    name: 'Windstride',
    on: ['feet'],
    powers: { dodge: 0.08 },
    says: 'Rolling clear of a bite mends you.',
    icon: 'wind',
  },
  grin: {
    name: "Goblin's Grin",
    on: ['trinket', 'torch', 'head'],
    powers: { find: 0.6 },
    says: 'What you fell leaves finer things.',
    icon: 'sparkles',
  },
}

/** A piece as it rolled: its kind's numbers, finer by its rarity and by
 * every upgrade (`plus`), the bonuses it rolled folded into them, and, for a
 * legendary, its legend. */
export type Piece = Thing & {
  eid: string
  kind: string
  rarity: Rarity
  /** the level needed to wear it; absent for things that are not gear */
  lvl?: number
  /** how many times it was upgraded (upgrade.ts) */
  plus: number
  /** the bonuses it rolled, each its stat and how much */
  bonuses: [Stat, number][]
  legend?: Legend
}

let two = (n: number) => Math.round(n * 100) / 100
let three = (n: number) => Math.round(n * 1000) / 1000
let lower = (s: string) => s[0].toLowerCase() + s.slice(1)

/** An item level rolled from a new gear row's eid, within its tier. */
export let itemLevel = (eid: string, kind: string): number | undefined => {
  let t = ITEMS[kind]
  if (!t?.slot || !t.tier) return undefined
  let [lo, hi] = tierRange(t.tier)
  return lo + Math.floor(stream(hashOf(eid))() * (hi - lo + 1))
}

// A piece's roll, from its eid: its own numbers, its bonuses, its name.
let roll = (
  eid: string,
  kind: string,
  rarity: Rarity,
  r = stream(hashOf(eid)),
): Piece => {
  let t: Thing = ITEMS[kind] ?? { name: kind, look: [] }
  let slot = t.slot
  if (!slot || rarity == 'common') {
    return { ...t, eid, kind, rarity: 'common', plus: 0, bonuses: [] }
  }
  let g = GRADES[rarity], tier = t.tier ?? 1
  let p: Piece = { ...t, eid, kind, rarity, plus: 0, bonuses: [] }
  let fine = g.fine * (0.96 + 0.08 * r())
  if (t.dmg) p.dmg = two(t.dmg * fine)
  if (t.armour) p.armour = Math.round(t.armour * fine)
  if (t.hp) p.hp = Math.round(t.hp * fine)
  let pool = STATS.filter((s) => BONUSES[s].on.includes(slot))
  for (let i = 0; i < g.rolls && pool.length; i++) {
    let stat = pool.splice(Math.floor(r() * pool.length), 1)[0]
    let b = BONUSES[stat]
    let n = b.most(tier) * g.big * (0.5 + 0.5 * r())
    n = b.whole ? Math.max(1, Math.round(n)) : two(n)
    p.bonuses.push([stat, n])
    p[stat] = two((p[stat] ?? 0) + n)
  }
  let [a, b] = p.bonuses.map(([s]) => BONUSES[s])
  p.name = b
    ? `${b.before} ${lower(t.name)} ${a.after}`
    : `${t.name} ${a.after}`
  if (rarity == 'legendary') {
    let fits = Object.values(LEGENDS).filter((l) =>
      l.on.includes(t.family ?? slot)
    )
    p.legend = fits[Math.floor(r() * fits.length)]
    if (p.legend) p.name = p.legend.name
  }
  return p
}

// Level refines a kind's numbers within its material tier. The first level
// keeps the numbers older item rows already had.
let levelled = (p: Piece, lvl?: number): Piece => {
  if (!p.slot || !p.tier) return p
  let [lo, hi] = tierRange(p.tier)
  let at = Math.max(lo, Math.min(hi, Math.floor(lvl ?? lo)))
  let k = 1 + 0.2 * (at - lo) / (hi - lo)
  let q: Piece = { ...p, lvl: at, bonuses: [...p.bonuses] }
  if (p.dmg) q.dmg = two(p.dmg * k)
  for (let s of STATS) {
    let n = p[s]
    if (n) q[s] = s == 'hp' ? Math.round(n * k) : two(n * k)
  }
  q.bonuses = p.bonuses.map((
    [s, n],
  ) => [s, s == 'hp' ? Math.round(n * k) : two(n * k)])
  return q
}

/** Bounds for each number a newly made piece can roll. The high ends are
 * calculated independently; one piece cannot necessarily reach them all. */
export let GEAR_STATS: (Stat | 'dmg')[] = ['dmg', ...STATS]
export let statRange = (
  kind: string,
): Partial<Record<Stat | 'dmg', [number, number]>> => {
  let t = ITEMS[kind]
  if (!t?.slot || !t.tier) return {}
  let [lo, hi] = tierRange(t.tier)
  let low = levelled(roll('preview', kind, 'common'), lo)
  let slot = t.slot
  let pool = STATS.filter((s) => BONUSES[s].on.includes(slot))
  let high = (stat: Stat | 'dmg') => {
    let calls = 0
    let r = () => {
      calls++
      return calls == 2 && stat != 'dmg' && pool.includes(stat)
        ? (pool.indexOf(stat) + 0.5) / pool.length
        : 1 - Number.EPSILON
    }
    return levelled(roll('preview', kind, 'legendary', r), hi)
  }
  return Object.fromEntries(GEAR_STATS.flatMap((s) => {
    let a = low[s] ?? 0, b = high(s)[s] ?? 0
    return a || b ? [[s, [a, b]]] : []
  }))
}

/** An older upgrade's gain; new rows keep their own gain. */
export let UP = 0.1
export let UP_MIN = 0.08
export let UP_MAX = 0.12

/** A saved upgrade row's gain, rolled once from its eid. */
export let upgradeGain = (eid: string): number => {
  let steps = Math.round((UP_MAX - UP_MIN) * 100) + 1
  return (Math.round(UP_MIN * 100) +
    Math.floor(stream(hashOf(eid))() * steps)) / 100
}

// A piece upgraded `plus` times: every number and rolled bonus grows by its
// saved gains. Older rows keep their tenth per step and their old rounding.
// Small numbers get finer precision on new rolls so both ends can be seen.
let hone = (p: Piece, plus: number, gain?: number): Piece => {
  if (!plus || !p.slot) return p
  let k = 1 + (gain ?? UP * plus)
  let round = (s: Stat, n: number) =>
    gain == null
      ? BONUSES[s].whole ? Math.round(n) : two(n)
      : s == 'hp'
      ? Math.round(n)
      : s == 'armour'
      ? two(n)
      : three(n)
  let finer = (s: Stat, n: number) => round(s, n * k)
  let top =
    STATS.filter((s) => p[s]).sort((a, b) =>
      Number(!!BONUSES[b].whole) - Number(!!BONUSES[a].whole) ||
      (p[b] ?? 0) - (p[a] ?? 0)
    )[0]
  let point = (s: Stat) =>
    gain == null ? BONUSES[s].whole ? 1 : 0.01 : s == 'hp' ? 1 : 0.001
  let q: Piece = {
    ...p,
    plus,
    name: `+${plus} ${p.name}`,
    bonuses: p.bonuses.map(([s, n]) => [s, finer(s, n)]),
  }
  if (p.dmg) q.dmg = two(p.dmg * k)
  for (let s of STATS) {
    let n = p[s]
    if (n) {
      q[s] = s == top
        ? Math.max(
          finer(s, n),
          gain == null
            ? two(n + point(s) * plus)
            : round(s, n + point(s) * plus),
        )
        : finer(s, n)
    }
  }
  return q
}

let rolled = new Map<string, Piece>()

/** A piece of gear as it rolled, from its item row, and as far as it was
 * upgraded: the same eid always rolls the same, and a common piece, or a
 * thing that is not gear, is its kind as items.ts has it.
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * import { ITEMS } from './items.ts'
 * let p = (rarity: Rarity, eid = 'e1', kind = 'sword3') =>
 *   piece({ eid, kind, rarity })
 * assertEquals(p('epic').bonuses, p('epic').bonuses)
 * assertEquals(p('common').dmg, ITEMS.sword3.dmg)
 * assertEquals(p('common').name, 'Steel sword')
 * // Rarer rolls more bonuses, and a finer blade.
 * assertEquals(RARITIES.map((r) => p(r).bonuses.length), [0, 1, 2, 3, 3])
 * assert(p('legendary').dmg! > p('uncommon').dmg!)
 * // A legendary has a name and a power.
 * let l = p('legendary')
 * assertEquals(l.name, l.legend!.name)
 * assert(Object.keys(l.legend!.powers).length == 1)
 * // Two pieces of one kind and rarity roll their own.
 * let many = new Set(['a', 'b', 'c', 'd'].map((e) => p('rare', e).name))
 * assert(many.size > 1)
 * // A tonic has no rarity to roll.
 * assertEquals(p('epic', 'e2', 'tonic').rarity, 'common')
 * // Each upgrade makes it finer, and its name counts them.
 * let up = piece({ eid: 'e1', kind: 'sword3', rarity: 'epic', plus: 2 })
 * assertEquals(up.name, `+2 ${p('epic').name}`)
 * assert(up.dmg! > p('epic').dmg! && up.bonuses[0][1] >= p('epic').bonuses[0][1])
 * // Every step changes what the piece shows: a number too small for a
 * // tenth of it to show rises a point.
 * let robe = (plus: number) => piece({ eid: 'e1', kind: 'robe3', plus }).hp
 * assertEquals([0, 1, 2, 3, 4, 5].map(robe), [6, 7, 8, 9, 10, 11])
 * let shown = (p: Piece) => STATS.map((s) => p[s] ?? 0)
 * for (let kind of Object.keys(ITEMS).filter((k) => ITEMS[k].slot)) {
 *   for (let rarity of RARITIES) {
 *     let at = (plus: number) => piece({ eid: 'e3', kind, rarity, plus })
 *     for (let n = 1; n <= 5; n++) {
 *       let [a, b] = [at(n - 1), at(n)]
 *       let moved = shown(a).some((x, i) => x != shown(b)[i])
 *       assert(a.dmg != b.dmg || moved, `${kind} ${rarity} +${n}`)
 *     }
 *   }
 * }
 * ```
 */
export type PieceRow = {
  eid: string
  kind: string
  rarity?: Rarity
  lvl?: number
  plus?: number
  /** combined gain from upgraded rows; absent means legacy +10% steps */
  gain?: number
}

export let piece = (h: PieceRow): Piece => {
  let rarity = h.rarity ?? 'common', plus = h.plus ?? 0
  let key = `${h.eid}:${h.kind}:${rarity}:${h.lvl ?? ''}:${plus}:${
    h.gain ?? ''
  }`
  let p = rolled.get(key)
  if (!p) {
    p = hone(levelled(roll(h.eid, h.kind, rarity), h.lvl), plus, h.gain)
    rolled.set(key, p)
  }
  return p
}

/** The least and most that the next upgrade can make of this piece. */
export let upgradeRange = (h: PieceRow): [PieceRow, PieceRow] => {
  let plus = h.plus ?? 0, gain = h.gain ?? UP * plus
  let at = (roll: number): PieceRow => ({
    ...h,
    plus: plus + 1,
    gain: gain + roll,
  })
  return [at(UP_MIN), at(UP_MAX)]
}

/** The class the glass marks a piece of rarity `r` with (ui/Rarity.css):
 * none for a common one. */
export let tint = (r: Rarity = 'common'): string =>
  r == 'common' ? '' : `Rarity-${r}`
