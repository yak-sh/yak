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
//   Routed       the query asks only about each entity itself, so it joins
//                the registry's network (@yaks/match `net`), which every
//                subscription of that kind shares. A changed entity moves
//                through the network once, into the subscriptions it matches
//                and out of the ones it left — the query is never run again,
//                however large the set is, and a commit costs what it
//                changed, not how many subscriptions are open.
//   Refresh      the query follows a reference, counts, orders or limits, so
//                its result can change when an entity the query never named
//                does. A dependency with a reference back to the answer
//                refreshes that entity alone. An unlocated dependency or a
//                window refreshes the whole query (./interest.ts).
//
// The membership Set is what makes "this entity no longer matches" as cheap
// as "this entity now matches": a client cannot work out that something left
// its set — it never sees the row that stopped matching — so the server is
// what remembers who is in.

import type { Bundle, Eid, Graph } from '@yaks/graph'
import {
  admit,
  coalesced,
  composed,
  isPromise,
  over,
  then,
  transient,
  type TransientFrame,
} from '@yaks/graph'
import {
  type Agg,
  aggregate,
  comps,
  only,
  type Reduced,
  reduced,
  wanted,
} from '@yaks/graph'
import { matcher, net, rows as matchRows } from '@yaks/match'
import { type And, parse } from '@yaks/query'
import { syncOf } from '@yaks/vocab'
import { cares, type Interest, interest } from './interest.ts'
import { peerPlan } from './peer_query.ts'
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
  /** the token a socket subscriber echoes after applying this frame */
  ack?: string
  /** a whole answer after a hibernating socket wakes */
  reset?: boolean
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
} & Partial<Reduced>

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
  close: (sink: Sink, id: string) => void | Promise<void>
  /** close every subscription a sink holds — a client went away */
  drop: (sink: Sink) => void | Promise<void>
  /** a transaction committed: push what changed to whoever is watching */
  commit: (applied: Bundle[]) => void | Promise<void>
  /**
   * `sync: peers` components from one sink: forwarded to everyone else
   * watching those entities, and held under this sink until it closes
   * (relay.ts). Nothing is stored or committed. Queries that read peer
   * components update their membership against the value now held.
   */
  relay: (sink: Sink, bundles: Bundle[]) => void | Promise<void>
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
  /** true when the registry's network decides membership, false when this
   * subscription runs its query again instead */
  routed: boolean
  /** the query reads a component held by peers rather than storage */
  peer: boolean
  /** the durable rows that may match a query reading peers */
  durable?: And | null
  candidates?: Bundle[] | Promise<Bundle[]>
  /** the components its rows carry, or `null` for every one (@yaks/graph
   * `wanted`), so a pushed bundle is cut the way the first answer was */
  want?: Set<string> | null
  /** the reduction an aggregate query asks for, and its last answer */
  agg?: Agg
  answer?: string
  /** what a refresh or an aggregate is read from, or `null` when every
   * commit can move it */
  reads?: Interest | null
}

// What one commit did to one routed subscription: the entities now in its set,
// the ones among them that were not in it before, and the ones that left it.
type Moved = { bundles: Bundle[]; joined: Eid[]; gone: Eid[] }

// What one commit did to each entity it touched: the components its patches
// named, and the ones it wears now, or `null` once it is deleted.
type Touch = Map<Eid, {
  named: Set<string>
  props: Set<string>
  worn: Set<string> | null
  bundle?: Bundle
  born: boolean
}>

let touches = (applied: Bundle[], now: Bundle[]): Touch => {
  let out: Touch = new Map()
  for (let b of now) {
    out.set(b.entity.eid, {
      named: new Set(),
      props: new Set(),
      worn: new Set(Object.keys(b)),
      bundle: b,
      born: false,
    })
  }
  for (let b of applied) {
    let t = out.get(b.entity.eid) ?? {
      named: new Set<string>(),
      props: new Set<string>(),
      worn: null,
      born: false,
    }
    out.set(b.entity.eid, t)
    if (b.$delete) t.worn = null
    if (b.created) t.born = true
    for (let k of Object.keys(b)) {
      if (k == 'entity' || k[0] == '$') continue
      t.named.add(k)
      let patch = b[k]
      if (patch && typeof patch == 'object') {
        for (let prop of Object.keys(patch)) t.props.add(k + '.' + prop)
      }
    }
  }
  return out
}

// The answer's entities a write can have moved. `null` means that the query
// must run whole: a far dependency has no owner, or a reference moved/deleted
// and the old owner cannot be read after the commit.
let affected = (sub: Sub, touch: Touch): Set<Eid> | null | undefined => {
  let i = sub.reads
  if (!i) return null
  let ids = new Set<Eid>()
  for (let [eid, t] of touch) {
    if (!t.worn) return null
    if ([...i.far].some((c) => t.named.has(c) || t.worn!.has(c))) {
      return null
    }
    if (
      sub.members.has(eid) ||
      (cares(i, t.named, t.worn) &&
        i.fixed.every(({ comp, prop, value }) =>
          (t.bundle?.[comp] as Record<string, unknown> | undefined)
            ?.[prop] === value
        ))
    ) ids.add(eid)
    for (let [comp, prop] of i.via) {
      if (!t.named.has(comp) && !t.worn.has(comp)) continue
      let owner = (t.bundle?.[comp] as Record<string, unknown> | undefined)
        ?.[prop]
      if (typeof owner != 'string') return null
      if (t.props.has(comp + '.' + prop) && !t.born) return null
      ids.add(owner)
    }
  }
  return ids.size ? i.whole ? null : ids : undefined
}

/**
 * A subscription registry over a graph. It registers an `effect` hook on that
 * graph, so every transaction that commits — through this API or not —
 * reaches whoever is watching. Build one per graph;
 * {@link https://jsr.io/@yaks/api | api()} makes one when you do not pass
 * your own.
 *
 * ```ts ignore
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
  let durableNet = net<Sub>(graph.vocab)
  let peerNet = net<Sub>(graph.vocab)
  // Keep storage rows only while a peer value makes their entity relevant.
  // A missing row is cached too: a peer-only entity must not hit storage on
  // every movement.
  let peerRows = new Map<Eid, Bundle | null>()
  let network = (sub: Sub) => sub.peer ? peerNet : durableNet
  let peerComp = (name: string) => syncOf(graph.vocab, name) == 'peers'
  let pendingWork: Promise<void> | undefined
  let ordered = (fn: () => void | Promise<void>) => {
    let out = pendingWork ? pendingWork.then(fn) : fn()
    if (isPromise(out)) {
      let done = out.then(() => {}, () => {})
      pendingWork = done
      done.then(() => {
        if (pendingWork === done) pendingWork = undefined
      })
    }
    return out
  }
  let relays = new Map<Sink, { bundles: Bundle[]; done: Promise<void> }>()
  // A subscription let go of, by its sink closing it or by a new one under
  // its id: the network lets go of it too.
  let forget = (sub: Sub | undefined) => {
    if (sub?.routed) network(sub).drop(sub)
  }

  // A subscription whose query is refused is closed, not kept: a query the
  // graph cannot answer would otherwise throw on every commit for the life of
  // the socket.
  let cut = (sub: Sub, err: unknown) => {
    held.get(sub.sink)?.delete(sub.id)
    forget(sub)
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
      routed: false,
      peer: false,
    }
    forget(mine.get(id))
    mine.set(id, sub)
    // a raw feed carries whole transactions, not a membership set
    if (sub.raw) return
    return attempt(sub, () => {
      // Parsed here, before the network is asked, so a query that cannot be
      // parsed is refused rather than quietly demoted to a subscription that
      // runs it again on every commit forever.
      let ast = parse(line)
      sub.reads = interest(ast, graph.vocab)
      let plan = peerPlan(ast, graph.vocab)
      sub.peer = plan.peers
      sub.durable = plan.durable
      sub.agg = aggregate(ast)
      if (sub.agg) return tell(sub, true)
      sub.want = wanted(graph.vocab, line)
      return then(read(sub), (bundles) => {
        for (let b of bundles) sub.members.add(b.entity.eid)
        if (held.get(sink)?.get(id) === sub) {
          sub.routed = network(sub).add(sub, ast, sub.members)
        }
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

  // An aggregate's answer, sent when it is new: always on open, and after a
  // commit only when the value moved. A count or a tally is a question about
  // the whole set, so it is asked again after every commit.
  let tell = (sub: Sub, first = false) =>
    then(
      sub.peer
        ? then(source(sub), (bundles) =>
          matchRows(sub.query, graph.vocab)(bundles))
        : graph.rows(parse(sub.query), { durable: true }),
      (rows) => {
        let value = reduced(sub.agg!, rows)
        let answer = JSON.stringify(value)
        if (!first && answer == sub.answer) {
          return
        }
        sub.answer = answer
        sub.sink({ id: sub.id, ...value })
      },
    )

  // What a commit did to one routed subscription, sent cut to what the query
  // names.
  let send = (sub: Sub, moved?: Moved) => {
    if (!moved) return
    let { bundles, joined, gone } = moved
    rememberFields(sub, bundles)
    for (const eid of gone) sub.fields.delete(eid)
    if (bundles.length || gone.length) {
      sub.sink({ id: sub.id, bundles, gone, ...hail(sub, joined) })
    }
  }

  // What the peers are already saying about entities that just joined a set,
  // as a subscription that opens is told it: a writer relays a value when it
  // changes, so one relayed before its entity joined would otherwise not be
  // heard again until it moved.
  let hail = (sub: Sub, joined: Eid[]): { relay?: Bundle[] } => {
    if (!joined.length) return {}
    let fresh = new Set(joined)
    let now = peers.snapshot(sub.sink, (eid) => fresh.has(eid))
    return now.length ? { relay: now } : {}
  }

  // A refresh runs against the affected entities where it can locate them.
  // A limit, order or unlocated dependency still needs the whole answer.
  let push = (
    sub: Sub,
    scope?: Set<Eid>,
    load = (q: string): Bundle[] | Promise<Bundle[]> =>
      graph.read(q, { durable: true }),
  ) => {
    if (sub.agg) return tell(sub)
    // Peer candidates include held values, so only durable queries can use
    // the scoped storage read. Read the complete peer answer when it moves.
    if (sub.peer) scope = undefined
    let query = scope ? sub.query + '&.eid=' + [...scope].join(',') : sub.query
    return then(sub.peer ? read(sub) : load(query), (set) => {
      let ids = new Set(set.map((b) => b.entity.eid))
      let gone = [...sub.members].filter((e) =>
        (!scope || scope.has(e)) && !ids.has(e)
      )
      // An entity can join without being touched: a hop or a computed
      // property moved it from the far side.
      let joined = [...ids].filter((e) => !sub.members.has(e))
      if (scope) {
        for (let e of gone) sub.members.delete(e)
        for (let e of ids) sub.members.add(e)
      } else sub.members = ids
      if (sub.routed) network(sub).add(sub, sub.query, sub.members)
      rememberFields(sub, set)
      for (let e of gone) sub.fields.delete(e)
      if (set.length || gone.length) {
        sub.sink({ id: sub.id, bundles: set, gone, ...hail(sub, joined) })
      }
    })
  }

  let commitNow = (applied: Bundle[]) => {
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
    for (let s of queries) if (s.peer) s.candidates = undefined
    let touched = [...new Set(applied.map((b) => b.entity.eid))]
    if (!queries.length && !touched.some((eid) => peerRows.has(eid))) return
    let reads = new Map<string, Bundle[] | Promise<Bundle[]>>()
    let load = (q: string) => {
      let got = reads.get(q)
      if (!got) reads.set(q, got = graph.read(q, { durable: true }))
      return got
    }
    return then(graph.get(touched), (now) => {
      let changed = new Map(now.map((b) => [b.entity.eid, b]))
      for (let eid of touched) {
        if (peerRows.has(eid)) peerRows.set(eid, changed.get(eid) ?? null)
      }
      if (!queries.length) return
      let touch = touches(applied, now)
      let routing = new Map([
        ...route(now, touched, durableNet),
        ...route(
          overlay(now, peers.values((eid) => touched.includes(eid))),
          touched,
          peerNet,
        ),
      ])
      return then(
        over(queries, (s) =>
          attempt(s, () => {
            if (opts.invalidate?.(s.query, applied)) {
              return then(s.peer ? read(s) : load(s.query), (set) => {
                let ids = new Set(set.map((b) => b.entity.eid))
                let gone = [...s.members].filter((id) => !ids.has(id))
                let joined = [...ids].filter((id) => !s.members.has(id))
                s.members = ids
                if (s.routed) network(s).add(s, s.query, ids)
                rememberFields(s, set)
                s.sink({ id: s.id, bundles: set, gone, ...hail(s, joined) })
              })
            }
            if (s.routed && !s.reads?.via.size) {
              return send(s, routing.get(s))
            }
            let scope = affected(s, touch)
            if (scope === undefined) return
            return push(s, scope ?? undefined, load)
          })),
        () => undefined,
      )
    })
  }
  let commit = (applied: Bundle[]) => ordered(() => commitNow(applied))

  // The entities a transaction changed, read whole, each moved through the
  // network once: what joined and what left every routed subscription.
  let route = (
    now: Bundle[],
    touched: Eid[],
    routing: ReturnType<typeof net<Sub>>,
    joinsOnly = false,
  ): Map<Sub, Moved> => {
    let out = new Map<Sub, Moved>()
    let of = (s: Sub) => {
      let m = out.get(s)
      if (!m) out.set(s, m = { bundles: [], joined: [], gone: [] })
      return m
    }
    let seen = new Set<Eid>()
    for (let b of now) {
      let eid = b.entity.eid
      seen.add(eid)
      let { into, out: left } = routing.move(b)
      for (let s of left) {
        s.members.delete(eid)
        of(s).gone.push(eid)
      }
      for (let s of into) {
        let joined = !s.members.has(eid)
        if (joined) of(s).joined.push(eid)
        s.members.add(eid)
        // Peer relays change routing but not stored data. Existing members
        // already heard the patch from cast(); only new members need a
        // full stored bundle and the held relay from hail().
        if (joined || !joinsOnly) {
          of(s).bundles.push(only(s.want ?? null)(stored(b)))
        }
      }
    }
    // An entity storage no longer holds at all has left every set too.
    for (let eid of touched) {
      if (seen.has(eid)) continue
      for (let s of routing.forget(eid)) {
        s.members.delete(eid)
        of(s).gone.push(eid)
      }
    }
    return out
  }

  // Deliver a relay patch to the old members before that patch changes a
  // peer-aware query's membership. A raw feed receives every patch.
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
  let peers: Relay<Sink> = relaying(
    graph.vocab,
    (b) => {
      let out = ordered(() => peerChange(b))
      if (isPromise(out)) out.catch((err) => fault(err, 'peer expiry'))
    },
    opts.timer,
  )

  // A peer query is answered from durable candidates and the relay's current
  // values together. The query plan keeps unrelated durable rows out of this
  // read, even when an OR has both stored and peer branches.
  let overlay = (rows: Bundle[], values: Bundle[]): Bundle[] => {
    let out = new Map(rows.map((b) => [b.entity.eid, b]))
    for (let peer of values) {
      let was = out.get(peer.entity.eid) ?? { entity: peer.entity }
      out.set(peer.entity.eid, { ...was, ...peer })
    }
    return [...out.values()]
  }
  let stored = (b: Bundle): Bundle => {
    let out: Bundle = { entity: b.entity }
    for (let [name, patch] of comps(b)) {
      if (!peerComp(name)) out[name] = patch
    }
    return out
  }
  let durableRows = (ids: Eid[]): Bundle[] | Promise<Bundle[]> => {
    let missing = ids.filter((eid) => !peerRows.has(eid))
    let collect = () => ids.flatMap((eid) => peerRows.get(eid) ?? [])
    if (!missing.length) return collect()
    return then(graph.get(missing), (rows) => {
      let found = new Map(rows.map((b) => [b.entity.eid, b]))
      for (let eid of missing) peerRows.set(eid, found.get(eid) ?? null)
      return collect()
    })
  }
  let source = (sub: Sub): Bundle[] | Promise<Bundle[]> => {
    let values = peers.values()
    let ids = [...new Set(values.map((b) => b.entity.eid))]
    let candidates = sub.candidates ??
      (sub.candidates = sub.durable
        ? graph.read(sub.durable, { durable: true })
        : [])
    return then(
      candidates,
      (rows) =>
        then(
          durableRows(ids),
          (held) => overlay([...rows, ...held], values),
        ),
    )
  }
  let read = (sub: Sub): Bundle[] | Promise<Bundle[]> => {
    if (!sub.peer) return graph.read(sub.query, { durable: true })
    return then(source(sub), (bundles) => {
      let chosen = matcher(sub.query, graph.vocab)(bundles)
      return chosen.map((b) => only(sub.want ?? null)(stored(b)))
    })
  }

  let peerChange = (bundles: Bundle[], except?: Sink) => {
    if (!bundles.length) return
    // Old members hear the patch that moved a row out; new members receive
    // its full held value in the membership frame below.
    cast(bundles, except)
    let touched = [...new Set(bundles.map((b) => b.entity.eid))]
    let values = peers.values((eid) => touched.includes(eid))
    let active = new Set(values.map((b) => b.entity.eid))
    let release = () => {
      for (let eid of touched) if (!active.has(eid)) peerRows.delete(eid)
    }
    if (!all().some((s) => s.peer)) {
      release()
      return
    }
    return then(durableRows(touched), (rows) => {
      let routing = route(
        overlay(rows, values),
        touched,
        peerNet,
        true,
      )
      release()
      return then(
        over(
          all().filter((s) => s.peer),
          (s) =>
            attempt(
              s,
              () => s.routed ? send(s, routing.get(s)) : push(s),
            ),
        ),
        () => undefined,
      )
    })
  }

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
    open: (sink, id, query) => ordered(() => open(sink, id, query)),
    close: (sink, id) =>
      ordered(() => {
        pending.get(sink)?.delete(id)
        forget(held.get(sink)?.get(id))
        held.get(sink)?.delete(id)
      }),
    drop: (sink) =>
      ordered(() => {
        pending.delete(sink)
        for (let sub of held.get(sink)?.values() ?? []) forget(sub)
        held.delete(sink)
        // Every value this connection was relaying stops being true when the
        // connection goes.
        let off = peers.drop(sink)
        if (off.length) return peerChange(off)
      }),
    commit,
    relay: (sink, bundles) => {
      // Admit before queueing, so even a patch superseded while waiting still
      // gets the same refusal as one sent without a backlog.
      let bare = admit(bundles, graph.vocab).map((b) => {
        let out: Bundle = { entity: { eid: b.entity.eid } }
        for (let [name, patch] of comps(b)) out[name] = patch
        return out
      })
      let waiting = relays.get(sink)
      if (waiting) {
        waiting.bundles = coalesced([...waiting.bundles, ...bare])
        return waiting.done
      }
      let run = (batch: Bundle[]) => {
        let out = peers.write(sink, batch)
        return peerChange(out, sink)
      }
      if (!pendingWork) return ordered(() => run(bare))
      let next = { bundles: bare, done: Promise.resolve() }
      relays.set(sink, next)
      next.done = ordered(() => {
        relays.delete(sink)
        return run(next.bundles)
      }) as Promise<void>
      return next.done
    },
    relaying: (sink) => peers.holds(sink),
    relayed: (sink, keys) => peers.adopt(sink, keys),
  }
}
