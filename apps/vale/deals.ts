// The villagers' deals as this page holds them (stock.ts says what counts):
// the deals of the villagers of the level the hero is in and the heroes'
// replies to them; what each villager's rows come to; the gifts this page
// takes up for its hero; the offers it lets them agree to or turn down, the
// jobs on the land's notice board it lets them take, and the deals it lets
// them hand in; and what it says of them. A gift is taken up a moment after
// the store took it, once every deal made beside it has reached every page.
// Each write is named by its deal and its hero, so a second tab writing the
// same writes nothing new.
//
// Only a person signed in deals, and only for a hero they made: a reply from
// anyone else counts for nothing.
import type { Watch } from '@yaks/client'
import { writer } from './chat.ts'
import { type Bundle, comp, type Me, type Net, num, str } from './net.ts'
import type { Sheet } from './play.ts'
import { type Giver, GIVERS } from './quests.ts'
import { uuidOf } from './rand.ts'
import { itemLevel } from './rarity.ts'
import {
  type Book,
  type Deal,
  type Goods,
  LAST,
  ledger,
  OFFER,
  pay,
  POSTED,
  type Reply,
  said,
  type State,
  type Step,
  steps,
} from './stock.ts'
import { eidOf, hears } from './villagers.ts'

// How long a gift waits after the store took it before this page takes it
// up, in ms.
let SETTLE = 3000

// How long after a deal a page still says what came of it, in ms: a page
// opened later has nothing to say about it.
let FRESH = 60_000

let atOf = (b: Bundle) => Date.parse(str(comp(b, 'created').at)) || 0

// Whether the store has taken a row: it names who wrote it.
let stamped = (b: Bundle) => !!writer(b) && !!atOf(b)

let dealOf = (b: Bundle): Deal => {
  let d = comp(b, 'deal')
  return {
    eid: b.entity.eid,
    villager: str(d.villager),
    player: str(d.player),
    give: str(d.give),
    take: str(d.take),
    by: writer(b),
    via: str(comp(b, 'created').via),
    at: atOf(b),
  }
}

let replyOf = (did: Reply['did']) => (b: Bundle): Reply => {
  let r = comp(b, did)
  return {
    eid: b.entity.eid,
    deal: str(r.deal),
    player: str(r.player),
    did,
    by: writer(b),
    at: atOf(b),
  }
}

/** The items a deal gives the hero, one row a thing and coin in a heap, each
 * named by the deal so writing them twice writes them once. */
let given = (deal: string, hero: string, give: Goods, now: number) =>
  give.flatMap(({ kind, n }) =>
    Array.from({ length: kind == 'coin' ? 1 : n }, (_, i) => {
      let eid = uuidOf(`deal/${deal}/${kind}/${i}`)
      let lvl = itemLevel(eid, kind)
      return {
        entity: { eid },
        item: {
          kind,
          n: kind == 'coin' ? n : 1,
          owner: hero,
          at: now,
          ...lvl != null && { lvl },
        },
      }
    })
  )

/** A deal standing between a villager and this page's hero, as the hero
 * sees it: what it gives and asks, whether they agreed to it, when it lapses,
 * how far they have come with each step, and whether they can hand it in. */
export type View = {
  eid: string
  giver: Giver
  give: Goods
  take: Goods
  state: State
  ends: number
  steps: Step[]
  ready: boolean
}

/** Something to say of a deal: its words, and, for an offer, its deal id. */
export type Note = { text: string; offer?: string }

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
  let agreed: Watch | null = null
  let handed: Watch | null = null
  let declined: Watch | null = null
  let follow = (lv: string) => {
    for (let w of [rows, agreed, handed, declined]) w?.close()
    level = lv
    let eids = GIVERS.filter((g) => g.level == lv).map((g) => eidOf(g.id))
    let of = (name: string) =>
      eids.length ? watch(`.${name}.villager=${eids.join(',')}&?created`) : null
    rows = of('deal')
    agreed = of('agreed')
    handed = of('handed')
    declined = of('declined')
  }

  // Who made a hero, off the rows village.ts watches.
  let owner = (hero: string) => writer(net.client.ent(hero)) || null

  // What each villager's rows come to, worked out again when a row changes
  // or a second passes.
  type Kept = { g: Giver; deals: Deal[]; book: Book }
  let kept: unknown[] = []
  let books = new Map<string, Kept>()
  let read = () => {
    let r = rows?.value ?? [], a = agreed?.value ?? []
    let h = handed?.value ?? [], x = declined?.value ?? []
    let t = Math.floor(net.now() / 1000)
    if ([r, a, h, x, t].every((k, i) => k === kept[i])) return books
    kept = [r, a, h, x, t]
    let land = new Map(
      GIVERS.filter((g) => g.level == level).map((g) => [eidOf(g.id), g]),
    )
    // A row counts from when the store took it: one this page is still
    // sending has only this page's stamp, with nobody's name on it, and no
    // place in the order yet.
    let deals = r.filter(stamped).map(dealOf)
    let replies = [
      ...a.filter(stamped).map(replyOf('agreed')),
      ...h.filter(stamped).map(replyOf('handed')),
      ...x.filter(stamped).map(replyOf('declined')),
    ]
    let ledgers = ledger(land, deals, replies, owner, t * 1000)
    books = new Map(
      [...land].map(([v, g]) => [g.id, {
        g,
        deals: deals.filter((d) => d.villager == v),
        book: ledgers.get(v)!,
      }]),
    )
    return books
  }

  let me: Me | null = null
  // The deals this page wrote for, or said something of.
  let done = new Set<string>()
  let told = new Set<string>()
  let refused = new Set<string>()
  // The jobs this page took off the board, until the store says whose they
  // are.
  let took = new Set<string>()

  // Whether this page speaks for its hero: a person signed in, who made it.
  let mine = () => {
    let hero = net.hero
    return hero && me?.person && owner(hero) == me.person ? hero : null
  }
  let nameOf = (hero: string, or = 'them') => net.who(hero)?.name ?? or

  // The creatures the hero felled, as a deed counts them.
  let kills = () =>
    net.mine('slain').map((b) => {
      let s = comp(b, 'slain')
      return { kind: str(s.kind), at: num(s.at) }
    })
  let worn = (s: Sheet) =>
    new Set(Object.values(s.worn).flatMap((h) => h ? [h.eid] : []))

  // A deal of a villager's that stands between them and this page's hero,
  // or a job on the board nobody has taken yet, as the rules have it.
  let find = (id: string, eid: string) => {
    let k = read().get(id)
    let d = k?.deals.find((d) => d.eid == eid)
    let state = k?.book.states.get(eid)
    let terms = k?.book.terms.get(eid)
    let whose = (k?.book.boarded.has(eid) ? null : d?.player) ||
      k?.book.taker.get(eid)
    return k && d && terms && (state == 'open' || state == 'taken') &&
        (!whose || whose == net.hero)
      ? { g: k.g, d, state, ...terms, since: k.book.since.get(eid) ?? d.at }
      : null
  }

  // Take up a gift: the hand-in and what it gives, in one change.
  let take = (g: Giver, d: Deal, give: Goods, hero: string) => {
    done.add(d.eid)
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
     * say what came of the deals asked for from this page */
    tick: (lv: string): Note[] => {
      if (lv != level) follow(lv)
      let hero = mine(), now = net.now()
      if (!hero) return []
      let out: Note[] = []
      let name = nameOf(hero)
      for (let { g, deals, book } of read().values()) {
        for (let d of deals) {
          // A job on the board: whoever took it first has it.
          let job = !d.player || book.boarded.has(d.eid)
          let whose = book.taker.get(d.eid)
          if (job && whose && took.delete(d.eid) && whose != hero) {
            out.push({
              text: `${nameOf(whose, 'Someone')} took that job first.`,
            })
          }
          if (!job && d.player != hero) continue
          let state = book.states.get(d.eid), terms = book.terms.get(d.eid)
          let gift = !job && (terms ? !terms.take.length : !d.take.trim())
          if (
            state == 'open' && terms && gift && now - d.at >= SETTLE &&
            !done.has(d.eid)
          ) out.push({ text: take(g, d, terms.give, hero) })
          if (
            d.by != me?.person || d.via != d.villager ||
            now - d.at >= FRESH || told.has(d.eid)
          ) continue
          let what = job ? 'post' : gift ? 'give' : 'offer'
          if (state == 'void') {
            told.add(d.eid)
            out.push({ text: `${g.name} could not ${what} that.` })
            write([hears(
              g.id,
              `(You found you could not ${what} ${d.give}${
                gift ? '' : ` for ${d.take}`
              }${job ? ' on the notice board' : ` to ${name}`}: ${
                book.why.get(d.eid)
              }.)`,
              uuidOf(`heard/void/${d.eid}`),
            )])
          } else if (state == 'open' && terms && job) {
            told.add(d.eid)
            out.push({
              text: `${g.name} pinned a job on the notice board: ${
                said(terms.take)
              } for ${said(terms.give)}.`,
            })
          } else if (state == 'open' && terms && !gift) {
            told.add(d.eid)
            out.push({
              text: `${g.name} offers you ${said(terms.give)} for ${
                said(terms.take)
              }.`,
              offer: d.eid,
            })
          }
        }
      }
      return out
    },
    /** what a villager of this level holds free to give, by kind */
    holds: (id: string): Map<string, number> =>
      read().get(id)?.book.holds ?? new Map(),
    /** a villager's job on the notice board, if one, whether a hero took
     * it, and whether they may post one now */
    board: (id: string) => {
      let book = read().get(id)?.book
      let terms = book?.post ? book.terms.get(book.post) : undefined
      return {
        job: book?.post && terms
          ? { ...terms, taken: book.states.get(book.post) == 'taken' }
          : null,
        room: !!book?.room,
      }
    },
    /** the jobs on the level's notice board that no hero has taken, as the
     * hero would stand with each */
    posted: (s: Sheet): View[] => {
      let now = net.now(), felled = kills()
      return [...read().values()].flatMap(({ g, deals, book }) =>
        deals.flatMap((d): View[] => {
          let terms = book.terms.get(d.eid)
          return (!d.player || book.boarded.has(d.eid)) && terms &&
              book.states.get(d.eid) == 'open'
            ? [{
              eid: d.eid,
              giver: g,
              ...terms,
              state: 'open',
              ends: (book.boarded.get(d.eid) ?? d.at) + POSTED,
              steps: steps(terms.take, now, felled, s.bag),
              ready: false,
            }]
            : []
        })
      )
    },
    /** the deals standing between a villager of this level and the hero,
     * a job they took off the board among them, newest first; with no
     * villager, every one in the level */
    standing: (s: Sheet, id?: string): View[] => {
      let hero = net.hero
      if (!hero) return []
      let felled = kills()
      return [...read().values()].filter((k) => !id || k.g.id == id)
        .flatMap(({ g, deals, book }) =>
          deals.flatMap((d): View[] => {
            let state = book.states.get(d.eid)
            let terms = book.terms.get(d.eid)
            if (
              ((book.boarded.has(d.eid) ? null : d.player) ||
                  book.taker.get(d.eid)) != hero ||
              !terms ||
              !terms.take.length ||
              (state != 'open' && state != 'taken') ||
              (state == 'open' && refused.has(d.eid))
            ) return []
            let since = book.since.get(d.eid)
            let st = steps(terms.take, since ?? d.at, felled, s.bag)
            return [{
              eid: d.eid,
              giver: g,
              ...terms,
              state,
              ends: since
                ? since + LAST
                : book.boarded.get(d.eid)
                ? book.boarded.get(d.eid)! + POSTED
                : d.at + OFFER,
              steps: st,
              ready: st.every((x) => x.have >= x.n) &&
                !!pay(s.bag, terms.take),
            }]
          })
        ).sort((a, b) => b.ends - a.ends)
    },
    /** the hero agrees to a villager's offer, or takes their job off the
     * board */
    agree: (id: string, eid: string): string | null => {
      let hero = mine(), f = find(id, eid)
      if (!hero || !f || f.state != 'open' || done.has(`agreed/${eid}`)) {
        return null
      }
      done.add(`agreed/${eid}`)
      let job = !f.d.player || !!read().get(id)?.book.boarded.has(eid)
      if (job) took.add(eid)
      write([
        {
          entity: { eid: uuidOf(`agreed/${eid}/${hero}`) },
          agreed: { deal: eid, villager: eidOf(id), player: hero },
        },
        hears(
          id,
          `(${nameOf(hero)} ${
            job ? 'took your job off the notice board' : 'agreed to your offer'
          }: ${said(f.take)} for your ${said(f.give)}.)`,
          uuidOf(`heard/agreed/${eid}/${hero}`),
        ),
      ])
      return job
        ? `Job taken: ${said(f.take)}, then back to ${f.g.name} for ${
          said(f.give)
        }.`
        : `You agreed: ${said(f.take)} for ${f.g.name}'s ${said(f.give)}.`
    },
    /** the hero hands a deal in: what it asks leaves their bag, and what
     * it gives comes into it */
    hand: (id: string, eid: string, s: Sheet): string | null => {
      let hero = mine(), f = find(id, eid)
      let paid = f && pay(s.bag, f.take, worn(s))
      let far = f ? steps(f.take, f.since, kills(), s.bag) : []
      if (
        !hero || !f || !paid || done.has(eid) ||
        far.some((x) => x.have < x.n)
      ) return null
      done.add(eid)
      let now = net.now()
      write([
        {
          entity: { eid: uuidOf(`handed/${eid}`) },
          handed: { deal: eid, villager: eidOf(id), player: hero },
        },
        ...paid.spend.map((item) => ({
          entity: { eid: uuidOf(`used/${eid}/${item}`) },
          used: { item, by: hero, at: now },
        })),
        ...given(`${eid}/back`, hero, paid.back, now),
        ...given(eid, hero, f.give, now),
        hears(
          id,
          `(${nameOf(hero)} handed in your deal: ${said(f.take)}, and you ` +
            `gave them ${said(f.give)}.)`,
          uuidOf(`heard/handed/${eid}`),
        ),
      ])
      return `${f.g.name} gives you ${said(f.give)}.`
    },
    /** the hero turns an offer down */
    refuse: (id: string, eid: string) => {
      let hero = mine(), f = find(id, eid)
      if (
        !hero || !f || f.state != 'open' || !f.d.player ||
        f.d.player != hero || !f.take.length || refused.has(eid)
      ) return
      refused.add(eid)
      write([
        {
          entity: { eid: uuidOf(`declined/${eid}/${hero}`) },
          declined: { deal: eid, villager: eidOf(id), player: hero },
        },
        hears(
          id,
          `(${nameOf(hero)} turned down your offer of ${said(f.give)} for ${
            said(f.take)
          }; the work is pinned on the notice board.)`,
          uuidOf(`heard/refused/${eid}`),
        ),
      ])
    },
  }
}
