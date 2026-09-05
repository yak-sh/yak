// The route table. Three paths, one `try`, and the two seams a host fills in.
//
// The door is where trust lives. `authenticate` runs on EVERY request — a
// read, a write and a socket upgrade alike — and its answer is what signs the
// batch; whatever `$actor` a client sent is discarded before the graph sees
// it. `upgrade` is the only step no standard covers, so a host that is not
// Deno passes its own.

import type { Graph } from '@yaks/graph'
import { type Authenticate } from './actor.ts'
import { ask, write } from './doors.ts'
import { denoUpgrade } from './deno.ts'
import { json, refuse } from './refuse.ts'
import { attach, type Upgrade } from './socket.ts'
import { type Subs, subscriptions } from './subs.ts'

/** A web-standard request handler: a `Request` in, a `Response` out. */
export type Handler = (request: Request) => Response | Promise<Response>

/** How a handler is built: the graph it fronts, and the seams a host fills. */
export type Options = {
  /** the graph this API reads and writes */
  graph: Graph
  /** who is writing (default: nobody — batches land unattributed) */
  authenticate?: Authenticate
  /** the host's WebSocket upgrade (default: Deno's) */
  upgrade?: Upgrade
  /** the subscription registry (default: a fresh one over `graph`) */
  subs?: Subs
}

let nobody: Authenticate = () => null

/**
 * Build the request handler for a graph: `POST /apply`, `GET|POST /query`, and
 * `/ws` for live subscriptions. Everything else is a 404, and every thrown
 * error becomes the refusal body it describes (see the README's Refusals).
 *
 * ```ts
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
      return refuse(err)
    }
  }
}
