// The socket half: a WebSocket wired to the subscription registry, and
// nothing else. Two verbs go up, one frame shape comes down (see the README's
// Protocol), and no write ever crosses this seam — a batch is applied with
// `POST /apply`, and the socket is how you hear about it.
//
// Frames sent before the socket opens are held: a host's upgrade hands back a
// socket that is still CONNECTING until its response is returned to the
// runtime, and a subscription opened on that first tick would otherwise throw
// on its own opening set.

import { refusal } from './refuse.ts'
import type { Frame, Sink, Subs } from './subs.ts'

/** The part of a WebSocket this package uses: the standard `WebSocket`
 * satisfies it, and so does a Cloudflare Worker's server-side half. */
export type Socket = {
  /** `0` connecting, `1` open — frames sent before it opens are held */
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
 * How the host turns a request into a WebSocket. This is the one thing about
 * serving that no standard covers, so it is injected: Deno's default is
 * {@link https://jsr.io/@yaks/api/doc/~/denoUpgrade | denoUpgrade}, and a
 * Cloudflare Worker's is a `WebSocketPair` (see the README).
 */
export type Upgrade = (
  request: Request,
) => { socket: Socket; response: Response }

let OPEN = 1

/** A {@link Sink} that writes frames to a socket, holding them until it
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

/** One frame from a client, dispatched: `{subscribe, id}` opens a subscription
 * (a query line, or `true` for the raw feed of committed batches) and
 * `{unsubscribe}` closes one. Anything else is refused under its own id. */
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
    throw new SyntaxError('expected {subscribe} or {unsubscribe}')
  } catch (err) {
    to({ id, refused: refusal(err) })
  }
}

/**
 * Wire a socket to a registry: its messages become subscriptions, its close
 * drops them all. Returns the sink its frames go to, which is also the key its
 * subscriptions are held under.
 */
export let attach = (subs: Subs, socket: Socket): Sink => {
  let to = sink(socket)
  socket.addEventListener('message', (e) => receive(subs, to, e.data))
  socket.addEventListener('close', () => subs.drop(to))
  return to
}
