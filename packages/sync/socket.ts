// The receiving side: one WebSocket, the subscriptions held open across it,
// and the reconnect that opens them again.
//
// A socket dies for reasons that have nothing to do with the client — a laptop
// lid, a deploy, a proxy timeout — so "connected" is a state this module keeps
// track of rather than something the caller checks. There is one reconnect
// timer per instance: a second one turns a server that is merely slow into a
// client that hammers it, which is how a wedged server stays wedged.
//
// Reopening is not the same as never having disconnected. The server tracks
// each subscription's membership per connection, so a subscription opened again
// answers with the set as it stands and reports nothing about what left while
// the client was away. This module therefore tracks each subscription's members
// itself and treats the first frame after a reopen as a reset: whatever it was
// holding and did not hear about again is reported as gone.

import type { Bundle, Eid } from '@yaks/graph'
import type { Coverage } from './coverage.ts'

/** The part of a WebSocket this package uses. The standard `WebSocket`
 * satisfies it, and so does any stand-in a test or a caller provides. */
export type Socket = {
  /** `0` connecting, `1` open, `2` closing, `3` closed */
  readyState: number
  /** send one frame, already serialized */
  send(data: string): void
  /** close the connection */
  close(): void
  /** listen for `open`, `message`, `close` and `error` */
  addEventListener(
    type: string,
    listener: (event: Event & { data?: unknown }) => void,
  ): void
}

/** How a socket is made: the `WebSocket` constructor, or a stand-in with the
 * same call shape. */
export type Connect = (url: string) => Socket

/** How a retry is scheduled. Defaults to `setTimeout`; a test passes its own
 * and fires the reconnect when it wants one. */
export type Timer = (fn: () => void, ms: number) => void

/** What a subscriber asks for: a query, or `true` for the raw feed of every
 * committed write. */
export type Ask = string | true

/** One push from the server: the entities now in the set, the ones that left
 * it, or the refusal that closed the subscription. */
export type Frame = {
  transient?: import('@yaks/graph').TransientFrame[]
  transientReset?: string[]
  /** the subscription this frame answers */
  id: string
  /** the entities now in the set (whole rows), or, for a raw feed, the
   * bundles as applied */
  bundles?: Bundle[]
  /** Per-row coverage for result bundles. Omitted entries are full rows. Each delivery
   * replaces that role's coverage. Adapters must repeat projected coverage on
   * deltas, including exclusions for deliberately omitted bodies. */
  coverage?: Record<Eid, Coverage>
  /** Rider coverage, independent even when an eid has both roles in a frame.
   * Omitted entries cover only delivered properties. */
  peerCoverage?: Record<Eid, Coverage>
  /** Payload riders, pinned by this subscription but never query members. */
  peers?: Bundle[]
  /** Rider departures, independent of result membership. reset replaces both. */
  peerGone?: Eid[]
  /** entities that left the set — deleted, or no longer matching */
  gone?: Eid[]
  /**
   * `sync: peers` components the server is relaying: somebody's cursor, a
   * caret, a presence dot. Never stored, on either end. A value cleared by its
   * writer — or by that writer's connection closing — arrives as the component
   * set to `null`.
   *
   * Not to be confused with `peers` above, which is this package's older name
   * for a join's payload riders. The two are unrelated; this one carries the
   * `sync: peers` components.
   */
  relay?: Bundle[]
  /** why the subscription was refused, when it was */
  refused?: { error: string; message: string; [k: string]: unknown }
  /** the first frame after a reopen: the set as it now stands, whole */
  reset?: boolean
}

/** The socket's half of a sync: what it has to be told, and what it reports. */
export type WireOpts = {
  /** the server's base URL — `https://…` or `http://…` */
  url: string
  /** the socket constructor (default: the global `WebSocket`) */
  connect?: Connect
  /** how a reconnect is scheduled (default: `setTimeout`) */
  timer?: Timer
  /** the first reconnect delay in ms, doubling to `most` (default: 250) */
  wait?: number
  /** the longest reconnect delay in ms (default: 30_000) */
  most?: number
  /** each frame, once the reset bookkeeping has been done for it */
  land: (frame: Frame) => void
  /** a subscription needs a fresh answer: opened, re-pointed or disconnected */
  pending?: (id: string) => void
  /** anything that went wrong on the socket */
  report: (err: unknown) => void
}

/** A live WebSocket with subscriptions held open on it. */
export type Wire = {
  /** open the socket if it is not already opening or open */
  open: () => void
  /** subscribe (or re-point an existing id); returns the id */
  subscribe: (query: Ask, id?: string) => string
  /** drop one subscription */
  unsubscribe: (id: string) => void
  /**
   * Send `sync: peers` components to the server to relay. It is the only write
   * sent over the socket rather than posted, and it goes here because its
   * lifetime is this socket's: the server holds it under this connection and
   * clears it when the connection closes. A relay message sent while the socket
   * is down is dropped, never queued — this state is short-lived, there is no
   * backlog worth replaying, and the next write carries the current value.
   */
  relay: (bundles: Bundle[]) => void
  /** whether the socket is open right now */
  connected: () => boolean
  /** close the socket and stop reconnecting */
  close: () => void
}

/** The next reconnect delay: double it, but never past the ceiling. */
export let backoff = (wait: number, most: number): number =>
  Math.min(wait * 2, most)

// `https://shelf.example/api` → `wss://shelf.example/api/ws`. The socket is
// served from the same origin as the HTTP routes, so only the scheme changes.
let wsUrl = (url: string): string =>
  `${url.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`

let OPEN = 1

let global = (): Connect | undefined => {
  let W = (globalThis as { WebSocket?: new (url: string) => Socket }).WebSocket
  return W && ((url) => new W(url))
}

/**
 * The socket half of a sync: subscriptions that survive a disconnection, one
 * reconnect timer, and a reset frame after each reopen so a client can work out
 * what left the set while it was away.
 */
export let wire = (opts: WireOpts): Wire => {
  let connect = opts.connect ?? global()
  let timer = opts.timer ?? ((fn, ms) => setTimeout(fn, ms))
  let first = opts.wait ?? 250
  let most = opts.most ?? 30_000

  let asks = new Map<string, Ask>() // what each subscription asked for
  let members = new Map<string, Set<Eid>>() // who is in each set
  let resetting = new Set<string>() // ids whose next frame is a reset
  let socket: Socket | null = null
  let wait = first
  let retrying = false // the one timer — never a second
  let closed = false
  let n = 0

  let send = (msg: unknown) => {
    if (socket && socket.readyState == OPEN) socket.send(JSON.stringify(msg))
  }

  // A frame, with the reopen bookkeeping done: a reset frame reports whatever
  // the client was holding and did not hear about again as gone, and every
  // frame keeps the membership set current so the next reset can do the same.
  let landed = (frame: Frame) => {
    // An unsubscribe can race a frame already in transit. It must not refill
    // the cache or recreate membership bookkeeping after its last owner left.
    if (!asks.has(frame.id)) return
    let held = members.get(frame.id) ?? new Set<Eid>()
    members.set(frame.id, held)
    let gone = [...(frame.gone ?? [])]
    let arrived = (frame.bundles ?? []).map((b) => b.entity.eid)
    if (!frame.refused && (resetting.delete(frame.id) || frame.reset)) {
      let seen = new Set(arrived)
      for (let eid of held) if (!seen.has(eid)) gone.push(eid)
      held.clear()
      frame = { ...frame, reset: true }
    }
    for (let eid of arrived) held.add(eid)
    for (let eid of gone) held.delete(eid)
    opts.land({ ...frame, gone })
  }

  let retry = () => {
    if (closed || retrying) return
    retrying = true
    timer(() => {
      retrying = false
      open()
    }, wait)
    wait = backoff(wait, most)
  }

  let open = () => {
    if (closed || !connect) return
    if (socket && socket.readyState <= OPEN) return
    let s = connect(wsUrl(opts.url))
    socket = s
    s.addEventListener('open', () => {
      if (socket != s || closed) return
      wait = first // the server is reachable: retry promptly after the next drop
      for (let [id, query] of asks) {
        resetting.add(id) // its answer will be the whole set, as it now stands
        s.send(JSON.stringify({ subscribe: query, id }))
      }
    })
    s.addEventListener('message', (e) => {
      if (socket != s || closed) return
      try {
        landed(JSON.parse(String(e.data)) as Frame)
      } catch (err) {
        opts.report(err)
      }
    })
    s.addEventListener('error', (e) => opts.report(e))
    s.addEventListener('close', () => {
      if (socket != s) return
      socket = null
      for (let id of asks.keys()) opts.pending?.(id)
      retry()
    })
  }

  return {
    open,
    subscribe: (query, id) => {
      if (closed) throw new Error('wire is closed')
      let key = id ?? `s${++n}`
      asks.set(key, query)
      members.set(key, new Set())
      resetting.add(key)
      opts.pending?.(key)
      open()
      send({ subscribe: query, id: key })
      return key
    },
    unsubscribe: (id) => {
      asks.delete(id)
      members.delete(id)
      resetting.delete(id)
      send({ unsubscribe: id })
    },
    relay: (bundles) => {
      if (bundles.length) send({ relay: bundles })
    },
    connected: () => socket?.readyState == OPEN,
    close: () => {
      closed = true
      let s = socket
      socket = null
      for (let id of asks.keys()) opts.pending?.(id)
      asks.clear()
      members.clear()
      resetting.clear()
      s?.close()
    },
  }
}
