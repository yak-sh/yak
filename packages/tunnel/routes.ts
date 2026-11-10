// The routes facet, exported as `@yaks/tunnel/routes`: the machine's end of a
// tunnel, imported by its `yak` wherever it serves `web`. Its server then
// answers a request the tunnel's gateway marked only at the paths the config
// opens (`routes`, URLPattern pathnames), and refuses the rest before any
// route sees them (./filter.ts). `/apply` and `/query` stay closed to the
// tunnel unless the machine's owner lists them; a request that did not come
// through the tunnel is untouched.
//
// A marked request is also never one of the machine's own callers. Whatever
// run it names, it writes `by` the persona the config names for the tunnel's
// callers and `via` a session standing here for the conversation it came from
// (its `x-via`, @yaks/session `standIn`), so what a hosted assistant does on
// the machine is recorded as that assistant's, and never as the machine's
// person or one of its agents. And where an opened path lists and runs tools
// (`/mcp`), it is offered only the ones the config names (`tools`).
import type { Arrived, Offers } from '@yaks/api'
import { VIA } from '@yaks/api'
import type { Eid, Graph } from '@yaks/graph'
import { standIn } from '@yaks/session/who'
import { filter as only, marked, offered } from './filter.ts'

/** What a config file can set for this facet. */
export type Options = {
  /** the paths the tunnel answers, as URLPattern pathnames; none opens
   * nothing */
  routes?: string[]
  /** the tools a request through the tunnel is offered at a path that runs
   * them, by name; none offers nothing */
  tools?: string[]
  /** the persona a request through the tunnel writes as, by eid, number or
   * name; without one it writes as nobody, through its session */
  persona?: string
}

/** What this facet reads off the host: the graph a caller's session is kept
 * in. */
export type Hosting = { graph: Pick<Graph, 'address' | 'get' | 'apply'> }

/** The session a tunnel's callers stand in is named within this door. */
export let DOOR = 'tunnel'

/** The tunnel's filter, over the paths the config opens. */
export let filter = (
  _host: unknown,
  options: Options = {},
): (req: Request) => void => only(options.routes)

/** Who a request through the tunnel is from: the config's persona, through
 * the session standing for the conversation its `x-via` names. */
export let arrived = (host: Hosting, options: Options = {}): Arrived => {
  let said = options.persona
  let persona: Promise<Eid | undefined> | undefined
  // Addressed by the first marked request: the graph is open by then.
  let named = () =>
    persona ??= (async () =>
      said
        ? ((await host.graph.address([said], 'persona')).get(said) ??
          said) as Eid
        : undefined)()
  return async (request) =>
    marked(request)
      ? await standIn(
        host.graph,
        DOOR,
        request.headers.get(VIA) ?? '',
        await named(),
      )
      : undefined
}

/** The tools a request through the tunnel is offered: the config's. */
export let offers = (_host: unknown, options: Options = {}): Offers =>
  offered(options.tools)
