/**
 * @yaks/workerd — the Cloudflare Workers adapter: a Worker made from a plugin
 * config ({@link compose}), and {@link https://jsr.io/@yaks/api | @yaks/api}
 * served from a Worker.
 *
 * `compose(config, facets)` makes a Worker module from the plugins a config
 * names, each through its `./worker` facet: the routes it answers, the
 * letters and queue batches it handles, the Durable Object and entrypoint
 * classes it defines, loaded on their first call, and the boundary every
 * invocation enters.
 *
 * `@yaks/api` is a plain `Request` → `Response` handler that knows nothing
 * about the runtime it is served from. Three things are specific to Cloudflare,
 * and they are all this package contains:
 *
 * - **{@link workerUpgrade}** — a socket, created the way Cloudflare creates
 *   one: a `WebSocketPair`, the server half accepted, the client half returned
 *   on a 101. It is the implementation of the `upgrade` callback `/ws` needs.
 * - **{@link worker}** — the `fetch` entrypoint a Worker exports. Bindings
 *   arrive with the request, so the graph is built from `env` on the first
 *   request and cached for the isolate.
 * - **{@link door}** — the identity of the caller, read off a Worker request:
 *   a session cookie or a bearer token, passed to the application's own
 *   `verify` function.
 *
 * A graph that lives in a Durable Object is served the same way, one hop
 * further on: the Worker {@link forward}s the request to the object, and the
 * object runs `api()` over its own storage.
 *
 * ```ts
 * import type { Graph } from '@yaks/graph'
 * import { door, worker } from '@yaks/workerd'
 *
 * declare let shopGraph: (db: unknown) => Graph
 * declare let memberFor: (token: string) => { by: string } | null
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
export {
  compose,
  type Composed,
  type Deferred,
  type Entry,
  type Handling,
  type WorkerFacet,
  type WorkerRoute,
  type Wrap,
} from './compose.ts'
export { type Around, deferred, type Made } from './deferred.ts'
export { VERSION } from './version.ts'
