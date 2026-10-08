// Subscriptions: a saved query whose result is pushed again whenever a
// committed transaction changes it.
//
// The registry registers a hook on the graph's own `effect` phase, so every
// commit is seen — the ones that arrived through `POST /apply` and the ones
// the application wrote straight to the graph. A commit is handled in two
// steps: read the changed entities once, whole, then test them against each
// subscription.
//
// The writer does not wait for that. The hook starts the pass and returns, so a
// tool call's bookkeeping rows are answered at their commit, however many tabs
// are open and however long their windows take to read. Commits that arrive
// while a pass is still reading join the next one, so a busy writer costs the
// subscribers one more pass, not one per commit.
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

import type { Bundle, Eid, Graph, Query, ReadOpts } from '@yaks/graph'
import { after, isPromise, over } from '@yaks/fp'
import { during, link, parent, peek, scope, unlink } from '@yaks/trace'
import {
  coalesced,
  composed,
  formed,
  transient,
  type TransientFrame,
} from '@yaks/graph'
import {
  type Agg,
  aggregate,
  comps,
  type Coverage,
  flat,
  named,
  only,
  project,
  type Projected,
  type Projection,
  projection,
  type ReadView,
  type Reduced,
  reduced,
  Refused,
} from '@yaks/graph'
import { matcher, net, rows as matchRows } from '@yaks/match'
import { type And, bare, drifts, parse } from '@yaks/query'
import { paceOf, saveOf, syncOf } from '@yaks/vocab'
import { published } from './publish.ts'
import { cares, type Interest, interest } from './interest.ts'
import { peerPlan } from './peer_query.ts'
import { fault, type Refusal, refusal } from './refuse.ts'
import { type Relay, relay as relaying, type Timer } from './relay.ts'
import { type PeerWriter, saving } from './save.ts'

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
  /** what each of `bundles` covers, where a `.fields` projection narrowed it:
   * a property covered and left out is absent, one not covered was not read */
  coverage?: Record<Eid, Coverage>
  /** the entities a `.fields` projection's paths reach from the set, each
   * narrowed to what was read off it: carried along, never in the set */
  peers?: Bundle[]
  /** what each of `peers` covers */
  peerCoverage?: Record<Eid, Coverage>
  /** entities no path reaches any more */
  peerGone?: Eid[]
  /** entities that left the set — deleted, or no longer matching */
  gone?: Eid[]
  /**
   * `sync: peers` components being relayed: a cursor, a caret, a presence
   * dot. Components declaring `save` also retain a stored snapshot. A value cleared by its writer — or by
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

/** Saved watches recovered together after their owner lost its memory. */
export type Opening = { sink: Sink; id: string; query: Ask; opts?: ReadOpts }

/** The subscription registry: what the socket layer talks to, and what an
 * application can drive directly. */
export type Subs = {
  /** Runtime activity target, shared with the graph even through read overlays. */
  activity?: object
  /** Read bundles using the graph's query and read-option contract, with held
   * peer values unless `durable: true` selects storage alone. */
  read: Graph['read']
  /** Observe changes to held peer values after registry work has released.
   * Observers may read the registry or write the graph. */
  observe: (fn: (bundles: Bundle[]) => void | Promise<unknown>) => () => void
  /** Answer one query from storage and the peer values held right now. */
  snapshot: (
    query: Query,
    opts?: ReadOpts,
  ) => Bundle[] | Reduced | Promise<Bundle[] | Reduced>
  /** open (or replace) a subscription and send its current set */
  open: (
    sink: Sink,
    id: string,
    query: Ask,
    opts?: ReadOpts,
  ) => void | Promise<void>
  /** Reopen saved watches. A cold peer-only recovery may register proven
   * static durable interests without repeating the page's held snapshot. */
  restore: (openings: Opening[], deferStatic?: boolean) => void | Promise<void>
  /** Answer deferred static watches on an explicit read/handshake. */
  resume?: () => void | Promise<void>
  /** close one subscription */
  close: (sink: Sink, id: string) => void | Promise<void>
  /** close every subscription a sink holds — a client went away */
  drop: (sink: Sink) => void | Promise<void>
  /** a transaction committed: push what changed to whoever is watching */
  commit: (applied: Bundle[]) => void | Promise<void>
  /**
   * `sync: peers` components from one sink: forwarded to everyone else
   * watching those entities, and held under this sink until it closes
   * (relay.ts). Components declaring `save` also keep snapshots through apply.
   * Queries that read peer
   * components update their membership against the value now held.
   */
  relay: (
    sink: Sink,
    bundles: Bundle[],
    writer?: PeerWriter,
  ) => void | Promise<void>
  /** Socket inputs share one short fan-out batch across writers. Held values
   * and ownership change immediately; the returned promise follows delivery. */
  enqueue?: (
    sink: Sink,
    bundles: Bundle[],
    writer?: PeerWriter,
  ) => void | Promise<void>
  /** The vocabulary's cadence for a peer component, if it declares one. */
  pace?: (comp: string) => number | null
  /** The query deciding when a peer component is saved. */
  save?: (comp: string) => string | null
  /** The keys one sink's relayed values are held under — small enough to
   * store somewhere that outlives this process's memory. */
  relaying: (sink: Sink) => string[]
  /** Take those keys back after such a loss, so a close still clears them. */
  relayed: (sink: Sink, keys: string[]) => void | Promise<void>
}

type Sub = {
  id: string
  sink: Sink
  /** the raw feed of committed transactions, rather than a query */
  raw: boolean
  /** Interests stand, but the page's retained snapshot was not reread here.
   * Its first relevant durable change owes a complete scoped reset. */
  deferred?: boolean
  /** the query string (empty for a raw feed) */
  query: string
  ast?: And
  view?: ReadView
  opts?: ReadOpts
  send: (frame: Frame) => void | Promise<void>
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
  /** one reference through which this query reads a peer value */
  ref?: { comp: string; prop: string; far: Set<string> }
  /** the components its rows carry, or `null` for every one (@yaks/graph
   * `named`) */
  want?: Set<string> | null
  /** its `.fields` projection, when it asks for one */
  plan?: Projection | null
  /** a pushed bundle cut the way the first answer was */
  cut: (b: Bundle) => Bundle
  /** the entities its projection's paths reach from the set */
  riders: Set<Eid>
  /** the reduction an aggregate query asks for, and its last answer */
  agg?: Agg
  answer?: string
  /** what a refresh or an aggregate is read from, or `null` when every
   * commit can move it */
  reads?: Interest | null
  /** the answer this subscription shares with every other asking the same */
  shared?: Shared
  /** closed, and standing only to keep its shared answer current */
  kept?: boolean
}

// A routed answer held in memory: the rows a client subscribed all along
// holds, kept current by the network from what each commit moved, never by
// asking again. Subscriptions asking the same query with the same options
// share one, and the last to close leaves it standing, so a page that lets go
// of a watch and asks for it again (a map walked back across, a reload) is
// answered from memory. Answers hold at most HELD rows; closed ones KEPT rows
// between them, the longest unasked let go first.
type Shared = { key: string; rows: Map<Eid, Bundle>; users: Set<Sub> }
const HELD = 512, KEPT = 8192

// Membership and projection use storage's vocabulary; delivery uses the caller's.
let queryOf = (sub: Sub, q = sub.query): Query => {
  if (!sub.ast) return q
  if (q == sub.query) return sub.ast
  return {
    ...sub.ast,
    clauses: [
      ...sub.ast.clauses,
      ...parse(q.slice(sub.query.length)).clauses,
    ],
  }
}

// What one commit did to one routed subscription: the entities now in its set,
// the ones among them that were not in it before, and the ones that left it.
type Moved = { bundles: Bundle[]; joined: Eid[]; gone: Eid[] }

// A query's answer as a subscription holds it: the entities in its set, and
// the ones its projection's paths reach from them.
type Answer = Projected | Promise<Projected>

let answered = (found: Bundle[]): Projected => ({
  found,
  reached: [],
  covers: new Map(),
})

let whole = (b: Bundle) => b

let covering = (
  bundles: Bundle[],
  of: (eid: Eid) => Coverage,
): Record<Eid, Coverage> =>
  Object.fromEntries(bundles.map((b) => [b.entity.eid, of(b.entity.eid)]))

// What one commit did to each entity it touched: the components its patches
// named, and the ones it wears now, or `null` once it is deleted.
type Touch = Map<Eid, {
  named: Set<string>
  props: Set<string>
  worn: Set<string> | null
  bundle?: Bundle
  born: boolean
}>

// A write matters when it changes what the query tests or sends. A whole-row
// projection also observes every component of an entity already in its set.
let notices = (sub: Sub, b: Bundle): boolean => {
  if (
    !sub.reads || sub.reads.unseen || b.$delete ||
    (sub.deferred && sub.want === null)
  ) return true
  if (sub.want === null && sub.members.has(b.entity.eid)) return true
  let i = sub.reads
  if (b.created && !i.own.length) return true
  return Object.keys(b).some((c) =>
    c != 'entity' &&
    (i.near.has(c) || i.far.has(c) || i.via.has(c))
  )
}

// `get` is only for deciding changed entities' membership and filling their
// frames. Read the union of what open queries test and project, unless one
// query needs the entire row or a peer cache must retain it.
let components = (subs: Sub[]): string[] | undefined => {
  let names = new Set<string>()
  for (let s of subs) {
    if (s.peer || !s.reads || s.want === null) return undefined
    for (let c of s.reads.near) names.add(c)
    for (let c of s.reads.far) names.add(c)
    for (let c of s.reads.via.keys()) names.add(c)
    for (let c of s.want ?? []) names.add(c)
  }
  names.delete('entity')
  return [...names]
}

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
let affected = (
  sub: Sub,
  touch: Touch,
  relevant: Set<Eid>,
): Set<Eid> | null | undefined => {
  let i = sub.reads
  if (!i || i.unseen) return null
  let ids = new Set<Eid>()
  for (let [eid, t] of touch) {
    if (!relevant.has(eid)) continue
    if (!t.worn) return null
    if ([...i.far].some((c) => t.named.has(c) || t.worn!.has(c))) {
      return null
    }
    if (
      sub.members.has(eid) ||
      (t.born && !i.own.length) ||
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
 * subs.open(sink, 'cheap', '.book&.book.price<20')
 * ```
 */
export let subscriptions = (graph: Graph, opts: {
  /** The composed graph when `graph` is only its read overlay. */
  activity?: object
  /** A query may depend on entities outside its result (for example a computed
   * session status depends on transcript entries). Returning true refreshes
   * that subscription after this commit. It does not subscribe to those rows. */
  invalidate?: (query: string, applied: Bundle[]) => boolean
  /** how a `durable: "5s"` relayed value's timer is set (default:
   * setTimeout) */
  timer?: Timer
  /** Clock used by pending save queries. */
  now?: () => number
} = {}): Subs => {
  let held = new Map<Sink, Map<string, Sub>>()
  let all = () => [...held.values()].flatMap((m) => [...m.values()])
  let durableNet = net<Sub>(graph.vocab)
  let peerNet = net<Sub>(graph.vocab)
  // Keep storage rows only while a peer value makes their entity relevant.
  // A missing row is cached too: a peer-only entity must not hit storage on
  // every movement.
  let peerRows = new Map<Eid, Bundle | null>()
  // A reference's durable answer changes only with a commit that writes its
  // component, or writes an entity among its rows. Keep its full rows across
  // peer movements and other commits, including empty answers, with a fixed
  // bound for spaces that hold many peer values at once.
  let backlinks = new Map<
    string,
    { comp: string; peer: Eid; rows: Bundle[] }
  >()
  const BACKLINK_LIMIT = 512
  let linkKey = (comp: string, prop: string, peer: Eid) =>
    JSON.stringify([comp, prop, peer])
  let linked = (
    ref: { comp: string; prop: string },
    targets: Eid[],
  ): Bundle[] | Promise<Bundle[]> => {
    let answers = new Map<Eid, Bundle[]>()
    for (let peer of targets) {
      let rows = backlinks.get(linkKey(ref.comp, ref.prop, peer))?.rows
      if (rows) answers.set(peer, rows)
    }
    let missing = targets.filter((peer) => !answers.has(peer))
    let fresh = missing.length
      ? after(
        graph.read(
          `.${ref.comp}.${ref.prop}=${missing.join(',')}`,
          { durable: true, native: true },
        ),
        (refs) =>
          refs.length
            ? graph.get(refs.map((b) => b.entity.eid), undefined, {
              native: true,
            })
            : [],
      )
      : []
    return after(fresh, (rows) => {
      for (let peer of missing) {
        let key = linkKey(ref.comp, ref.prop, peer)
        let matching = rows.filter((b) =>
          (b[ref.comp] as Record<string, unknown> | undefined)
            ?.[ref.prop] == peer
        )
        answers.set(peer, matching)
        backlinks.set(key, { comp: ref.comp, peer, rows: matching })
      }
      while (backlinks.size > BACKLINK_LIMIT) {
        backlinks.delete(backlinks.keys().next().value!)
      }
      let held = peers.referencing(ref.comp, ref.prop, targets)
      return [...targets.flatMap((peer) => answers.get(peer) ?? []), ...held]
    })
  }
  let network = (sub: Sub) => sub.peer ? peerNet : durableNet
  let peerComp = (name: string) => syncOf(graph.vocab, name) == 'peers'
  let pendingWork: Promise<void> | undefined
  let observers = new Set<(bundles: Bundle[]) => void | Promise<unknown>>()
  let observed: Bundle[] = []
  let observing = false
  let notify = (bundles: Bundle[]) => {
    if (!observers.size || !bundles.length) return
    observed.push(...bundles)
    if (observing) return
    observing = true
    let released = () => {
      // Registry work never awaits an observer: it may read this registry or
      // write through a graph hook that queues more registry work.
      if (pendingWork) return void pendingWork.then(released)
      observing = false
      let changes = coalesced(observed)
      observed = []
      for (let fn of observers) {
        try {
          let out = fn(changes)
          if (isPromise(out)) out.catch((err) => fault(err, 'peer observer'))
        } catch (err) {
          fault(err, 'peer observer')
        }
      }
    }
    queueMicrotask(released)
  }

  let ordered = <T>(fn: () => T | Promise<T>): T | Promise<T> => {
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
  let saves = saving<Sink>(graph, (fn, ms) =>
    (opts.timer ?? ((fn, ms) => {
      let t = setTimeout(fn, ms)
      return () => clearTimeout(t)
    }))(() => {
      let out = ordered(fn)
      if (isPromise(out)) out.catch((err) => fault(err, 'peer saving'))
    }, ms), (sink, err) => {
    fault(err, 'peer saving')
    sink({ id: '', refused: refusal(err) })
  }, opts.now)
  let saved = (bundles: Bundle[]) =>
    bundles.some((b) =>
      comps(b).some(([comp]) => saveOf(graph.vocab, comp) != null)
    )
  let relays = new Map<Sink, { bundles: Bundle[]; done: Promise<void> }>()
  let shared = new Map<string, Shared>()
  // The closed subscriptions keeping a shared answer, longest unasked first.
  let kept = new Map<string, Sub>()
  let keyOf = (sub: Sub) => JSON.stringify([sub.query, sub.opts ?? null])
  let unshare = (share: Shared) => {
    if (shared.get(share.key) === share) shared.delete(share.key)
    for (let s of share.users) {
      s.shared = undefined
      if (!s.kept) continue
      kept.delete(share.key)
      network(s).drop(s)
    }
    share.users.clear()
  }
  // A routed subscription that reads only what each entity holds, now and
  // later alike, takes up the answer others asking the same share, or starts
  // one for them when its own is small enough to hold.
  let join = (sub: Sub, ast: And, bundles: Bundle[]) => {
    if (
      sub.view || sub.peer || sub.agg || sub.plan || sub.reads?.via.size ||
      moving(ast)
    ) return
    let share = shared.get(keyOf(sub))
    if (!share) {
      if (bundles.length > HELD) return
      share = {
        key: keyOf(sub),
        rows: new Map(bundles.map((b) => [b.entity.eid, b])),
        users: new Set(),
      }
      shared.set(share.key, share)
    }
    for (let k of share.users) {
      if (!k.kept) continue
      share.users.delete(k)
      kept.delete(share.key)
      network(k).drop(k)
    }
    share.users.add(sub)
    sub.shared = share
  }
  // A subscription let go of, by its sink closing it or by a new one under
  // its id: the network lets go of it too, unless it is the last keeping a
  // shared answer, which it keeps current while the answer stays kept.
  let forget = (sub: Sub | undefined, keep = true) => {
    if (!sub?.routed) return
    let share = sub.shared
    share?.users.delete(sub)
    if (share && !share.users.size) {
      if (!keep) return unshare(share)
      sub.kept = true
      share.users.add(sub)
      kept.set(share.key, sub)
      let rows = 0
      for (let k of [...kept.values()].reverse()) {
        rows += k.shared!.rows.size
        if (rows > KEPT) unshare(k.shared!)
      }
      return
    }
    network(sub).drop(sub)
  }

  // A subscription whose query is refused is closed, not kept: a query the
  // graph cannot answer would otherwise throw on every commit for the life of
  // the socket.
  let cut = (sub: Sub, err: unknown) => {
    held.get(sub.sink)?.delete(sub.id)
    forget(sub, false)
    fault(err, 'subscription')
    sub.sink({ id: sub.id, refused: refusal(err) })
  }

  let delivery = (
    sink: Sink,
    id: string,
    readOpts?: ReadOpts,
    raw = false,
  ): Sub['send'] => {
    let sendPublished: Sink = (frame) => {
      let out: Frame = { ...frame }
      for (let key of ['bundles', 'peers', 'relay'] as const) {
        if (frame[key]) out[key] = published(graph.vocab, frame[key])
      }
      for (let key of ['coverage', 'peerCoverage'] as const) {
        if (!frame[key]) continue
        out[key] = Object.fromEntries(
          Object.entries(frame[key]).map(([eid, coverage]) => [
            eid,
            coverage === true ? true : Object.fromEntries(
              Object.entries(coverage).filter(([comp]) =>
                syncOf(graph.vocab, comp) != 'none'
              ),
            ),
          ]),
        )
      }
      if (frame.transient) {
        out.transient = frame.transient.filter((f) =>
          syncOf(graph.vocab, f.component) != 'none'
        )
      }
      return sink(out)
    }
    if (!graph.rewrites(readOpts)) return sendPublished
    let patchOpts = { ...readOpts, patch: true }
    let waiting: Promise<void> | undefined
    let send = (frame: Frame) => {
      let rewritten: Frame = { ...frame }
      return after(
        over(['bundles', 'peers', 'relay'] as const, (key) => {
          let bundles = frame[key]
          if (!bundles) return
          return after(
            graph.answer(
              published(graph.vocab, bundles),
              key == 'relay' || raw && key == 'bundles' ? patchOpts : readOpts,
            ),
            (out) => {
              rewritten[key] = out
            },
          )
        }),
        () =>
          after(
            over(['coverage', 'peerCoverage'] as const, (key) => {
              let coverage = frame[key]
              if (!coverage) return
              let rows: Bundle[] = Object.entries(coverage).flatMap(
                ([eid, comps]) => {
                  if (comps === true) return []
                  let row: Bundle = { entity: { eid } }
                  for (let [comp, props] of Object.entries(comps)) {
                    row[comp] = props === true
                      ? {}
                      : Object.fromEntries(props.map((p) => [p, null]))
                  }
                  return [row]
                },
              )
              return after(
                graph.answer(published(graph.vocab, rows), readOpts),
                (out) => {
                  rewritten[key] = { ...coverage }
                  for (let row of out) {
                    rewritten[key]![row.entity.eid] = Object.fromEntries(
                      Object.entries(row).filter(([name]) => name != 'entity')
                        .map((
                          [name, props],
                        ) => [
                          name,
                          props && typeof props == 'object'
                            ? Object.keys(props).length
                              ? Object.keys(props)
                              : true
                            : [],
                        ]),
                    )
                  }
                },
              )
            }),
            () => sendPublished(rewritten),
          ),
      )
    }
    return (frame) => {
      let fail = (err: unknown) => {
        let sub = held.get(sink)?.get(id)
        if (sub) cut(sub, err)
      }
      try {
        let out = waiting ? waiting.then(() => send(frame)) : send(frame)
        if (isPromise(out)) {
          let pending = out.catch(fail)
          waiting = pending
          pending.then(() => {
            if (waiting === pending) waiting = undefined
          })
          return pending
        }
      } catch (err) {
        fail(err)
      }
    }
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

  // What a subscription's query answers now. A projection whose paths reach
  // other entities is read as its rows (@yaks/graph `project`), which tell the
  // entities it selects from the ones they reach; any other query is the
  // graph's read, the same answer `/query` gives.
  let ask = (sub: Sub, q: string): Answer =>
    sub.view
      ? viewed(sub.view, sub.opts)
      : sub.plan?.reaches.length
      ? project(graph, sub.plan, { ...sub.opts, durable: true, native: true })
      : after(
        graph.read(queryOf(sub, q), {
          ...sub.opts,
          durable: true,
          native: !!sub.ast || graph.rewrites(sub.opts) || sub.opts?.native,
        }),
        answered,
      )

  // The bundles a frame carries, and what each covers where a projection
  // narrowed them, so a replica clears only a property the projection named.
  // A projection that reaches sends its riders whole each time, and names the
  // ones no path reaches any more.
  let framed = (
    sub: Sub,
    bundles: Bundle[],
    { reached, covers }: Projected = answered([]),
    initial = false,
  ): Partial<Frame> => {
    // Current held values outrun saved snapshots. New replicas initialize
    // from the saved value; subsequent updates carry the live one when held.
    if (!initial && !sub.view) {
      let latest = (b: Bundle) => {
        let out = { ...b }
        let held = peers.values([b.entity.eid])[0]
        for (let [comp, patch] of held ? comps(held) : []) {
          if (saveOf(graph.vocab, comp) != null) out[comp] = patch
        }
        return out
      }
      bundles = bundles.map((b) => sub.cut(latest(b)))
      reached = reached.map((b) => {
        let out = latest(b), coverage = covers.get(b.entity.eid)
        if (!coverage) return b
        return {
          entity: out.entity,
          ...Object.fromEntries(
            Object.entries(coverage).flatMap(([comp, props]) => {
              let value = out[comp] as Record<string, unknown> | undefined
              return value
                ? [[
                  comp,
                  Object.fromEntries(
                    props.filter((p) => p in value).map((p) => [p, value[p]]),
                  ),
                ]]
                : []
            }),
          ),
        }
      })
    }
    let p = sub.plan
    if (!p) {
      // A component-selected answer knows whole components, not the entity.
      // Include absent requested components so snapshots clear stale values.
      if (sub.want == null) return { bundles }
      let scope: Coverage = Object.fromEntries(
        [...sub.want].map((comp) => [comp, true]),
      )
      return { bundles, coverage: covering(bundles, () => scope) }
    }
    let own = { bundles, coverage: covering(bundles, () => p.own) }
    if (!p.reaches.length) return own
    let now = new Set(reached.map((b) => b.entity.eid))
    let peerGone = [...sub.riders].filter((eid) => !now.has(eid))
    sub.riders = now
    return {
      ...own,
      peers: reached,
      peerCoverage: covering(reached, (eid) => covers.get(eid)!),
      ...peerGone.length ? { peerGone } : {},
    }
  }

  // A path no component declares (`.kind`) may be anything: it drifts.
  let moving = (ast: And): boolean =>
    drifts(ast, (c) => {
      let leaf = graph.vocab.aim(c.path.join('.'), bare(c)).at(-1)
      return leaf && graph.vocab.prop(leaf.comp, leaf.prop)?.scalar
    })

  let open = (
    sink: Sink,
    id: string,
    query: Ask,
    readOpts?: ReadOpts,
    rows?: Map<string, Answer>,
    answers?: Map<string, Reduced | Promise<Reduced>>,
    deferStatic = false,
  ) => {
    flush()
    let mine = held.get(sink) ?? new Map<string, Sub>()
    held.set(sink, mine)
    let line = query === true ? '' : query
    let sub: Sub = {
      id,
      sink,
      raw: query === true,
      query: line,
      opts: readOpts,
      send: delivery(sink, id, readOpts, query === true),
      members: new Set(),
      fields: new Map(),
      routed: false,
      peer: false,
      cut: whole,
      riders: new Set(),
    }
    forget(mine.get(id))
    mine.set(id, sub)
    // a raw feed carries whole transactions, not a membership set
    if (sub.raw) return
    return attempt(sub, () => {
      // Parsed here, before the network is asked, so a query that cannot be
      // parsed is refused rather than quietly demoted to a subscription that
      // runs it again on every commit forever.
      return after(graph.view(line, readOpts), (view) => {
        if (view) {
          sub.view = view
          sub.ast = view.original
          sub.reads = interest(view.original, view.vocab, graph.worn)
          sub.peer = view.dependencies?.some(peerComp) ?? false
          sub.agg = aggregate(view.original)
          sub.want = named(view.vocab, view.original)
          sub.plan = projection(view.vocab, view.original)
          sub.cut = sub.plan?.cut ?? only(sub.want)
          // The view already speaks the caller's words.
          sub.send = delivery(sink, id, { ...readOpts, native: true })
          if (sub.agg) return tell(sub, true, answers)
          let key = JSON.stringify([line, readOpts])
          let loaded = rows?.get(key)
          if (!loaded) {
            loaded = viewed(view, readOpts)
            rows?.set(key, loaded)
          }
          return after(loaded, (answer) => {
            for (let b of answer.found) sub.members.add(b.entity.eid)
            rememberFields(sub, answer.found)
            return sub.send({ id, ...framed(sub, answer.found, answer, true) })
          })
        }
        return after(
          graph.rewrites(readOpts) ? graph.ask(line, readOpts) : line,
          (q) => {
            let ast = typeof q == 'string' ? parse(q) : q
            if (typeof q != 'string') sub.ast = ast
            sub.reads = interest(ast, graph.vocab, graph.worn)
            let plan = peerPlan(ast, graph.vocab)
            sub.peer = plan.peers
            sub.durable = plan.durable
            sub.ref = plan.ref
            sub.agg = aggregate(ast)
            sub.want = named(graph.vocab, ast, q !== line)
            sub.plan = projection(graph.vocab, ast)
            sub.cut = sub.plan?.cut ?? only(sub.want)
            if (
              deferStatic && !sub.peer && sub.reads && !sub.reads.unseen &&
              sub.opts?.now == null && !sub.agg &&
              !moving(ast) &&
              [...sub.reads.near, ...sub.reads.far, ...sub.reads.via.keys()]
                .every((c) => syncOf(graph.vocab, c) != 'peers')
            ) {
              sub.deferred = true
              return
            }
            if (sub.agg) return tell(sub, true, answers)
            if (sub.peer && sub.plan?.reaches.length) {
              throw new Refused(
                'a projection through a reference is not read over relayed values',
              )
            }
            let key = readOpts ? JSON.stringify([line, readOpts]) : line
            let share = shared.get(keyOf(sub))
            let loaded = share
              ? answered([...share.rows.values()])
              : rows?.get(key)
            if (!loaded) {
              loaded = sub.peer ? after(read(sub), answered) : ask(sub, line)
              rows?.set(key, loaded)
            }
            return after(loaded, (answer) => {
              let bundles = answer.found
              for (let b of bundles) sub.members.add(b.entity.eid)
              // A query over a computed component is never routed: the entities it
              // selects move without a bundle that names them (./interest.ts). Nor
              // is a projection that reaches: what it reaches moves without the
              // entities it selects moving.
              if (
                held.get(sink)?.get(id) === sub && !sub.reads?.unseen &&
                !sub.plan?.reaches.length && sub.opts?.now == null
              ) {
                sub.routed = network(sub).add(sub, ast, sub.members)
                if (sub.routed) join(sub, ast, bundles)
              }
              rememberFields(sub, bundles)
              const snapshots = live.snapshots().filter((f) => visible(sub, f))
              // The relayed values other connections already hold for this set, so
              // a subscriber that arrives late still sees the cursors that were
              // there before it.
              let now = peers.snapshot(sink, (eid) => sub.members.has(eid))
              return sub.send({
                id,
                ...framed(sub, bundles, answer, true),
                transientReset: bundles.map((b) => b.entity.eid),
                ...snapshots.length ? { transient: snapshots } : {},
                ...now.length ? { relay: now } : {},
              })
            })
          },
        )
      })
    })
  }

  // An aggregate's answer, sent when it is new: always on open, and after a
  // commit only when the value moved. A count or a tally is a question about
  // the whole set, so it is asked again after every commit.
  let tell = (
    sub: Sub,
    first = false,
    answers?: Map<string, Reduced | Promise<Reduced>>,
  ) => {
    let key = sub.opts ? JSON.stringify([sub.query, sub.opts]) : sub.query
    let value = answers?.get(key)
    if (!value) {
      value = sub.view
        ? after(
          viewValues(sub.view, sub.opts),
          (bundles) =>
            reduced(
              sub.agg!,
              matchRows(sub.view!.original, sub.view!.vocab, sub.opts)(bundles),
            ),
        )
        : after(
          sub.peer
            ? after(
              source(sub),
              (bundles) =>
                matchRows(queryOf(sub), graph.vocab, sub.opts)(bundles),
            )
            : graph.rows(queryOf(sub), {
              ...sub.opts,
              durable: true,
              native: !!sub.ast || graph.rewrites(sub.opts) || sub.opts?.native,
            }),
          (rows) => reduced(sub.agg!, rows),
        )
      answers?.set(key, value)
    }
    return after(value, (value) => {
      let answer = JSON.stringify(value)
      if (!first && answer == sub.answer) {
        return
      }
      sub.answer = answer
      return sub.send({ id: sub.id, ...value })
    })
  }

  // What a commit did to one routed subscription, sent cut to what the query
  // names.
  let send = (sub: Sub, moved?: Moved) => {
    if (!moved) return
    let { bundles, joined, gone } = moved
    let share = sub.shared
    if (share) {
      for (let b of bundles) share.rows.set(b.entity.eid, b)
      for (let eid of gone) share.rows.delete(eid)
      if (share.rows.size > HELD) unshare(share)
    }
    if (sub.kept) return
    rememberFields(sub, bundles)
    for (const eid of gone) sub.fields.delete(eid)
    if (bundles.length || gone.length) {
      return sub.send({
        id: sub.id,
        ...framed(sub, bundles),
        gone,
        ...hail(sub, joined),
      })
    }
  }

  // What the peers are already saying about entities that just joined a set,
  // as a subscription that opens is told it: a writer relays a value when it
  // changes, so one relayed before its entity joined would otherwise not be
  // heard again until it moved.
  let hail = (sub: Sub, joined: Eid[]): { relay?: Bundle[] } => {
    if (!joined.length || sub.view) return {}
    let fresh = new Set(joined)
    let now = peers.snapshot(sub.sink, (eid) => fresh.has(eid))
    return now.length ? { relay: now } : {}
  }

  // A refresh runs against the affected entities where it can locate them.
  // A limit, order or unlocated dependency still needs the whole answer, and
  // so does a projection that reaches: what it reaches is the whole answer's.
  let push = (
    sub: Sub,
    scope?: Set<Eid>,
    load: (sub: Sub, q: string) => Answer = ask,
    prepared?: Bundle[] | Promise<Bundle[]>,
    joinsOnly = false,
  ) => {
    if (sub.agg) return tell(sub)
    if (sub.plan?.reaches.length) scope = undefined
    let query = scope
      ? sub.query + '&.entity.eid=' + [...scope].join(',')
      : sub.query
    let loaded = sub.view
      ? viewed(sub.view, sub.opts)
      : sub.peer
      ? after(read(sub, scope, prepared), answered)
      : load(sub, query)
    return after(loaded, (answer) => {
      let set = answer.found
      let ids = new Set(set.map((b) => b.entity.eid))
      let gone = [...(scope ?? sub.members)].filter((e) =>
        sub.members.has(e) && !ids.has(e)
      )
      // An entity can join without being touched: a hop or a computed
      // property moved it from the far side.
      let joined = [...ids].filter((e) => !sub.members.has(e))
      if (scope) {
        for (let e of gone) sub.members.delete(e)
        for (let e of ids) sub.members.add(e)
      } else sub.members = ids
      if (sub.routed) network(sub).add(sub, queryOf(sub), sub.members)
      // A far peer movement changes membership, not stored answer rows.
      // Existing members need no second copy of their unchanged row.
      let changed = joinsOnly
        ? set.filter((b) => joined.includes(b.entity.eid))
        : set
      rememberFields(sub, changed)
      for (let e of gone) sub.fields.delete(e)
      let frame = framed(sub, changed, answer)
      if (changed.length || gone.length || frame.peerGone) {
        return sub.send({ id: sub.id, ...frame, gone, ...hail(sub, joined) })
      }
    })
  }

  // One pass over the transactions that committed since the last: each one
  // to the raw feeds, then all of them at once to the queries.
  let fanout = (txs: Bundle[][]) => {
    let target = opts.activity ?? graph
    let c = peek(target)
    if (!c) return commitNow(txs)
    // Refreshes can run after the writer has already answered. The box host
    // treats a missing/completed parent as an independent request; a Store
    // still recording that write keeps this pass in its existing tree.
    return scope(undefined, () =>
      during(
        c.begin({
          kind: 'request',
          name: 'ws refresh',
          package: '@yaks/api',
          parent: parent(target, txs[0]),
        }),
        () =>
          during(
            c.begin({
              kind: 'fanout',
              name: 'subscriptions',
              package: '@yaks/api',
            }),
            () => commitNow(txs),
            'ok',
            () => ({
              transactions: txs.length,
              bundles: txs.reduce((n, b) => n + b.length, 0),
              subscriptions: all().length,
            }),
          ),
      ))
  }

  let commitNow = (txs: Bundle[][]) => {
    flush()
    let applied = txs.flat()
    let wrote = new Set(applied.map((b) => b.entity.eid))
    let named = new Set(applied.flatMap((b) => Object.keys(b)))
    for (let [key, link] of backlinks) {
      if (
        named.has(link.comp) || link.rows.some((b) => wrote.has(b.entity.eid))
      ) backlinks.delete(key)
    }
    let subs = all()
    // A raw feed sends each transaction to a client, and this hook is handed
    // what the phases passed to each other — one patch each, with the `$`
    // keys still on them. So it is composed here, the same way `apply()`
    // composes what it returns: a subscriber receives exactly what the writer
    // did.
    let raw = subs.filter((s) => s.raw)
    for (let tx of raw.length ? txs : []) {
      let bundles = composed(tx)
      for (let s of raw) s.send({ id: s.id, bundles })
    }
    let queries = [...subs.filter((s) => !s.raw), ...kept.values()]
    let invalidated = new Set(
      queries.filter((s) =>
        s.deferred && applied.some((b) => notices(s, b)) ||
        opts.invalidate?.(s.query, applied) ||
        s.view && applied.some((b) =>
            b.$delete ||
            !s.view!.dependencies || comps(b).some(([comp]) =>
              s.view!.dependencies!.includes(comp)
            )
          )
      ),
    )
    let noticedBy = new Map(queries.map((s) => [
      s,
      new Set(applied.filter((b) => notices(s, b)).map((b) => b.entity.eid)),
    ]))
    let relevant = new Set(
      queries.filter((s) => invalidated.has(s) || noticedBy.get(s)!.size),
    )
    for (let s of relevant) if (s.peer) s.candidates = undefined
    let touched = [
      ...new Set(
        applied.filter((b) =>
          peerRows.has(b.entity.eid) || invalidated.size ||
          [...noticedBy.values()].some((ids) => ids.has(b.entity.eid))
        ).map((b) => b.entity.eid),
      ),
    ]
    if (!relevant.size && !touched.length) return
    let reads = new Map<string, Answer>()
    let load = (s: Sub, q: string) => {
      let key = s.opts ? JSON.stringify([q, s.opts]) : q
      let got = reads.get(key)
      if (!got) reads.set(key, got = ask(s, q))
      return got
    }
    let names = touched.some((eid) => peerRows.has(eid))
      ? undefined
      : components(queries)
    return after(graph.get(touched, names, { native: true }), (now) => {
      let changed = new Map(now.map((b) => [b.entity.eid, b]))
      for (let eid of touched) {
        if (peerRows.has(eid)) {
          let row = changed.get(eid)
          peerRows.set(eid, row ? stored(row) : null)
        }
      }
      if (!queries.length) return
      let touch = touches(applied, now)
      let routing = new Map([
        ...route(now, touched, durableNet),
        ...route(
          overlay(now.map(stored), peers.values(touched)),
          touched,
          peerNet,
        ),
      ])
      return after(
        over(queries, (s) =>
          attempt(s, () => {
            if (!relevant.has(s)) return
            if (invalidated.has(s)) {
              // An answer asked again whole is no longer one kept current.
              if (s.shared) unshare(s.shared)
              if (s.kept) return
              let reset = s.deferred
              if (s.agg) return tell(s)
              let loaded = s.view
                ? viewed(s.view, s.opts)
                : s.peer
                ? after(read(s), answered)
                : load(s, s.query)
              return after(loaded, (answer) => {
                s.deferred = false
                let set = answer.found
                let ids = new Set(set.map((b) => b.entity.eid))
                let gone = [...s.members].filter((id) => !ids.has(id))
                let joined = [...ids].filter((id) => !s.members.has(id))
                s.members = ids
                if (
                  reset && !s.reads?.unseen && !s.plan?.reaches.length &&
                  s.opts?.now == null
                ) s.routed = network(s).add(s, queryOf(s), ids)
                else if (s.routed) network(s).add(s, queryOf(s), ids)
                rememberFields(s, set)
                return s.send({
                  id: s.id,
                  ...framed(s, set, answer),
                  ...reset ? { reset: true } : {},
                  gone,
                  ...hail(s, joined),
                })
              })
            }
            if (s.routed && !s.reads?.via.size) {
              let moved = routing.get(s)
              if (moved) {
                let joined = new Set(moved.joined)
                moved.bundles = moved.bundles.filter((b) =>
                  joined.has(b.entity.eid) ||
                  noticedBy.get(s)!.has(b.entity.eid)
                )
              }
              return send(s, moved)
            }
            // An ordered window can change only at the named local rows.
            // Re-select its existing members plus those rows, not every old
            // entry. A missing replacement (delete/filter exit) falls back to
            // the full query, since an unseen row may fill the window then.
            let ast = s.ast ?? parse(s.query)
            let limit = ast.clauses.find((c) => c.kind == 'limit')
            if (
              limit?.kind == 'limit' && !s.peer && !s.view && !s.agg &&
              s.reads && !s.reads.unseen && !s.reads.far.size &&
              !s.reads.via.size && s.reads.own.length &&
              !ast.clauses.some((c) => c.kind == 'after') &&
              (s.members.size < limit.n ||
                ![...noticedBy.get(s)!].some((id) => s.members.has(id)))
            ) {
              let local = affected(
                { ...s, reads: { ...s.reads, whole: false } },
                touch,
                noticedBy.get(s)!,
              )
              if (local === undefined) return
              if (local) {
                if (
                  s.members.size < limit.n &&
                  [...s.members].filter((id) => !local.has(id)).length +
                        local.size <= limit.n &&
                  [...local].every((id) => /^[a-zA-Z0-9_-]+$/.test(id))
                ) {
                  let query = s.query + '&.entity.eid=' + [...local].join(',')
                  return after(load(s, query), (answer) => {
                    let unaffected = [...s.members].filter((id) =>
                      !local.has(id)
                    ).length
                    return unaffected + answer.found.length <= limit.n
                      ? push(s, local, () => answer)
                      : push(s, undefined, load)
                  })
                }
                let candidates = [...new Set([...s.members, ...local])]
                if (
                  candidates.some((id) => !/^[a-zA-Z0-9_-]+$/.test(id))
                ) return push(s, undefined, load)
                let q = s.query + '&.entity.eid=' + candidates.join(',')
                let loaded = load(s, q)
                return after(loaded, (answer) => {
                  return push(s, undefined, () =>
                    s.members.size >= limit.n && answer.found.length < limit.n
                      ? load(s, s.query)
                      : answer)
                })
              }
            }
            let scope = affected(s, touch, noticedBy.get(s)!)
            if (scope === undefined) {
              return
            }
            return push(s, scope ?? undefined, load)
          })),
        () => undefined,
      )
    })
  }
  // A commit that finds earlier work still running waits for it, beside every
  // commit that arrives meanwhile: when their turn comes they are one pass.
  let waiting: { txs: Bundle[][]; done: Promise<void> } | undefined
  let commit = (applied: Bundle[]): void | Promise<void> => {
    flushPeers()
    if (waiting) {
      waiting.txs.push(applied)
      return waiting.done
    }
    if (!pendingWork) return ordered(() => fanout([applied]))
    let next = { txs: [applied], done: Promise.resolve() }
    waiting = next
    next.done = ordered(() => {
      waiting = undefined
      return fanout(next.txs)
    }) as Promise<void>
    return next.done
  }

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
          of(s).bundles.push(s.cut(s.peer ? stored(b) : b))
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
        // Views refresh after the canonical movement; their whole answer
        // includes the reconstructed relay value in the caller's vocabulary.
        if (sub.view) continue
        let seen = sub.raw
          ? bundles
          : bundles.filter((b) => sub.members.has(b.entity.eid))
        if (seen.length) sub.send({ id: sub.id, relay: seen })
      }
    }
  }
  let peers: Relay<Sink> = relaying(
    graph.vocab,
    (b) => {
      flushPeers()
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
    return after(graph.get(missing, undefined, { native: true }), (rows) => {
      let found = new Map(rows.map((b) => [b.entity.eid, stored(b)]))
      for (let eid of missing) peerRows.set(eid, found.get(eid) ?? null)
      return collect()
    })
  }
  let source = (
    sub: Sub,
    scope?: Set<Eid>,
    scoped?: Bundle[] | Promise<Bundle[]>,
  ): Bundle[] | Promise<Bundle[]> => {
    let candidates = scope
      ? scoped ??
        after(
          graph.get([...scope], undefined, { native: true }),
          (rows) => rows.map(stored),
        )
      : sub.candidates ??
        (sub.candidates = sub.durable
          ? after(
            graph.read(sub.durable, {
              ...sub.opts,
              durable: true,
              native: !!sub.ast || graph.rewrites(sub.opts) || sub.opts?.native,
            }),
            (rows) => rows.map(stored),
          )
          : [])
    if (scope) {
      return after(candidates, (rows) => {
        let ids = new Set(scope)
        if (sub.ref) {
          for (let row of overlay(rows, peers.values(scope))) {
            let eid = (row[sub.ref.comp] as Record<string, unknown> | undefined)
              ?.[sub.ref.prop]
            if (typeof eid == 'string') ids.add(eid)
          }
        }
        let values = peers.values(ids)
        return after(
          durableRows(values.map((b) => b.entity.eid)),
          (held) => overlay([...rows, ...held], values),
        )
      })
    }
    let values = peers.values()
    let ids = [...new Set(values.map((b) => b.entity.eid))]
    let refs = sub.ref && !scope && ids.length ? linked(sub.ref, ids) : []
    return after(
      candidates,
      (rows) =>
        after(
          refs,
          (linked) =>
            after(durableRows(ids), (held) =>
              overlay([...rows, ...linked, ...held], values)),
        ),
    )
  }
  let read = (
    sub: Sub,
    scope?: Set<Eid>,
    prepared?: Bundle[] | Promise<Bundle[]>,
  ): Bundle[] | Promise<Bundle[]> => {
    if (sub.view) return after(viewed(sub.view, sub.opts), flat)
    if (!sub.peer) {
      return graph.read(queryOf(sub), {
        ...sub.opts,
        durable: true,
        native: !!sub.ast || graph.rewrites(sub.opts) || sub.opts?.native,
      })
    }
    return after(prepared ?? source(sub, scope), (bundles) => {
      let chosen = matcher(queryOf(sub), graph.vocab, sub.opts)(bundles)
      return chosen.filter((b) => !scope || scope.has(b.entity.eid))
        .map((b) => sub.cut(stored(b)))
    })
  }

  let snapshot = (
    line: Query,
    readOpts: ReadOpts = {},
    nested = false,
    reduce = true,
  ): Bundle[] | Reduced | Promise<Bundle[] | Reduced> => {
    let ast = typeof line == 'string' ? parse(line) : line
    let op = reduce ? aggregate(ast) : null
    if (readOpts.durable) {
      return op
        ? after(graph.rows(line, readOpts), (rows) => reduced(op, rows))
        : graph.read(line, readOpts)
    }
    let plan = peerPlan(ast, graph.vocab)
    let p = op ? null : projection(graph.vocab, ast)
    let cut = p?.cut ??
      only(named(graph.vocab, line, nested || !!readOpts.native))
    if (!plan.peers) {
      if (op) {
        return after(
          graph.rows(ast, {
            ...readOpts,
            durable: true,
            native: nested || readOpts.native || graph.rewrites(readOpts),
          }),
          (rows) => reduced(op, rows),
        )
      }
      // A projection answers what is stored, the entities it reaches too.
      if (p) {
        return graph.read(ast, {
          ...readOpts,
          durable: true,
          native: nested || readOpts.native || graph.rewrites(readOpts),
        })
      }
      return after(
        graph.read(ast, {
          ...readOpts,
          durable: true,
          native: nested || readOpts.native || graph.rewrites(readOpts),
        }),
        (rows) =>
          rows.map((row) =>
            cut(overlay([row], peers.values([row.entity.eid]))[0])
          ),
      )
    }
    if (p?.reaches.length) {
      throw new Refused(
        'a projection through a reference is not read over relayed values',
      )
    }
    let sub: Sub = {
      id: '',
      sink: () => {},
      send: () => {},
      raw: false,
      query: typeof line == 'string' ? line : '',
      ast: typeof line == 'string' ? undefined : line,
      opts: { ...readOpts, native: nested || readOpts.native },
      members: new Set(),
      fields: new Map(),
      routed: false,
      peer: true,
      durable: plan.durable,
      ref: plan.ref,
      cut,
      riders: new Set(),
    }
    return after(
      source(sub),
      (bundles) =>
        op
          ? reduced(op, matchRows(line, graph.vocab, readOpts)(bundles))
          : matcher(line, graph.vocab, readOpts)(bundles).map(cut),
    )
  }

  // A durable watch kept by the page may still carry relays for its rows.
  // Recover only the touched owners' membership, never its retained catalog.
  let recoverMembership = (bundles: Bundle[]): void | Promise<void> => {
    let deferred = all().filter((s) => s.deferred)
    if (!deferred.length || !bundles.length) return
    let ids = [...new Set(bundles.map((b) => b.entity.eid))]
    return after(
      graph.get(ids, undefined, { native: true }),
      (rows) =>
        after(
          over(deferred, (s) => {
            let i = s.reads!
            let candidates = rows.filter((row) => i.own.every((c) => c in row))
            if (!candidates.length) return
            if (
              i.whole || i.far.size || i.via.size || s.plan?.reaches.length
            ) return open(s.sink, s.id, s.query, s.opts)
            for (
              let row of matcher(queryOf(s), graph.vocab, s.opts)(candidates)
            ) s.members.add(row.entity.eid)
          }),
          () => {},
        ),
    )
  }
  let peerChange = (
    bundles: Bundle[],
    except?: Sink,
    casted = false,
  ): void | Promise<void> => {
    if (!bundles.length) return
    if (!casted) {
      return after(recoverMembership(bundles), () => {
        cast(bundles, except)
        return peerChange(bundles, except, true)
      })
    }
    notify(bundles)
    // Old members hear the patch that moved a row out; new members receive
    // its full held value in the membership frame below.

    let touched = [...new Set(bundles.map((b) => b.entity.eid))]
    let values = peers.values(touched)
    let active = new Set(values.map((b) => b.entity.eid))
    let release = () => {
      for (let eid of touched) {
        if (active.has(eid)) continue
        peerRows.delete(eid)
        for (let [key, value] of backlinks) {
          if (value.peer == eid) backlinks.delete(key)
        }
      }
    }
    if (!all().some((s) => s.peer)) {
      release()
      return
    }
    // Every watch that follows the same reference sees the same rows for
    // this movement. The cross-movement cache avoids SQL; this batch map
    // avoids rebuilding the combined answer for every watch.
    let batchLinks = new Map<string, Bundle[] | Promise<Bundle[]>>()
    let batchSources = new Map<string, Bundle[] | Promise<Bundle[]>>()
    return after(durableRows(touched), (rows) => {
      let routing = route(overlay(rows, values), touched, peerNet, true)
      release()
      return after(
        over(
          all().filter((s) => s.peer),
          (s) =>
            attempt(
              s,
              () => {
                if (s.view) return push(s)
                if (s.routed) return send(s, routing.get(s))
                if (!s.ref) return push(s)
                let roots = new Set(
                  bundles.filter((b) => s.ref!.comp in b)
                    .map((b) => b.entity.eid),
                )
                let moved = bundles.filter((b) =>
                  Object.keys(b).some((c) => s.ref!.far.has(c))
                )
                if (!moved.length && !roots.size) return
                let ids = [...new Set(moved.map((b) => b.entity.eid))]
                let key = JSON.stringify([s.ref.comp, s.ref.prop, ids])
                let found = batchLinks.get(key)
                if (!found) {
                  found = ids.length ? linked(s.ref, ids) : []
                  batchLinks.set(key, found)
                }
                return after(
                  found,
                  (refs) => {
                    let scope = new Set([
                      ...roots,
                      ...refs.map((b) => b.entity.eid),
                    ])
                    if (!scope.size) return
                    let own = rows.filter((b) => roots.has(b.entity.eid))
                    let sourceKey = JSON.stringify([key, [...roots]])
                    let prepared = batchSources.get(sourceKey)
                    if (!prepared) {
                      prepared = source(s, scope, [...refs, ...own])
                      batchSources.set(sourceKey, prepared)
                    }
                    return push(s, scope, undefined, prepared, true)
                  },
                )
              },
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
    if (syncOf(graph.vocab, frame.component) == 'none') return
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

  // The writer is answered at its commit, and the pass it starts goes on
  // without it. A pass that fails is said here, where nobody waits on it.
  graph.use({
    name: '@yaks/api',
    hooks: {
      effect: (bundles, _tx, _err, context) => {
        let target = opts.activity ?? graph
        if (context?.parent && peek(target)) {
          link(target, bundles, context.parent)
        }
        let pass = commit(bundles)
        if (isPromise(pass)) {
          pass.finally(() => unlink(target, bundles)).catch(() => {})
        } else unlink(target, bundles)
        if (isPromise(pass)) pass.catch((err) => fault(err, 'subscriptions'))
        return bundles
      },
    },
  })

  let batch: {
    writes: Map<string, { sink: Sink; row: Bundle }>
    done: Promise<void>
    resolve: () => void
    reject: (err: unknown) => void
    cancel: () => void
  } | undefined
  let flushPeers = () => {
    let next = batch
    if (!next) return
    batch = undefined
    next.cancel()
    let run = () => {
      let writes = new Map<Sink, Bundle[]>()
      for (let { sink, row } of next.writes.values()) {
        let rows = writes.get(sink) ?? []
        rows.push(row)
        writes.set(sink, rows)
      }
      let bundles = coalesced([...next.writes.values()].map((w) => w.row))
      return after(recoverMembership(bundles), () => {
        for (let [sink, rows] of writes) cast(coalesced(rows), sink)
        return peerChange(bundles, undefined, true)
      })
    }
    try {
      let out = ordered(run)
      if (isPromise(out)) out.then(next.resolve, next.reject)
      else next.resolve()
    } catch (err) {
      next.reject(err)
    }
  }
  let enqueue = (sink: Sink, bundles: Bundle[], writer?: PeerWriter) => {
    bundles = formed(bundles)
    let stage = (accepted: Bundle[]) => {
      let rows = peers.write(sink, accepted)
      if (!rows.length) return
      if (!batch) {
        let resolve!: () => void, reject!: (err: unknown) => void
        let done = new Promise<void>((yes, no) => {
          resolve = yes
          reject = no
        })
        let cancel = (opts.timer ?? ((fn, ms) => {
          let t = setTimeout(fn, ms)
          return () => clearTimeout(t)
        }))(flushPeers, 16)
        batch = { writes: new Map(), done, resolve, reject, cancel }
      }
      for (let row of rows) {
        for (let [comp, patch] of comps(row)) {
          let key = JSON.stringify([row.entity.eid, comp])
          let was = batch.writes.get(key)?.row[comp]
          let previous = was && typeof was == 'object' ? was : {}
          batch.writes.set(key, {
            sink,
            row: {
              entity: row.entity,
              [comp]: patch == null ? null : { ...previous, ...patch },
            },
          })
        }
      }
      return batch.done
    }
    // The fan-out promise must not lock the registry while its batch is
    // gathering more inputs. Flush orders delivery after storage work.
    let delivery: void | Promise<void>
    let out = ordered(() =>
      after(
        saves.write(
          sink,
          bundles,
          writer,
          peers.values(bundles.map((b) => b.entity.eid)),
        ),
        (accepted) => {
          delivery = stage(accepted)
        },
      )
    )
    return after(out, () => delivery)
  }
  // Views supply canonical candidates first; peer values are overlaid before
  // reconstructing and selecting the caller's components.
  let viewValues = (view: ReadView, readOpts: ReadOpts = {}) =>
    after(
      graph.read(view.query, { ...readOpts, native: true, durable: true }),
      (rows) =>
        after(view.expand ? view.expand(rows) : rows, (expanded) => {
          // Canonical live reads strip even positions reconstructed from an
          // unmoved saved source. A durable caller component keeps its saved
          // baseline; held values replace that baseline under active holders.
          let baseline = view.saved || readOpts.durable
            ? expanded
            : expanded.map(stored)
          return view.answer(overlay(baseline, peers.values()))
        }),
    )
  let viewed = (view: ReadView, readOpts: ReadOpts = {}): Answer =>
    after(viewValues(view, readOpts), (bundles) => {
      let p = projection(view.vocab, view.original)
      if (p) return p.fold(matchRows(p.query, view.vocab, readOpts)(bundles))
      return answered(
        matcher(view.original, view.vocab, readOpts)(bundles)
          .map(only(named(view.vocab, view.original))),
      )
    })
  let answering = (query: Query, readOpts: ReadOpts = {}, reduce = true) => {
    if (readOpts.durable) return snapshot(query, readOpts, false, reduce)
    return after(graph.view(query, readOpts), (view) => {
      if (view) {
        let op = reduce ? aggregate(view.original) : null
        return op
          ? after(
            viewValues(view, readOpts),
            (bundles) =>
              reduced(
                op,
                matchRows(view.original, view.vocab, readOpts)(bundles),
              ),
          )
          : after(viewed(view, readOpts), flat)
      }
      return after(
        graph.ask(query, readOpts),
        (q) =>
          after(
            snapshot(q, readOpts, q !== query, reduce),
            (out) => Array.isArray(out) ? graph.answer(out, readOpts) : out,
          ),
      )
    })
  }

  return {
    activity: opts.activity ?? graph,
    // A host can read while its own graph apply is saving a relay. This read
    // takes the currently admitted held values without entering ordered work.
    read: (query, readOpts) =>
      after(answering(query, readOpts, false), (out) => out as Bundle[]),
    observe: (fn) => {
      observers.add(fn)
      return () => void observers.delete(fn)
    },
    snapshot: (query, readOpts) => {
      flushPeers()
      return ordered(() =>
        after(
          answering(query, readOpts),
          (out) => Array.isArray(out) ? published(graph.vocab, out) : out,
        )
      )
    },
    enqueue,
    open: (sink, id, query, readOpts) => {
      flushPeers()
      return ordered(() => open(sink, id, query, readOpts))
    },
    restore: (openings, deferStatic = false) => {
      flushPeers()
      return ordered(() => {
        let rows = new Map<string, Answer>()
        let answers = new Map<string, Reduced | Promise<Reduced>>()
        return after(
          over(
            openings,
            ({ sink, id, query, opts }) =>
              open(sink, id, query, opts, rows, answers, deferStatic),
          ),
          () => {},
        )
      })
    },
    resume: () =>
      after(
        ordered(() =>
          over(
            all().filter((s) => s.deferred),
            (s) => open(s.sink, s.id, s.query, s.opts),
          )
        ),
        () => {},
      ),
    close: (sink, id) => {
      flushPeers()
      return ordered(() => {
        pending.get(sink)?.delete(id)
        forget(held.get(sink)?.get(id))
        held.get(sink)?.delete(id)
      })
    },
    drop: (sink) => {
      flushPeers()
      return ordered(() => {
        pending.delete(sink)
        for (let sub of held.get(sink)?.values() ?? []) forget(sub)
        held.delete(sink)
        // Every value this connection was relaying stops being true when the
        // connection goes.
        return after(saves.drop(sink), () => {
          let off = peers.drop(sink)
          if (off.length) return peerChange(off)
        })
      })
    },
    commit,
    relay: (sink, bundles, writer) => {
      bundles = formed(bundles)
      flushPeers()
      // Admit before queueing, so even a patch superseded while waiting still
      // gets the same refusal as one sent without a backlog.
      if (saved(bundles)) {
        return ordered(() =>
          after(
            saves.write(
              sink,
              bundles,
              writer,
              peers.values(bundles.map((b) => b.entity.eid)),
            ),
            (accepted) => {
              let out = peers.write(sink, accepted)
              return peerChange(out, sink)
            },
          )
        )
      }
      return after(
        saves.write(
          sink,
          bundles,
          writer,
          peers.values(bundles.map((b) => b.entity.eid)),
        ),
        (accepted) => {
          let waiting = relays.get(sink)
          if (waiting) {
            waiting.bundles = coalesced([...waiting.bundles, ...accepted])
            return waiting.done
          }
          let run = (rows: Bundle[]) =>
            peerChange(peers.write(sink, rows), sink)
          if (!pendingWork) return ordered(() => run(accepted))
          let next = { bundles: accepted, done: Promise.resolve() }
          relays.set(sink, next)
          next.done = ordered(() => {
            relays.delete(sink)
            return run(next.bundles)
          }) as Promise<void>
          return next.done
        },
      )
    },
    relaying: (sink) => peers.holds(sink),
    relayed: (sink, keys) =>
      ordered(() => {
        let before = new Set(peers.holds(sink))
        peers.adopt(sink, keys)
        let restored = peers.holds(sink).filter((key) => {
          let comp = key.slice(key.indexOf(' ') + 1)
          return !before.has(key) && saveOf(graph.vocab, comp) != null
        })
        if (!restored.length) return
        let ids = [...new Set(restored.map((k) => k.slice(0, k.indexOf(' '))))]
        return after(
          graph.get(ids, undefined, { native: true, durable: true }),
          (rows) => {
            let held = new Set(restored)
            let values = rows.flatMap((row) => {
              let value: Bundle = { entity: row.entity }
              for (let [comp, patch] of comps(row)) {
                if (held.has(row.entity.eid + ' ' + comp) && patch != null) {
                  value[comp] = patch
                }
              }
              return comps(value).length ? [value] : []
            })
            return peerChange(peers.write(sink, values), sink)
          },
        )
      }),
    pace: (comp) => peerComp(comp) ? paceOf(graph.vocab, comp) : null,
    save: (comp) => saveOf(graph.vocab, comp),
  }
}
