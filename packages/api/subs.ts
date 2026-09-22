// Subscriptions: a saved query whose result is pushed again whenever a
// committed transaction changes it.
//
// The registry registers a hook on the graph's own `effect` phase, so every
// commit is seen — the ones that arrived through `POST /apply` and the ones
// the application wrote straight to the graph. A commit is handled in two
// steps: read the changed entities once, whole, then test them against each
// subscription.
//
// Two modes, chosen when the subscription opens:
//
//   Incremental  the query asks only about each entity itself, so
//                @yaks/match's `filter` decides membership one bundle at a
//                time — the query is never run again, however large the set
//                is.
//   Refresh      the query follows a reference, counts, orders or limits, so
//                its result can change when an entity the query never named
//                does. These run the query again and compare it against the
//                membership set.
//
// The membership Set is what makes "this entity no longer matches" as cheap
// as "this entity now matches": a client cannot work out that something left
// its set — it never sees the row that stopped matching — so the server is
// what remembers who is in.

import type { Bundle, Eid, Graph } from '@yaks/graph'
import {
  admit,
  composed,
  detached,
  isPromise,
  over,
  then,
  transient,
  type TransientFrame,
} from '@yaks/graph'
import { comps } from '@yaks/graph'
import { type Filter, filter } from '@yaks/match'
import { bare, type Clause, parse } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { fault, type Refusal, refusal } from './refuse.ts'
import { type Relay, relay as relaying, type Timer } from './relay.ts'

/**
 * One push to one subscriber. `bundles` are whole entities that are now in
 * the set — for the raw feed (`subscribe: true`), the committed transaction
 * as it was applied, one bundle per entity, exactly as its writer's `/apply`
 * response read. `gone` names the entities that left the set, whether they
 * were deleted or merely stopped matching. `refused` replaces both when the
 * subscription could not be opened.
 */
export type Frame = {
  transient?: TransientFrame[]
  transientReset?: Eid[]
  /** the subscription this frame answers */
  id: string
  /** the entities now in the set (whole), or the composed transaction for a
   * raw feed */
  bundles?: Bundle[]
  /** entities that left the set — deleted, or no longer matching */
  gone?: Eid[]
  /**
   * `sync: peers` components being relayed: a cursor, a caret, a presence
   * dot. Never stored, on either end. A value cleared by its writer — or by
   * that writer's connection closing, or by its own duration running out —
   * arrives as the component set to `null`.
   */
  relay?: Bundle[]
  /** why the subscription was refused, when it was */
  refused?: Refusal
}

/** Where a subscriber's frames go. One sink per client — the socket layer
 * makes one per connection, and the registry keys subscriptions by it. */
export type Sink = (frame: Frame) => void

/** What a subscriber asks for: a query string, or `true` for the raw feed of
 * every committed transaction. */
export type Ask = string | true

/** The subscription registry: what the socket layer talks to, and what an
 * application can drive directly. */
export type Subs = {
  /** open (or replace) a subscription and send its current set */
  open: (sink: Sink, id: string, query: Ask) => void | Promise<void>
  /** close one subscription */
  close: (sink: Sink, id: string) => void
  /** close every subscription a sink holds — a client went away */
  drop: (sink: Sink) => void
  /** a transaction committed: push what changed to whoever is watching */
  commit: (applied: Bundle[]) => void | Promise<void>
  /**
   * `sync: peers` components from one sink: forwarded to everyone else
   * watching those entities, and held under this sink until it closes
   * (relay.ts). Nothing is stored, so nothing commits and no subscription
   * runs its query again.
   */
  relay: (sink: Sink, bundles: Bundle[]) => void
  /** The keys one sink's relayed values are held under — small enough to
   * store somewhere that outlives this process's memory. */
  relaying: (sink: Sink) => string[]
  /** Take those keys back after such a loss, so a close still clears them. */
  relayed: (sink: Sink, keys: string[]) => void
}

type Sub = {
  id: string
  sink: Sink
  /** the raw feed of committed transactions, rather than a query */
  raw: boolean
  /** the query string (empty for a raw feed) */
  query: string
  /** the entities currently in the set */
  members: Set<Eid>
  fields: Map<Eid, Set<string>>
  /** the per-bundle test, or `null` when this subscription runs its query
   * again instead */
  test: Filter | null
}

// Whether a clause can be decided against one entity on its own: a column of
// the entity itself, a term in its own text, nothing at all. A path that hops
// through a reference or a backlink, an ordering, a limit or an aggregate is
// a question about the set, and answering it means running the query again.
// `*` selects which components a result carries — it is not a question about
// membership at all — so it leaves a subscription incremental.
let local = (c: Clause, v: Vocab): boolean =>
  c.kind == 'and' || c.kind == 'or'
    ? c.clauses.every((k) => local(k, v))
    : c.kind == 'pred'
    ? v.aim(c.path.join('.'), bare(c)).length == 1
    : c.kind == 'text' || c.kind == 'never' || c.kind == 'every'

// The per-bundle test for a parsed query, or null to run the query again
// instead. Both a query that reaches beyond a single entity and one
// @yaks/match refuses to compile fall back to running it again.
let judge = (ast: Clause, query: string, vocab: Vocab): Filter | null => {
  try {
    return local(ast, vocab) ? filter(query, vocab) : null
  } catch {
    return null
  }
}

/**
 * A subscription registry over a graph. It registers an `effect` hook on that
 * graph, so every transaction that commits — through this API or not —
 * reaches whoever is watching. Build one per graph;
 * {@link https://jsr.io/@yaks/api | api()} makes one when you do not pass
 * your own.
 *
 * ```ts
 * let subs = subscriptions(graph)
 * subs.open(sink, 'cheap', '.book&.price<20')
 * ```
 */
export let subscriptions = (graph: Graph, opts: {
  /** A query may depend on entities outside its result (for example a computed
   * session status depends on transcript entries). Returning true refreshes
   * that subscription after this commit. It does not subscribe to those rows. */
  invalidate?: (query: string, applied: Bundle[]) => boolean
  /** how a `durable: "5s"` relayed value's timer is set (default:
   * setTimeout) */
  timer?: Timer
} = {}): Subs => {
  let held = new Map<Sink, Map<string, Sub>>()
  let all = () => [...held.values()].flatMap((m) => [...m.values()])

  // A subscription whose query is refused is closed, not kept: a query the
  // graph cannot answer would otherwise throw on every commit for the life of
  // the socket.
  let cut = (sub: Sub, err: unknown) => {
    held.get(sub.sink)?.delete(sub.id)
    fault(err, 'subscription')
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

  const rememberFields = (sub: Sub, bundles: Bundle[]) => {
    for (const b of bundles) {
      sub.fields.set(
        b.entity.eid,
        new Set(
          Object.entries(b).flatMap(([comp, value]) =>
            value && typeof value == 'object'
              ? Object.keys(value).map((prop) => comp + '.' + prop)
              : []
          ),
        ),
      )
    }
  }
  const visible = (sub: Sub, f: TransientFrame) =>
    sub.members.has(f.entity) &&
    sub.fields.get(f.entity)?.has(f.component + '.' + f.property)

  let open = (sink: Sink, id: string, query: Ask) => {
    flush()
    let mine = held.get(sink) ?? new Map<string, Sub>()
    held.set(sink, mine)
    let line = query === true ? '' : query
    let sub: Sub = {
      id,
      sink,
      raw: query === true,
      query: line,
      members: new Set(),
      fields: new Map(),
      test: null,
    }
    mine.set(id, sub)
    // a raw feed carries whole transactions, not a membership set
    if (sub.raw) return
    return attempt(sub, () => {
      // Parsed here, outside `judge`, so a query that cannot be parsed is
      // refused rather than quietly demoted to a subscription that runs it
      // again on every commit forever.
      sub.test = judge(parse(line), line, graph.vocab)
      return then(graph.read(line, { durable: true }), (bundles) => {
        for (let b of bundles) sub.members.add(b.entity.eid)
        rememberFields(sub, bundles)
        const snapshots = live.snapshots().filter((f) => visible(sub, f))
        // The relayed values other connections already hold for this set, so
        // a subscriber that arrives late still sees the cursors that were
        // there before it.
        let now = peers.snapshot(sink, (eid) => sub.members.has(eid))
        sink({
          id,
          bundles,
          transientReset: bundles.map((b) => b.entity.eid),
          ...snapshots.length ? { transient: snapshots } : {},
          ...now.length ? { relay: now } : {},
        })
      })
    })
  }

  // One query subscription against the entities a transaction changed, read
  // whole.
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
      // An entity storage no longer holds at all has left the set too.
      for (let eid of touched) {
        if (!seen.has(eid) && sub.members.delete(eid)) gone.push(eid)
      }
      rememberFields(sub, bundles)
      for (const eid of gone) sub.fields.delete(eid)
      if (bundles.length || gone.length) sub.sink({ id: sub.id, bundles, gone })
      return
    }
    // Refresh: the result is a property of the whole set, so run the query
    // again.
    return then(graph.read(sub.query, { durable: true }), (set) => {
      let ids = new Set(set.map((b) => b.entity.eid))
      let gone = [...sub.members].filter((e) => !ids.has(e))
      sub.members = ids
      rememberFields(sub, set)
      if (gone.length || touched.some((e) => ids.has(e))) {
        sub.sink({ id: sub.id, bundles: set, gone })
      }
    })
  }

  let commit = (applied: Bundle[]) => {
    flush()
    let subs = all()
    // A raw feed sends the transaction to a client, and this hook is handed
    // what the phases passed to each other — one patch each, with the `$`
    // keys still on them. So it is composed here, the same way `apply()`
    // composes what it returns: a subscriber receives exactly what the writer
    // did.
    let raw = subs.filter((s) => s.raw)
    if (raw.length) {
      let batch = composed(applied)
      for (let s of raw) s.sink({ id: s.id, bundles: batch })
    }
    let queries = subs.filter((s) => !s.raw)
    if (!queries.length) return
    let touched = [...new Set(applied.map((b) => b.entity.eid))]
    return then(detached(graph.storage).get(touched), (now) =>
      then(
        over(queries, (s) =>
          attempt(s, () => {
            if (opts.invalidate?.(s.query, applied)) {
              return then(graph.read(s.query, { durable: true }), (set) => {
                let ids = new Set(set.map((b) => b.entity.eid))
                let gone = [...s.members].filter((id) => !ids.has(id))
                s.members = ids
                rememberFields(s, set)
                s.sink({ id: s.id, bundles: set, gone })
              })
            }
            return push(s, now, touched)
          })),
        () => undefined,
      ))
  }

  // The relay, and how a value reaches the clients watching. A relayed value
  // never changes membership, so it is sent to whoever already has that
  // entity in their set (a raw feed receives every one) and never opens or
  // closes anybody's subscription.
  let cast = (bundles: Bundle[], except?: Sink) => {
    for (let [sink, mine] of held) {
      if (sink === except) continue
      for (let sub of mine.values()) {
        let seen = sub.raw
          ? bundles
          : bundles.filter((b) => sub.members.has(b.entity.eid))
        if (seen.length) sink({ id: sub.id, relay: seen })
      }
    }
  }
  let peers: Relay<Sink> = relaying(graph.vocab, (b) => cast(b), opts.timer)

  const live = transient(graph)
  const pending = new Map<Sink, Map<string, TransientFrame[]>>()
  let scheduled = false
  const flush = () => {
    scheduled = false
    const batch = [...pending]
    pending.clear()
    for (const [sink, ids] of batch) {
      for (const [id, frames] of ids) {
        if (held.get(sink)?.has(id)) sink({ id, transient: frames })
      }
    }
  }
  live.subscribe((frame) => {
    for (const mine of held.values()) {
      for (const sub of mine.values()) {
        if (!sub.raw && !visible(sub, frame)) continue
        let ids = pending.get(sub.sink)
        if (!ids) pending.set(sub.sink, ids = new Map())
        const frames = ids.get(sub.id) ?? []
        frames.push(frame)
        ids.set(sub.id, frames)
      }
    }
    if (!scheduled) {
      scheduled = true
      queueMicrotask(flush)
    }
  })

  graph.use({
    name: '@yaks/api',
    hooks: { effect: (bundles) => then(commit(bundles), () => bundles) },
  })

  return {
    open,
    close: (sink, id) => {
      pending.get(sink)?.delete(id)
      held.get(sink)?.delete(id)
    },
    drop: (sink) => {
      pending.delete(sink)
      held.delete(sink)
      // Every value this connection was relaying stops being true when the
      // connection goes.
      let off = peers.drop(sink)
      if (off.length) cast(off)
    },
    commit,
    relay: (sink, bundles) => {
      // Admitted like any other write — an unknown column is refused, a
      // server-owned or computed one is dropped, every value is checked
      // against the vocabulary — and then stripped of the `$` keys a stored
      // write carries. A relayed value has no precondition to check, no
      // cascading delete to perform, and no actor to sign it with: the
      // connection it arrived on was authenticated at the upgrade, and
      // nothing here is stored for anyone to read back later.
      let bare = admit(bundles, graph.vocab).map((b) => {
        let out: Bundle = { entity: { eid: b.entity.eid } }
        for (let [name, patch] of comps(b)) out[name] = patch
        return out
      })
      let out = peers.write(sink, bare)
      if (out.length) cast(out, sink)
    },
    relaying: (sink) => peers.holds(sink),
    relayed: (sink, keys) => peers.adopt(sink, keys),
  }
}
