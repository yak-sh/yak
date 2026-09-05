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

import type { Graph, Plugin } from '@yaks/graph'
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

/** How a graph is wired to a server. Only `url` is required; both transports
 * default to the platform's own. */
export type SyncOpts = {
  /** the server's base URL — the origin `/apply`, `/query` and `/ws` sit under */
  url: string
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
  subscribe: (query: Ask, id?: string) => string
  /** drop one subscription */
  unsubscribe: (id: string) => void
  /** whether the socket is open right now */
  connected: () => boolean
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
 * import { memory } from '@yaks/memory'
 * import { sync } from '@yaks/sync'
 *
 * // let g = graph({ storage: memory(vocab, { adopt: true }), vocab })
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
          sending = sending.then(() =>
            post(batch, {
              graph,
              url: opts.url,
              fetch: opts.fetch ?? ((r) => globalThis.fetch(r)),
              headers: opts.headers,
              report,
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
    land: (frame: Frame) => {
      if (frame.refused) {
        return report({
          sent: [],
          refused: frame.refused,
          reverted: false,
        })
      }
      let out = land(graph, frame)
      if (out instanceof Promise) {
        out.catch((error: unknown) =>
          report({ sent: [], error, reverted: false })
        )
      }
    },
    report: (error) => report({ sent: [], error, reverted: false }),
  })

  return {
    plugin,
    open: w.open,
    subscribe: w.subscribe,
    unsubscribe: w.unsubscribe,
    connected: w.connected,
    idle: () => sending,
    close: w.close,
  }
}
