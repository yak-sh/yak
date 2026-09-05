/**
 * @yaks/api — the transport in front of a yaks graph, as a plain request
 * handler that runs in any JavaScript environment.
 *
 * Given a {@link https://jsr.io/@yaks/graph | @yaks/graph} `Graph`, this
 * package answers the three routes a client needs and nothing more:
 *
 * - **`POST /apply`** — a batch of bundles in, the batch as applied out;
 *   `?check=1` rehearses it instead, rolling back at the commit so a caller
 *   spreading one batch over several graphs can ask before any of them keeps
 *   it;
 * - **`GET /query?q=…`** (or `POST /query`) — a query line in, bundles out;
 * - **`/ws`** — subscriptions: a saved query whose answer is pushed again
 *   whenever a committed batch changes it.
 *
 * ```ts
 * import { api } from '@yaks/api'
 * // Deno.serve(api({ graph, authenticate }))
 * ```
 *
 * ## The door is where trust lives
 * A bundle can say anything, including whose name is on it. So every batch
 * that arrives has its `$actor` component replaced by the identity
 * {@link Authenticate} returned for that request — never the client's word.
 * `authenticate` runs on every request, and throwing {@link Unauthorized} from
 * it refuses one with a 401.
 *
 * ## Two injected seams
 * {@link Authenticate} names the writer. {@link Upgrade} turns a request into
 * a WebSocket — the one step no web standard covers — and defaults to
 * {@link denoUpgrade}; a Cloudflare Worker passes a `WebSocketPair` (see the
 * README). Everything else here is standard `Request`, `Response` and
 * `WebSocket`, so the same handler serves on Deno, Node and a Worker.
 *
 * ## The socket protocol, whole
 * ```text
 * → { subscribe: "<query>" | true, id: "<id>" }   open (true = every batch)
 * → { unsubscribe: "<id>" }                       close
 * ← { id, bundles: Bundle[], gone?: Eid[] }        the set, then every change
 * ← { id, refused: { error, message, … } }         the subscription was refused
 * ```
 * No write crosses the socket: a batch is applied with `POST /apply`, and the
 * socket is how everyone hears about it.
 *
 * @module
 */

export { api, type Handler, type Options } from './route.ts'
export { type Authenticate, signed } from './actor.ts'
export { ask, write } from './doors.ts'
export {
  json,
  type Refusal,
  refusal,
  refuse,
  STATUS,
  status,
  Unauthorized,
} from './refuse.ts'
export {
  type Ask,
  type Frame,
  type Sink,
  type Subs,
  subscriptions,
} from './subs.ts'
export { attach, receive, sink, type Socket, type Upgrade } from './socket.ts'
export { denoUpgrade } from './deno.ts'
