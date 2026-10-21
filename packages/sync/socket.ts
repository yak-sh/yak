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
// holding and did not hear about again is reported as gone. The relayed values
// this side is saying are said again first, since the server held them under
// the connection that closed.

import type { Bundle, Eid } from '@yaks/graph'
import { decode, stringify, unpack } from '@yaks/vocab/wire'
import type { Vocab } from '@yaks/vocab'
import { coalesced } from '@yaks/graph/bundle'
import type { Coverage } from './coverage.ts'
import { clock } from './clock.ts'

/** The part of a WebSocket this package uses. The standard `WebSocket`
 * satisfies it, and so does any stand-in a test or a caller provides. */
export type Socket = {
  /** `0` connecting, `1` open, `2` closing, `3` closed */
  readyState: number
  /** bytes already handed to the transport but not yet sent */
  bufferedAmount?: number
  /** send one frame, already serialized */
  send(data: string): void
  /** close the connection, saying why with a close code */
  close(code?: number): void
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
  /** an opted-in subscriber echoes this after applying the frame */
  ack?: string
  transient?: import('@yaks/graph').TransientFrame[]
  transientReset?: string[]
  /** the subscription this frame answers */
  id: string
  /** the entities now in the set (whole rows, unless `coverage` says what
   * each answers for), or, for a raw feed, the bundles as applied */
  bundles?: Bundle[]
  /** Per-row coverage for result bundles. Omitted entries are full rows. Each delivery
   * replaces that role's coverage. Adapters must repeat projected coverage on
   * deltas, including exclusions for deliberately omitted bodies. */
  coverage?: Record<Eid, Coverage>
  /** Rider coverage, independent even when an eid has both roles in a frame.
   * Omitted entries cover only delivered properties. */
  peerCoverage?: Record<Eid, Coverage>
  /** Payload riders, pinned by this subscription but never query members:
   * the entities a `.fields` projection's paths reach (@yaks/api). */
  peers?: Bundle[]
  /** Rider departures, independent of result membership. reset replaces both. */
  peerGone?: Eid[]
  /** entities that left the set — deleted, or no longer matching */
  gone?: Eid[]
  /**
   * `sync: peers` components the server is relaying: somebody's cursor, a
   * caret, a presence dot. The server keeps none of it, and a client holds it
   * in its graph's memory until it is cleared: a value cleared by its writer —
   * or by that writer's connection closing — arrives as the component set to
   * `null`.
   *
   * Not to be confused with `peers` above, the payload riders. The two are
   * unrelated; this one carries the `sync: peers` components.
   */
  relay?: Bundle[]
  /** why the subscription was refused, when it was */
  refused?: { error: string; message: string; [k: string]: unknown }
  /** an aggregate query's answer, in place of bundles: `.count`,
   * `.distinct=prop` and `.tally=prop` (@yaks/api) */
  count?: number
  distinct?: string[]
  tally?: Record<string, number>
  /** the first frame after a reopen: the set as it now stands, whole */
  reset?: boolean
}

/** The socket's half of a sync: what it has to be told, and what it reports. */
export type WireOpts = {
  /** Interpret binary properties only when their vocabulary declares them. */
  vocab?: Vocab
  /** the server's base URL — `https://…` or `http://…` */
  url: string
  /** the socket constructor (default: the global `WebSocket`) */
  connect?: Connect
  /** Local epoch milliseconds for clock measurements (default: a monotonic epoch). */
  time?: () => number
  /** how a reconnect is scheduled (default: `setTimeout`) */
  timer?: Timer
  /** the reconnect delay in ms after a failed attempt, doubling to `most`
   * (default: 250); a connection that held this long is retried at once */
  wait?: number
  /** the longest reconnect delay in ms (default: 30_000) */
  most?: number
  /** each frame, once the reset bookkeeping has been done for it */
  land: (frame: Frame) => unknown | Promise<unknown>
  /** a subscription needs a fresh answer: opened, re-pointed or disconnected */
  pending?: (id: string) => void
  /** the `sync: peers` values this side is saying, said again on every
   * connection before its subscriptions (./saying.ts) */
  again?: () => Bundle[]
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
   * is down is dropped, never queued: there is no backlog worth replaying, and
   * the next connection is told what is being said as it stands (`again`).
   */
  relay: (bundles: Bundle[]) => void
  /** Store epoch milliseconds; first use opens the socket and starts calibration.
   * Until the first reply this is the local epoch; across outages it holds the offset. */
  now: () => number
  /** whether the socket is open right now */
  connected: () => boolean
  /** be called with true each time the socket opens, and with false each
   * time an open one closes under it; not called immediately. The returned
   * function removes the listener. */
  onConnection: (fn: (open: boolean) => void) => () => void
  /** close the socket and stop reconnecting */
  close: () => void
}

/** An open socket that closed under this wire and opened again: what closed
 * it (its close code, when it gave one) and how long it was down. Said once it
 * reopens, so a report about it reaches a server that is back. A server going
 * away on purpose (`1001`: a restart, a proxy reloading) that is back within
 * five seconds is the system working, and is never said. */
export class Dropped extends Error {
  constructor(url: string, code: number | undefined, ms: number) {
    super(
      `${url} closed${code ? ` (${code})` : ''} and reopened after ${
        (ms / 1000).toFixed(1)
      } s`,
    )
    this.name = 'Dropped'
  }
}

// Whether a drop is the system working rather than failing: the far side went
// away on purpose (close code 1001: a restart, a proxy reloading) and was back
// within five seconds. An abnormal close, or an outage that lasts, is a
// failure.
let expected = (code: number | undefined, ms: number): boolean =>
  code == 1001 && ms <= 5000

/** The next reconnect delay: double it, but never past the ceiling. */
export let backoff = (wait: number, most: number): number =>
  Math.min(wait * 2, most)

// `https://shelf.example/api` → `wss://shelf.example/api/ws`. The socket is
// served from the same origin as the HTTP routes, so only the scheme changes.
let wsUrl = (url: string): string =>
  `${url.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`

let OPEN = 1
let BUFFER = 8 * 1024

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
  let refused = new Set<string>() // terminal until explicitly re-pointed
  let members = new Map<string, Set<Eid>>() // who is in each set
  let resetting = new Set<string>() // ids whose next frame is a reset
  let socket: Socket | null = null
  let wait = first
  let retrying = false // the one timer — never a second
  let closed = false
  // Every unexpected drop is reported once the socket opens again
  // (`Dropped`), and an outage the backoff reaches its ceiling in is reported
  // as it goes on, once, until a connection opens again.
  let told = false
  let down: { at: number; code?: number } | undefined
  let hearing = new Set<(open: boolean) => void>()
  let heard = (open: boolean) => {
    for (let fn of hearing) fn(open)
  }
  let n = 0
  let waiting: Bundle[] = []
  let draining = false
  let agreed = clock(opts.time)
  let timing = false
  let trip: number | undefined
  let rounds = 0
  let clockGeneration = 0
  let clockTimer: ReturnType<typeof setTimeout> | undefined
  let stopClock = () => {
    clockGeneration++
    if (clockTimer !== undefined) clearTimeout(clockTimer)
    clockTimer = undefined
    trip = undefined
  }
  let probe = () => {
    if (!timing || closed || socket?.readyState != OPEN) return
    trip = agreed.read()
    send({ clock: trip })
    let generation = clockGeneration
    let next = () => {
      if (generation == clockGeneration) probe()
    }
    let ms = rounds++ < 7 ? 1000 : 30_000
    if (opts.timer) opts.timer(next, ms)
    else clockTimer = setTimeout(next, ms)
  }

  let send = (msg: unknown) => {
    if (socket && socket.readyState == OPEN) socket.send(stringify(msg))
  }
  let flush = () => {
    if (!waiting.length) return
    if (!socket || socket.readyState != OPEN) {
      waiting = []
      return
    }
    if ((socket.bufferedAmount ?? 0) >= BUFFER) {
      schedule()
      return
    }
    let bundles = waiting
    waiting = []
    send({ relay: bundles })
  }
  let schedule = () => {
    if (draining) return
    draining = true
    timer(() => {
      draining = false
      flush()
    }, 16)
  }

  // A frame, with the reopen bookkeeping done: a reset frame reports whatever
  // the client was holding and did not hear about again as gone, and every
  // frame keeps the membership set current so the next reset can do the same.
  let landed = (frame: Frame): unknown | Promise<unknown> => {
    // An unsubscribe can race a frame already in transit. It must not refill
    // the cache or recreate membership bookkeeping after its last owner left.
    if (frame.refused) {
      if (asks.has(frame.id)) {
        refused.add(frame.id)
        return opts.land(frame)
      }
      // A malformed or relay request may have no subscription id at all.
      let error = new Error(frame.refused.message)
      error.name = frame.refused.error
      opts.report(error)
      return
    }
    if (!asks.has(frame.id)) return
    refused.delete(frame.id)
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
    return opts.land({ ...frame, gone })
  }

  // `now`: the connection that dropped had held for a while, which is what a
  // server handing over to its replacement looks like, so the next one opens
  // at once. A connection that fails, or drops as soon as it opened, waits out
  // the backoff, so a server that accepts and hangs up is never hammered.
  let retry = (now = false) => {
    if (closed || retrying) return
    if (now) return open()
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
    let opened: number | undefined
    s.addEventListener('open', () => {
      if (socket != s || closed) return
      opened = agreed.read()
      waiting = []
      wait = first // the server is reachable: retry promptly after the next drop
      told = false
      if (down) {
        let ms = agreed.read() - down.at
        if (!expected(down.code, ms)) {
          opts.report(new Dropped(wsUrl(opts.url), down.code, ms))
        }
        down = undefined
      }
      agreed.reset()
      rounds = 0
      probe()
      // Said before anything is asked, so no answer hands back an older copy.
      let said = opts.again?.() ?? []
      if (said.length) s.send(stringify({ relay: said }))
      for (let [id, query] of asks) {
        if (refused.has(id)) continue
        resetting.add(id) // its answer will be the whole set, as it now stands
        s.send(
          stringify({ subscribe: query, id, acks: true, frames: true }),
        )
      }
      heard(true)
    })
    let inbox: Frame[] = []
    let landing = false
    let ack = (frame: Frame) => {
      if (frame.ack && socket == s && s.readyState == OPEN) {
        s.send(stringify({ ack: frame.ack }))
      }
    }
    let drain = () => {
      if (landing || socket != s || closed) return
      while (inbox.length) {
        let frame = inbox.shift()!
        try {
          let out = landed(frame)
          if (out instanceof Promise) {
            landing = true
            out.then(() => {
              ack(frame)
              landing = false
              drain()
            }, (err) => {
              opts.report(err)
              ack(frame)
              landing = false
              drain()
            })
            return
          }
          ack(frame)
        } catch (err) {
          opts.report(err)
          ack(frame)
        }
      }
    }
    let message = (data: unknown) => {
      if (socket != s || closed) return
      try {
        let packed = data instanceof ArrayBuffer || data instanceof Uint8Array
          ? unpack(data)
          : undefined
        let value = packed ? packed.value : JSON.parse(String(data))
        if (opts.vocab) value = decode(opts.vocab, value, packed?.payload)
        if (value && typeof value == 'object' && 'clock' in value) {
          if (trip !== undefined && value.clock === trip) {
            agreed.sample(trip, value.received, value.sent)
            trip = undefined
          }
          return
        }
        let packet = value as
          | Frame
          | { frames: Frame[]; ack?: string }
        if ('frames' in packet) {
          if (!Array.isArray(packet.frames) || !packet.frames.length) {
            throw new SyntaxError('expected nonempty frames')
          }
          inbox.push(...packet.frames.map((frame, i) => ({
            ...frame,
            ack: i == packet.frames.length - 1 ? packet.ack : undefined,
          })))
        } else inbox.push(packet)
        drain()
      } catch (err) {
        opts.report(err)
      }
    }
    let pending: Promise<void> | undefined
    s.addEventListener('message', (e) => {
      if (e.data instanceof Blob || pending) {
        let data = e.data
        pending = (pending ?? Promise.resolve()).then(async () => {
          message(data instanceof Blob ? await data.arrayBuffer() : data)
        }).catch(opts.report).finally(() => {
          if (pending === next) pending = undefined
        })
        let next = pending
      } else message(e.data)
    })
    s.addEventListener('error', (e) => {
      if (told || wait < most) return
      told = true
      let why = (e as ErrorEvent).message || 'the connection failed'
      opts.report(new Error(`${wsUrl(opts.url)}: ${why}; still reconnecting`))
    })
    s.addEventListener('close', (e) => {
      if (socket != s) return
      socket = null
      // A connection that never opened is a retry failing, not a drop.
      if (opened !== undefined) {
        down ??= { at: agreed.read(), code: (e as CloseEvent).code }
      }
      stopClock()
      waiting = []
      inbox = []
      // The next connection is on its way before the page hears of the loss.
      retry(opened !== undefined && agreed.read() - opened >= first)
      for (let id of asks.keys()) {
        if (!refused.has(id)) opts.pending?.(id)
      }
      if (opened !== undefined) heard(false)
    })
  }

  return {
    open,
    subscribe: (query, id) => {
      if (closed) throw new Error('wire is closed')
      let key = id ?? `s${++n}`
      refused.delete(key)
      asks.set(key, query)
      members.set(key, new Set())
      resetting.add(key)
      opts.pending?.(key)
      open()
      send({ subscribe: query, id: key, acks: true, frames: true })
      return key
    },
    unsubscribe: (id) => {
      asks.delete(id)
      refused.delete(id)
      members.delete(id)
      resetting.delete(id)
      send({ unsubscribe: id })
    },
    relay: (bundles) => {
      if (!bundles.length || !socket || socket.readyState != OPEN) return
      waiting = coalesced([...waiting, ...bundles])
      flush()
    },
    now: () => {
      if (!closed && !timing) {
        timing = true
        open()
        probe()
      }
      return agreed.now()
    },
    connected: () => socket?.readyState == OPEN,
    onConnection: (fn) => {
      hearing.add(fn)
      return () => hearing.delete(fn)
    },
    close: () => {
      closed = true
      hearing.clear()
      stopClock()
      waiting = []
      let s = socket
      socket = null
      for (let id of asks.keys()) opts.pending?.(id)
      asks.clear()
      refused.clear()
      members.clear()
      resetting.clear()
      s?.close()
    },
  }
}
