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
import type { Frame, Sink, Subs } from './subs.ts'

/** The part of a WebSocket this package uses: the standard `WebSocket`
 * satisfies it, and so does a Cloudflare Worker's server-side half. */
export type Socket = {
  /** `0` connecting, `1` open — frames sent before it opens are queued */
  readyState: number
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

/** A {@link Sink} that writes frames to a socket, queueing them until it
 * opens. */
export let sink = (socket: Socket): Sink => {
  let waiting: Frame[] = []
  let flush = () => {
    let held = waiting
    waiting = []
    for (let f of held) socket.send(JSON.stringify(f))
  }
  socket.addEventListener('open', flush)
  return (frame) => {
    waiting.push(frame)
    if (socket.readyState == OPEN) flush()
  }
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
      subs.relay(to, msg.relay)
      return
    }
    throw new SyntaxError('expected {subscribe}, {unsubscribe} or {relay}')
  } catch (err) {
    fault(err, 'socket message')
    to({ id, refused: refusal(err) })
  }
}

/**
 * Connect a socket to a subscription registry: its messages become
 * subscriptions, and closing it drops them all. Returns the sink its frames
 * go to, which is also the key its subscriptions are held under.
 */
export let attach = (subs: Subs, socket: Socket): Sink => {
  let to = sink(socket)
  socket.addEventListener('message', (e) => receive(subs, to, e.data))
  socket.addEventListener('close', () => subs.drop(to))
  return to
}
