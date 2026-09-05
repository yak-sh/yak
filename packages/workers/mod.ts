/**
 * @yaks/workers — the Cloudflare Workers adapter that serves
 * {@link https://jsr.io/@yaks/api | @yaks/api} from a Worker.
 *
 * `@yaks/api` is a plain `Request` → `Response` handler that knows nothing
 * about any host. Three things are Cloudflare's own, and they are all this
 * package is:
 *
 * - **{@link workerUpgrade}** — a socket, made the way Cloudflare makes one:
 *   a `WebSocketPair`, the server half accepted, the client half returned on a
 *   101. It is the `upgrade` seam `/ws` needs.
 * - **{@link worker}** — the `fetch` entrypoint a Worker exports. Bindings
 *   arrive with the request, so the graph is built from `env` on the first one
 *   and kept for the isolate.
 * - **{@link door}** — who is writing, read off a Worker request: a session
 *   cookie or a bearer token, handed to the app's own `verify`.
 *
 * A graph that lives in a Durable Object is served the same way, one hop
 * further on: the Worker {@link forward}s the request to the object, and the
 * object runs `api()` over its own storage.
 *
 * ```ts
 * import { door, worker } from '@yaks/workers'
 *
 * export default worker({
 *   api: (env: { DB: unknown }) => ({
 *     graph: shopGraph(env.DB),
 *     authenticate: door({ cookie: 'shop_session', verify: memberFor }),
 *   }),
 * })
 * ```
 *
 * @module
 */

export { type Accepting, workerUpgrade } from './upgrade.ts'
export { bearer, cookies, type Door, door } from './door.ts'
export {
  type Context,
  type Env,
  type Options,
  type Worker,
  worker,
} from './worker.ts'
export { forward, type Namespace, type Stub } from './stub.ts'
