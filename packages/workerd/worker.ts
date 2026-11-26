// The Worker entrypoint. A Worker's module export is an object with a `fetch`,
// and its bindings — a database, a Durable Object namespace, a secret — arrive
// as an argument to that call rather than as an environment a module can read
// at import time. So the graph cannot be built when this file loads: it is
// built from `env` on the first request and kept for the isolate's life.
//
// That cache is why `api` is given only the bindings: building the api per
// request would create a fresh subscription registry each time, and the sockets
// already open would be listening to a registry nothing writes through any
// more.

import { api, type Handler, type Options as Api, refuse } from '@yaks/api'
import { workerUpgrade } from './upgrade.ts'

/** A Worker's bindings, as this package reads them: whatever `wrangler.toml`
 * declared, under the names it gave them. */
export type Env = Record<string, unknown>

/** The Workers execution context — the third argument to `fetch`, kept opaque
 * because this package only passes it along. */
export type Context = {
  /** keep the Worker alive until a promise settles */
  waitUntil: (promise: Promise<unknown>) => void
}

/** A Cloudflare Worker's default export: its `fetch` entrypoint. */
export type Worker<E extends Env = Env> = {
  /** answer one request, given this Worker's bindings */
  fetch: (request: Request, env: E, ctx?: Context) => Promise<Response>
}

/** How a Worker is built: what the api is, for a given set of bindings. */
export type Options<E extends Env = Env> = {
  /** the api this Worker serves — its graph, and the authentication callback
   * that identifies the caller — built from the bindings the request arrived
   * with */
  api: (env: E) => Api | Promise<Api>
}

/**
 * The Worker export for a graph: build the api from the Worker's bindings once
 * per isolate, connect Cloudflare's socket upgrade to it, and serve every
 * request from it.
 *
 * ```ts
 * import type { Authenticate } from '@yaks/api'
 * import type { Graph } from '@yaks/graph'
 * import { worker } from '@yaks/workerd'
 *
 * declare let shopGraph: (db: unknown) => Graph
 * declare let authenticate: Authenticate
 *
 * export default worker({
 *   api: (env) => ({ graph: shopGraph(env.DB), authenticate }),
 * })
 * ```
 *
 * The routes are [@yaks/api](https://jsr.io/@yaks/api)'s: `POST /apply`,
 * `GET|POST /query`, and `/ws`. An `upgrade` given in the options is used as
 * is; when none is given, {@link workerUpgrade} is used. A graph that lives in
 * a Durable Object is served differently — the Worker {@link forward}s to the
 * object, and the object is what calls this.
 */
export let worker = <E extends Env = Env>(opts: Options<E>): Worker<E> => {
  // Kept as a value per env once built, never as the build's promise, which
  // settles only in the request that made it (@yaks/fp `Scope`). A build
  // that failed keeps nothing: a binding that was not there is worth trying
  // again rather than answering 500 for the isolate's whole life.
  let built = new WeakMap<object, Handler>()
  let handler = async (env: E) => {
    let held = built.get(env)
    if (held) return held
    let made = api({ upgrade: workerUpgrade, ...await opts.api(env) })
    if (!built.has(env)) built.set(env, made)
    return built.get(env)!
  }

  return {
    fetch: async (request, env) => {
      try {
        return await (await handler(env))(request)
      } catch (err) {
        return refuse(err)
      }
    },
  }
}
