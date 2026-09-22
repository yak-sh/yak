// The socket plumbing, and only the plumbing. What a subscription means — a
// saved query whose results are sent again when a committed write changes them
// — belongs to @yaks/api; this file carries frames between that registry and a
// Durable Object's WebSockets, which no standard covers.
//
// The whole difficulty is hibernation. A socket accepted with
// `ctx.acceptWebSocket` outlives the object: the runtime evicts the object
// between two frames and rebuilds it on the next one, so every subscription
// held in memory is gone while the client still believes it is watching. The
// only thing that survives is the socket's attachment, so that is where what a
// socket subscribed to is written, and a woken object rebuilds the registry
// from it (`wake`) before doing anything else. A client's first frame after a
// hibernation is answered with its current results again — a resync, not
// silence.
//
// A hibernated socket fires no events either, so @yaks/api's `attach()`, which
// registers event listeners, cannot be used here: the object's own
// `webSocketMessage` and `webSocketClose` handlers take its place, calling
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
// A plain Worker's upgrade — a pair accepted in this isolate, for @yaks/api's
// own `/ws` route — is @yaks/workerd' `workerUpgrade`. Here the socket is
// handed to the runtime instead, which is what hibernation means.
declare let WebSocketPair: { new (): { 0: unknown; 1: Wire } }

// A socket's subscriptions, stored on the socket. The runtime caps an
// attachment at 2KB, and the application may be storing fields of its own
// there, so the subscriptions live under one key and the rest is left alone.
type Held = { subs?: Record<string, Ask>; relay?: string[] }
let CAP = 2048
// A `sync: peers` value is held in memory, and this object's memory does not
// survive hibernation. What survives is the attachment, so the KEYS go there:
// a value lost to an eviction cannot be re-sent, but its clearing still can,
// and a peer left watching a cursor that will never move again is the worse
// failure. Bounded, because the 2KB is shared with the subscriptions — beyond
// this many keys, a value lost to an eviction remains until its writer clears
// it.
let KEYS = 16

let asksOf = (ws: Wire): Record<string, Ask> => {
  let held = ws.deserializeAttachment() as Held | null
  let subs = held && typeof held == 'object' ? held.subs : undefined
  return subs && typeof subs == 'object' ? { ...subs } : {}
}

// Write the subscriptions back beside whatever else the application stores.
// `false` means they would not fit — the runtime would drop the whole
// attachment at the next hibernation, so the subscription is rejected now
// rather than disappearing silently later.
let hold = (ws: Wire, subs: Record<string, Ask>): boolean => {
  let held = ws.deserializeAttachment()
  let next = { ...(held && typeof held == 'object' ? held : {}), subs }
  if (JSON.stringify(next).length > CAP) return false
  ws.serializeAttachment(next)
  return true
}

let relayOf = (ws: Wire): string[] => {
  let held = ws.deserializeAttachment() as Held | null
  let keys = held && typeof held == 'object' ? held.relay : undefined
  return Array.isArray(keys) ? keys : []
}

// The relay keys, written back beside everything else. Over the cap they are
// simply not written: a relay must never cost somebody their subscriptions.
let remember = (ws: Wire, keys: string[]) => {
  let held = ws.deserializeAttachment()
  let was = held && typeof held == 'object' ? held as Held : {}
  let relay = keys.slice(0, KEYS)
  let next = relay.length ? { ...was, relay } : { ...was, relay: undefined }
  if (JSON.stringify(next).length <= CAP) ws.serializeAttachment(next)
}

// What a frame subscribed to, read alongside @yaks/api's own dispatch so that
// the attachment stays current. Anything malformed is not a subscription —
// `receive` rejects it.
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
 * Frames go straight to the socket; no durable write crosses it (a batch is
 * applied with `POST /apply`, and the socket is how everyone hears about it).
 * The one exception is a `sync: peers` relay, which crosses here because its
 * lifetime is this socket's — see @yaks/api's `receive`.
 */
export let sockets = (subs: Subs, ctx: Hibernation): Sockets => {
  let sinks = new Map<Wire, Sink>()

  // The sink for a socket, created once. A socket this object has not seen
  // before may still be one it inherited, so its stored subscriptions are
  // re-opened here — the client is sent its current results, which is the
  // resync.
  let sink = (ws: Wire): Sink => {
    let to = sinks.get(ws)
    if (to) return to
    let fresh: Sink = (frame) => ws.send(JSON.stringify(frame))
    sinks.set(ws, fresh)
    // The relay keys first: whatever else this socket did, the registry has to
    // know what it is saying before a close can stop saying it.
    subs.relayed(fresh, relayOf(ws))
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
      // Accepted for hibernation: the runtime holds this socket while the
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
      let was = subs.relaying(to).join('\n')
      receive(subs, to, data)
      // Only when it moved: a frame that relays nothing should not rewrite an
      // attachment, and most frames relay nothing.
      let now = subs.relaying(to)
      if (now.join('\n') != was) remember(ws, now)
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
