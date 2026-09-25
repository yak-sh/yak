/**
 * @yaks/api — an HTTP and WebSocket interface to a yaks graph, as a plain
 * request handler that runs in any JavaScript runtime.
 *
 * Given a {@link https://jsr.io/@yaks/graph | @yaks/graph} `Graph`, this
 * package serves the three endpoints a client needs and nothing more:
 *
 * - **`POST /apply`** — the request body is a JSON array of bundles, applied
 *   in one transaction; the response body is that array as applied.
 *   `?check=1` runs every phase and then rolls the transaction back, so a
 *   caller spreading one array over several graphs can ask each of them
 *   before any of them keeps it. `content-type: application/x-ndjson` is the
 *   same endpoint with one bundle per line, for an import too big to parse or
 *   commit whole ({@link pour}).
 * - **`GET /query?q=…`** (or `POST /query`) — a query string in, the bundles
 *   it selects out.
 * - **`/ws`** — subscriptions: a saved query whose result is pushed again
 *   whenever a committed transaction changes it.
 *
 * ```ts
 * import { api } from '@yaks/api'
 * // Deno.serve(api({ graph, authenticate }))
 * ```
 *
 * ## Attribution is decided here, not by the client
 * A client can put anything in the JSON it posts, including whose name is on
 * it. So every array that arrives has its `$actor` component replaced by the
 * identity {@link Authenticate} returned for that request. `authenticate`
 * runs on every request, and throwing {@link Unauthorized} from it answers
 * that request with a 401.
 *
 * ## Two callbacks the application supplies
 * {@link Authenticate} names the writer. {@link Upgrade} turns a request into
 * a WebSocket — the one step no web standard covers — and defaults to
 * {@link denoUpgrade}; on Cloudflare Workers you pass one built on
 * `WebSocketPair` (see the README). Everything else here is standard
 * `Request`, `Response` and `WebSocket`, so the same handler serves on Deno,
 * Node and a Worker.
 *
 * ## The WebSocket protocol
 * ```text
 * → { subscribe: "<query>" | true, id: "<id>" }   open (true = every commit)
 * → { unsubscribe: "<id>" }                       close
 * → { relay: Bundle[] }                           forward `sync: peers` values
 * ← { id, bundles: Bundle[], gone?: Eid[] }        the set, then every change
 * ← { id, relay: Bundle[] }                        peer values from a client
 * ← { id, refused: { error, message, … } }         the subscription was refused
 * ```
 * No durable write crosses the socket: changes are applied with
 * `POST /apply`, and the socket is how every connected client learns about
 * them. A relayed value is the one exception: it is forwarded to the other
 * subscribers and never stored.
 *
 * @module
 */

export {
  api,
  type Filter,
  type Handler,
  type Options,
  type Route,
  routed,
} from './route.ts'
export { type Authenticate, signed } from './actor.ts'
export { ask, CHUNK, pour, poured, write } from './doors.ts'
export {
  fault,
  json,
  type Refusal,
  refusal,
  refuse,
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
export { timed } from './timing.ts'
export {
  type Addr,
  denoListen,
  denoUpgrade,
  type Listen,
  type Listener,
} from './deno.ts'
