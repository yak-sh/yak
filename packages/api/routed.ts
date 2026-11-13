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
