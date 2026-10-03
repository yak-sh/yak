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
import { isPromise } from '@yaks/fp'
import { type Bundle, coalescer, type ReadOpts } from '@yaks/graph'
import { admission } from './admission.ts'
import type { Frame, Sink, Subs } from './subs.ts'
import type { PeerWriter } from './save.ts'

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
  | { error: unknown; id?: string }
  | { value: unknown }

// A refusal must name the request even when its query is too large to parse.
// Scan without copying the payload, and decode only bounded top-level ids.
// The same scan can identify an id before a syntax error; nested ids and text
// inside a query are never mistaken for the request's identity.
let requestId = (raw: string): string | undefined => {
  let depth = 0
  for (let i = 0; i < raw.length; i++) {
    let c = raw[i]
    if (c == '{' || c == '[') depth++
    else if (c == '}' || c == ']') depth--
    else if (c == '"') {
      let start = i
      while (++i < raw.length) {
        if (raw[i] == '\\') i++
        else if (raw[i] == '"') break
      }
      if (depth != 1 || i - start > 32) continue
      let next = i + 1
      while (/\s/.test(raw[next] ?? '') && next < raw.length) next++
      if (raw[next++] != ':') continue
      try {
        if (JSON.parse(raw.slice(start, i + 1)) != 'id') continue
        while (/\s/.test(raw[next] ?? '') && next < raw.length) next++
        if (raw[next] != '"') continue
        let end = next
        while (++end < raw.length && end - next <= 1024) {
          if (raw[end] == '\\') end++
          else if (raw[end] == '"') {
            return JSON.parse(raw.slice(next, end + 1))
          }
        }
      } catch { /* no recoverable request id */ }
    }
  }
}

export let decode = (data: unknown): Incoming => {
  let raw = typeof data == 'string' ? data : undefined
  let large = raw !== undefined
    ? raw.length > MAX_MESSAGE ||
      new TextEncoder().encode(raw).byteLength > MAX_MESSAGE
    : data instanceof ArrayBuffer
    ? data.byteLength > MAX_MESSAGE
    : data instanceof Blob && data.size > MAX_MESSAGE
  if (large) {
    let error = new Error(`socket message exceeds ${MAX_MESSAGE} bytes`)
    error.name = 'Refused'
    return { error, id: raw === undefined ? undefined : requestId(raw) }
  }
  try {
    if (raw === undefined) {
      throw new SyntaxError('expected a text socket message')
    }
    return { value: JSON.parse(raw) }
  } catch (error) {
    return { error, id: raw === undefined ? undefined : requestId(raw) }
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
 * connection it arrived on is what holds it. A component declaring `save`
 * also stores periodic snapshots through the graph as this connection's writer
 * — which is precisely why it cannot go through `/apply`, a separate request
 * with no connection to name.
 */
export let receive = (
  subs: Subs,
  to: Sink,
  data: unknown,
  now?: () => number,
  input: Incoming = decode(data),
  opts?: ReadOpts,
  writer?: PeerWriter,
): void | 'close' => {
  let id = ''
  let fail = (err: unknown) => {
    fault(err, 'socket message')
    to({ id, refused: refusal(err) })
  }
  try {
    if ('error' in input) {
      id = input.id ?? ''
      throw input.error
    }
    let msg = input.value
    if (!msg || typeof msg != 'object') {
      throw new SyntaxError('expected {subscribe}, {unsubscribe} or {relay}')
    }
    id = 'id' in msg && msg.id != null ? String(msg.id) : ''
    let subscribe = 'subscribe' in msg ? msg.subscribe : undefined
    if (typeof subscribe == 'string' || subscribe === true) {
      subs.open(to, id, subscribe, opts)
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
      let out = (subs.enqueue ?? subs.relay)(to, msg.relay, writer)
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
  opts?: ReadOpts,
  writer?: PeerWriter,
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
    let input = decode(e.data)
    let msg = 'value' in input && input.value && typeof input.value == 'object'
      ? input.value as Record<string, unknown>
      : undefined
    if (typeof msg?.ack == 'string') return q.ack(msg.ack)
    if (
      msg?.acks === true &&
      (typeof msg.subscribe == 'string' || msg.subscribe === true)
    ) q.enable(msg.frames === true)
    if (receive(subs, to, e.data, now, input, opts, writer) == 'close') {
      drop()
      socket.close?.(1008, 'relay flood')
    }
  })
  socket.addEventListener('close', drop)
  return to
}
