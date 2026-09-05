// The Worker entrypoint. A Worker's module export is an object with a `fetch`,
// and its bindings — a database, a Durable Object namespace, a secret — arrive
// as an argument to that call rather than as an environment a module can read
// at import time. So the graph cannot be built when this file loads: it is
// built from `env` on the first request and kept for the isolate's life.
//
// That cache is why `api` takes only the bindings: an api built per request
// would mint a fresh subscription registry each time, and the sockets already
// open would be talking to a registry nobody applies through any more.

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
  /** the api this Worker fronts — its graph, and the door that names the
   * writer — read off the bindings the request arrived with */
  api: (env: E) => Api | Promise<Api>
}

/**
 * The Worker export for a graph: build the api from the Worker's bindings once
 * per isolate, wire Cloudflare's socket upgrade into it, and answer every
 * request with it.
 *
 * ```ts
 * import { worker } from '@yaks/workers'
 *
 * export default worker({
 *   api: (env) => ({ graph: shopGraph(env.DB), authenticate }),
 * })
 * ```
 *
 * The routes are [@yaks/api](https://jsr.io/@yaks/api)'s: `POST /apply`,
 * `GET|POST /query`, and `/ws`. An `upgrade` the options name is kept; when
 * they do not name one, {@link workerUpgrade} is used. A graph that lives in a
 * Durable Object instead is not this — the Worker {@link forward}s to the
 * object, and the object runs this.
 */
export let worker = <E extends Env = Env>(opts: Options<E>): Worker<E> => {
  let built = new WeakMap<object, Promise<Handler>>()
  let handler = (env: E) => {
    let held = built.get(env)
    if (!held) {
      held = Promise.resolve(opts.api(env))
        .then((o) => api({ upgrade: workerUpgrade, ...o }))
        // A binding that was not there is worth retrying: forget the failure
        // rather than answering 500 for the isolate's whole life.
        .catch((err) => {
          built.delete(env)
          throw err
        })
      built.set(env, held)
    }
    return held
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
