// A browser's WebSocket to yaks.app: it can set no header, so it speaks a
// subprotocol of the platform's and carries its bearer token in another
// beside it (identity.ts `asking` reads it). Said apart from the identity
// door so an object accepting a socket answers the subprotocol without
// loading the door.

import { bearerOf, PROTOCOL } from '@yaks/extension/wire'

export { PROTOCOL }

/** Whether a request asks to become a WebSocket. */
export let upgrading = (req: Request): boolean =>
  (req.headers.get('upgrade') ?? '').toLowerCase() == 'websocket'

// The subprotocols an upgrade offers, as `Sec-WebSocket-Protocol` lists them.
let offered = (req: Request): string =>
  upgrading(req) ? req.headers.get('sec-websocket-protocol') ?? '' : ''

/** Whether a WebSocket upgrade speaks {@link PROTOCOL}, so its 101 names it. */
export let protocolled = (req: Request): boolean =>
  offered(req).split(',').some((p) => p.trim() == PROTOCOL)

/// carried(new Request('https://yaks.app/', { headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'yaks, bearer.YTpiOmM' } })) -> 'a:b:c'
/** The token an upgrade carries in its subprotocol beside {@link PROTOCOL}
 * (@yaks/extension `bearerOf`): '' for one that does not decode, nothing
 * where none is offered. */
export let carried = (req: Request): string | undefined => {
  let said = offered(req)
  return /(^|,)\s*bearer\./.test(said) ? bearerOf(said) ?? '' : undefined
}
