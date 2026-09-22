// The routes facet, exported as `@yaks/api/routes`: this package is what
// makes a host answer HTTP at all.
//
// A host does not serve requests because it was composed. It serves them
// because its config names this package among its plugins, and this is the one
// module that turns routes into a handler: every listed plugin's own routes
// (`host.routes`), with `/apply`, `/query` and `/ws` behind them. A config
// that does not name this package composes a host with no handler, no `serve`
// verb, and no reason to ask the other plugins for routes nobody would answer.
//
// It is handed the host once the graph is open and the routes are gathered,
// unlike `authenticate` beside it, which is asked for before anything is open.

import type { Graph } from '@yaks/graph'
import type { Authenticate } from './actor.ts'
import { api, type Handler, type Route, routed } from './route.ts'

/** What this facet reads off the host it is composing into: the graph its
 * endpoints answer over, who that host says is calling, and every route the
 * listed plugins contributed. */
export type Hosting = {
  graph: Graph
  who: Authenticate
  routes: Route[]
}

/**
 * The host's one request handler: each plugin's route, and this package's
 * three endpoints behind them.
 *
 * A plugin's route is matched first, so a host answers a path of its own ahead
 * of the doors; a request no route claimed goes to `/apply`, `/query` and
 * `/ws`, which refuse anything they do not serve.
 */
export let handler = (host: Hosting): Handler => {
  let routes = host.routes
  let door = api({ graph: host.graph, authenticate: host.who })
  return (request) => {
    let path = new URL(request.url).pathname
    let route = routes.find((r) => routed(r, request.method, path))
    return route ? route.handle(request) : door(request)
  }
}
