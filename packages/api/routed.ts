// One route, and whether a request takes it: no graph, no socket and no
// subscription, so a router that only matches paths (@yaks/workerd's) loads
// nothing else of this package. Exported as `@yaks/api/routed`.

/** A web-standard request handler: a `Request` in, a `Response` out. */
export type Handler = (request: Request) => Response | Promise<Response>

/** One path served alongside this package's three endpoints — a plugin's
 * route. `path` is matched exactly, or ends in `*` to match a prefix, which
 * is what content-addressed bytes (`/blob/<sha>`) need; `method` is the HTTP
 * method, or `*` for any. Whoever mounts the routes decides which one wins a
 * conflict: this package serves `/apply`, `/query` and `/ws` and claims
 * nothing else. */
export type Route = {
  method: string
  path: string
  /** record the route pattern instead of a path carrying credentials */
  sensitive?: boolean
  handle: Handler
  /** What a person reaching this path finds, said beside its address when a
   * server starts listening: the few doors somebody starting one opens. */
  says?: string
}

/** Whether a route matches this request's method and path. A GET route
 * matches a HEAD too, which is a GET answered without its body (RFC 9110
 * §9.3.2): how a page asks a bundle's etag without fetching it. */
export let routed = (route: Route, method: string, path: string): boolean =>
  (route.method == '*' || route.method == method ||
    route.method == 'GET' && method == 'HEAD') &&
  (route.path.endsWith('*')
    ? path.startsWith(route.path.slice(0, -1))
    : route.path == path)

/** The path a request names to doors that answer under `under` as well as at
 * the root: its own path with `under` taken off its front where it starts
 * there, so `/api/query` is `/query` to doors under `/api`, as a page's
 * `./api/` finds them.
 *
 * ```ts
 * import { pathOf } from '@yaks/api/routed'
 * import { equal } from '@yaks/testing'
 * let at = (path: string) => new Request(`http://box${path}`)
 * equal(pathOf(at('/api/query'), '/api'), '/query')
 * equal(pathOf(at('/query'), '/api'), '/query')
 * equal(pathOf(at('/apiary'), '/api'), '/apiary')
 * equal(pathOf(at('/api/query')), '/api/query')
 * ```
 */
export let pathOf = (request: Request, under?: string): string => {
  let path = new URL(request.url).pathname
  return under && path.startsWith(`${under}/`) ? path.slice(under.length) : path
}
