// What the people of the vale hold and hand over, as plain functions over
// plain rows. Every villager keeps a stock: their land's coin and potion, a
// few things its creatures leave, and a couple of things of their own, finer
// than any rack holds. What they hand over fills again slowly, their own
// things slowest of all.
//
// A deal is what a villager promised a hero out of that stock, and for what:
// nothing, which is a gift; things from the hero's bag; creatures of the land
// to fell, a quest of their own making. The villager's model writes it
// (vocab.json `give` and `offer`); the hero agrees to it, and hands it in once
// every step it asks is done, and only then do things change hands. Whether a
// deal counts is decided here, never by the words that talked a villager into
// it: a villager promises only what it holds, asks only what its land has,
// and never gives much more than what it asks is worth. What a villager holds
// is counted from its deals and the heroes' replies in the order the store
// took them, so every page reaches the same answer.
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
import { RARITIES } from './rarity.ts'
import { type Held, SPOILS, worth } from './rules.ts'

let MIN = 60_000
let HOUR = 60 * MIN

/** How long an offer stands before what it promised goes back on the
 * shelf, unless the hero agrees to it. */
export let OFFER = 15 * MIN

/** How long a deal a hero agreed to stands. */
export let LAST = 24 * HOUR

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

// What a land's creatures leave, and what its nodes give.
let found = (level: string): string[] => {
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
  ]
}

// What a land yields: what it gives, bar coin, potions and gear.
let yields = (level: string): string[] =>
  found(level).filter((k) => k != 'coin' && !ITEMS[k]?.slot && !ITEMS[k]?.heals)

let POTIONS = ['tonic', 'tonic', 'draught', 'draught', 'elixir']

// The potion a land's villagers keep.
let potion = (level: string) => POTIONS[tierOf(lvlOf(level)) - 1]

let WARES = new Map<string, Set<string>>()

/**
 * What a deal in a land may ask for: its creatures to fell, and what a hero
 * comes by there: what its creatures leave, the gear of their tiers, what its
 * nodes give, coin and its potion.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * let vale = wares('mossvale')
 * assert(vale.has('thornback') && vale.has('tusk') && vale.has('sword2'))
 * assert(!vale.has('frostwolf') && !vale.has('pearl'))
 * ```
 */
export let wares = (level: string): Set<string> => {
  let had = WARES.get(level)
  if (had) return had
  let tiers = new Set(bred(level).map((k) => tierOf(BEASTS[k].lvl)))
  let gear = Object.keys(ITEMS).filter((k) =>
    ITEMS[k].slot && tiers.has(ITEMS[k].tier ?? 0)
  )
  let all = new Set([
    ...bred(level),
    ...found(level),
    ...gear,
    'coin',
    potion(level),
  ])
  WARES.set(level, all)
  return all
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

/** What one of a kind is worth in a land, in coin: a thing by its price, a
 * creature by what felling it teaches a hero there. */
export let priceIn = (kind: string, level: string): number =>
  Math.round(worthOf([{ kind, n: 1 }], level) / valueOf('coin'))

/** What a deal in a land is likeliest to ask for, dearest first: its
 * creatures worth felling, the things it yields and its potion, and the
 * tiers of the gear its creatures leave. */
export let wants = (level: string, most = 6) => {
  let dear = (kinds: string[]) =>
    kinds.map((kind) => ({ kind, price: priceIn(kind, level) }))
      .filter((w) => w.price > 0).sort((a, b) => b.price - a.price)
      .slice(0, most)
  return {
    creatures: dear(bred(level)),
    things: dear([...yields(level), potion(level)]),
    tiers: [...new Set(bred(level).map((k) => tierOf(BEASTS[k].lvl)))].sort(),
  }
}

/** One shelf of a villager's stock: a kind, the most of it they keep, how
 * long each one takes to come back, in ms, and whether it is their own. */
export type Shelf = { kind: string; most: number; every: number; own?: boolean }

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
    { kind: potion(g.level), most: 2, every: 40 * MIN },
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
 * villager gives and what for, in words (`goods`), who wrote it, what it came
 * through (the transcript of the turn whose command wrote it, which the store
 * stamps and no page can) and when the store took it, in ms. */
export type Deal = {
  eid: string
  villager: string
  player: string
  give: string
  take: string
  by: string
  via: string
  at: number
}

/** A hero's reply to a deal, written by their page: they agreed to it, or
 * handed it in; who wrote it, and when. */
export type Reply = {
  eid: string
  deal: string
  player: string
  did: 'agreed' | 'handed'
  by: string
  at: number
}

/** What became of a deal: never counted, standing, agreed to, handed in, or
 * gone back (lapsed, or replaced by a newer offer to the same hero). */
export type State = 'void' | 'open' | 'taken' | 'done' | 'gone'

/** What a villager's rows come to at a moment: each deal's state, what each
 * counted deal promised and asked, when the hero agreed to each they took
 * up, why each that never counted did not, what the villager holds free to
 * promise, by kind, and what they have set aside for deals still standing. */
export type Book = {
  states: Map<string, State>
  terms: Map<string, { give: Goods; take: Goods }>
  since: Map<string, number>
  why: Map<string, string>
  holds: Map<string, number>
  aside: Map<string, number>
}

type Event =
  | { at: number; eid: string; deal: Deal }
  | { at: number; eid: string; reply: Reply }
  | { at: number; eid: string; lapse: Deal; from: State; since?: number }

let rank = (e: Event) =>
  'deal' in e ? 0 : 'reply' in e ? (e.reply.did == 'agreed' ? 1 : 2) : 3

let order = (a: Event, b: Event) =>
  a.at - b.at || rank(a) - rank(b) || (a.eid < b.eid ? -1 : +(a.eid > b.eid))

/**
 * What a villager's deals and the heroes' replies come to at `now`, taken
 * in the order the store took them. A deal counts only if the villager made
 * it, in a turn of their own, and held what it gives when they made it; a
 * gift only if it is small, none of their
 * own things, and the person's first from them in a while; any other deal
 * only if it asks for what the land has and gives no more than half again
 * what that is worth. What a counted deal gives is set aside at once, still
 * theirs, so it does not come back on the shelf. The hero's own person
 * agrees to a deal, which then stands a while, or hands it in, which passes
 * what it gives over and takes what was brought; an offer nobody agreed to
 * lapses soon, or gives way to a newer one to the same hero, and what a deal
 * set aside is free again once it is gone. `owner` names who made a hero.
 */
export let ledger = (
  g: Giver,
  deals: Deal[],
  replies: Reply[],
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
  let has = wares(g.level)
  let byEid = new Map(deals.map((d) => [d.eid, d]))
  let states = new Map<string, State>()
  let terms = new Map<string, { give: Goods; take: Goods }>()
  let since = new Map<string, number>()
  let why = new Map<string, string>()
  let offered = new Map<string, string>()
  let gifted = new Map<string, number>()
  let back = (d: Deal) => {
    states.set(d.eid, 'gone')
    add(aside, terms.get(d.eid)!.give, -1)
  }
  let worthy = (x: Goods) => worthOf(x, g.level)
  // Why a deal is not one the villager would make, whatever they hold.
  let unfair = (d: Deal, give: Goods, take: Goods) =>
    !take.length
      ? worthy(give) > most(g.level)
        ? 'a gift that large is more than you can spare'
        : give.some((x) => shelves.get(x.kind)?.own)
        ? 'your own things are not for giving away'
        : d.at - (gifted.get(d.by) ?? -Infinity) < GAP
        ? 'you gave them something a short while ago'
        : null
      : !take.every((x) => has.has(x.kind))
      ? 'it asks for what your land does not have'
      : worthy(give) > BAND * worthy(take)
      ? 'what you give is worth far more than what you ask'
      : null
  let events: Event[] = [
    ...deals.map((d) => ({ at: d.at, eid: d.eid, deal: d })),
    ...replies.map((r) => ({ at: r.at, eid: r.eid, reply: r })),
    ...deals.map((d) => ({
      at: d.at + OFFER,
      eid: d.eid,
      lapse: d,
      from: 'open' as State,
    })),
    ...replies.flatMap((r) => {
      let d = byEid.get(r.deal)
      return d && r.did == 'agreed'
        ? [{
          at: r.at + LAST,
          eid: d.eid,
          lapse: d,
          from: 'taken' as State,
          since: r.at,
        }]
        : []
    }),
  ].filter((e) => e.at <= now).sort(order)
  for (let e of events) {
    fill(e.at)
    if ('deal' in e) {
      let d = e.deal, give = goods(d.give), take = goods(d.take)
      let no = d.via != d.villager
        ? 'it was not yours'
        : !give?.length
        ? 'it names nothing you could give'
        : !take
        ? 'it asks for something the world does not have'
        : unfair(d, give, take) ??
          (give.every((x) => free(x.kind) >= x.n)
            ? null
            : 'you do not have that to give')
      if (no || !give || !take) {
        states.set(d.eid, 'void')
        why.set(d.eid, no ?? '')
        continue
      }
      states.set(d.eid, 'open')
      terms.set(d.eid, { give, take })
      add(aside, give, 1)
      if (!take.length) gifted.set(d.by, d.at)
      else {
        let was = byEid.get(offered.get(d.player) ?? '')
        if (was && states.get(was.eid) == 'open') back(was)
        offered.set(d.player, d.eid)
      }
    } else if ('reply' in e) {
      let r = e.reply, d = byEid.get(r.deal)
      let state = d && states.get(d.eid)
      if (!d || r.player != d.player || r.by != owner(d.player)) continue
      let { give, take } = terms.get(d.eid) ?? { give: [], take: [] }
      if (r.did == 'agreed') {
        if (state != 'open' || !take.length) continue
        states.set(d.eid, 'taken')
        since.set(d.eid, r.at)
        if (offered.get(d.player) == d.eid) offered.delete(d.player)
      } else if (state == 'open' || state == 'taken') {
        states.set(d.eid, 'done')
        add(aside, give, -1)
        add(held, give, -1)
        add(held, take, 1)
      }
    } else if (
      states.get(e.lapse.eid) == e.from &&
      (e.from == 'open' || since.get(e.lapse.eid) == e.since)
    ) back(e.lapse)
  }
  fill(Math.max(now, t0))
  let holds = new Map(
    [...held.keys()].map((k) => [k, free(k)] as [string, number])
      .filter(([, n]) => n > 0),
  )
  for (let [k, n] of aside) if (!n) aside.delete(k)
  return { states, terms, since, why, holds, aside }
}

/** One step of what a deal asks, and how far a hero has come with it: a
 * creature to fell, counted from their falls since they agreed, or a thing
 * to bring, counted in their bag. */
export type Step = { kind: string; n: number; have: number; deed: boolean }

/**
 * How far a hero has come with each step of what a deal asks.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let kills = [{ kind: 'thornback', at: 5 }, { kind: 'thornback', at: 1 }]
 * let bag = [{ eid: 'a', kind: 'tusk', n: 1 }]
 * assertEquals(steps(goods('1 thornback, 2 tusk')!, 3, kills, bag), [
 *   { kind: 'thornback', n: 1, have: 1, deed: true },
 *   { kind: 'tusk', n: 2, have: 1, deed: false },
 * ])
 * ```
 */
export let steps = (
  take: Goods,
  since: number,
  kills: { kind: string; at: number }[],
  bag: Held[],
): Step[] =>
  take.map(({ kind, n }) => {
    let deed = !!BEASTS[kind]
    let have = deed
      ? kills.filter((k) => k.kind == kind && k.at >= since).length
      : bag.filter((b) => b.kind == kind).reduce((s, b) => s + b.n, 0)
    return { kind, n, have: Math.min(have, n), deed }
  })

/**
 * What in a bag pays the things a deal asks for: the rows to spend, the
 * ones a hero is not wearing first and the humblest pieces of those, and
 * what comes back from the last heap broken into. Nothing when the bag does
 * not hold it all.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let bag = [
 *   { eid: 'c1', kind: 'coin', n: 8 },
 *   { eid: 'c2', kind: 'coin', n: 8 },
 *   { eid: 's1', kind: 'sword2', n: 1 },
 *   { eid: 's2', kind: 'sword2', n: 1 },
 * ]
 * assertEquals(pay(bag, goods('10 coin, 1 sword2')!, new Set(['s1'])), {
 *   spend: ['c1', 'c2', 's2'],
 *   back: [{ kind: 'coin', n: 6 }],
 * })
 * // An epic is the last thing handed over.
 * let fine = [{ eid: 'e', kind: 'ring1', n: 1, rarity: 'epic' as const }, {
 *   eid: 'p',
 *   kind: 'ring1',
 *   n: 1,
 * }]
 * assertEquals(pay(fine, goods('1 ring1')!)?.spend, ['p'])
 * assertEquals(pay(bag, goods('20 coin')!), null)
 * ```
 */
export let pay = (
  bag: Held[],
  take: Goods,
  worn: Set<string> = new Set(),
): { spend: string[]; back: Goods } | null => {
  let spend: string[] = [], back: Goods = []
  for (let { kind, n } of take) {
    if (BEASTS[kind]) continue
    let left = n
    let fine = (h: Held) => RARITIES.indexOf(h.rarity ?? 'common')
    let rows = bag.filter((b) => b.kind == kind)
      .sort((a, b) => +worn.has(a.eid) - +worn.has(b.eid) || fine(a) - fine(b))
    for (let b of rows) {
      if (left <= 0) break
      spend.push(b.eid)
      left -= b.n
    }
    if (left > 0) return null
    if (left < 0) back.push({ kind, n: -left })
  }
  return { spend, back }
}
