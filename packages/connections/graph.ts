// The `graph` export (`@yaks/connections/graph`): what a direct tool call is
// answered with beside its own answer. A call whose answer names a connection
// is answered with the integration it goes through too, so whoever asked for
// one (an agent calling connection_need) reads how to get its key without
// asking again. A host composes it like any plugin's graph facet; nothing
// calls it by hand.
//
// Every process composing this package loads this module as it starts, so it
// needs only the names (./identity.ts), never the connection actions.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import type { Reply } from '@yaks/tools'
import type { Read } from './integrations.ts'
import { CONNECTION, INTEGRATION, integrationEid, USES } from './identity.ts'

/** What this needs of the host: a read of its graph. */
export type Host = { graph: { read: Read } }

let any = (eids: Eid[]) => eids.join(',')

/** The integrations the connections among `bundles` go through, as the graph
 * holds them, but for any `bundles` already carry: what a person and their
 * agent read beside a connection, how to get its key among it. A `uses` link
 * whose connection is not among them is read to find which. */
export let through = async (
  read: Read,
  bundles: Bundle[],
): Promise<Bundle[]> => {
  let names = new Set<string>()
  let ask: Eid[] = []
  for (let b of bundles) {
    let c = b[CONNECTION] as Comp | undefined
    if (typeof c?.integration == 'string') names.add(c.integration)
    else if (b[USES]) ask.push(String((b.edge as Comp | undefined)?.to))
  }
  if (ask.length) {
    for (let b of await read(`.entity.eid=${any(ask)}&.${CONNECTION}`)) {
      names.add(String((b[CONNECTION] as Comp).integration))
    }
  }
  let have = new Set(
    bundles.filter((b) => b[INTEGRATION]).map((b) => b.entity.eid),
  )
  let wanted = [...names].map(integrationEid).filter((e) => !have.has(e))
  return wanted.length
    ? await read(`.entity.eid=${any(wanted)}&.${INTEGRATION}`)
    : []
}

/** Beside a direct call's answer: the integrations its connections go
 * through, but for those it already carries. */
export let reply = (host: Host): Reply => (_call, answer) =>
  through(host.graph.read, answer)
