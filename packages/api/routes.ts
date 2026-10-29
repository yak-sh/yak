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

import type { Bundle, Graph, News, Storage } from '@yaks/graph'
import type { Authenticate } from './actor.ts'
import {
  api,
  DOORS,
  type Filter,
  type Handler,
  type Route,
  routed,
} from './route.ts'
import { type Report, served } from './request.ts'
import { subscriptions } from './subs.ts'
import type { Timer } from './relay.ts'
import { fault } from './refuse.ts'

/** What this facet reads off the host it is composing into: the graph its
 * endpoints answer over, who that host says is calling, every route the
 * listed plugins contributed, every filter they put in front, and the commits
 * other hosts make to the same store, which `/ws` subscribers are told of as
 * well as this graph's own. */
export type Hosting = {
  graph: Graph
  storage?: Pick<Storage, 'revision'>
  stopping?: AbortSignal
  who: Authenticate
  routes: Route[]
  filters?: Filter[]
  feed?: (each: (news: News) => void | Promise<void>) => () => void
  /** Host telemetry, supplied with the failing request bundle. */
  report?: (
    error: unknown,
    context: { request: Bundle; during: { request: string } },
  ) => void | Promise<void>
}

// How closely a route names a path: an exact path over any prefix, and a
// longer prefix over a shorter one.
let exact = (r: Route) => !r.path.endsWith('*')
let reach = (r: Route) => exact(r) ? Infinity : r.path.length

/**
 * The host's one request handler: each plugin's route, and this package's
 * three endpoints, behind every plugin's filter. A filter that throws answers
 * the request with that refusal, and nothing past it runs. An answer at 500 or
 * over, from a route, a filter or a door, goes to `host.report` with a `request`
 * bundle named by its route (./request.ts `served`).
 *
 * The route that names the path most closely wins, whichever plugin listed it:
 * an exact path over a prefix, a longer prefix over a shorter, and plugin order
 * between equals. `/apply`, `/query` and `/ws` are exact paths, so a plugin's
 * catch-all (`/*`) answers only what nothing else claims. A request no route
 * claimed goes to the doors, which refuse anything they do not serve.
 */
export let handler = (host: Hosting, options: {
  /** Time between store revision checks, in ms (default 1000). */
  every?: number
  /** Schedule a revision check and return its cancellation function. */
  timer?: Timer
} = {}): Handler => {
  let routes = host.routes
  let graph = host.graph
  // One registry, fed twice: its own graph's `effect` phase for what this host
  // commits, and the host's feed for what every other process or thread
  // commits to the same store — a `yak` command beside `yak serve`, the effect
  // pool's thread — which that phase never runs for.
  // A commit feed already carries every commit, this process's and others',
  // as precise patches. The revision is for a store without one: it moves on
  // any write, so polling it beside a feed would reset every query each time.
  let revision = host.feed ? undefined : host.storage?.revision
  let subs = subscriptions(graph, { revision })
  let stopFeed = host.feed?.(subs.hear)
  let cancel = () => {}
  let stopped = host.stopping?.aborted ?? false
  let stop = () => {
    stopped = true
    cancel()
    stopFeed?.()
    subs.stop()
  }
  if (stopped) stop()
  else host.stopping?.addEventListener('abort', stop, { once: true })
  if (revision && !host.stopping?.aborted) {
    let timer = options.timer ?? ((fn, ms) => {
      let id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    })
    let look = async () => {
      try {
        await subs.check()
      } catch (error) {
        fault(error, 'store revision')
      }
      if (!stopped) cancel = timer(look, options.every ?? 1000)
    }
    cancel = timer(look, options.every ?? 1000)
  }
  let report: Report | undefined = host.report
    ? (request, error) => {
      void host.report!(error ?? 'HTTP request failed', {
        request,
        during: { request: request.entity.eid },
      })
    }
    : undefined
  let door = api({
    graph,
    authenticate: host.who,
    subs,
    report,
  })
  let claimed = (request: Request): Route | undefined => {
    let path = new URL(request.url).pathname
    let route = routes.filter((r) => routed(r, request.method, path))
      .reduce<Route | undefined>(
        (best, r) => best && reach(best) >= reach(r) ? best : r,
        undefined,
      )
    return route && (exact(route) || !DOORS.includes(path)) ? route : undefined
  }
  let filters = host.filters ?? []
  return served(async (request) => {
    for (let f of filters) await f(request)
    let route = claimed(request)
    if (!route) return door(request)
    let answer = await route.handle(request)
    return request.method == 'HEAD' ? new Response(null, answer) : answer
  }, {
    graph: host.graph,
    report,
    route: (request) => {
      let path = new URL(request.url).pathname
      return claimed(request)?.path ?? (DOORS.includes(path) ? path : undefined)
    },
  })
}
