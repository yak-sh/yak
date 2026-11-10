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
//
// The config's own `routes`, `tools` and `persona` are what every request
// through the tunnel gets, an app's worker in the space included. What only
// one kind of caller gets is under `callers`, by the platform's word for it
// (./gateway.ts `CALLER`): yaks.app says `operator` for the owner's Operator,
// `connector` for the owner's own assistant and `app` for an app's worker, so
// `callers.operator` holds the paths, tools and persona of the Operator alone.
import type { Arrived, Offers } from '@yaks/api'
import { VIA } from '@yaks/api'
import type { Eid, Graph } from '@yaks/graph'
import { standIn } from '@yaks/session/who'
import {
  type Callers,
  filter as only,
  marked,
  named as opened,
  offered,
  type Opened,
} from './filter.ts'

/** What a config file can set for this facet: what every request through the
 * tunnel is opened (without a persona it writes as nobody, through its
 * session), and what each kind of caller is on top of that. */
export type Options = Opened & {
  /** what one kind of caller is opened as well, by the platform's word for
   * it: its paths and tools beside everyone's, and its own persona */
  callers?: Callers
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
): (req: Request) => void => only(options.routes, options.callers)

/** Who a request through the tunnel is from: the persona the config names for
 * its caller, or else for every request, through the session standing for the
 * conversation its `x-via` names. */
export let arrived = (host: Hosting, options: Options = {}): Arrived => {
  let personas = new Map<string, Promise<Eid>>()
  let address = async (said: string) =>
    ((await host.graph.address([said], 'persona')).get(said) ?? said) as Eid
  // Addressed by the first marked request that writes as it: the graph is
  // open by then.
  let named = (said?: string) =>
    said
      ? personas.get(said) ?? personas.set(said, address(said)).get(said)
      : undefined
  return async (request) =>
    marked(request)
      ? await standIn(
        host.graph,
        DOOR,
        request.headers.get(VIA) ?? '',
        await named(
          opened(options.callers, request).persona ?? options.persona,
        ),
      )
      : undefined
}

/** The tools a request through the tunnel is offered: the config's, for every
 * request and for its caller. */
export let offers = (_host: unknown, options: Options = {}): Offers =>
  offered(options.tools, options.callers)
