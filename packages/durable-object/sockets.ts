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
  decode,
  type Frame,
  json,
  queue,
  receive,
  refusal,
  type Sink,
  type Subs,
} from '@yaks/api'
import type { DurableStorage } from './sql.ts'
import { holds, MissingSubscriptions } from './holds.ts'

/**
 * The part of a hibernatable WebSocket this package uses: a frame out, and the
 * attachment that is the socket's only durable memory. A Cloudflare Worker's
 * server-side `WebSocket` satisfies it.
 */
export type Wire = {
  /** send one frame, already serialized */
  send(data: string): void
  /** close a connection whose messages keep exceeding its relay allowance */
  close?(code?: number, reason?: string): void
  /** bytes waiting inside the socket transport */
  bufferedAmount?: number
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
  /** the object's storage, used only when subscription queries exceed 2 KB */
  storage: DurableStorage
}

/** The plumbing an object wires its handlers to. */
export type Sockets = {
  /** answer a `/ws` request: accept the socket for hibernation, return the 101 */
  accept(request: Request): Response
  /** a frame arrived — the object's `webSocketMessage` */
  message(
    ws: Wire,
    data: unknown,
    scope?: (kind: SocketKind, work: () => void) => void,
  ): void
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
type Held = {
  subs?: Record<string, Ask>
  subref?: string
  relay?: string[]
  acks?: boolean
  frames?: boolean
  owed?: string
  seen?: string[]
}
let CAP = 2048
// A `sync: peers` value is held in memory, and this object's memory does not
// survive hibernation. What survives is the attachment, so the KEYS go there:
// a value lost to an eviction cannot be re-sent, but its clearing still can,
// and a peer left watching a cursor that will never move again is the worse
// failure. Bounded, because the 2KB is shared with the subscriptions — beyond
// this many keys, a value lost to an eviction remains until its writer clears
// it.
let KEYS = 16
let bytes = new TextEncoder()

let fits = (held: Held, subs = held.subs ?? {}) => {
  // Serial ACKs allow only one snapshot on the wire at a time. Reserve its
  // longest possible subscription id, not every id in the query map.
  let longest: string | undefined
  let width = 0
  for (let [id, ask] of Object.entries(subs)) {
    let size = bytes.encode(JSON.stringify(id)).length
    if (ask !== true && (longest === undefined || size > width)) {
      longest = id
      width = size
    }
  }
  let seen = longest === undefined ? held.seen : [longest]
  let full = held.acks ? { ...held, owed: '0'.repeat(36), seen } : held
  return bytes.encode(JSON.stringify(held)).length <= CAP &&
    bytes.encode(JSON.stringify(full)).length <= CAP
}

let delivery = (
  ws: Wire,
  owed?: string,
  seen: string[] = [],
  subs?: Record<string, Ask>,
) => {
  let held = ws.deserializeAttachment()
  let was = held && typeof held == 'object' ? held as Held : {}
  let next = { ...was, owed, seen: seen.length ? seen : undefined }
  if (!fits(next, subs)) {
    throw new RangeError('socket delivery exceeds attachment')
  }
  ws.serializeAttachment(next)
}

let snapshots = (
  frames: Frame[],
) => [
  ...new Set(
    frames.filter((frame) => frame.transientReset !== undefined || frame.reset)
      .map((frame) => frame.id),
  ),
]

let relayOf = (ws: Wire): string[] => {
  let held = ws.deserializeAttachment() as Held | null
  let keys = held && typeof held == 'object' ? held.relay : undefined
  return Array.isArray(keys) ? keys : []
}

// The relay keys, written back beside everything else. Over the cap they are
// simply not written: a relay must never cost somebody their subscriptions.
let remember = (ws: Wire, keys: string[], subs: Record<string, Ask>) => {
  let held = ws.deserializeAttachment()
  let was = held && typeof held == 'object' ? held as Held : {}
  let relay = keys.slice(0, KEYS)
  let next = relay.length ? { ...was, relay } : { ...was, relay: undefined }
  if (fits(next, subs)) ws.serializeAttachment(next)
}

// What a frame subscribed to, read alongside @yaks/api's own dispatch so that
// the attachment stays current. Anything malformed is not a subscription —
// `receive` rejects it.
let asked = (
  msg: unknown,
):
  | { id: string; ask?: Ask; acks?: boolean; frames?: boolean; ack?: string }
  | null => {
  if (!msg || typeof msg != 'object') return null
  if ('ack' in msg && typeof msg.ack == 'string') {
    return { id: '', ack: msg.ack }
  }
  let sub = 'subscribe' in msg ? msg.subscribe : undefined
  if (typeof sub == 'string' || sub === true) {
    return {
      id: 'id' in msg && msg.id != null ? String(msg.id) : '',
      ask: sub,
      acks: 'acks' in msg && msg.acks === true,
      frames: 'acks' in msg && msg.acks === true &&
        'frames' in msg && msg.frames === true,
    }
  }
  if ('unsubscribe' in msg && msg.unsubscribe != null) {
    return { id: String(msg.unsubscribe) }
  }
  return null
}

/** The finite protocol label a host may use for aggregate socket costs.
 * Frame ids, queries, relay values and malformed input never become labels. */
export type SocketKind = 'ack' | 'subscribe' | 'unsubscribe' | 'relay' | 'other'
let messageKind = (msg: unknown): SocketKind => {
  if (msg && typeof msg == 'object') {
    if ('ack' in msg && typeof msg.ack == 'string') return 'ack'
    if (
      'subscribe' in msg &&
      (typeof msg.subscribe == 'string' || msg.subscribe === true)
    ) {
      return 'subscribe'
    }
    if ('unsubscribe' in msg && msg.unsubscribe != null) return 'unsubscribe'
    if ('relay' in msg && Array.isArray(msg.relay)) return 'relay'
  }
  return 'other'
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
export let sockets = (
  subs: Subs,
  ctx: Hibernation,
  report?: (error: Error) => void,
): Sockets => {
  let sinks = new Map<
    Wire,
    ReturnType<typeof queue> & { forget: (id: string) => void }
  >()
  let closed = new WeakSet<Wire>()
  let queries = new Map<Wire, Record<string, Ask>>()
  let repo: ReturnType<typeof holds> | undefined
  let backing = () => repo ??= holds(ctx.storage)
  let asks = (ws: Wire): Record<string, Ask> => {
    let cached = queries.get(ws)
    if (cached) return cached
    let held = ws.deserializeAttachment() as Held | null
    let found = held?.subref ? backing().read(held.subref) : held?.subs ?? {}
    queries.set(ws, found)
    return found
  }
  // Keep the small map on the socket. Once it exceeds the attachment's
  // allowance, keep only its key there and store the queries on this object.
  let hold = (
    ws: Wire,
    nextSubs: Record<string, Ask>,
    acks = false,
    frames = false,
  ) => {
    let held = ws.deserializeAttachment() as Held | null
    let was = held && typeof held == 'object' ? held : {}
    let next = {
      ...was,
      subs: nextSubs,
      subref: undefined,
      ...(acks ? { acks: true } : {}),
      ...(frames ? { frames: true } : {}),
      seen: was.seen?.filter((id) => id in nextSubs),
    }
    if (fits(next)) {
      ws.serializeAttachment(next)
      if (was.subref) backing().delete(was.subref)
    } else {
      let ref = was.subref ?? crypto.randomUUID()
      let short = { ...next, subs: undefined, subref: ref }
      if (!fits(short, nextSubs)) return false
      backing().write(ref, nextSubs)
      ws.serializeAttachment(short)
    }
    queries.set(ws, nextSubs)
    return true
  }

  let drop = (ws: Wire) => {
    if (closed.has(ws)) return
    closed.add(ws)
    let to = sinks.get(ws)
    if (to) {
      to.close()
      subs.drop(to.send)
    }
    sinks.delete(ws)
    queries.delete(ws)
    let held = ws.deserializeAttachment() as Held | null
    if (held?.subref) {
      // The socket can outlive this incarnation. Clear its pointer before
      // deleting the row, so a later wake cannot read a row we removed.
      ws.serializeAttachment({ ...held, subref: undefined, subs: undefined })
      backing().delete(held.subref)
    }
  }

  let retire = (ws: Wire, error: unknown) => {
    if (!(error instanceof MissingSubscriptions)) throw error
    drop(ws)
    try {
      ws.close?.(1012, 'subscriptions lost')
    } catch { /* the socket may already be closed */ }
    report?.(error)
  }

  // The sink for a socket, created once. A socket this object has not seen
  // before may still be one it inherited, so its stored subscriptions are
  // re-opened here — the client is sent its current results, which is the
  // resync.
  let sink = (ws: Wire): Sink => {
    let to = sinks.get(ws)?.send
    if (to) return to
    let held = ws.deserializeAttachment() as Held | null
    let seen = new Set(held?.owed ? held.seen ?? [] : [])
    if (!held?.owed && held?.seen?.length) {
      delivery(ws, undefined, [], asks(ws))
    }
    let fresh = queue(ws, undefined, undefined, {
      owed: held?.owed,
      fits: (frames) => {
        let held = ws.deserializeAttachment() as Held | null
        return fits(
          { ...held, owed: '0'.repeat(36), seen: snapshots(frames) },
          asks(ws),
        )
      },
      sent: (frames, token) => {
        if ((ws.deserializeAttachment() as Held | null)?.frames) seen.clear()
        for (let id of snapshots(frames)) seen.add(id)
        delivery(ws, token, [...seen], asks(ws))
      },
      acked: (owed) => {
        if (!owed) seen.clear()
        delivery(ws, owed, [...seen], asks(ws))
      },
    })
    // A snapshot already on the wire before eviction needs its ACK, not a
    // second copy. The remaining subscriptions still get their snapshots.
    let skip = new Set(seen)
    let reopening = new Map(Object.entries(asks(ws)))
    let send: Sink = (frame) => {
      let snapshot = reopening.has(frame.id) && reopening.get(frame.id) !== true
      if (snapshot) reopening.delete(frame.id)
      if (snapshot && skip.delete(frame.id)) return
      fresh.send(snapshot ? { ...frame, reset: true } : frame)
    }
    sinks.set(ws, {
      ...fresh,
      send,
      forget: (id) => {
        seen.delete(id)
        skip.delete(id)
        let held = ws.deserializeAttachment() as Held | null
        delivery(ws, held?.owed, [...seen], asks(ws))
      },
    })
    if (held?.acks) fresh.enable(held.frames)
    // The relay keys first: whatever else this socket did, the registry has to
    // know what it is saying before a close can stop saying it.
    subs.relayed(send, relayOf(ws))
    for (let [id, ask] of Object.entries(asks(ws))) {
      subs.open(send, id, ask)
    }
    return send
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

    message: (ws, data, scope) => {
      if (closed.has(ws)) return
      let input = decode(data)
      let run = () => {
        let to = sink(ws)
        let ask = asked('value' in input ? input.value : null)
        let sender = sinks.get(ws)!
        if (ask?.ack) return sender.ack(ask.ack)
        if (ask) sender.forget(ask.id)
        if (ask?.acks) sender.enable(ask.frames)
        let was = subs.relaying(to).join('\n')
        if (receive(subs, to, data, undefined, input) == 'close') {
          drop(ws)
          ws.close?.(1008, 'relay flood')
          return
        }
        // Only when it moved: a frame that relays nothing should not rewrite
        // an attachment, and most frames relay nothing.
        let now = subs.relaying(to)
        if (now.join('\n') != was) remember(ws, now, asks(ws))
        if (!ask) return
        let subscriptions = { ...asks(ws) }
        if (ask.ask === undefined) delete subscriptions[ask.id]
        else subscriptions[ask.id] = ask.ask
        if (hold(ws, subscriptions, ask.acks, ask.frames)) return
        subs.close(to, ask.id)
        to({
          id: ask.id,
          refused: refusal(
            new RangeError('too many subscriptions to survive hibernation'),
          ),
        })
      }
      let kind = messageKind('value' in input ? input.value : null)
      let recover = () => {
        try {
          run()
        } catch (error) {
          retire(ws, error)
        }
      }
      return scope ? scope(kind, recover) : recover()
    },

    close: drop,

    wake: () => {
      for (let ws of ctx.getWebSockets()) {
        if (closed.has(ws)) continue
        try {
          sink(ws)
        } catch (error) {
          retire(ws, error)
        }
      }
    },
  }
}
