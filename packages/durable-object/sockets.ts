// The socket plumbing, and only the plumbing. What a subscription MEANS — a
// saved query whose answer is pushed again when a committed batch changes it —
// is @yaks/api's; this file carries frames between that registry and a Durable
// Object's WebSockets, which no standard covers.
//
// The whole difficulty is HIBERNATION. A socket accepted with
// `ctx.acceptWebSocket` outlives the object: the runtime evicts the object
// between two frames and rebuilds it on the next one, so every subscription
// held in memory is gone while the client still believes it is watching. The
// only thing that survives is the socket's ATTACHMENT, so that is where what a
// socket asked for is written, and a woken object rebuilds the registry from it
// (`wake`) before it does anything else. A client's first frame after a
// hibernation is answered with its set again — a resync, not a silence.
//
// Hibernated sockets do not fire events either, so `attach()` from @yaks/api
// (which listens) is not the door here: the object's own
// `webSocketMessage`/`webSocketClose` handlers are, and they call
// {@link Sockets.message} and {@link Sockets.close}.

import {
  type Ask,
  json,
  receive,
  refusal,
  type Sink,
  type Subs,
} from '@yaks/api'

/**
 * The part of a hibernatable WebSocket this package uses: a frame out, and the
 * attachment that is the socket's only durable memory. A Cloudflare Worker's
 * server-side `WebSocket` satisfies it.
 */
export type Wire = {
  /** send one frame, already serialized */
  send(data: string): void
  /** hold a value on the socket itself — it survives hibernation (2KB cap) */
  serializeAttachment(value: unknown): void
  /** read that value back, `null` when nothing was held */
  deserializeAttachment(): unknown
}

/**
 * The part of a `DurableObjectState` this package uses: accepting a socket for
 * hibernation, and finding the ones a woken object inherited.
 */
export type Hibernation = {
  /** hand a socket to the runtime, so it outlives this object's memory */
  acceptWebSocket(ws: Wire): void
  /** every socket this object is serving, hibernated or not */
  getWebSockets(): Wire[]
}

/** The plumbing an object wires its handlers to. */
export type Sockets = {
  /** answer a `/ws` request: accept the socket for hibernation, return the 101 */
  accept(request: Request): Response
  /** a frame arrived — the object's `webSocketMessage` */
  message(ws: Wire, data: unknown): void
  /** a socket went away — the object's `webSocketClose` */
  close(ws: Wire): void
  /** re-open the subscriptions of every socket this object inherited; call it
   * at the top of `fetch`, so a batch applied on a woken object still pushes */
  wake(): void
}

// The runtime's socket factory: two ends of one connection, the client half
// handed back in the 101 response, the server half handed to the runtime.
// Declared structurally (the global is looked up at call time) so this package
// needs no Cloudflare dependency to compile.
//
// A plain Worker's upgrade — a pair accepted in THIS isolate, for @yaks/api's
// own `/ws` route — is @yaks/workers' `workerUpgrade`. Here the socket is
// handed to the runtime instead, which is what hibernation means.
declare let WebSocketPair: { new (): { 0: unknown; 1: Wire } }

// What a socket asked for, kept on the socket. The runtime caps an attachment
// at 2KB and a host may be holding fields of its own there, so the asks live
// under one key and the rest is left alone.
type Held = { subs?: Record<string, Ask> }
let CAP = 2048

let asksOf = (ws: Wire): Record<string, Ask> => {
  let held = ws.deserializeAttachment() as Held | null
  let subs = held && typeof held == 'object' ? held.subs : undefined
  return subs && typeof subs == 'object' ? { ...subs } : {}
}

// Write the asks back beside whatever else the host holds. `false` means they
// would not fit — the runtime would drop the whole attachment at the next
// hibernation, so the subscription is refused now instead of dying quietly.
let hold = (ws: Wire, subs: Record<string, Ask>): boolean => {
  let held = ws.deserializeAttachment()
  let next = { ...(held && typeof held == 'object' ? held : {}), subs }
  if (JSON.stringify(next).length > CAP) return false
  ws.serializeAttachment(next)
  return true
}

// What a frame asked for, read alongside @yaks/api's own dispatch so the
// attachment can be kept current. Junk is nobody's ask — `receive` refuses it.
let asked = (data: unknown): { id: string; ask?: Ask } | null => {
  try {
    let msg = JSON.parse(String(data))
    if (typeof msg?.subscribe == 'string' || msg?.subscribe === true) {
      return { id: msg?.id == null ? '' : String(msg.id), ask: msg.subscribe }
    }
    if (msg?.unsubscribe != null) return { id: String(msg.unsubscribe) }
    return null
  } catch {
    return null
  }
}

/**
 * Wire a Durable Object's sockets to a subscription registry. The object keeps
 * one of these and calls it from its three handlers:
 *
 * ```ts
 * // fetch(request)                 → live.wake(); live.accept(request)
 * // webSocketMessage(ws, data)     → live.message(ws, data)
 * // webSocketClose(ws)             → live.close(ws)
 * ```
 *
 * Frames go straight to the socket; no write ever crosses it (a batch is
 * applied with `POST /apply`, and the socket is how everyone hears about it).
 */
export let sockets = (subs: Subs, ctx: Hibernation): Sockets => {
  let sinks = new Map<Wire, Sink>()

  // The sink for a socket, made once. A socket this object has not seen before
  // may still be one it INHERITED, so its held asks are re-opened here — the
  // client is answered with its current set, which is the resync.
  let sink = (ws: Wire): Sink => {
    let to = sinks.get(ws)
    if (to) return to
    let fresh: Sink = (frame) => ws.send(JSON.stringify(frame))
    sinks.set(ws, fresh)
    for (let [id, ask] of Object.entries(asksOf(ws))) subs.open(fresh, id, ask)
    return fresh
  }

  return {
    accept: (request) => {
      if ((request.headers.get('upgrade') ?? '').toLowerCase() != 'websocket') {
        return json(
          { error: 'NotAllowed', message: 'this is a WebSocket endpoint' },
          405,
        )
      }
      let pair = new WebSocketPair()
      // Accepted for HIBERNATION: the runtime holds this socket while the
      // object is evicted and wakes the object with the next frame, so an idle
      // client costs nothing.
      ctx.acceptWebSocket(pair[1])
      // The 101 carries the other end; `webSocket` is the runtime's own
      // ResponseInit field, which no standard declares.
      return new Response(
        null,
        { status: 101, webSocket: pair[0] } as
          & ResponseInit
          & { webSocket: unknown },
      )
    },

    message: (ws, data) => {
      let to = sink(ws)
      let ask = asked(data)
      receive(subs, to, data)
      if (!ask) return
      let subscriptions = asksOf(ws)
      if (ask.ask === undefined) delete subscriptions[ask.id]
      else subscriptions[ask.id] = ask.ask
      if (hold(ws, subscriptions)) return
      subs.close(to, ask.id)
      to({
        id: ask.id,
        refused: refusal(
          new RangeError('too many subscriptions to survive hibernation'),
        ),
      })
    },

    close: (ws) => {
      let to = sinks.get(ws)
      if (to) subs.drop(to)
      sinks.delete(ws)
    },

    wake: () => {
      for (let ws of ctx.getWebSockets()) sink(ws)
    },
  }
}
