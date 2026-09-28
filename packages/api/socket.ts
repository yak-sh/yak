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
import { coalesced, isPromise } from '@yaks/graph'
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
    sent?: (frame: Frame, token: string) => void
    acked?: (owed?: string) => void
  } = {},
): {
  send: Sink
  flush: () => void
  close: () => void
  enable: () => void
  ack: (token: string) => void
} => {
  let waiting: Frame[] = []
  let draining = false
  let closed = false
  let enabled = false
  let owed = resume.owed
  let schedule = () => {
    if (draining || closed) return
    draining = true
    timer(() => {
      draining = false
      flush()
    }, 16)
  }
  let flush = () => {
    if (!ready() || closed || owed) return
    while (waiting.length && (socket.bufferedAmount ?? 0) < BUFFER) {
      let frame = waiting.shift()!
      if (enabled) {
        let token = crypto.randomUUID()
        socket.send(JSON.stringify({ ...frame, ack: token }))
        owed = token
        resume.sent?.(frame, token)
        break
      }
      socket.send(JSON.stringify(frame))
    }
    if (waiting.length && !owed) schedule()
  }
  let send: Sink = (frame) => {
    if (closed) return
    // A relay is a patch. Only merge it with another relay of this
    // subscription before the next membership or durable-data frame.
    if (
      frame.relay && Object.keys(frame).every((k) => k == 'id' || k == 'relay')
    ) {
      for (let i = waiting.length - 1; i >= 0; i--) {
        let was = waiting[i]
        if (
          !was.relay || Object.keys(was).some((k) => k != 'id' && k != 'relay')
        ) break
        if (was.id == frame.id) {
          was.relay = coalesced([...was.relay, ...frame.relay])
          flush()
          return
        }
      }
    }
    waiting.push(frame)
    flush()
  }
  return {
    send,
    flush,
    enable: () => {
      enabled = true
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
export let receive = (subs: Subs, to: Sink, data: unknown): void => {
  let id = ''
  let fail = (err: unknown) => {
    fault(err, 'socket message')
    to({ id, refused: refusal(err) })
  }
  try {
    let msg = JSON.parse(String(data))
    id = msg?.id == null ? '' : String(msg.id)
    if (typeof msg?.subscribe == 'string' || msg?.subscribe === true) {
      subs.open(to, id, msg.subscribe)
      return
    }
    if (msg?.unsubscribe != null) {
      subs.close(to, String(msg.unsubscribe))
      return
    }
    if (Array.isArray(msg?.relay)) {
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
export let attach = (subs: Subs, socket: Socket): Sink => {
  let q = queue(socket, undefined, () => socket.readyState == OPEN)
  let to = q.send
  socket.addEventListener('open', q.flush)
  socket.addEventListener('message', (e) => {
    let msg: Record<string, unknown> | undefined
    try {
      msg = JSON.parse(String(e.data))
    } catch { /* receive refuses it */ }
    if (typeof msg?.ack == 'string') return q.ack(msg.ack)
    if (
      msg?.acks === true &&
      (typeof msg.subscribe == 'string' || msg.subscribe === true)
    ) q.enable()
    receive(subs, to, e.data)
  })
  socket.addEventListener('close', () => {
    q.close()
    let out = subs.drop(to)
    if (isPromise(out)) out.catch((err) => fault(err, 'socket close'))
  })
  return to
}
