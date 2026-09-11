// The assembly: a client graph, wired to a server.
//
// Two hooks and one socket. The `precondition` hook runs inside the batch's
// transaction, before the patches go in, and marks each bundle the caller sent
// with the image of the entity it is about to change — that mark is what tells
// the `effect` hook which bundles were asked for, and what to put back if the
// server refuses them. The `effect` hook runs after the commit and sends the
// batch, without waiting: a local write over a local store is synchronous, and
// staying synchronous is most of the reason to run a graph in a page at all.
//
// Posts are SERIALIZED. Two batches sent at once could reach the server in
// either order, and the second one's answer could then reconcile the first
// one's fields backwards. One chain, in the order the writes committed.

import type { Bundle, Eid, Graph, Plugin } from '@yaks/graph'
import { then } from '@yaks/graph'
import { asking, clean, echoed } from './mark.ts'
import { type Fetch, post, type Report } from './outbound.ts'
import { land } from './inbound.ts'
import {
  type Ask,
  type Connect,
  type Frame,
  type Timer,
  type Wire,
  wire,
} from './socket.ts'

/** Optional working-set policy. The client supplies retention here, rather
 * than intercepting sockets or building a second sync/readiness registry. */
export type Replica = {
  subscribe: (id: string, query: Ask, opts?: SubscribeOpts) => void
  unsubscribe: (id: string) => void
  land: (frame: Frame) => Bundle[] | Promise<Bundle[]>
  protect: (eids: Eid[]) => () => void
}

/** Local priming is optional: an authoritative server query may not be
 * evaluable over the client's incomplete graph (search, ranking, walks). */
export type SubscribeOpts = {
  /** Seed ownership from a local query before the first answer (default true). */
  prime?: boolean
  /** Exact app semantic identity, including query options, for bounded reopen. */
  answerKey?: string
}

/** How a graph is wired to a server. Only `url` is required; both transports
 * default to the platform's own. */
export type SyncOpts = {
  /** the server's base URL — the origin `/apply`, `/query` and `/ws` sit under */
  url: string
  /** Working-set ownership, retention and pending-write protection. */
  replica?: Replica
  /** how a batch is sent (default: the global `fetch`) */
  fetch?: Fetch
  /** how the socket is opened (default: the global `WebSocket`) */
  connect?: Connect
  /** how a reconnect is scheduled (default: `setTimeout`) */
  timer?: Timer
  /** headers on every `POST /apply` — an authorization, say */
  headers?: Record<string, string>
  /** the first reconnect delay in ms, doubling to `most` (default: 250) */
  wait?: number
  /** the longest reconnect delay in ms (default: 30_000) */
  most?: number
  /** where a refusal or a transport failure is surfaced (default: a warning) */
  report?: Report
}

/** A graph's wire: the subscriptions on it, and the state of the socket. */
export type Sync = {
  /** the plugin this registered on the graph */
  plugin: Plugin
  /** open the socket without subscribing to anything */
  open: () => void
  /** subscribe to a query (or `true` for every committed batch) */
  subscribe: (query: Ask, id?: string, opts?: SubscribeOpts) => string
  /** drop one subscription */
  unsubscribe: (id: string) => void
  /** Ask one subscription, or every subscription, for a fresh authoritative frame. */
  refresh: (id?: string) => void
  /** whether the socket is open right now */
  connected: () => boolean
  /** whether this subscription has successfully applied an answer on the
   * current connection. Cached rows alone never make it ready. */
  ready: (id: string) => boolean
  /** hear readiness changes (including an empty first answer); not called
   * immediately. Unsubscribe with the returned function. */
  onReady: (fn: (id: string, ready: boolean) => void) => () => void
  /** settle: resolves when every batch in flight has been answered */
  idle: () => Promise<void>
  /** close the socket and stop reconnecting */
  close: () => void
}

let warn: Report = (t) =>
  console.warn('@yaks/sync —', t.refused ?? t.error, t.sent)

/**
 * Wire a client graph to a server. The plugin registers itself on the graph you
 * hand it, so one line is the whole setup:
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { sync } from '@yaks/sync'
 *
 * // let g = graph({ storage: ram(vocab, { adopt: true }), vocab })
 * // let wire = sync(g, { url: 'https://recipes.example' })
 * // wire.subscribe('.dinner&.serves>4')
 * ```
 *
 * From then on every write through `g.apply()` lands locally at once and is
 * forwarded; every batch the server pushes lands locally too.
 */
export let sync = (graph: Graph, opts: SyncOpts): Sync => {
  let report = opts.report ?? warn
  let sending: Promise<void> = Promise.resolve()
  let asks = new Map<string, Ask>()
  let members = new Map<string, Set<Eid>>()
  // A fresh object on every invalidation guards asynchronous apply completion
  // against a disconnect, re-point or unsubscribe while it was in flight.
  let states = new Map<string, { ready: boolean }>()
  let listeners = new Set<(id: string, ready: boolean) => void>()
  let notify = (id: string, ready: boolean) => {
    for (let fn of listeners) fn(id, ready)
  }
  let pending = (id: string) => {
    let was = states.get(id)?.ready
    states.set(id, { ready: false })
    if (was) notify(id, false)
  }

  let plugin: Plugin = {
    name: '@yaks/sync',
    hooks: {
      // Inside the transaction, before the patches: the image to put back.
      precondition: (bundles, tx) => {
        if (bundles.some(echoed)) return bundles
        let eids = [...new Set(bundles.map((b) => b.entity.eid))]
        return then(tx.get(eids), (held) => {
          let was = new Map(held.map((b) => [b.entity.eid, b]))
          return bundles.map((b) => asking(b, was.get(b.entity.eid) ?? null))
        })
      },
      // After the commit: tell the server, and reconcile whatever it says.
      // The marks come off what the caller gets back — they were this
      // package's note to itself, not part of anybody's data.
      effect: (bundles) => {
        if (!bundles.some(echoed)) {
          let batch = bundles
          let release = opts.replica?.protect(bundles.map((b) => b.entity.eid))
          sending = sending.then(() =>
            post(batch, {
              graph,
              url: opts.url,
              fetch: opts.fetch ?? ((r) => globalThis.fetch(r)),
              headers: opts.headers,
              report,
            }).then((settled) => {
              if (settled) release?.()
            })
          ).catch((error) => report({ sent: [], error, reverted: false }))
        }
        return bundles.map(clean)
      },
    },
  }
  graph.use(plugin)

  let w: Wire = wire({
    url: opts.url,
    connect: opts.connect,
    timer: opts.timer,
    wait: opts.wait,
    most: opts.most,
    pending,
    land: (frame: Frame) => {
      if (frame.refused) {
        pending(frame.id)
        return report({
          sent: [],
          refused: frame.refused,
          reverted: false,
        })
      }
      let state = states.get(frame.id)
      let safe = frame
      // With a working-set policy, ownership lives there, not in a duplicate
      // registry here. Standalone sync still protects cross-subscription rows.
      if (!opts.replica) {
        if (
          frame.coverage || frame.peerCoverage || frame.peers || frame.peerGone
        ) {
          throw new Error(
            'coverage/rider delivery requires a working-set replica',
          )
        }
        let held = members.get(frame.id) ?? new Set<Eid>()
        if (frame.reset) held.clear()
        for (let b of frame.bundles ?? []) held.add(b.entity.eid)
        for (let eid of frame.gone ?? []) held.delete(eid)
        members.set(frame.id, held)
        safe = {
          ...frame,
          gone: frame.gone?.filter((eid) =>
            ![...members.values()].some((set) => set.has(eid))
          ),
        }
      }
      let out = then(
        opts.replica ? opts.replica.land(frame) : land(graph, safe),
        () => {
          if (state && states.get(frame.id) === state && !state.ready) {
            state.ready = true
            notify(frame.id, true)
          }
        },
      )
      if (out instanceof Promise) {
        out.catch((error: unknown) =>
          report({ sent: [], error, reverted: false })
        )
      }
    },
    report: (error) => report({ sent: [], error, reverted: false }),
  })

  let serial = 0
  return {
    plugin,
    open: w.open,
    subscribe: (query, id, subOpts) => {
      // Register ownership before a synchronous transport can answer.
      let key = id
      if (key === undefined) {
        do {
          key = 's' + ++serial
        } while (asks.has(key))
      }
      asks.set(key, query)
      opts.replica?.subscribe(key, query, subOpts)
      try {
        return w.subscribe(query, key)
      } catch (error) {
        asks.delete(key)
        opts.replica?.unsubscribe(key)
        throw error
      }
    },
    refresh: (only) => {
      for (let [id, query] of asks) {
        if (only === undefined || only === id) w.subscribe(query, id)
      }
    },
    unsubscribe: (id) => {
      let ready = states.get(id)?.ready
      states.delete(id)
      asks.delete(id)
      members.delete(id)
      w.unsubscribe(id)
      opts.replica?.unsubscribe(id)
      if (ready) notify(id, false)
    },
    connected: w.connected,
    ready: (id) => states.get(id)?.ready ?? false,
    onReady: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    idle: () => sending,
    close: () => {
      w.close()
      for (let id of asks.keys()) opts.replica?.unsubscribe(id)
      asks.clear()
      members.clear()
      states.clear()
      listeners.clear()
    },
  }
}
