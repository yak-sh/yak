// Where the pieces are assembled: a client graph connected to a server.
//
// Two plugin hooks and one socket. The `precondition` hook runs inside the
// write's transaction, before the patches go in, and marks each bundle the
// caller passed in with a copy of the entity it is about to change — that mark
// is what tells the `effect` hook which bundles came from a caller, and what to
// put back if the server refuses them. The `effect` hook runs after the commit
// and sends the write without waiting for a response: a local write over a
// local store is synchronous, and staying synchronous is most of the reason to
// run a graph in a page at all.
//
// One exception: a write that deletes is not applied optimistically. Deletion
// is final in this model, so a refused delete could never be put back; the
// precondition hook holds the whole list of bundles out of the transaction and
// sends it as it stands, and the server's response is applied here marked as an
// echo, carrying its own tombstones — exactly as the response to an accepted
// write is.
//
// Requests are serialized. Two writes posted at once could reach the server in
// either order, and the second one's response could then reconcile the first
// one's properties backwards. One promise chain, in the order the writes
// committed.

import type { Bundle, Eid, Graph, Plugin } from '@yaks/graph'
import { dead, then } from '@yaks/graph'
import { asking, clean, ECHO, echoed, SENT } from './mark.ts'
import { type Fetch, post, type Report } from './outbound.ts'
import { relayed } from './tier.ts'
import { pacer } from './pace.ts'
import { type Mine, saying } from './saying.ts'
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
  /** apply one frame; `mine` is what this node is saying itself, which a
   * reset frame leaves out (inbound.ts `hear`) */
  land: (frame: Frame, mine?: Mine) => Bundle[] | Promise<Bundle[]>
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

/** How a graph is connected to a server. Only `url` is required; both
 * transports default to the platform's own. */
export type SyncOpts = {
  /** the server's base URL — the origin `/apply`, `/query` and `/ws` sit under */
  url: string
  /** Working-set ownership, retention and pending-write protection. */
  replica?: Replica
  /** how a write is sent (default: the global `fetch`) */
  fetch?: Fetch
  /** how the socket is opened (default: the global `WebSocket`) */
  connect?: Connect
  /** how a reconnect, and a relayed value's pace, is timed (default:
   * `setTimeout`) */
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

/** A graph's connection to a server: its subscriptions, and the state of the
 * socket they are held on. */
export type Sync = {
  /** the plugin this registered on the graph */
  plugin: Plugin
  /** open the socket without subscribing to anything */
  open: () => void
  /** subscribe to a query (or `true` for every committed write) */
  subscribe: (query: Ask, id?: string, opts?: SubscribeOpts) => string
  /** drop one subscription */
  unsubscribe: (id: string) => void
  /** Ask one subscription, or every subscription, for a fresh full frame from
   * the server. */
  refresh: (id?: string) => void
  /** whether the socket is open right now */
  connected: () => boolean
  /** whether this subscription has successfully applied an answer on the
   * current connection. Cached rows alone never make it ready. */
  ready: (id: string) => boolean
  /** be called when readiness changes (including on an empty first answer);
   * not called immediately. The returned function removes the listener. */
  onReady: (fn: (id: string, ready: boolean) => void) => () => void
  /** resolves when every write in flight has been answered */
  idle: () => Promise<void>
  /** close the socket and stop reconnecting */
  close: () => void
}

let warn: Report = (t) =>
  console.warn('@yaks/sync —', t.refused ?? t.error, t.sent)

/**
 * Connect a client graph to a server. The plugin registers itself on the graph
 * you pass in, so one line is the whole setup:
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { sync } from '@yaks/sync'
 *
 * // let g = graph({ storage: ram(vocab, { adopt: true }), vocab })
 * // let link = sync(g, { url: 'https://recipes.example' })
 * // link.subscribe('.dinner&.serves>4')
 * ```
 *
 * From then on every write through `g.apply()` is applied locally at once and
 * then sent to the server; everything the server pushes is applied locally too.
 */
export let sync = (graph: Graph, opts: SyncOpts): Sync => {
  let report = opts.report ?? warn
  let timer: Timer = opts.timer ?? ((fn, ms) => setTimeout(fn, ms))
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
  let said = saying()

  // Post one write on the chain. `held` means it was never applied locally, so
  // a refusal has nothing to revert and an unanswered request has nothing to
  // keep pinned.
  let send = (batch: Bundle[], held = false) => {
    let release = opts.replica?.protect(batch.map((b) => b.entity.eid))
    sending = sending.then(() =>
      post(batch, {
        graph,
        url: opts.url,
        fetch: opts.fetch ?? ((r) => globalThis.fetch(r)),
        headers: opts.headers,
        report,
        held,
      }).then((settled) => {
        if (settled || held) release?.()
      })
    ).catch((error) => report({ sent: [], error, reverted: false }))
  }

  let plugin: Plugin = {
    name: '@yaks/sync',
    // The two marks a batch carries through `apply()` (./mark.ts): what the
    // caller sent, and what came back from the server.
    requests: [SENT, ECHO],
    hooks: {
      // Inside the transaction, before the patches: the copy to put back.
      precondition: (bundles, tx) => {
        if (bundles.some(echoed)) return bundles
        let eids = [...new Set(bundles.map((b) => b.entity.eid))]
        return then(tx.get(eids), (held) => {
          let was = new Map(held.map((b) => [b.entity.eid, b]))
          let asked = bundles.map((b) =>
            asking(b, was.get(b.entity.eid) ?? null)
          )
          // A delete waits for the server: the whole list is sent as it
          // stands, and none of it is applied here until the response is.
          if (bundles.some(dead)) {
            send(asked, true)
            return []
          }
          return asked
        })
      },
      // After the commit: send it to the server, and reconcile the response.
      // The marks are removed from what the caller gets back — they were this
      // package's own bookkeeping, not part of anybody's data.
      effect: (bundles) => {
        if (bundles.length && !bundles.some(echoed)) {
          send(bundles)
          // The `sync: peers` half is sent over the socket instead: the
          // server holds it under this connection and clears it when the
          // connection closes, so the connection has to be the one that wrote
          // it. It leaves at the component's pace (./pace.ts), and is kept as
          // what this node is saying, for the next connection (./saying.ts).
          let peers = relayed(bundles, graph.vocab)
          said.wrote(peers, w.connected())
          relay(peers)
        }
        return bundles.map(clean)
      },
    },
  }
  graph.use(plugin)

  let w: Wire = wire({
    url: opts.url,
    connect: opts.connect,
    timer,
    wait: opts.wait,
    most: opts.most,
    pending,
    again: said.again,
    land: (frame: Frame) => {
      if (frame.refused) {
        pending(frame.id)
        return report({
          sent: [],
          refused: frame.refused,
          reverted: false,
        })
      }
      // Another connection's word on a value takes it over (./saying.ts).
      said.heard(frame.relay ?? [])
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
        opts.replica
          ? opts.replica.land(frame, said.mine)
          : land(graph, safe, said.mine),
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
  let relay = pacer(graph.vocab, w.relay, timer)

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
