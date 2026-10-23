// Where the pieces are assembled: a client graph connected to a server.
//
// Three plugin hooks and one socket. The `precondition` hook runs inside the
// write's transaction, before the patches go in, and marks each bundle the
// caller passed in with a copy of the entity it is about to change — that mark
// is what tells the `effect` hook which bundles came from a caller, and what to
// put back if the server refuses them. The `rules` hook marks what the write's
// rules added the same way, since the server's answer replaces it and its
// refusal takes it back (./mark.ts). The `effect` hook runs after the commit
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
import { after } from '@yaks/fp'
import { comps, dead } from '@yaks/graph/bundle'
import {
  ACK,
  asked,
  asking,
  clean,
  ECHO,
  echoed,
  ruling,
  SENT,
} from './mark.ts'
import {
  exchange,
  type Fetch,
  type Refusal,
  type Report,
  WriteRefused,
  WriteUnknown,
} from './outbound.ts'
import { outward, relayed, syncOf } from './tier.ts'
import { durableOutbox, type OutboxStore, type Pending } from './outbox.ts'
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
  protect: (eids: Eid[]) => (accepted?: boolean) => void
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
  /** Durable intent storage; defaults to IndexedDB in a browser. */
  outbox?: OutboxStore<Bundle[]>
  /** Isolate apps/identities sharing an origin. Defaults to URL + headers. */
  outboxScope?: string
  /** the server's base URL — the origin `/apply`, `/query` and `/ws` sit under */
  url: string
  /** Working-set ownership, retention and pending-write protection. */
  replica?: Replica
  /** how a write is sent (default: the global `fetch`) */
  fetch?: Fetch
  /** Local epoch milliseconds for clock measurement (default: monotonic epoch). */
  time?: () => number
  /** how the socket is opened (default: the global `WebSocket`) */
  connect?: Connect
  /** how a reconnect, and a relayed value's pace, is timed (default:
   * `setTimeout`) */
  timer?: Timer
  /** headers on every `POST /apply` — an authorization, say */
  headers?: Record<string, string>
  /** the reconnect delay in ms after a failed attempt, doubling to `most`
   * (default: 250); a connection that held this long is retried at once */
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
  /** Store epoch milliseconds, calibrated over the socket on first use. Starts
   * locally until a reply; retains its last offset while disconnected. */
  now: () => number
  /** whether the socket is open right now */
  connected: () => boolean
  /** be called with true each time the socket opens, and with false each
   * time an open one closes; not called immediately */
  onConnection: (fn: (open: boolean) => void) => () => void
  /** whether this subscription has successfully applied an answer on the
   * current connection. Cached rows alone never make it ready. */
  ready: (id: string) => boolean
  /** be called when readiness changes (including on an empty first answer),
   * and when the server refuses a subscription; not called immediately. The
   * returned function removes the listener. */
  onReady: (fn: (id: string, ready: boolean) => void) => () => void
  /** why the server refused this subscription, until it answers it again */
  refusal: (id: string) => Refusal | undefined
  /** Send an input batch whose identity the server must resolve before this
   * graph can hold it. The caller has separated browser-owned components.
   * `key` names the write, so a send after a `WriteUnknown` under the same key
   * is answered as the first one was, never applied twice. */
  submit: (sent: Bundle[], key?: string) => Promise<Bundle[]>
  /** Apply optimistically, but answer only after server acceptance. Local-only
   * writes stay synchronous. Refusals and unknown outcomes reject. */
  apply: (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>
  pending: () => Pending<Bundle[]>[]
  onPending: (fn: () => void) => () => void
  retry: (key: string) => Promise<void>
  forget: (key: string) => Promise<void>
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
 * // link.subscribe('.recipe.course=dinner&.recipe.serves>4')
 * ```
 *
 * From then on every write through `g.apply()` is applied locally at once and
 * then sent to the server; everything the server pushes is applied locally too.
 */
export let sync = (graph: Graph, opts: SyncOpts): Sync => {
  let report = opts.report ?? warn
  let timer: Timer = opts.timer ?? ((fn, ms) => setTimeout(fn, ms))
  let sending: Promise<void> = Promise.resolve()
  let originals = new Map<string, {
    bundles: Bundle[]
    held: boolean
    release?: (accepted?: boolean) => void
  }>()
  let outbox = durableOutbox<Bundle[], Bundle[]>({
    scope: opts.outboxScope ?? JSON.stringify([opts.url, opts.headers ?? {}]),
    store: opts.outbox,
    report: (error) => {
      if (
        !(error instanceof WriteUnknown) && !(error instanceof WriteRefused)
      ) {
        report({ sent: [], error, reverted: false })
      }
    },
    send: async (key, sent) => {
      let original = originals.get(key)
      let result = await exchange(original?.bundles ?? sent, {
        graph,
        url: opts.url,
        fetch: opts.fetch ?? ((r) => globalThis.fetch(r)),
        headers: opts.headers,
        report,
        held: original?.held ?? true,
        sent,
        key,
      })
      if (result.refused) {
        original?.release?.(false)
        originals.delete(key)
        throw new WriteRefused(sent, result.refused)
      }
      if (result.error) throw result.error
      original?.release?.(!original.held && !!result.applied?.length)
      originals.delete(key)
      return result.applied ?? []
    },
  })
  let deliver = (
    bundles: Bundle[],
    sent: Bundle[],
    held: boolean,
    key: string = `outbox:${crypto.randomUUID()}`,
    release?: (accepted?: boolean) => void,
  ) => {
    originals.set(key, { bundles, held, release })
    return outbox.submit(sent, key)
  }
  let writes = 0
  let receipts = new Map<number, { answer?: Promise<Bundle[] | undefined> }>()
  let asks = new Map<string, Ask>()
  let members = new Map<string, Set<Eid>>()
  // A fresh object on every invalidation guards asynchronous apply completion
  // against a disconnect, re-point or unsubscribe while it was in flight.
  let states = new Map<string, { ready: boolean }>()
  let refusals = new Map<string, Refusal>()
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

  let queue = <T>(run: () => Promise<T>): Promise<T> => {
    // Start admission now, not behind an HTTP response. Otherwise a second
    // write could die in a promise chain before it ever reached durable disk.
    let pending = run()
    sending = Promise.all([sending, pending.catch(() => {})]).then(() => {})
    return pending
  }

  // Post one write on the chain. `held` means it was never applied locally, so
  // a refusal has nothing to revert and an unanswered request has nothing to
  // keep pinned.
  let send = (bundles: Bundle[], held = false) => {
    let sent = outward(bundles, graph.vocab)
    if (!sent.length) return
    let release = opts.replica?.protect(bundles.map((b) => b.entity.eid))
    let answer = queue(() =>
      deliver(bundles, sent, held, undefined, release).then(async (applied) => {
        // A held deletion deferred the whole caller batch. The HTTP door
        // admits only server components, so its accepted answer cannot carry
        // the page/peer half. Apply that half now through the ordinary graph
        // hooks: page values stay local and peer values use their socket.
        let companions = held
          ? bundles.flatMap((b) => {
            if (dead(b)) return []
            let own = Object.fromEntries(
              comps(b).filter(([name]) =>
                syncOf(graph.vocab, name) != 'server'
              ),
            )
            return Object.keys(own).length ? [{ entity: b.entity, ...own }] : []
          })
          : []
        let local = companions.length ? await graph.apply(companions) : []
        return [...applied, ...local]
      })
    ).catch((error) => {
      if (
        !(error instanceof WriteRefused) && !(error instanceof WriteUnknown)
      ) {
        report({ sent, error, reverted: false })
      }
      throw error
    })
    // Background graph writes still report failures without an unhandled
    // rejection. An acknowledged caller receives this same promise.
    answer.catch(() => {})
    for (let b of bundles) {
      let receipt = receipts.get(b[ACK] as number)
      if (receipt) receipt.answer = answer
    }
    return answer
  }

  let submit = (sent: Bundle[], key?: string): Promise<Bundle[]> =>
    queue(() => deliver(sent, sent, true, key))

  let apply = (bundles: Bundle[]): Bundle[] | Promise<Bundle[]> => {
    let id = ++writes
    let receipt: { answer?: Promise<Bundle[] | undefined> } = {}
    receipts.set(id, receipt)
    try {
      let result = after(
        graph.apply(bundles.map((b) => ({ ...b, [ACK]: id }))),
        (local) => {
          receipts.delete(id)
          return receipt.answer?.then((applied) => applied ?? local) ?? local
        },
      )
      if (result instanceof Promise) {
        // A fire-and-forget caller still has report(). Awaiting this promise
        // still rejects, so recovery-sensitive callers can keep their copies.
        result.catch(() => receipts.delete(id))
      }
      return result
    } catch (error) {
      receipts.delete(id)
      throw error
    }
  }

  let plugin: Plugin = {
    name: '@yaks/sync',
    // The two marks a batch carries through `apply()` (./mark.ts): what the
    // caller sent, and what came back from the server.
    requests: [SENT, ECHO, ACK],
    hooks: {
      // Inside the transaction, before the patches: the copy to put back.
      precondition: (bundles, tx) => {
        if (bundles.some(echoed)) return bundles
        let eids = [...new Set(bundles.map((b) => b.entity.eid))]
        return after(tx.get(eids), (held) => {
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
      // After the rules, still before the patches: what they added, marked
      // with the copy to put back. The server's own batch carries what its
      // rules added, so a batch that came from it has nothing to mark.
      rules: (bundles, tx) => {
        let added = bundles.filter((b) => !asked(b))
        if (!added.length || bundles.some(echoed)) return bundles
        let eids = [...new Set(added.map((b) => b.entity.eid))]
        return after(tx.get(eids), (held) => {
          let was = new Map(held.map((b) => [b.entity.eid, b]))
          return bundles.map((b) =>
            asked(b) ? b : ruling(b, was.get(b.entity.eid) ?? null)
          )
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
    vocab: graph.vocab,
    url: opts.url,
    connect: opts.connect,
    timer,
    time: opts.time,
    wait: opts.wait,
    most: opts.most,
    pending,
    again: said.again,
    land: (frame: Frame) => {
      if (frame.refused) {
        // Kept for the watch to say why, and heard even by one never ready.
        refusals.set(frame.id, frame.refused)
        let was = states.get(frame.id)?.ready
        pending(frame.id)
        if (!was) notify(frame.id, false)
        return report({
          sent: [],
          refused: frame.refused,
          reverted: false,
          subscription: frame.id,
        })
      }
      // Another connection's word on a value takes it over (./saying.ts).
      said.heard(frame.relay ?? [])
      refusals.delete(frame.id)
      let state = states.get(frame.id)
      let safe = frame
      // With a working-set policy, ownership lives there, not in a duplicate
      // registry here. Standalone sync still protects cross-subscription rows.
      if (!opts.replica) {
        if (frame.peerCoverage || frame.peers || frame.peerGone) {
          throw new Error('rider delivery requires a working-set replica')
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
      let out = after(
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
      return out
    },
    report: (error) => {
      if (
        !(error instanceof WriteUnknown) && !(error instanceof WriteRefused)
      ) {
        report({ sent: [], error, reverted: false })
      }
    },
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
      refusals.delete(id)
      asks.delete(id)
      members.delete(id)
      w.unsubscribe(id)
      opts.replica?.unsubscribe(id)
      if (ready) notify(id, false)
    },
    now: w.now,
    connected: w.connected,
    onConnection: w.onConnection,
    ready: (id) => states.get(id)?.ready ?? false,
    onReady: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    refusal: (id) => refusals.get(id),
    submit,
    apply,
    idle: () => sending,
    pending: outbox.pending,
    onPending: outbox.onPending,
    retry: outbox.retry,
    forget: outbox.forget,
    close: () => {
      outbox.close()
      w.close()
      for (let id of asks.keys()) opts.replica?.unsubscribe(id)
      asks.clear()
      members.clear()
      states.clear()
      refusals.clear()
      listeners.clear()
    },
  }
}
