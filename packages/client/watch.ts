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
// changed entities once, whole, then work out which watches each one moved, in
// one of two ways chosen when the watch opens.
//
//   Routed    the query asks only about each entity itself, so it joins the
//             registry's network (@yaks/match `net`), which every watch of
//             that kind shares. A changed entity walks the network once, to
//             exactly the watches it now matches; the ones it matched before
//             are remembered per entity. So a commit costs what it changed,
//             not what is watched, and the query is never run again.
//   Refresh   the query follows a reference, orders, limits or counts, so its
//             result can change when an entity it never named does. These run
//             the query again and compare.
//
// A routed result keeps first-match order: the order the entities were read
// in, with a new match appended at the end. A query that cares about order
// states it (`.order=title`), and stating it puts the watch in refresh mode,
// where the order is the one the store returned. Either way a watch's rows
// carry what its query names, the answer `graph.read` gives (@yaks/graph
// `only`).

import type { Bundle, Eid, Graph } from '@yaks/graph'
import { only, over, then, transient, wanted } from '@yaks/graph'
import { type Net, net } from '@yaks/match'
import { parse } from '@yaks/query'

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
  /** true when the registry's network decides this watch's membership, false
   * when the watch runs its query again instead */
  routed: boolean
  /** what one of its rows carries */
  cut: (b: Bundle) => Bundle
  /** the result, by eid, in the order it is published */
  members: Map<Eid, Bundle>
  hold: Hold<Bundle[]>
  ready: Hold<boolean>
  listeners: Set<(bundles: Bundle[]) => void>
}

let plain: Make = <T>(value: T) => ({ value })

/**
 * The watches on a graph. Building one registers an `effect` hook on that
 * graph, which is how every commit — this page's, and the server's — reaches
 * every watch:
 *
 * ```ts ignore
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
  // The routed watches: one network per reference moment, since a watch may
  // name its own.
  let nets = new Map<number | undefined, Net<Live>>()
  let netFor = (now?: number) => {
    let n = nets.get(now)
    if (!n) nets.set(now, n = net<Live>(graph.vocab, { now }))
    return n
  }

  let publish = (w: Live, value: Bundle[]) => {
    w.hold.value = value
    for (let fn of w.listeners) fn(value)
  }

  // The routed watches against the entities a transaction changed, read
  // whole: each entity moves through the network once, into the watches it
  // matches and out of the ones it has left.
  let route = (now: Bundle[], touched: Eid[]) => {
    let moved = new Set<Live>()
    let seen = new Set<Eid>()
    for (let b of now) {
      let eid = b.entity.eid
      seen.add(eid)
      for (let n of nets.values()) {
        let { into, out } = n.move(b)
        for (let w of out) {
          w.members.delete(eid)
          moved.add(w)
        }
        for (let w of into) {
          w.members.set(eid, w.cut(b))
          moved.add(w)
        }
      }
    }
    // An entity the store no longer holds at all has left every result too.
    for (let eid of touched) {
      if (seen.has(eid)) continue
      for (let n of nets.values()) {
        for (let w of n.forget(eid)) {
          w.members.delete(eid)
          moved.add(w)
        }
      }
    }
    for (let w of moved) publish(w, live.project([...w.members.values()]))
  }

  // Refresh: the result is a property of the whole set, so run the query
  // again.
  let refresh = (w: Live, touched: Eid[]) =>
    then(graph.read(w.query, { now: w.now, durable: true }), (set) => {
      let ids = new Set(set.map((b) => b.entity.eid))
      let left = [...w.members.keys()].some((eid) => !ids.has(eid))
      w.members = new Map(set.map((b) => [b.entity.eid, b]))
      if (left || touched.some((eid) => ids.has(eid))) {
        publish(w, live.project(set))
      }
    })

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
    return then(graph.get(touched), (now) => {
      route(now, touched)
      let again = [...held].filter((w) => !w.routed)
      return then(over(again, (w) => refresh(w, touched)), () => undefined)
    })
  }

  graph.use({
    name: '@yaks/client',
    hooks: { effect: (bundles) => then(commit(bundles), () => bundles) },
  })

  let watch = (query: string, opts: WatchOpts = {}): Watch => {
    if (closed) throw new Error('watch registry is closed')
    // A query that cannot be parsed is refused here, out of `watch()`.
    parse(query)
    let active = true
    let now = opts.now ?? base.now
    let want = wanted(graph.vocab, query)
    let w: Live = {
      query,
      now,
      routed: false,
      cut: only(want),
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
      w.routed = netFor(now).add(w, query, w.members.keys())
      w.hold.value = live.project(set)
      w.ready.value = true
      held.add(w)
      for (let fn of w.listeners) fn(w.hold.value)
    })
    let forget = () => {
      held.delete(w)
      if (w.routed) nets.get(now)?.drop(w)
    }
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
        forget()
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
      nets.clear()
    },
  }
}
