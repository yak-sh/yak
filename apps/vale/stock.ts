// What the people of the vale hold and hand over, as plain functions over
// plain rows. Every villager keeps a stock: their land's coin and potion, a
// few things its creatures leave, and a couple of things of their own, finer
// than any rack holds. What they hand over fills again slowly, their own
// things slowest of all.
//
// A deal is what a villager promised a hero out of that stock, and for what:
// nothing, which is a gift; things to bring; creatures to fell. The villager's
// model writes it (vocab.json `give`), the hero's page hands it in once what
// it asks is done, and only then do things change hands. Whether a deal
// counts is decided here, never by the words that talked a villager into it:
// a villager promises only what it holds, and never more than the deal is
// worth. What a villager holds is counted from its deals and hand-ins in the
// order the store took them, so every page reaches the same answer.
import { tierOf } from './arms.ts'
import { BEASTS } from './beasts.ts'
import { isA } from './features.ts'
import { LODES } from './gather.ts'
import { RACK } from './gear.ts'
import { dens } from './homes.ts'
import { ITEMS } from './items.ts'
import { HOPS, LEVELS } from './levels.ts'
import type { Giver } from './quests.ts'
import { hashOf, stream } from './rand.ts'
import { SPOILS, worth } from './rules.ts'

let MIN = 60_000
let HOUR = 60 * MIN

/** How long a deal stands before what it promised goes back on the shelf. */
export let LAST = 2 * HOUR

/** How long a person waits for another gift from the same villager. */
export let GAP = 30 * MIN

/** How far a deal may pay over what it asks is worth. */
export let BAND = 1.5

/** Some goods: so many of each kind (items.ts), or of a creature to fell
 * (beasts.ts). */
export type Goods = { kind: string; n: number }[]

// Every word a kind goes by: its own, and its name.
let WORDS = new Map<string, string>(
  [...Object.entries(ITEMS), ...Object.entries(BEASTS)].flatMap((
    [kind, t],
  ) => [[kind, kind], [t.name.toLowerCase(), kind]]),
)

let kindOf = (word: string): string | null =>
  WORDS.get(word) ?? WORDS.get(word.replace(/s$/, '')) ??
    WORDS.get(word.replace(/es$/, '')) ??
    WORDS.get(word.replace(/ies$/, 'y')) ?? null

/**
 * Goods as a villager says them: parts split by commas or "and", each a count
 * and a kind, by its own word or its name. Nothing when any part names
 * nothing the vale has.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(goods('12 coins, a Mossberry tonic and 2 tusk'), [
 *   { kind: 'coin', n: 12 },
 *   { kind: 'tonic', n: 1 },
 *   { kind: 'tusk', n: 2 },
 * ])
 * assertEquals(goods('1 thornback'), [{ kind: 'thornback', n: 1 }])
 * assertEquals(goods(''), [])
 * assertEquals(goods('3 dragons'), null)
 * assertEquals(goods('-2 coin'), null)
 * ```
 */
export let goods = (text: string): Goods | null => {
  let out: Goods = []
  for (let part of text.toLowerCase().split(/,|;|\band\b|\+/)) {
    let words = part.trim().replace(/^(a|an|the|one)\s+/, '1 ')
    if (!words) continue
    let [, count, word] = /^(\d+)?\s*x?\s*(.+?)$/.exec(words) ?? []
    let kind = word ? kindOf(word.trim()) : null
    let n = count ? Number(count) : 1
    if (!kind || !(n >= 1)) return null
    let had = out.find((g) => g.kind == kind)
    if (had) had.n += n
    else out.push({ kind, n })
  }
  return out
}

/**
 * Goods in words a person reads.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(said([{ kind: 'coin', n: 12 }, { kind: 'tonic', n: 1 }]),
 *   '12 Coins, Mossberry tonic')
 * ```
 */
export let said = (g: Goods): string =>
  g.map(({ kind, n }) => {
    let name = ITEMS[kind]?.name ?? BEASTS[kind]?.name ?? kind
    return n == 1 ? name : `${n} ${name}s`
  }).join(', ')

let mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)

// What felling one creature of each tier's country teaches, on average: what
// a gathered thing of that tier is worth, and, over the odds of one falling, a
// piece of gear.
let KILL = [1, 2, 3, 4, 5].map((t) =>
  mean(
    Object.values(BEASTS).filter((b) => !b.boss && tierOf(b.lvl) == t)
      .map((b) => b.xp),
  )
)

// What each land's nodes give, by the tier of the node.
let GATHERED = new Map(Object.values(LODES).map((l) => [l.gives, l.tier]))

// What each kind that falls from a creature is worth: the least a hero
// spends, in xp of felling, until one falls to them.
let DROPS = new Map<string, number>()
for (let b of Object.values(BEASTS)) {
  for (let [kind, chance] of b.loot) {
    let each = kind == 'coin' ? (3 * b.lvl + 1) / 2 : 1
    let v = b.xp / (chance * each)
    if (!(v >= (DROPS.get(kind) ?? Infinity))) DROPS.set(kind, v)
  }
}

/**
 * What a thing is worth, in the xp a hero spends getting one: the least any
 * creature asks before it drops one, what a kill of its tier teaches for a
 * thing gathered, a piece of gear by its tier, and nothing for the plain arms
 * any village's rack gives away.
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * assertEquals(valueOf('sword1'), 0)
 * assert(valueOf('coin') < valueOf('jelly'))
 * assert(valueOf('ring1') < valueOf('ring2'))
 * assert(valueOf('oaklog') > 0)
 * ```
 */
export let valueOf = (kind: string): number => {
  let tier = GATHERED.get(kind) ?? ITEMS[kind]?.tier
  return RACK.includes(kind) ? 0 : DROPS.get(kind) ??
    (GATHERED.has(kind)
      ? KILL[tier! - 1]
      : tier
      ? KILL[tier - 1] / SPOILS
      : DROPS.get('coin')!)
}

/** A thing's worth in coins, as a villager haggles. */
export let priceOf = (kind: string): number =>
  Math.round(valueOf(kind) / valueOf('coin'))

/** The level a hero of a land is about, which is what a deed there is worth
 * to: the lands climb two creature levels a road from home. */
export let lvlOf = (level: string): number => 2 * (HOPS[level] ?? 0) + 2

// The kinds of creature a land grows.
let bred = (level: string): string[] =>
  LEVELS[level] ? [...new Set(dens(LEVELS[level]).map((d) => d.kind))] : []

// What a land yields: what its creatures leave and its nodes give, bar coin,
// potions and gear.
let yields = (level: string): string[] => {
  let hops = HOPS[level] ?? 0
  let places = Object.values(LEVELS[level]?.places ?? {})
  let gathered = Object.values(LODES).filter((l) =>
    hops >= l.hops[0] && hops <= l.hops[1] &&
    places.some((p) => l.near.some((near) => isA(p.kind, near)))
  ).map((l) => l.gives)
  return [
    ...new Set([
      ...bred(level).flatMap((k) => BEASTS[k].loot.map(([kind]) => kind)),
      ...gathered,
    ]),
  ].filter((k) => k != 'coin' && !ITEMS[k]?.slot && !ITEMS[k]?.heals)
}

// What each land's creatures teach, on average: a gift's measure.
let taught = (level: string) =>
  mean(
    bred(level).map((k) => BEASTS[k]).filter((b) => !b.boss).map((b) => b.xp),
  )

/** The most a gift from a villager of a land is worth: about what eight of
 * its creatures teach. */
export let most = (level: string): number => 8 * taught(level)

/**
 * What goods are worth: things by what getting them costs, creatures by what
 * felling them teaches a hero of the villager's land (rules.ts `worth`).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(worthOf([{ kind: 'slime', n: 2 }], 'mossvale'), 2 * 11)
 * ```
 */
export let worthOf = (g: Goods, level: string): number =>
  g.reduce(
    (sum, { kind, n }) =>
      sum + n * (BEASTS[kind]
          ? worth(BEASTS[kind].xp, BEASTS[kind].lvl, lvlOf(level))
          : valueOf(kind)),
    0,
  )

/** One shelf of a villager's stock: a kind, the most of it they keep, how
 * long each one takes to come back, in ms, and whether it is their own. */
export type Shelf = { kind: string; most: number; every: number; own?: boolean }

let POTIONS = ['tonic', 'tonic', 'draught', 'draught', 'elixir']
let FAMILIES = ['sword', 'axe', 'hammer', 'dagger', 'bow', 'staff']

/**
 * What a villager keeps: their land's coin and potion, two things it yields,
 * and their own things, a weapon a tier finer than their land's rack (their
 * staff, if they lean on one) and a ring. The same on every page, since it
 * is only their row of GIVERS.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { GIVERS } from './quests.ts'
 * let wren = GIVERS.find((g) => g.id == 'wren')!
 * assertEquals(stockOf(wren).filter((s) => s.own).map((s) => s.kind), [
 *   'staff2',
 *   'ring1',
 * ])
 * ```
 */
export let stockOf = (g: Giver): Shelf[] => {
  let t = tierOf(lvlOf(g.level))
  let r = stream(hashOf(`stock/${g.id}`))
  let left = yields(g.level)
  let pick = () => left.splice(Math.floor(r() * left.length), 1)
  let family = g.staff ? 'staff' : FAMILIES[Math.floor(r() * FAMILIES.length)]
  return [
    { kind: 'coin', most: 20 * t, every: 3 * MIN / t },
    { kind: POTIONS[t - 1], most: 2, every: 40 * MIN },
    ...[...pick(), ...pick()].map((kind) => ({
      kind,
      most: 4,
      every: 20 * MIN,
    })),
    ...[`${family}${Math.min(5, t + 1)}`, `ring${t}`].map((kind) => ({
      kind,
      most: 1,
      every: 48 * HOUR,
      own: true,
    })),
  ]
}

/** A deal as the store holds it: the villager's row, the hero's, what the
 * villager gives and what for, in words (`goods`), who wrote it and when the
 * store took it, in ms. */
export type Deal = {
  eid: string
  player: string
  give: string
  take: string
  by: string
  at: number
}

/** A deal handed in: which, by which hero, who wrote it, and when. */
export type Hand = {
  eid: string
  deal: string
  player: string
  by: string
  at: number
}

/** What became of a deal: never counted, standing, handed in, or gone back
 * (lapsed, or replaced by a newer one to the same hero). */
export type State = 'void' | 'open' | 'done' | 'gone'

/** What a villager's rows come to at a moment: each deal's state, what each
 * counted deal promised and asked, what the villager holds free to promise,
 * by kind, and what they have set aside for deals still standing. */
export type Book = {
  states: Map<string, State>
  terms: Map<string, { give: Goods; take: Goods }>
  holds: Map<string, number>
  aside: Map<string, number>
}

type Event =
  | { at: number; eid: string; deal: Deal }
  | { at: number; eid: string; hand: Hand }
  | { at: number; eid: string; lapse: Deal }

let rank = (e: Event) => 'deal' in e ? 0 : 'hand' in e ? 1 : 2

let order = (a: Event, b: Event) =>
  a.at - b.at || rank(a) - rank(b) || (a.eid < b.eid ? -1 : +(a.eid > b.eid))

/**
 * What a villager's deals and hand-ins come to at `now`, taken in the order
 * the store took them. A deal counts only if the villager held what it gives
 * when it was made; a gift only if it is small, none of their own things, and
 * the person's first from them in a while; any other deal only if it asks for
 * what the land has and pays no more than half again what that is worth.
 * What a counted deal gives is set aside at once, still theirs, so it does
 * not come back on the shelf; a hand-in by the hero's own person passes it
 * over, and takes what was brought; a deal left standing lapses, or gives way
 * to a newer one to the same hero, and what it set aside is free again.
 * `owner` names who made a hero.
 */
export let ledger = (
  g: Giver,
  deals: Deal[],
  hands: Hand[],
  owner: (hero: string) => string | null,
  now: number,
): Book => {
  let shelves = new Map(stockOf(g).map((s) => [s.kind, s]))
  let held = new Map([...shelves].map(([k, s]) => [k, s.most]))
  let aside = new Map<string, number>()
  let t0 = -Infinity
  let fill = (t: number) => {
    for (let [kind, s] of shelves) {
      let l = held.get(kind) ?? 0
      if (l < s.most) held.set(kind, Math.min(s.most, l + (t - t0) / s.every))
    }
    t0 = t
  }
  let add = (to: Map<string, number>, goods: Goods, sign: number) => {
    for (let { kind, n } of goods) {
      if (!BEASTS[kind]) to.set(kind, (to.get(kind) ?? 0) + sign * n)
    }
  }
  let free = (kind: string) =>
    Math.floor(held.get(kind) ?? 0) - (aside.get(kind) ?? 0)
  let land = new Set(bred(g.level))
  let byEid = new Map(deals.map((d) => [d.eid, d]))
  let states = new Map<string, State>()
  let terms = new Map<string, { give: Goods; take: Goods }>()
  let standing = new Map<string, Deal>()
  let gifted = new Map<string, number>()
  let back = (d: Deal) => {
    states.set(d.eid, 'gone')
    add(aside, terms.get(d.eid)!.give, -1)
  }
  // Whether a deal is one the villager would make, whatever they hold.
  let fair = (d: Deal, give: Goods, take: Goods) =>
    !take.length
      ? worthOf(give, g.level) <= most(g.level) &&
        give.every((x) => !shelves.get(x.kind)?.own) &&
        !(d.at - (gifted.get(d.by) ?? -Infinity) < GAP)
      : take.every((x) => !BEASTS[x.kind] || land.has(x.kind)) &&
        worthOf(give, g.level) <= BAND * worthOf(take, g.level)
  let events: Event[] = [
    ...deals.map((d) => ({ at: d.at, eid: d.eid, deal: d })),
    ...hands.map((h) => ({ at: h.at, eid: h.eid, hand: h })),
    ...deals.map((d) => ({ at: d.at + LAST, eid: d.eid, lapse: d })),
  ].filter((e) => e.at <= now).sort(order)
  for (let e of events) {
    fill(e.at)
    if ('deal' in e) {
      let d = e.deal, give = goods(d.give), take = goods(d.take)
      if (
        !give?.length || !take || !fair(d, give, take) ||
        !give.every((x) => free(x.kind) >= x.n)
      ) {
        states.set(d.eid, 'void')
        continue
      }
      states.set(d.eid, 'open')
      terms.set(d.eid, { give, take })
      add(aside, give, 1)
      if (!take.length) gifted.set(d.by, d.at)
      else {
        let was = standing.get(d.player)
        if (was && states.get(was.eid) == 'open') back(was)
        standing.set(d.player, d)
      }
    } else if ('hand' in e) {
      let h = e.hand, d = byEid.get(h.deal)
      if (
        !d || states.get(d.eid) != 'open' || h.player != d.player ||
        h.by != owner(d.player)
      ) continue
      let { give, take } = terms.get(d.eid)!
      states.set(d.eid, 'done')
      add(aside, give, -1)
      add(held, give, -1)
      add(held, take, 1)
    } else if (states.get(e.lapse.eid) == 'open') back(e.lapse)
  }
  fill(Math.max(now, t0))
  let holds = new Map(
    [...held.keys()].map((k) => [k, free(k)] as [string, number])
      .filter(([, n]) => n > 0),
  )
  for (let [k, n] of aside) if (!n) aside.delete(k)
  return { states, terms, holds, aside }
}
