// A query as a value that changes. This is the reactive half of the package:
// hand it a query line and get back something with a `value` on it, which is
// the answer now and the answer after every commit that moved it.
//
// The registry hangs off the graph's own `effect` phase, so it sees every
// committed batch — a local write, and the batch @yaks/sync applied when the
// server pushed one. There is no polling and no diffing of the whole store.
//
// A commit is answered the way a server answers a subscription: read the
// touched entities once, whole, then judge them once per watch, in one of two
// modes chosen when the watch opens.
//
//   INCREMENTAL  the query asks only about each entity itself, so @yaks/match's
//                `filter` decides membership one bundle at a time and the
//                answer is edited in place — no re-read, however large the
//                store is.
//   REFRESH      the query follows a reference, orders, windows or counts, so
//                its answer can move when an entity it never named does. Those
//                run the query again and compare.
//
// An incremental answer keeps FIRST-MATCH order: the order the entities were
// read in, with a newcomer at the end. A query that cares about order says so
// (`.order=title`), and saying so puts it in refresh mode, where the order is
// the one the store answers with.

import type { Bundle, Eid, Graph } from '@yaks/graph'
import { detached, over, then } from '@yaks/graph'
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

/** One live query: its answer now, a way to hear about a new one, and the way
 * to stop. */
export type Watch = {
  /** the query line this watch was opened with */
  query: string
  /** the entities matching it, as of the last commit */
  readonly value: Bundle[]
  /** hear about every later answer; call the returned function to stop
   * listening. It is NOT called with the current answer — read `value` for
   * that, which is also the `getSnapshot` half of React's
   * `useSyncExternalStore`. */
  subscribe: (fn: (bundles: Bundle[]) => void) => () => void
  /** stop watching: the registry forgets it and no listener fires again */
  close: () => void
}

/** What one watch may say about itself. */
export type WatchOpts = {
  /** the reference moment relative time phrases resolve against */
  now?: number
}

/** How a registry is built. */
export type WatchesOpts = {
  /** the signal factory backing every `value` (default: a plain object) */
  signal?: Make
  /** the reference moment for time phrases, for every watch in it */
  now?: number
}

/** The watches on one graph. */
export type Watches = {
  /** open a watch on a query */
  watch: (query: string, opts?: WatchOpts) => Watch
  /** how many watches are open — what a test asserts on after a close */
  size: () => number
  /** close every watch */
  close: () => void
}

type Live = {
  query: string
  now?: number
  /** the per-bundle test, or `null` when this watch re-reads instead */
  test: Filter | null
  /** the answer, by eid, in the order it is published */
  members: Map<Eid, Bundle>
  hold: Hold<Bundle[]>
  listeners: Set<(bundles: Bundle[]) => void>
}

let plain: Make = <T>(value: T) => ({ value })

// A clause every entity can be judged on alone: a column of its own, a word in
// its own text, nothing. A path that hops through a reference, an ordering, a
// window or an aggregate is a question about the SET, and answering it needs
// the query run again.
let alone = (c: Clause, v: Vocab): boolean =>
  c.kind == 'and' || c.kind == 'or'
    ? c.clauses.every((k) => alone(k, v))
    : c.kind == 'pred'
    ? v.aim(c.path.join('.'), bare(c)).length == 1
    : c.kind == 'text' || c.kind == 'never'

// The per-bundle test for a query, or null to re-read it instead: a query
// reaching beyond one entity, and one @yaks/match declines outright, both fall
// back to reading. Parsing happens outside the `try`, so an unreadable query
// is refused here rather than quietly demoted.
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
 * graph, which is how every commit — yours, and the server's — reaches every
 * watch:
 *
 * ```ts
 * let seen = watches(graph, { signal })
 * let dinners = seen.watch('.course=dinner&.serves>4')
 * dinners.value // the bundles, now
 * ```
 *
 * {@link client} builds one for you; build your own when the graph is yours.
 */
export let watches = (graph: Graph, base: WatchesOpts = {}): Watches => {
  let held = new Set<Live>()
  let make = base.signal ?? plain

  let publish = (w: Live, value: Bundle[]) => {
    w.hold.value = value
    for (let fn of w.listeners) fn(value)
  }

  // One watch against the entities a batch touched, read whole.
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
      // An entity the store no longer holds at all is a departure too.
      for (let eid of touched) {
        if (!seen.has(eid) && w.members.delete(eid)) moved = true
      }
      if (moved) publish(w, [...w.members.values()])
      return
    }
    // Refresh: the answer is a property of the whole set, so ask for it again.
    return then(graph.read(w.query, { now: w.now }), (set) => {
      let ids = new Set(set.map((b) => b.entity.eid))
      let left = [...w.members.keys()].some((eid) => !ids.has(eid))
      w.members = new Map(set.map((b) => [b.entity.eid, b]))
      if (left || touched.some((eid) => ids.has(eid))) publish(w, set)
    })
  }

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
    let now = opts.now ?? base.now
    let w: Live = {
      query,
      now,
      test: judge(query, graph.vocab, now),
      members: new Map(),
      hold: make<Bundle[]>([]),
      listeners: new Set(),
    }
    // The first answer, before the watch is registered: a query the graph
    // cannot answer throws HERE, out of `watch()`, rather than on every later
    // commit for the life of the page.
    then(graph.read(query, { now }), (set) => {
      w.members = new Map(set.map((b) => [b.entity.eid, b]))
      w.hold.value = set
      held.add(w)
    })
    return {
      query,
      get value() {
        return w.hold.value
      },
      subscribe: (fn) => {
        w.listeners.add(fn)
        return () => w.listeners.delete(fn)
      },
      close: () => {
        held.delete(w)
        w.listeners.clear()
      },
    }
  }

  return {
    watch,
    size: () => held.size,
    close: () => {
      for (let w of held) w.listeners.clear()
      held.clear()
    },
  }
}
