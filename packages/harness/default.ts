// What a native session asks when nothing names a model, exported alone as
// `@yaks/harness/default` so a package that requests sessions (@yaks/heal's
// fixers) reads the same default without loading the agent loop. A session
// opened on a piece of work asks what that work's project says its work runs
// on ({@link usingFor}), and the default where the project says nothing.
// Either may be routed: a row that `routes` offerings is answered by the
// router (@yaks/model/route) over the plans' readings, and by its own `using`
// only where the router can't say.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { type Reading, type Route, route } from '@yaks/model/route'
import { CallError } from '@yaks/tools/errors'

/** The native harness's own entity, @yaks/code's row for this package: its
 * eid is derived from the package's name, so every graph names it alike. */
export let HARNESS: string = identityEid('package', ['@yaks/harness'])

let comp = (b: Bundle | undefined, name: string) => (b?.[name] ?? {}) as Comp

// The offerings a row routes: the `serves` edges its `routes` edges point at,
// each with the provider whose plan meters it.
let routesOf = async (g: Graph, of: Eid): Promise<Route[]> => {
  let links = await g.read(`.routes .edge.from=${of}`)
  if (!links.length) return []
  let offers = (await g.get(links.map((b) => String(comp(b, 'edge').to))))
    .filter((b) => b?.serves)
  let providers = await g.get(
    [...new Set(offers.map((b) => String(comp(b, 'edge').from)))],
    ['provider'],
  )
  let plans = new Map(
    providers.filter(Boolean).map((b) => [
      b.entity.eid,
      String(comp(b, 'provider').plan ?? b.entity.eid),
    ]),
  )
  return offers.map((b) => {
    let provider = String(comp(b, 'edge').from)
    return {
      provider,
      model: String(comp(b, 'edge').to),
      name: String(comp(b, 'serves').name),
      plan: plans.get(provider) ?? provider,
    }
  })
}

// What the router chooses for a row: `using{provider, model, why}`, or
// nothing where the row routes no offering or no plan of theirs has a reading.
let routed = async (g: Graph, of: Eid): Promise<Comp | undefined> => {
  let routes = await routesOf(g, of)
  if (!routes.length) return undefined
  let readings = (await g.read('.rate_limit')).map((b) =>
    b.rate_limit as Reading
  )
  return route({ routes, readings, now: Date.now() })
}

/** What a native session asks when nothing names it: of the offerings
 * {@link HARNESS} routes, the one the router chooses, with its reason
 * (`using.why`); else the `using{provider, model}` on {@link HARNESS}. One
 * write changes either and no release does. */
export let defaultUsing = async (g: Graph): Promise<Comp> => {
  let chosen = await routed(g, HARNESS)
  if (chosen) return chosen
  let [row] = await g.get([HARNESS], ['using'])
  let using = row?.using as Comp | undefined
  if (!using?.provider || !using.model) {
    throw new CallError(
      'model',
      `Choose a model: no default using{provider, model} on ${HARNESS}`,
    )
  }
  return using
}

/** What a session opened on a piece of work asks: what the project a task is
 * filed in, or the project itself, routes or names (`using{provider, model}`),
 * so the session runs as that project's other work does; {@link defaultUsing}
 * where the project says neither. */
export let usingFor = async (g: Graph, work: string): Promise<Comp> => {
  let [row] = await g.get([work], ['project', 'filed', 'using'])
  let project = row?.project ? row : (await g.get(
    [String((row?.filed as Comp | undefined)?.project ?? '')].filter(Boolean),
    ['using'],
  ))[0]
  let using = (project && await routed(g, project.entity.eid)) ??
    project?.using as Comp | undefined
  return using?.provider && using.model ? using : await defaultUsing(g)
}
