// A query as a value that changes. This is the reactive half of the package:
// pass it a query string and get back an object with a `value` on it, which
// is the query's result now and its result after every commit that changed
// it.
//
// The registry registers a hook on the graph's own `effect` phase, so it sees
// every committed transaction — a local write, and the changes @yaks/sync
// applied when the server pushed some. There is no polling and no comparing
// of the whole store.
//
// A commit is handled the way a server handles a subscription: read the
// changed entities once, whole, then test them once per watch, in one of two
// modes chosen when the watch opens.
//
//   Incremental  the query asks only about each entity itself, so
//                @yaks/match's `filter` decides membership one bundle at a
//                time and the result is edited in place — the query is never
//                run again, however large the store is.
//   Refresh      the query follows a reference, orders, limits or counts, so
//                its result can change when an entity it never named does.
//                These run the query again and compare.
//
// An incremental result keeps first-match order: the order the entities were
// read in, with a new match appended at the end. A query that cares about
// order states it (`.order=title`), and stating it puts the watch in refresh
// mode, where the order is the one the store returned.

import type { Bundle, Eid, Graph } from '@yaks/graph'
import { detached, over, then, transient } from '@yaks/graph'
import { type Filter, filter } from '@yaks/match'
import { bare, type Clause, parse } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'

/** Something with a `value` that can be replaced: the one thing this package
 * needs from a signal. A `@preact/signals` signal is one; so is `{ value }`. */
export type Hold<T> = { value: T }

/** How a holder is made. Pass `signal` from `@preact/signals` (or any library
 * with that call shape) and every watch's `value` becomes reactive; the
 * default is a plain object, which is enough for {@link Watch.subscribe}. */
export type Make = <T>(value: T) => Hold<T>

/** One live query: its result now, a way to be notified of a new one, and the
 * way to stop. */
export type Watch = {
  /** the query string this watch was opened with */
  query: string
  /** the entities matching it, as of the last commit */
  readonly value: Bundle[]
  /** the first result has arrived. A local watch becomes ready after its
   * first read; a watch backed by a server subscription waits for the server,
   * even when cached rows are already on screen. False again on
   * disconnect. */
  readonly ready: boolean
  /** be called with every later result; call the function it returns to stop
   * listening. It is also called when `ready` changes, even if the result is
   * empty. It is NOT called with the current result — read `value` for that,
   * which is also the `getSnapshot` half of React's
   * `useSyncExternalStore`. */
  subscribe: (fn: (bundles: Bundle[]) => void) => () => void
  /** stop watching: the registry forgets it and no listener fires again */
  close: () => void
}

/** The options one watch takes. */
export type WatchOpts = {
  /** the reference time that relative time expressions resolve against */
  now?: number
}

/** How a registry is built. */
export type WatchesOpts = {
  /** the signal factory backing every `value` (default: a plain object) */
  signal?: Make
  /** the reference time for relative time expressions, for every watch in
   * the registry */
  now?: number
}

/** The watches on one graph. */
export type Watches = {
  /** open a watch on a query */
  watch: (query: string, opts?: WatchOpts) => Watch
  /** notify watches after a row was evicted from the in-memory cache — which
   * is not a deletion from the graph */
  invalidate: (eids: Eid[]) => void | Promise<void>
  /** how many watches are open — what a test asserts on after a close */
  size: () => number
  /** close every watch */
  close: () => void
}

type Live = {
  query: string
  now?: number
  /** the per-bundle test, or `null` when this watch runs its query again
   * instead */
  test: Filter | null
  /** the result, by eid, in the order it is published */
  members: Map<Eid, Bundle>
  hold: Hold<Bundle[]>
  ready: Hold<boolean>
  listeners: Set<(bundles: Bundle[]) => void>
}

let plain: Make = <T>(value: T) => ({ value })

// Whether a clause can be decided against one entity on its own: a column of
// its own, a term in its own text, nothing at all. A path that hops through a
// reference, an ordering, a limit or an aggregate is a question about the
// set, and answering it means running the query again.
let alone = (c: Clause, v: Vocab): boolean =>
  c.kind == 'and' || c.kind == 'or'
    ? c.clauses.every((k) => alone(k, v))
    : c.kind == 'pred'
    ? v.aim(c.path.join('.'), bare(c)).length == 1
    : c.kind == 'text' || c.kind == 'never'

// The per-bundle test for a query, or null to run the query again instead.
// Both a query that reaches beyond a single entity and one @yaks/match
// refuses to compile fall back to running it again. Parsing happens outside
// the `try`, so a query that cannot be parsed is refused here rather than
// quietly demoted.
let judge = (query: string, vocab: Vocab, now?: number): Filter | null => {
  let ast = parse(query)
  try {
    return alone(ast, vocab) ? filter(query, vocab, { now }) : null
  } catch {
    return null
  }
}

/**
 * The watches on a graph. Building one registers an `effect` hook on that
 * graph, which is how every commit — this page's, and the server's — reaches
 * every watch:
 *
 * ```ts
 * let seen = watches(graph, { signal })
 * let dinners = seen.watch('.course=dinner&.serves>4')
 * dinners.value // the bundles, now
 * ```
 *
 * {@link client} builds one for you; build your own when you assembled the
 * graph yourself.
 */
export let watches = (graph: Graph, base: WatchesOpts = {}): Watches => {
  let held = new Set<Live>()
  let closed = false
  let make = base.signal ?? plain

  let publish = (w: Live, value: Bundle[]) => {
    w.hold.value = value
    for (let fn of w.listeners) fn(value)
  }

  // One watch against the entities a transaction changed, read whole.
  let push = (w: Live, now: Bundle[], touched: Eid[]) => {
    let test = w.test
    if (test) {
      let moved = false
      let seen = new Set(now.map((b) => b.entity.eid))
      for (let b of now) {
        let eid = b.entity.eid
        if (test(b, now)) {
          w.members.set(eid, b)
          moved = true
        } else if (w.members.delete(eid)) moved = true
      }
      // An entity the store no longer holds at all has left the result too.
      for (let eid of touched) {
        if (!seen.has(eid) && w.members.delete(eid)) moved = true
      }
      if (moved) publish(w, live.project([...w.members.values()]))
      return
    }
    // Refresh: the result is a property of the whole set, so run the query
    // again.
    return then(graph.read(w.query, { now: w.now, durable: true }), (set) => {
      let ids = new Set(set.map((b) => b.entity.eid))
      let left = [...w.members.keys()].some((eid) => !ids.has(eid))
      w.members = new Map(set.map((b) => [b.entity.eid, b]))
      if (left || touched.some((eid) => ids.has(eid))) {
        publish(w, live.project(set))
      }
    })
  }

  const live = transient(graph)
  const offLive = live.subscribe((f) => {
    for (const w of held) {
      if (w.members.has(f.entity)) {
        publish(w, live.project([...w.members.values()]))
      }
    }
  })

  let commit = (applied: Bundle[]) => {
    if (!held.size) return
    let touched = [...new Set(applied.map((b) => b.entity.eid))]
    return then(
      detached(graph.storage).get(touched),
      (now) =>
        then(over([...held], (w) => push(w, now, touched)), () => undefined),
    )
  }

  graph.use({
    name: '@yaks/client',
    hooks: { effect: (bundles) => then(commit(bundles), () => bundles) },
  })

  let watch = (query: string, opts: WatchOpts = {}): Watch => {
    if (closed) throw new Error('watch registry is closed')
    let active = true
    let now = opts.now ?? base.now
    let w: Live = {
      query,
      now,
      test: judge(query, graph.vocab, now),
      members: new Map(),
      hold: make<Bundle[]>([]),
      ready: make(false),
      listeners: new Set(),
    }
    // The first result, read before the watch is registered: a query the
    // graph cannot answer throws here, out of `watch()`, rather than on every
    // later commit for the life of the page.
    then(graph.read(query, { now, durable: true }), (set) => {
      if (!active || closed) return
      w.members = new Map(set.map((b) => [b.entity.eid, b]))
      w.hold.value = live.project(set)
      w.ready.value = true
      held.add(w)
      for (let fn of w.listeners) fn(w.hold.value)
    })
    return {
      query,
      get value() {
        return w.hold.value
      },
      get ready() {
        return w.ready.value
      },
      subscribe: (fn) => {
        if (!active || closed) return () => {}
        w.listeners.add(fn)
        return () => w.listeners.delete(fn)
      },
      close: () => {
        active = false
        held.delete(w)
        w.listeners.clear()
      },
    }
  }

  return {
    watch,
    invalidate: (eids) => commit(eids.map((eid) => ({ entity: { eid } }))),
    size: () => held.size,
    close: () => {
      offLive()
      closed = true
      for (let w of held) w.listeners.clear()
      held.clear()
    },
  }
}
