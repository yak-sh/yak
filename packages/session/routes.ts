// Who is calling, for a graph that has transcripts: the `routes` facet a host
// takes (`@yaks/session/routes`).
//
// A client says which RUN it speaks for and the door says what that means.
// The word rides on `x-via` — the fleet's own spelling, an instrument behind
// a write rather than a credential — and it is read the way every other id a
// caller types is read (./who.ts): an eid, a human id, a name, or the
// harness's own name for the transcript. What it names is a lease and a
// byline, never an authorization: a host that gates access authenticates with
// a key and lets this name the run beside it.
//
// A request that names nothing, or names a run this graph has never heard of,
// is left to the host's own answer — the composer signs those as the server
// itself (@yaks/cli `writer`), so a write is attributed either way.

import type { Authenticate } from '@yaks/api'
import type { Actor, Graph } from '@yaks/graph'
import { sessionFor, speaking, where } from './who.ts'

/** The header a caller names its run on. */
export let VIA = 'x-via'

/** What the facet is handed: the graph, once it is open. */
export type Host = { graph: Graph }

/** The facet a host takes: a request's `x-via` as the actor behind it. */
export let authenticate =
  (host: Host): Authenticate =>
  async (request: Request): Promise<Actor | null> => {
    let said = request.headers.get(VIA)
    if (!said) return null
    let s = await sessionFor(where(host.graph), said)
    return s ? speaking(s) : null
  }
