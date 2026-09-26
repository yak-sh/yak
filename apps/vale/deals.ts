// The villagers' deals as this page holds them (stock.ts says what counts):
// the deals and hand-ins of the villagers of the level the hero is in, what
// each villager's rows come to, the gifts this page takes up for its hero,
// and what it says of them. A gift is taken up a moment after the store took
// it, once every deal made beside it has reached every page, by writing the
// hand-in and the items it gives in one change, each named by the deal, so a
// second tab writing the same writes nothing new.
//
// Only a person signed in deals, and only for a hero they made: a hand-in
// from anyone else counts for nothing.
import type { Watch } from '@yaks/client'
import { writer } from './chat.ts'
import { type Bundle, comp, type Me, type Net, str } from './net.ts'
import { type Giver, GIVERS } from './quests.ts'
import { uuidOf } from './rand.ts'
import {
  type Book,
  type Deal,
  type Goods,
  type Hand,
  ledger,
  said,
} from './stock.ts'
import { eidOf, hears } from './villagers.ts'

// How long a gift waits after the store took it before this page takes it
// up, in ms.
let SETTLE = 3000

// How long after a deal a page still says it came to nothing, in ms: a page
// opened later has nothing to say about it.
let FRESH = 60_000

let atOf = (b: Bundle) => Date.parse(str(comp(b, 'created').at)) || 0

let dealOf = (b: Bundle): Deal => {
  let d = comp(b, 'deal')
  return {
    eid: b.entity.eid,
    player: str(d.player),
    give: str(d.give),
    take: str(d.take),
    by: writer(b),
    at: atOf(b),
  }
}

let handOf = (b: Bundle): Hand => {
  let h = comp(b, 'handed')
  return {
    eid: b.entity.eid,
    deal: str(h.deal),
    player: str(h.player),
    by: writer(b),
    at: atOf(b),
  }
}

/** The items a hand-in gives the hero, one row a thing and coin in a heap,
 * each named by the deal so writing them twice writes them once. */
let given = (deal: string, hero: string, give: Goods, now: number) =>
  give.flatMap(({ kind, n }) =>
    Array.from({ length: kind == 'coin' ? 1 : n }, (_, i) => ({
      entity: { eid: uuidOf(`deal/${deal}/${kind}/${i}`) },
      item: { kind, n: kind == 'coin' ? n : 1, owner: hero, at: now },
    }))
  )

export type Deals = ReturnType<typeof deals>

/** The deals of whatever level the hero is in, over the store. */
export let deals = (net: Net) => {
  let watch = (q: string): Watch | null => {
    try {
      return net.client.watch(q)
    } catch (e) {
      console.warn('mossvale deals:', e)
      return null
    }
  }
  let write = (bundles: Bundle[]) => {
    try {
      net.client.mutate(bundles)
    } catch (e) {
      console.warn('mossvale deals:', e)
    }
  }

  let level = ''
  let rows: Watch | null = null
  let hands: Watch | null = null
  let follow = (lv: string) => {
    rows?.close()
    hands?.close()
    level = lv
    let eids = GIVERS.filter((g) => g.level == lv).map((g) => eidOf(g.id))
    rows = eids.length
      ? watch(`.deal.villager=${eids.join(',')}&?created`)
      : null
    hands = eids.length
      ? watch(`.handed.villager=${eids.join(',')}&?created`)
      : null
  }

  // Who made a hero, off the rows village.ts watches.
  let owner = (hero: string) => writer(net.client.ent(hero)) || null

  // What each villager's rows come to, worked out again when a row changes
  // or a second passes.
  type Kept = { g: Giver; deals: Deal[]; book: Book }
  let kept = { rows: null as unknown, hands: null as unknown, t: 0 }
  let books = new Map<string, Kept>()
  let read = () => {
    let r = rows?.value ?? [], h = hands?.value ?? []
    let t = Math.floor(net.now() / 1000)
    if (kept.rows === r && kept.hands === h && kept.t == t) return books
    kept = { rows: r, hands: h, t }
    let mine = new Map(
      GIVERS.filter((g) => g.level == level).map((g) => [
        eidOf(g.id),
        { g, deals: [] as Deal[], hands: [] as Hand[] },
      ]),
    )
    // A row counts from when the store took it: one this page is still
    // sending has no place in the order yet.
    for (let b of r.filter(atOf)) {
      mine.get(str(comp(b, 'deal').villager))?.deals.push(dealOf(b))
    }
    for (let b of h.filter(atOf)) {
      mine.get(str(comp(b, 'handed').villager))?.hands.push(handOf(b))
    }
    books = new Map(
      [...mine.values()].map(({ g, deals, hands }) => [g.id, {
        g,
        deals,
        book: ledger(g, deals, hands, owner, t * 1000),
      }]),
    )
    return books
  }

  let me: Me | null = null
  // The gifts this page has taken up, and the deals it said came to nothing.
  let taken = new Set<string>()
  let told = new Set<string>()

  // Take up a gift: the hand-in and what it gives, in one change.
  let take = (g: Giver, d: Deal, give: Goods, hero: string) => {
    taken.add(d.eid)
    write([
      {
        entity: { eid: uuidOf(`handed/${d.eid}`) },
        handed: { deal: d.eid, villager: eidOf(g.id), player: hero },
      },
      ...given(d.eid, hero, give, net.now()),
    ])
    return `${g.name} gives you ${said(give)}.`
  }

  return {
    /** who is looking: only a person signed in deals */
    me: (who: Me) => {
      me = who
    },
    /** this frame: follow the hero's level, take up the gifts made them, and
     * say what came of their deals */
    tick: (lv: string): string[] => {
      if (lv != level) follow(lv)
      let hero = net.hero, now = net.now()
      if (!hero || !me?.person || owner(hero) != me.person) return []
      let out: string[] = []
      let name = str(comp(net.client.ent(hero), 'player').name, 'them')
      for (let { g, deals, book } of read().values()) {
        for (let d of deals) {
          if (d.player != hero) continue
          let state = book.states.get(d.eid), terms = book.terms.get(d.eid)
          if (
            state == 'open' && terms && !terms.take.length &&
            now - d.at >= SETTLE && !taken.has(d.eid)
          ) out.push(take(g, d, terms.give, hero))
          if (
            state == 'void' && d.by == me.person && now - d.at < FRESH &&
            !told.has(d.eid)
          ) {
            told.add(d.eid)
            out.push(`${g.name} could not give that.`)
            write([hears(
              g.id,
              `(You found you could not give ${d.give} to ${name}.)`,
            )])
          }
        }
      }
      return out
    },
    /** what a villager of this level holds free to give, by kind */
    holds: (id: string): Map<string, number> =>
      read().get(id)?.book.holds ?? new Map(),
  }
}
