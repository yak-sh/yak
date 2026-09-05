// The inbound half's plumbing: one socket, the subscriptions held open across
// it, and the reconnect that puts them back.
//
// A socket dies for reasons that have nothing to do with the client — a laptop
// lid, a deploy, a proxy timeout — so "connected" is a state this module
// maintains rather than a thing the caller checks. There is ONE reconnect timer
// per instance: a second one turns a server that is merely slow into a client
// that hammers it, which is how a wedged server stays wedged.
//
// Reopening is not the same as never having disconnected. The server holds
// each subscription's membership per connection, so a fresh subscription
// answers with the set as it stands and says nothing about what left while the
// client was away. This module therefore remembers each subscription's members
// itself and treats the first frame after a reopen as a RESET: whatever it held
// and did not hear again is reported as gone.

import type { Bundle, Eid } from '@yaks/graph'

/** The part of a WebSocket this package uses. The standard `WebSocket`
 * satisfies it, and so does any stand-in a test or a host provides. */
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

/** What a subscriber asks for: a query line, or `true` for the raw feed of
 * every committed batch. */
export type Ask = string | true

/** One push from the server: the entities now in the set, the ones that left
 * it, or the refusal that closed the subscription. */
export type Frame = {
  /** the subscription this frame answers */
  id: string
  /** the entities now in the set (whole), or the applied batch for a raw feed */
  bundles?: Bundle[]
  /** entities that left the set — deleted, or no longer matching */
  gone?: Eid[]
  /** why the subscription was refused, when it was */
  refused?: { error: string; message: string; [k: string]: unknown }
  /** the first frame after a reopen: the set as it now stands, whole */
  reset?: boolean
}

/** The socket's half of a sync: what it needs to be told, and what it reports. */
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
  /** anything that went wrong on the socket */
  report: (err: unknown) => void
}

/** A live socket with subscriptions on it. */
export type Wire = {
  /** open the socket if it is not already opening or open */
  open: () => void
  /** subscribe (or re-point an existing id) and answer with the id */
  subscribe: (query: Ask, id?: string) => string
  /** drop one subscription */
  unsubscribe: (id: string) => void
  /** whether the socket is open right now */
  connected: () => boolean
  /** close the socket and stop reconnecting */
  close: () => void
}

/** The next reconnect delay: double it, but never past the ceiling. */
export let backoff = (wait: number, most: number): number =>
  Math.min(wait * 2, most)

// `https://shelf.example/api` → `wss://shelf.example/api/ws`. The socket lives
// beside the routes on the same origin, so the scheme is the only edit.
let wsUrl = (url: string): string =>
  `${url.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`

let OPEN = 1

let global = (): Connect | undefined => {
  let W = (globalThis as { WebSocket?: new (url: string) => Socket }).WebSocket
  return W && ((url) => new W(url))
}

/**
 * The socket half of a sync: subscriptions that survive a disconnection, one
 * reconnect timer, and a reset frame after each reopen so a client can tell
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

  // A frame, with the reopen bookkeeping done: a reset frame reports what the
  // client held and did not hear about as gone, and every frame keeps the
  // membership set current so the NEXT reset can do the same.
  let landed = (frame: Frame) => {
    let held = members.get(frame.id) ?? new Set<Eid>()
    members.set(frame.id, held)
    let gone = [...(frame.gone ?? [])]
    let arrived = (frame.bundles ?? []).map((b) => b.entity.eid)
    if (resetting.delete(frame.id) && !frame.refused) {
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
      wait = first // the server is reachable: the next drop retries promptly
      for (let [id, query] of asks) {
        resetting.add(id) // its answer is the whole set, as it now stands
        s.send(JSON.stringify({ subscribe: query, id }))
      }
    })
    s.addEventListener('message', (e) => {
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
      retry()
    })
  }

  return {
    open,
    subscribe: (query, id) => {
      let key = id ?? `s${++n}`
      asks.set(key, query)
      members.set(key, new Set())
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
    connected: () => socket?.readyState == OPEN,
    close: () => {
      closed = true
      let s = socket
      socket = null
      s?.close()
    },
  }
}
