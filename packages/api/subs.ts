// Subscriptions: a saved query whose answer is pushed again whenever a
// committed batch changes it.
//
// The registry hangs off the graph's own `effect` phase, so EVERY commit is
// seen — the ones that arrived through `POST /apply` and the ones a host wrote
// straight to the graph. A commit is answered in two steps: read the touched
// entities once, whole, then judge them against each subscription.
//
// Two modes, chosen when the subscription opens:
//
//   INCREMENTAL  the query asks only about each entity itself, so
//                @yaks/match's `filter` decides membership one bundle at a
//                time — no re-read, however large the set is.
//   REFRESH      the query follows a reference, counts, orders or windows, so
//                its ANSWER can move when an entity the query never named
//                does. Those re-read the whole query and diff it against the
//                membership set.
//
// The membership Set is what makes "you no longer match" as cheap as "you now
// match": a client cannot notice its own departure — it never sees the row
// that stopped matching — so the server is what remembers who is in.

import type { Bundle, Eid, Graph } from '@yaks/graph'
import { detached, isPromise, over, then } from '@yaks/graph'
import { type Filter, filter } from '@yaks/match'
import { bare, type Clause, parse } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { type Refusal, refusal } from './refuse.ts'

/**
 * One push to one subscriber. `bundles` are whole entities that are now in the
 * set — for the raw feed (`subscribe: true`), the batch exactly as it was
 * applied. `gone` names the entities that LEFT the set, whether they were
 * deleted or merely stopped matching. `refused` replaces both when the
 * subscription could not be opened.
 */
export type Frame = {
  /** the subscription this frame answers */
  id: string
  /** the entities now in the set (whole), or the applied batch for a raw feed */
  bundles?: Bundle[]
  /** entities that left the set — deleted, or no longer matching */
  gone?: Eid[]
  /** why the subscription was refused, when it was */
  refused?: Refusal
}

/** Where a subscriber's frames go. One sink per client — the socket layer
 * makes one per connection, and the registry keys subscriptions by it. */
export type Sink = (frame: Frame) => void

/** What a subscriber asks for: a query line, or `true` for the raw feed of
 * every committed batch. */
export type Ask = string | true

/** The subscription registry: what the socket layer talks to, and what a host
 * can drive directly. */
export type Subs = {
  /** open (or replace) a subscription and answer with its current set */
  open: (sink: Sink, id: string, query: Ask) => void | Promise<void>
  /** close one subscription */
  close: (sink: Sink, id: string) => void
  /** close every subscription a sink holds — a client went away */
  drop: (sink: Sink) => void
  /** a batch committed: push what changed to whoever is watching */
  commit: (applied: Bundle[]) => void | Promise<void>
}

type Sub = {
  id: string
  sink: Sink
  /** the raw feed of committed batches, rather than a query */
  raw: boolean
  /** the query line (empty for a raw feed) */
  query: string
  /** the entities currently in the set */
  members: Set<Eid>
  /** the per-bundle test, or `null` when this subscription re-reads instead */
  test: Filter | null
}

// A clause every subscriber can be judged on alone: a column of the entity
// itself, a word in its own text, nothing. A path that hops through a
// reference, a backlink, an ordering, a window or an aggregate is a question
// about the SET, and answering it needs the query run again. `*` asks which
// components an answer CARRIES — no question about membership at all — so it
// leaves a subscription incremental.
let local = (c: Clause, v: Vocab): boolean =>
  c.kind == 'and' || c.kind == 'or'
    ? c.clauses.every((k) => local(k, v))
    : c.kind == 'pred'
    ? v.aim(c.path.join('.'), bare(c)).length == 1
    : c.kind == 'text' || c.kind == 'never' || c.kind == 'every'

// The per-bundle test for a parsed query, or null to re-read it instead: a
// query reaching beyond one entity, and one @yaks/match declines outright,
// both fall back.
let judge = (ast: Clause, query: string, vocab: Vocab): Filter | null => {
  try {
    return local(ast, vocab) ? filter(query, vocab) : null
  } catch {
    return null
  }
}

/**
 * A subscription registry over a graph. It registers an `effect` hook on that
 * graph, so every batch which commits — through this API or not — reaches
 * whoever is watching. Build one per graph; {@link https://jsr.io/@yaks/api |
 * api()} makes one when you do not hand it yours.
 *
 * ```ts
 * let subs = subscriptions(graph)
 * subs.open(sink, 'cheap', '.book&.price<20')
 * ```
 */
export let subscriptions = (graph: Graph): Subs => {
  let held = new Map<Sink, Map<string, Sub>>()
  let all = () => [...held.values()].flatMap((m) => [...m.values()])

  // A subscription that refuses is CLOSED, not kept: a query the graph cannot
  // answer would otherwise throw on every commit for the life of the socket.
  let cut = (sub: Sub, err: unknown) => {
    held.get(sub.sink)?.delete(sub.id)
    sub.sink({ id: sub.id, refused: refusal(err) })
  }

  let attempt = (sub: Sub, fn: () => void | Promise<void>) => {
    try {
      let out = fn()
      return isPromise(out) ? out.catch((err) => cut(sub, err)) : out
    } catch (err) {
      cut(sub, err)
    }
  }

  let open = (sink: Sink, id: string, query: Ask) => {
    let mine = held.get(sink) ?? new Map<string, Sub>()
    held.set(sink, mine)
    let line = query === true ? '' : query
    let sub: Sub = {
      id,
      sink,
      raw: query === true,
      query: line,
      members: new Set(),
      test: null,
    }
    mine.set(id, sub)
    if (sub.raw) return // a raw feed carries batches, not a membership set
    return attempt(sub, () => {
      // Parsed here, outside `judge`, so an unreadable query is refused rather
      // than quietly demoted to a subscription that re-reads it forever.
      sub.test = judge(parse(line), line, graph.vocab)
      return then(graph.read(line), (bundles) => {
        for (let b of bundles) sub.members.add(b.entity.eid)
        sink({ id, bundles })
      })
    })
  }

  // One query subscription against the entities a batch touched, read whole.
  let push = (sub: Sub, now: Bundle[], touched: Eid[]) => {
    let test = sub.test
    if (test) {
      let bundles: Bundle[] = []
      let gone: Eid[] = []
      let seen = new Set(now.map((b) => b.entity.eid))
      for (let b of now) {
        let eid = b.entity.eid
        if (test(b, now)) {
          sub.members.add(eid)
          bundles.push(b)
        } else if (sub.members.delete(eid)) gone.push(eid)
      }
      // An entity storage no longer holds at all is a departure too.
      for (let eid of touched) {
        if (!seen.has(eid) && sub.members.delete(eid)) gone.push(eid)
      }
      if (bundles.length || gone.length) sub.sink({ id: sub.id, bundles, gone })
      return
    }
    // Refresh: the answer is a property of the whole set, so ask for it again.
    return then(graph.read(sub.query), (set) => {
      let ids = new Set(set.map((b) => b.entity.eid))
      let gone = [...sub.members].filter((e) => !ids.has(e))
      sub.members = ids
      if (gone.length || touched.some((e) => ids.has(e))) {
        sub.sink({ id: sub.id, bundles: set, gone })
      }
    })
  }

  let commit = (applied: Bundle[]) => {
    let subs = all()
    for (let s of subs) if (s.raw) s.sink({ id: s.id, bundles: applied })
    let queries = subs.filter((s) => !s.raw)
    if (!queries.length) return
    let touched = [...new Set(applied.map((b) => b.entity.eid))]
    return then(detached(graph.storage).get(touched), (now) =>
      then(
        over(queries, (s) => attempt(s, () => push(s, now, touched))),
        () => undefined,
      ))
  }

  graph.use({
    name: '@yaks/api',
    hooks: { effect: (bundles) => then(commit(bundles), () => bundles) },
  })

  return {
    open,
    close: (sink, id) => {
      held.get(sink)?.delete(id)
    },
    drop: (sink) => {
      held.delete(sink)
    },
    commit,
  }
}
