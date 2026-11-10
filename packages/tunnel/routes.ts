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
// person or one of its agents: a `by` it sends a tool, asking for a mark
// recorded as somebody else's, is dropped from what it writes (@yaks/session
// `attributing`). And where an opened path lists and runs tools
// (`/mcp`), it is offered only the ones the config names (`tools`).
//
// The config's own `routes`, `tools` and `persona` are what every request
// through the tunnel gets, an app's worker in the space included. What only
// one kind of caller gets is under `callers`, by the platform's word for it
// (./gateway.ts `CALLER`): yaks.app says `operator` for the owner's Operator,
// `connector` for the owner's own assistant and `app` for an app's worker, so
// `callers.operator` holds the paths, tools and persona of the Operator alone.
//
// A conversation the platform says is held with the tunnel's `owner`
// (`x-yak-with`) is the machine's person's, and its session says so
// (`session.person`), so what is news to them is told to it (@yaks/session
// watch.ts) and passed back up the tunnel's platform (./effects.ts).
//
// One kind of marked request is the machine's person's own: one the platform
// says is the act of the person the config names as the tunnel's `owner`
// (`x-yak-by`, ./gateway.ts), which it does where a request carries that
// person's own words and nobody's reading of them. It writes `by` the
// config's `person` and `via` this process, as what they type at the
// machine's own page does, and never through a session: a comment written
// through a session is an agent's, to every reader of the graph. A request
// said to be anybody else's act is refused.
import type { Arrived, Offers, Told } from '@yaks/api'
import { VIA } from '@yaks/api'
import type { Eid, Graph } from '@yaks/graph'
import { standIn } from '@yaks/session/who'
import { voice, wear } from '@yaks/persona'
import {
  type Callers,
  Closed,
  filter as only,
  marked,
  named as opened,
  offered,
  type Opened,
} from './filter.ts'
import { BY, WITH } from './gateway.ts'

/** What a config file can set for this facet: what every request through the
 * tunnel is opened (without a persona it writes as nobody, through its
 * session), and what each kind of caller is on top of that. */
export type Options = Opened & {
  /** what one kind of caller is opened as well, by the platform's word for
   * it: its paths and tools beside everyone's, and its own persona */
  callers?: Callers
}

/** What this facet reads off the host: the graph a caller's session is kept
 * in, the person the machine's config names, and its own process. */
export type Hosting = {
  graph: Pick<Graph, 'address' | 'get' | 'apply' | 'storage' | 'vocab'>
  config?: { person?: string }
  me?: Eid
}

/** The session a tunnel's callers stand in is named within this door. */
export let DOOR = 'tunnel'

/** The tunnel's filter, over the paths the config opens. */
export let filter = (
  _host: unknown,
  options: Options = {},
): (req: Request) => void => only(options.routes, options.callers)

// An entity the config names by eid, number or name, as its eid, addressed by
// the first marked request that needs it: the graph is open by then.
let naming = (host: Hosting) => {
  let found = new Map<string, Promise<Eid>>()
  let address = async (said: string, kind?: string) =>
    ((await host.graph.address([said], kind)).get(said) ?? said) as Eid
  return (said?: string, kind?: string) =>
    said
      ? found.get(said) ?? found.set(said, address(said, kind)).get(said)
      : undefined
}

/** Who a request through the tunnel is from: the persona the config names for
 * its caller, or else for every request, through the session standing for the
 * conversation its `x-via` names. One the platform says is the own act of the
 * tunnel's `owner` is from the config's `person`, through this process. */
export let arrived = (host: Hosting, options: Options = {}): Arrived => {
  let named = naming(host)
  return async (request) => {
    if (!marked(request)) return undefined
    let caller = opened(options.callers, request)
    let own = request.headers.get(BY)
    let owner = caller.owner ?? options.owner
    if (own == null) {
      let mine = !!owner && request.headers.get(WITH) == owner
      return await standIn(
        host.graph,
        DOOR,
        request.headers.get(VIA) ?? '',
        await named(caller.persona ?? options.persona, 'persona'),
        mine ? await named(host.config?.person) : undefined,
      )
    }
    let by = own == owner ? await named(host.config?.person) : undefined
    if (!by) {
      throw new Closed("the tunnel writes as nobody but its machine's owner")
    }
    return { by, via: host.me }
  }
}

/** The tools a request through the tunnel is offered: the config's, for every
 * request and for its caller. */
export let offers = (_host: unknown, options: Options = {}): Offers =>
  offered(options.tools, options.callers)

/** What a request through the tunnel is told before a door's own
 * instructions: the text of the persona it writes as, composed as every
 * persona here is (@yaks/persona `wear` and `voice`), and read again for each
 * request that asks, so an edit to it reaches the next one. A request that is
 * the owner's own act writes as no persona, and is told none. */
export let told = (host: Hosting, options: Options = {}): Told => {
  let named = naming(host)
  return async (request) => {
    if (!marked(request) || request.headers.has(BY)) return undefined
    let persona = await named(
      opened(options.callers, request).persona ?? options.persona,
      'persona',
    )
    let worn = persona &&
      await wear(host.graph.storage, host.graph.vocab)(persona)
    return worn ? voice(host.graph.vocab)(worn) : undefined
  }
}
