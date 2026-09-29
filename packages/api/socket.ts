// The WebSocket half: a socket wired to the subscription registry, and
// nothing else. Clients send two kinds of message, the server sends one frame
// shape back (see the README's Protocol), and no durable write ever crosses
// this connection — changes are applied with `POST /apply`, and the socket is
// how a client learns about them.
//
// Frames sent before the socket opens are queued: an upgrade hands back a
// socket that is still connecting until its response has been returned to the
// runtime, and a subscription opened on that first tick would otherwise throw
// while sending its own initial result.

import { fault, refusal } from './refuse.ts'
import { type Bundle, coalescer, isPromise } from '@yaks/graph'
import { admission } from './admission.ts'
import type { Frame, Sink, Subs } from './subs.ts'

/** The part of a WebSocket this package uses: the standard `WebSocket`
 * satisfies it, and so does a Cloudflare Worker's server-side half. */
export type Socket = {
  /** `0` connecting, `1` open — frames sent before it opens are queued */
  readyState: number
  /** bytes waiting inside the WebSocket transport */
  bufferedAmount?: number
  /** send one frame, already serialized */
  send(data: string): void
  /** stop a peer that keeps sending beyond its relay allowance */
  close?(code?: number, reason?: string): void
  /** listen for `open`, `message` and `close` */
  addEventListener(
    type: string,
    listener: (event: Event & { data?: unknown }) => void,
  ): void
}

/**
 * How the runtime turns a request into a WebSocket. This is the one thing
 * about serving that no web standard covers, so the application supplies it:
 * the Deno default is
 * {@link https://jsr.io/@yaks/api/doc/~/denoUpgrade | denoUpgrade}, and on
 * Cloudflare Workers you build one from `WebSocketPair` (see the README).
 */
export type Upgrade = (
  request: Request,
) => { socket: Socket; response: Response }

let OPEN = 1
let BUFFER = 8 * 1024
let TICK = 16
let BATCH = 32
let MAX_MESSAGE = 64 * 1024
let gates = new WeakMap<Subs, WeakMap<Sink, ReturnType<typeof admission>>>()

/** Decode one incoming frame before anyone dispatches it. A hibernating socket
 * can use the decoded shape to route its own work without parsing it again. */
export type Incoming =
  | { close: true }
  | { error: unknown }
  | { value: unknown }

export let decode = (data: unknown): Incoming => {
  try {
    if (data instanceof ArrayBuffer && data.byteLength > MAX_MESSAGE) {
      return { close: true }
    }
    if (data instanceof Blob && data.size > MAX_MESSAGE) {
      return { close: true }
    }
    let raw = String(data)
    if (raw.length > MAX_MESSAGE) return { close: true }
    return { value: JSON.parse(raw) }
  } catch (error) {
    return { error }
  }
}

let gate = (subs: Subs, to: Sink, now?: () => number) => {
  let bySink = gates.get(subs)
  if (!bySink) gates.set(subs, bySink = new WeakMap())
  let one = bySink.get(to)
  if (!one) bySink.set(to, one = admission(subs.pace ?? (() => null), now))
  return one
}
let peerOnly = (frame: Frame): frame is Frame & { relay: Bundle[] } =>
  !!frame.relay && Object.keys(frame).every((k) => k == 'id' || k == 'relay')

/** A replaceable frame queue for a socket, including hibernatable sockets
 * whose incoming messages are delivered by a Durable Object method. */
export let queue = (
  socket: Pick<Socket, 'send' | 'bufferedAmount'>,
  timer: (fn: () => void, ms: number) => void = (fn, ms) => {
    setTimeout(fn, ms)
  },
  ready: () => boolean = () => true,
  resume: {
    owed?: string
    sent?: (frames: Frame[], token: string) => void
    acked?: (owed?: string) => void
    fits?: (frames: Frame[]) => boolean
  } = {},
): {
  send: Sink
  flush: () => void
  close: () => void
  enable: (frames?: boolean) => void
  ack: (token: string) => void
} => {
  let waiting: Frame[] = []
  let draining = false
  let closed = false
  let enabled = false
  let frames = false
  let owed = resume.owed
  let relays = new WeakMap<Frame, ReturnType<typeof coalescer>>()
  let schedule = () => {
    if (draining || closed) return
    draining = true
    timer(() => {
      draining = false
      flush()
    }, TICK)
  }
  let flush = () => {
    if (!ready() || closed) return
    while (waiting.length && ready() && (socket.bufferedAmount ?? 0) < BUFFER) {
      if (owed && !peerOnly(waiting[0])) break
      let frame = waiting.shift()!
      let batch = relays.get(frame)
      if (batch) frame = { ...frame, relay: batch.read() }
      if (enabled && !peerOnly(frame)) {
        let token = crypto.randomUUID()
        owed = token
        let group = [frame]
        if (frames) {
          while (
            group.length < BATCH && waiting.length &&
            !peerOnly(waiting[0]) &&
            (resume.fits?.([...group, waiting[0]]) ?? true)
          ) group.push(waiting.shift()!)
        }
        resume.sent?.(group, token)
        socket.send(
          JSON.stringify(
            frames ? { frames: group, ack: token } : { ...frame, ack: token },
          ),
        )
      } else {
        socket.send(JSON.stringify(frame))
      }
    }
    if (ready() && waiting.length && (!owed || peerOnly(waiting[0]))) {
      schedule()
    }
  }
  let send: Sink = (frame) => {
    if (closed) return
    // Wait one tick to send the newest peer positions in one frame. A
    // membership or durable frame flushes the preceding relays first, so
    // their order relative to joins and leaves does not change.
    if (peerOnly(frame)) {
      for (let i = waiting.length - 1; i >= 0; i--) {
        let was = waiting[i]
        if (!peerOnly(was)) break
        if (was.id == frame.id) {
          let batch = relays.get(was) ?? coalescer()
          if (!relays.has(was)) batch.add(was.relay)
          batch.add(frame.relay)
          relays.set(was, batch)
          return
        }
      }
      waiting.push(frame)
      schedule()
      return
    }
    waiting.push(frame)
    flush()
  }
  return {
    send,
    flush,
    enable: (batched = false) => {
      enabled = true
      frames ||= batched
      flush()
    },
    ack: (token) => {
      if (token != owed) return
      owed = undefined
      flush()
      resume.acked?.(owed)
    },
    close: () => {
      closed = true
      waiting = []
      owed = undefined
    },
  }
}

/** A {@link Sink} that writes frames to a socket, queueing them until it
 * opens. */
export let sink = (
  socket: Socket,
  timer?: (fn: () => void, ms: number) => void,
): Sink => {
  let q = queue(socket, timer, () => socket.readyState == OPEN)
  socket.addEventListener('open', q.flush)
  socket.addEventListener('close', q.close)
  return q.send
}

/**
 * One message from a client, dispatched: `{subscribe, id}` opens a
 * subscription (a query string, or `true` for the raw feed of every committed
 * transaction), `{unsubscribe}` closes one, and `{relay: [...]}` forwards
 * `sync: peers` components to the other subscribers. Anything else is refused
 * under its own id.
 *
 * A relay is the only write that crosses this connection, and it leaves the
 * invariant that matters standing: no durable write crosses it. Nothing in a
 * relay message is stored, and the connection it arrived on is what holds it
 * — which is precisely why it cannot go through `/apply`, a separate request
 * with no connection to name.
 */
export let receive = (
  subs: Subs,
  to: Sink,
  data: unknown,
  now?: () => number,
  input: Incoming = decode(data),
): void | 'close' => {
  let id = ''
  let fail = (err: unknown) => {
    fault(err, 'socket message')
    to({ id, refused: refusal(err) })
  }
  try {
    if ('close' in input) return 'close'
    if ('error' in input) throw input.error
    let msg = input.value
    if (!msg || typeof msg != 'object') {
      throw new SyntaxError('expected {subscribe}, {unsubscribe} or {relay}')
    }
    id = 'id' in msg && msg.id != null ? String(msg.id) : ''
    let subscribe = 'subscribe' in msg ? msg.subscribe : undefined
    if (typeof subscribe == 'string' || subscribe === true) {
      subs.open(to, id, subscribe)
      return
    }
    if ('unsubscribe' in msg && msg.unsubscribe != null) {
      subs.close(to, String(msg.unsubscribe))
      return
    }
    if ('relay' in msg && Array.isArray(msg.relay)) {
      let verdict = gate(subs, to, now)(msg.relay)
      if (verdict == 'close') return 'close'
      if (verdict == 'skip') return
      let out = subs.relay(to, msg.relay)
      if (isPromise(out)) out.catch(fail)
      return
    }
    throw new SyntaxError('expected {subscribe}, {unsubscribe} or {relay}')
  } catch (err) {
    fail(err)
  }
}

/**
 * Connect a socket to a subscription registry: its messages become
 * subscriptions, and closing it drops them all. Returns the sink its frames
 * go to, which is also the key its subscriptions are held under.
 */
export let attach = (
  subs: Subs,
  socket: Socket,
  timer?: (fn: () => void, ms: number) => void,
  now?: () => number,
): Sink => {
  let q = queue(socket, timer, () => socket.readyState == OPEN)
  let to = q.send
  let shut = false
  let drop = () => {
    if (shut) return
    shut = true
    q.close()
    let out = subs.drop(to)
    if (isPromise(out)) out.catch((err) => fault(err, 'socket close'))
  }
  socket.addEventListener('open', q.flush)
  socket.addEventListener('message', (e) => {
    if (shut) return
    let msg: Record<string, unknown> | undefined
    try {
      msg = JSON.parse(String(e.data))
    } catch { /* receive refuses it */ }
    if (typeof msg?.ack == 'string') return q.ack(msg.ack)
    if (
      msg?.acks === true &&
      (typeof msg.subscribe == 'string' || msg.subscribe === true)
    ) q.enable(msg.frames === true)
    if (receive(subs, to, e.data, now) == 'close') {
      drop()
      socket.close?.(1008, 'relay flood')
    }
  })
  socket.addEventListener('close', drop)
  return to
}
