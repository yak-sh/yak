// The route table. Three paths, one `try`, and the two callbacks the
// application supplies.
//
// Attribution is decided here. `authenticate` runs on every request — a read,
// a write and a WebSocket upgrade alike — and what it returns is what signs
// the write; whatever `$actor` a client sent is discarded before the graph
// sees it. `upgrade` is the only step no web standard covers, so a runtime
// other than Deno supplies its own.

import type { Graph } from '@yaks/graph'
import { type Authenticate } from './actor.ts'
import { ask, write } from './doors.ts'
import { denoUpgrade } from './deno.ts'
import { json, refuse } from './refuse.ts'
import { attach, type Upgrade } from './socket.ts'
import { type Subs, subscriptions } from './subs.ts'

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
}

/** A check every request passes before any route or door answers it: a
 * plugin's own word on which requests it lets in. It refuses one by throwing
 * (a `Denied`, say, which answers 403), and anything it does not throw at goes
 * on. */
export type Filter = (request: Request) => void | Promise<void>

/** Whether a route matches this request's method and path. */
export let routed = (route: Route, method: string, path: string): boolean =>
  (route.method == '*' || route.method == method) &&
  (route.path.endsWith('*')
    ? path.startsWith(route.path.slice(0, -1))
    : route.path == path)

/** How a handler is built: the graph it serves, and the callbacks the
 * application supplies. */
export type Options = {
  /** the graph this API reads and writes */
  graph: Graph
  /** who is writing (default: nobody — writes are stored unattributed) */
  authenticate?: Authenticate
  /** the runtime's WebSocket upgrade (default: Deno's) */
  upgrade?: Upgrade
  /** the subscription registry (default: a fresh one over `graph`) */
  subs?: Subs
}

let nobody: Authenticate = () => null

/** The paths {@link api} answers itself. */
export let DOORS: string[] = ['/apply', '/query', '/ws']

/**
 * Build the request handler for a graph: `POST /apply`, `GET|POST /query`, and
 * `/ws` for live subscriptions. Everything else is a 404, and every thrown
 * error becomes the refusal body it describes (see the README's Refusals).
 *
 * ```ts ignore
 * Deno.serve(api({ graph, authenticate }))
 * ```
 */
export let api = (opts: Options): Handler => {
  let { graph } = opts
  let subs = opts.subs ?? subscriptions(graph)
  let authenticate = opts.authenticate ?? nobody
  let upgrade = opts.upgrade ?? denoUpgrade
  let no = (message: string, code: number) =>
    json({ error: code == 404 ? 'NotFound' : 'NotAllowed', message }, code)

  return async (request) => {
    let path = new URL(request.url).pathname
    try {
      let who = await authenticate(request)
      if (path == '/apply') {
        return request.method == 'POST'
          ? await write(graph, request, who)
          : no('/apply takes POST', 405)
      }
      if (path == '/query') {
        return request.method == 'GET' || request.method == 'POST'
          ? await ask(graph, request)
          : no('/query takes GET or POST', 405)
      }
      if (path == '/ws') {
        if (
          (request.headers.get('upgrade') ?? '').toLowerCase() != 'websocket'
        ) {
          return no('/ws is a WebSocket endpoint', 405)
        }
        let { socket, response } = upgrade(request)
        attach(subs, socket)
        return response
      }
      return no(`no route for ${path}`, 404)
    } catch (err) {
      return refuse(err, request)
    }
  }
}
