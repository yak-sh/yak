// The one step no web standard covers, in the one file that knows a runtime.
// Everywhere else a socket is just a `WebSocket`; making one out of a request
// is the host's own trick, and Cloudflare's is `WebSocketPair`: a Worker keeps
// one half and hands the other back on a 101 response.
//
// The global is LOOKED UP rather than imported, so this module loads and
// type-checks anywhere — off Workers it throws when called, which is the
// honest answer for a package named after the runtime it needs.

import type { Socket, Upgrade } from '@yaks/api'

/** A Workers socket: the half a Worker keeps has to be accepted before it
 * carries frames. */
export type Accepting = Socket & {
  /** start handling frames on this half of the pair */
  accept: () => void
}

/** `new WebSocketPair()` — an object of two sockets, client first. */
type Pair = new () => Record<string, Accepting>

// This runtime's `WebSocketPair`, or null where there is none.
let found = (): Pair | null => {
  let host: unknown = globalThis
  if (!host || typeof host != 'object' || !('WebSocketPair' in host)) {
    return null
  }
  let make = host.WebSocketPair
  // A constructor read off the global object: nothing types this for us.
  return typeof make == 'function' ? make as Pair : null
}

// The 101 hands the client half back. `webSocket` is Cloudflare's own addition
// to `ResponseInit` — no standard has a word for it, and the half we hold is
// described here only by the little this package uses — so the shape is
// asserted at this one line, and nowhere else.
let handing = (client: unknown): ResponseInit =>
  ({ status: 101, webSocket: client }) as ResponseInit

/**
 * Cloudflare's WebSocket upgrade, as an
 * {@link https://jsr.io/@yaks/api/doc/~/Upgrade | Upgrade}: mint a
 * `WebSocketPair`, accept the server half, and answer 101 with the client
 * half. Pass it to `api()` on a Worker, or let {@link worker} pass it for you.
 *
 * ```ts
 * import { api } from '@yaks/api'
 * import { workerUpgrade } from '@yaks/workers'
 *
 * let handler = api({ graph, upgrade: workerUpgrade })
 * ```
 *
 * It throws off the Workers runtime, where `WebSocketPair` does not exist.
 */
export let workerUpgrade: Upgrade = (_request) => {
  let Pair = found()
  if (!Pair) {
    throw new Error(
      '@yaks/workers: no WebSocketPair here — this needs a Worker',
    )
  }
  let [client, server] = Object.values(new Pair())
  server.accept()
  return { socket: server, response: new Response(null, handing(client)) }
}
