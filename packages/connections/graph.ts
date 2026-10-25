// The `graph` export (`@yaks/connections/graph`): what a direct tool call is
// answered with beside its own answer. A call whose answer names a connection
// is answered with the integration it goes through too, so whoever asked for
// one (an agent calling connection_need) reads how to get its key without
// asking again. A host composes it like any plugin's graph facet; nothing
// calls it by hand.

import type { Reply } from '@yaks/tools'
import { type Read } from './integrations.ts'
import { through } from './connections.ts'

/** What this needs of the host: a read of its graph. */
export type Host = { graph: { read: Read } }

/** Beside a direct call's answer: the integrations its connections go
 * through, but for those it already carries. */
export let reply = (host: Host): Reply => (_call, answer) =>
  through(host.graph.read, answer)
