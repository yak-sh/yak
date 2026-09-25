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
import { api, DOORS, type Handler, type Route, routed } from './route.ts'

/** What this facet reads off the host it is composing into: the graph its
 * endpoints answer over, who that host says is calling, and every route the
 * listed plugins contributed. */
export type Hosting = {
  graph: Graph
  who: Authenticate
  routes: Route[]
}

// How closely a route names a path: an exact path over any prefix, and a
// longer prefix over a shorter one.
let exact = (r: Route) => !r.path.endsWith('*')
let reach = (r: Route) => exact(r) ? Infinity : r.path.length

/**
 * The host's one request handler: each plugin's route, and this package's
 * three endpoints.
 *
 * The route that names the path most closely wins, whichever plugin listed it:
 * an exact path over a prefix, a longer prefix over a shorter, and plugin order
 * between equals. `/apply`, `/query` and `/ws` are exact paths, so a plugin's
 * catch-all (`/*`) answers only what nothing else claims. A request no route
 * claimed goes to the doors, which refuse anything they do not serve.
 */
export let handler = (host: Hosting): Handler => {
  let routes = host.routes
  let door = api({ graph: host.graph, authenticate: host.who })
  return (request) => {
    let path = new URL(request.url).pathname
    let route = routes.filter((r) => routed(r, request.method, path))
      .reduce<Route | undefined>(
        (best, r) => best && reach(best) >= reach(r) ? best : r,
        undefined,
      )
    return route && (exact(route) || !DOORS.includes(path))
      ? route.handle(request)
      : door(request)
  }
}
