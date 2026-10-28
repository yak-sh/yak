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
  clockReply,
  decode,
  fault,
  type Frame,
  json,
  type Opening,
  type PeerWriter,
  queue,
  receive,
  refusal,
  type Sink,
  type Subs,
} from '@yaks/api'
import type { ReadOpts } from '@yaks/graph'
import { after, isPromise, over } from '@yaks/fp'
import type { DurableStorage } from './sql.ts'
import { holds, MissingSubscriptions } from './holds.ts'
import { type Delta, pack, unpack } from './watches.ts'

/**
 * The part of a hibernatable WebSocket this package uses: a frame out, and the
 * attachment that is the socket's only durable memory. A Cloudflare Worker's
 * server-side `WebSocket` satisfies it.
 */
export type Wire = {
  /** only an open socket can receive a frame; closing sockets may still be
   * returned by `getWebSockets()` */
  readyState: number
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
  accept(request: Request, opts?: ReadOpts, writer?: PeerWriter): Response
  /** a frame arrived — the object's `webSocketMessage` */
  message(
    ws: Wire,
    data: unknown,
    scope?: (
      kind: SocketKind,
      work: () => void | Promise<void>,
    ) => void | Promise<void>,
  ): void | Promise<void>
  /** a socket went away — the object's `webSocketClose` */
  close(ws: Wire): void | Promise<void>
  /** re-open the subscriptions of every socket this object inherited; call it
   * at the top of `fetch`, so a batch applied on a woken object still pushes.
   * Cold peer-only recovery may omit proven static snapshots, not interests. */
  wake(deferStatic?: boolean): void | Promise<void>
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
  read?: ReadOpts
  writer?: PeerWriter
  subs?: Record<string, Ask>
  subref?: string
  subdelta?: Delta | string
  relay?: string[]
  acks?: boolean
  frames?: boolean
  owed?: string
  seen?: string[]
}
let CAP = 2048
/** How long a burst of watch changes may take before its map is stored, ms. */
export let SETTLE = 1000
// A `sync: peers` value is held in memory, and this object's memory does not
// survive hibernation. The attachment keeps keys; saved components are
// hydrated from storage under those surviving holders. Unsaved components
// retain keys alone so their holder's close can still clear them. The 2KB
// attachment bounds how many keys survive alongside subscriptions.
let KEYS = 16
let open = (ws: Wire) => ws.readyState == 1

let copy = <T>(values: Record<string, T> = {}): Record<string, T> =>
  Object.assign(Object.create(null), values)

let bytes = new TextEncoder()
let size = (value: unknown) => bytes.encode(JSON.stringify(value)).length
let within = (value: unknown) => size(value) <= CAP

// The watch whose id takes the most room among those sent snapshots (a raw
// feed, `true`, is sent none).
let longest = (subs: Record<string, Ask>) => {
  let most: string | undefined
  let width = 0
  for (let [id, ask] of Object.entries(subs)) {
    if (ask === true) continue
    let wide = size(id)
    if (most === undefined || wide > width) {
      most = id
      width = wide
    }
  }
  return most
}

// The snapshots the attachment must have room to remember while an ACK is
// owed. Serial ACKs retain every snapshot already delivered while the next one
// waits: reserve the complete chain so later delivery cannot exceed the cap.
// Batched delivery checks each group before sending it: reserve enough space
// for its longest individual snapshot as watches are added.
let owing = (held: Held, subs: Record<string, Ask>) => {
  if (held.frames) {
    let most = longest(subs)
    return most === undefined ? held.seen : [most]
  }
  let chain = new Set(held.seen)
  for (let [id, ask] of Object.entries(subs)) if (ask !== true) chain.add(id)
  return [...chain]
}

// Whether the attachment holds this, and with ACKs on, still holds it once a
// delivery is owed. Every delivered frame asks, so only the reservation the
// socket's own mode needs is measured.
let fits = (held: Held, subs = held.subs ?? {}) =>
  within(held) &&
  (!held.acks ||
    within({ ...held, owed: '0'.repeat(36), seen: owing(held, subs) }))

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
  opts: {
    /** On peer-only recovery, register static durable watch interests without
     * repeating the snapshot already held by the page. Unknown queries open. */
    deferStatic?: boolean
    /** Restore caller read context from the authenticated socket writer. */
    read?: (
      read: ReadOpts | undefined,
      writer: PeerWriter | undefined,
    ) => ReadOpts
    /** A host whose authenticated standing expires on wake can require a
     * new handshake before this writer relays again. */
    writer?: (writer: PeerWriter) => boolean | Promise<boolean>
    /** Current read/delivery authority. Denial or failure retires the socket.
     * Checked on recovery, input, and at transport delivery (including ACKs). */
    authorize?: (
      read: ReadOpts | undefined,
      writer: PeerWriter | undefined,
    ) => boolean | Promise<boolean>
    /** How a burst of watch changes is put off until its stored map is
     * written once (default: a timer of {@link SETTLE} ms, which also keeps
     * the object from hibernating before the write is made). */
    defer?: (write: () => void) => void
  } = {},
): Sockets => {
  let sinks = new Map<
    Wire,
    ReturnType<typeof queue> & { forget: (id: string) => void }
  >()
  let closed = new WeakSet<Wire>()
  let recovered = new Map<Wire, Promise<void>>()
  let waking: Promise<void> | undefined
  let queries = new Map<Wire, Record<string, Ask>>()
  let baselines = new Map<Wire, Record<string, Ask>>()
  let repo: ReturnType<typeof holds> | undefined
  let backing = () => repo ??= holds(ctx.storage)
  // A page changes its watches in bursts: one that walks into another tile
  // opens the tiles it reaches and closes the ones it left, a message each.
  // Its stored map is written once the burst settles, not once a message.
  let owed = new Map<string, Record<string, Ask>>()
  let reading = (held: Held | null): ReadOpts | undefined =>
    opts.read ? opts.read(held?.read, held?.writer) : held?.read
  // The registry's timers (@yaks/api `Subs`), unset the runtime's: read as a
  // timer is set, so a clock probe never touches the registry.
  let timer = (fn: () => void, ms: number) => {
    if (subs.timer) return subs.timer(fn, ms)
    let t = setTimeout(fn, ms)
    return () => clearTimeout(t)
  }
  let defer = opts.defer ?? ((write) => void timer(write, SETTLE))
  let pay = () => {
    let due = [...owed]
    owed.clear()
    for (let [ref, map] of due) backing().write(ref, map)
  }
  let owe = (ref: string, map: Record<string, Ask>) => {
    let first = !owed.size
    owed.set(ref, map)
    if (first) defer(pay)
  }
  let release = (ref: string) => {
    owed.delete(ref)
    backing().delete(ref)
  }
  let asks = (ws: Wire): Record<string, Ask> => {
    let cached = queries.get(ws)
    if (cached) return cached
    let held = ws.deserializeAttachment() as Held | null
    let found = copy(held?.subref ? backing().read(held.subref) : held?.subs)
    if (held?.subref) baselines.set(ws, copy(found))
    for (let [id, ask] of Object.entries(unpack(held?.subdelta ?? {}))) {
      if (ask === null) delete found[id]
      else found[id] = ask
    }
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
      subdelta: undefined,
      ...(acks ? { acks: true } : {}),
      ...(frames ? { frames: true } : {}),
      seen: was.seen?.filter((id) => id in nextSubs),
    }
    if (fits(next)) {
      ws.serializeAttachment(next)
      if (was.subref) release(was.subref)
      baselines.delete(ws)
    } else {
      let ref = was.subref ?? crypto.randomUUID()
      let short = { ...next, subs: undefined, subref: ref }
      // A watch burst changes only part of a large stored map. Keep that
      // difference on the socket; compact only when it no longer fits.
      let baseline = baselines.get(ws)
      let delta = copy<Ask | null>()
      if (baseline) {
        for (let [id, ask] of Object.entries(nextSubs)) {
          if (!Object.hasOwn(baseline, id) || baseline[id] !== ask) {
            delta[id] = ask
          }
        }
        for (let id of Object.keys(baseline)) {
          if (!Object.hasOwn(nextSubs, id)) delta[id] = null
        }
      }
      let overlay: Held = { ...short, subdelta: delta }
      if (baseline && !fits(overlay, nextSubs)) overlay.subdelta = pack(delta)
      if (baseline && fits(overlay, nextSubs)) {
        ws.serializeAttachment(overlay)
      } else {
        // Repeated query paths often compress the complete watch map below
        // the attachment limit. Its existing delta format carries the map
        // over an empty base, preserving ACK room before anything spills.
        let packed: Held = {
          ...next,
          subs: undefined,
          subdelta: pack(nextSubs),
        }
        if (fits(packed, nextSubs)) {
          ws.serializeAttachment(packed)
          if (was.subref) release(was.subref)
          baselines.delete(ws)
        } else {
          if (!fits(short, nextSubs)) return false
          baselines.set(ws, nextSubs)
          owe(ref, nextSubs)
          ws.serializeAttachment(short)
        }
      }
    }
    queries.set(ws, nextSubs)
    return true
  }

  let drop = (ws: Wire) => {
    if (closed.has(ws)) return
    closed.add(ws)
    let to = sinks.get(ws)
    let dropped: void | Promise<void> = undefined
    if (to) {
      to.close()
      dropped = subs.drop(to.send)
    }
    sinks.delete(ws)
    queries.delete(ws)
    baselines.delete(ws)
    let held = ws.deserializeAttachment() as Held | null
    if (held?.subref) {
      // The socket can outlive this incarnation. Clear its pointer before
      // deleting the row, so a later wake cannot read a row we removed.
      ws.serializeAttachment({
        ...held,
        subref: undefined,
        subdelta: undefined,
        subs: undefined,
      })
      release(held.subref)
    }
    return dropped
  }

  let retire = (ws: Wire, error: unknown) => {
    if (!(error instanceof MissingSubscriptions)) throw error
    finish(ws)
    try {
      ws.close?.(1012, 'subscriptions lost')
    } catch { /* the socket may already be closed */ }
    report?.(error)
  }

  // A protocol retirement has no caller to await its final saved writes.
  let finish = (ws: Wire) => {
    let out = drop(ws)
    if (out) out.catch((error) => fault(error, 'socket close'))
  }

  // The sink for a socket, created once. A socket this object has not seen
  // before may still be one it inherited, so its stored subscriptions are
  // re-opened here — the client is sent its current results, which is the
  // resync.
  let authorize = (ws: Wire): boolean | Promise<boolean> => {
    if (!opts.authorize) return true
    let refused = () => {
      finish(ws)
      try {
        ws.close?.(1012, 'authorization handshake required')
      } catch { /* closed */ }
      return false
    }
    try {
      let held = ws.deserializeAttachment() as Held | null
      let out = opts.authorize(reading(held), held?.writer)
      return isPromise(out)
        ? out.then((ok) => ok && !closed.has(ws) || refused(), refused)
        : out && !closed.has(ws) || refused()
    } catch {
      return refused()
    }
  }

  let sink = (
    ws: Wire,
    openings?: Opening[],
    deferStatic = false,
  ): Sink | Promise<Sink> => {
    let to = sinks.get(ws)?.send
    if (to) return after(recovered.get(ws), () => to!)
    let held = ws.deserializeAttachment() as Held | null
    let seen = new Set(held?.owed ? held.seen ?? [] : [])
    if (!held?.owed && held?.seen?.length) {
      delivery(ws, undefined, [], asks(ws))
    }
    // Gate the transport, not just the registry sink: ACKs and timer flushes
    // can release frames long after the subscription's last read.
    let pending = Promise.resolve()
    let queued = 0
    let transport = !opts.authorize ? ws : {
      get bufferedAmount() {
        return ws.bufferedAmount
      },
      send: (data: string) => {
        if (++queued > 64) {
          finish(ws)
          ws.close?.(1012, 'authorization delivery backlog')
          return
        }
        pending = pending.then(async () => {
          if (closed.has(ws) || !open(ws)) return
          if (await authorize(ws) && !closed.has(ws) && open(ws)) ws.send(data)
        }).catch(() => {
          finish(ws)
          try {
            ws.close?.(1012, 'authorization handshake required')
          } catch { /* closed */ }
        }).finally(() => {
          queued--
        })
      },
    }
    let fresh = queue(transport, timer, () => open(ws), {
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
      // An ACK that let the next frame out was recorded by `sent` already.
      acked: (owed) => {
        if (owed) return
        seen.clear()
        delivery(ws, undefined, [], asks(ws))
      },
    })
    // A snapshot already on the wire before eviction needs its ACK, not a
    // second copy. The remaining subscriptions still get their snapshots.
    let skip = new Set(seen)
    let reopening = new Map(Object.entries(asks(ws)))
    let send: Sink = (frame) => {
      let snapshot = reopening.has(frame.id) && reopening.get(frame.id) !== true
      if (snapshot) reopening.delete(frame.id)
      if (snapshot && skip.delete(frame.id) && !frame.reset) return
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
    let out = after(subs.relayed(send, relayOf(ws)), () => {
      if (closed.has(ws)) return
      return after(
        over(Object.entries(asks(ws)), ([id, ask]) => {
          if (openings) {
            openings.push({ sink: send, id, query: ask, opts: reading(held) })
          } else {
            return subs.restore([{
              sink: send,
              id,
              query: ask,
              opts: reading(held),
            }], deferStatic)
          }
        }),
        () => {},
      )
    })
    if (isPromise(out)) {
      recovered.set(ws, out)
      out.then(() => recovered.delete(ws), () => recovered.delete(ws))
    }
    return after(out, () => send)
  }

  return {
    accept: (request, opts, writer) => {
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
      if (opts || writer) {
        pair[1].serializeAttachment({ read: opts, writer })
      }
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
      if (!open(ws)) return
      let received = Date.now()
      let input = decode(data)
      if (clockReply(ws, 'value' in input ? input.value : null, received)) {
        return
      }
      let run = () => {
        let held = ws.deserializeAttachment() as Held | null
        let msg = 'value' in input ? input.value : undefined
        // A held identity is vouched at the handshake. A host may refresh its
        // current standing on wake without making the page reopen its socket.
        let relay = msg && typeof msg == 'object' &&
          'relay' in msg && Array.isArray(msg.relay)
        let valid = relay
          ? held?.writer === undefined
            ? false
            : opts.writer?.(held.writer) ?? true
          : true
        return after(valid, (valid) => {
          if (!valid) {
            finish(ws)
            ws.close?.(1012, 'writer handshake required')
            return
          }
          return after(
            after(
              authorize(ws),
              (ok) =>
                ok
                  ? sink(ws, undefined, !!opts.deferStatic && !!relay)
                  : undefined,
            ),
            (to) => {
              if (!to) return
              let ask = asked('value' in input ? input.value : null)
              let sender = sinks.get(ws)!
              if (ask?.ack) return sender.ack(ask.ack)
              if (ask) sender.forget(ask.id)
              if (ask?.acks) sender.enable(ask.frames)
              let was = subs.relaying(to).join('\n')
              return after(
                receive(
                  subs,
                  to,
                  data,
                  undefined,
                  input,
                  reading(ws.deserializeAttachment() as Held | null),
                  (ws.deserializeAttachment() as Held | null)?.writer,
                ),
                (verdict) => {
                  if (verdict == 'close') {
                    finish(ws)
                    ws.close?.(1008, 'relay flood')
                    return
                  }
                  // Only when it moved: a frame that relays nothing should not rewrite
                  // an attachment, and most frames relay nothing.
                  let now = subs.relaying(to)
                  if (now.join('\n') != was) remember(ws, now, asks(ws))
                  if (!ask) return
                  let subscriptions = copy(asks(ws))
                  if (ask.ask === undefined) delete subscriptions[ask.id]
                  else subscriptions[ask.id] = ask.ask
                  if (hold(ws, subscriptions, ask.acks, ask.frames)) return
                  subs.close(to, ask.id)
                  to({
                    id: ask.id,
                    refused: refusal(
                      new RangeError(
                        'too many subscriptions to survive hibernation',
                      ),
                    ),
                  })
                },
              )
            },
          )
        })
      }
      let kind = messageKind('value' in input ? input.value : null)
      let recover = () => {
        try {
          let out = run()
          if (isPromise(out)) return out.catch((error) => retire(ws, error))
        } catch (error) {
          retire(ws, error)
        }
      }
      return scope ? scope(kind, recover) : recover()
    },

    close: drop,

    wake: (deferStatic = false) => {
      if (waking) {
        return deferStatic ? waking : waking.then(() => subs.resume?.())
      }
      let openings: Opening[] = []
      let out = after(
        over(ctx.getWebSockets(), (ws) => {
          if (closed.has(ws) || !open(ws)) return
          try {
            let restored = after(
              authorize(ws),
              (ok) => ok ? sink(ws, openings) : undefined,
            )
            if (isPromise(restored)) {
              return restored.then(() => {}, (error) => retire(ws, error))
            }
          } catch (error) {
            retire(ws, error)
          }
        }),
        () =>
          after(
            openings.length ? subs.restore(openings, deferStatic) : undefined,
            () => !deferStatic ? subs.resume?.() : undefined,
          ),
      )
      if (isPromise(out)) {
        waking = out
        out.then(() => waking = undefined, () => waking = undefined)
      }
      return out
    },
  }
}
