// The one step no web standard covers, in the one file that depends on a
// specific runtime. Everywhere else a socket is just a `WebSocket`; creating
// one from a request is runtime-specific, and Cloudflare's way is
// `WebSocketPair`: a Worker keeps one half and returns the other on a 101
// response.
//
// The global is looked up rather than imported, so this module loads and
// type-checks anywhere — outside Workers it throws when called, which is the
// right behaviour for a package named after the runtime it requires.

import type { Socket, Upgrade } from '@yaks/api'

/** A Workers socket: the half a Worker keeps has to be accepted before it
 * carries frames. */
export type Accepting = Socket & {
  /** start handling frames on this half of the pair */
  accept: () => void
}

/** `new WebSocketPair()` — an object holding two sockets, client first. */
type Pair = new () => Record<string, Accepting>

// This runtime's `WebSocketPair`, or null if it has none.
let found = (): Pair | null => {
  let host: unknown = globalThis
  if (!host || typeof host != 'object' || !('WebSocketPair' in host)) {
    return null
  }
  let make = host.WebSocketPair
  // A constructor read off the global object: nothing types this for us.
  return typeof make == 'function' ? make as Pair : null
}

// The 101 returns the client half. `webSocket` is Cloudflare's own addition to
// `ResponseInit` — no standard declares it, and the half this package keeps is
// typed here only by the few members it uses — so the type is asserted on this
// one line, and nowhere else.
let handing = (client: unknown): ResponseInit =>
  ({ status: 101, webSocket: client }) as ResponseInit

/**
 * Cloudflare's WebSocket upgrade, as an
 * {@link https://jsr.io/@yaks/api/doc/~/Upgrade | Upgrade}: create a
 * `WebSocketPair`, accept the server half, and answer 101 with the client
 * half. Pass it to `api()` on a Worker, or let {@link worker} pass it for you.
 *
 * ```ts
 * import { api } from '@yaks/api'
 * import { workerUpgrade } from '@yaks/workerd'
 *
 * let handler = api({ graph, upgrade: workerUpgrade })
 * ```
 *
 * It throws outside the Workers runtime, where `WebSocketPair` does not exist.
 */
export let workerUpgrade: Upgrade = (_request) => {
  let Pair = found()
  if (!Pair) {
    throw new Error(
      '@yaks/workerd: no WebSocketPair here — this needs a Worker',
    )
  }
  let [client, server] = Object.values(new Pair())
  server.accept()
  return { socket: server, response: new Response(null, handing(client)) }
}
