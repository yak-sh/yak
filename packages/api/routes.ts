// The routes facet, exported as `@yaks/api/routes`: this package is what
// makes a host answer HTTP at all.
//
// A host does not serve requests because it was composed. It serves them
// because its config names this package among its plugins, and this is the one
// module that turns routes into a handler: every listed plugin's own routes
// (`host.routes`), with `/apply`, `/query` and `/ws` behind them, and every
// plugin's filter (`host.filters`) in front of all of it. A config
// that does not name this package composes a host with no handler, no `serve`
// verb, and no reason to ask the other plugins for routes nobody would answer.
//
// It is handed the host once the graph is open and the routes are gathered,
// unlike `authenticate` beside it, which is asked for before anything is open.

import type { Bundle, Graph } from '@yaks/graph'
import type { Authenticate } from './actor.ts'
import {
  api,
  DOORS,
  type Filter,
  type Handler,
  type Route,
  routed,
} from './route.ts'
import { refuse } from './refuse.ts'
import { subscriptions } from './subs.ts'

/** What this facet reads off the host it is composing into: the graph its
 * endpoints answer over, who that host says is calling, every route the
 * listed plugins contributed, every filter they put in front, and the commits
 * other hosts make to the same store, which `/ws` subscribers are told of as
 * well as this graph's own. */
export type Hosting = {
  graph: Graph
  who: Authenticate
  routes: Route[]
  filters?: Filter[]
  feed?: (each: (applied: Bundle[]) => void | Promise<void>) => () => void
}

// How closely a route names a path: an exact path over any prefix, and a
// longer prefix over a shorter one.
let exact = (r: Route) => !r.path.endsWith('*')
let reach = (r: Route) => exact(r) ? Infinity : r.path.length

/**
 * The host's one request handler: each plugin's route, and this package's
 * three endpoints, behind every plugin's filter. A filter that throws answers
 * the request with that refusal, and nothing past it runs.
 *
 * The route that names the path most closely wins, whichever plugin listed it:
 * an exact path over a prefix, a longer prefix over a shorter, and plugin order
 * between equals. `/apply`, `/query` and `/ws` are exact paths, so a plugin's
 * catch-all (`/*`) answers only what nothing else claims. A request no route
 * claimed goes to the doors, which refuse anything they do not serve.
 */
export let handler = (host: Hosting): Handler => {
  let routes = host.routes
  // One registry, fed twice: its own graph's `effect` phase for what this host
  // commits, and the host's feed for what every other process or thread
  // commits to the same store — a `yak` command beside `yak serve`, the effect
  // pool's thread — which that phase never runs for.
  let subs = subscriptions(host.graph)
  host.feed?.((applied) => subs.commit(applied))
  let door = api({ graph: host.graph, authenticate: host.who, subs })
  let answer: Handler = (request) => {
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
  let filters = host.filters ?? []
  return filters.length == 0 ? answer : async (request) => {
    try {
      for (let f of filters) await f(request)
    } catch (err) {
      return refuse(err, request)
    }
    return answer(request)
  }
}
