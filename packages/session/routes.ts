// Who is calling, for a graph that has transcripts: the `authenticate` function
// exported as `@yaks/session/routes`.
//
// A client names which run it speaks for, and this decides what that means.
// The id arrives in the `x-via` request header — the fleet's own header name,
// naming the instrument behind a write rather than a credential — and it is
// resolved the way every other id a caller types is resolved (./who.ts): an
// eid, a human-readable id, a name, or the harness's own id for the transcript.
// What it names is a lease and an attribution, never an authorization: a server
// that gates access checks a key and lets this identify the run alongside it.
//
// A request that names nothing, or names a run this graph has never heard of,
// is left to the server's own fallback — the composer attributes those to the
// server itself (@yaks/cli `writer`), so a write is attributed either way.

import type { Authenticate } from '@yaks/api'
import type { Actor, Graph } from '@yaks/graph'
import { sessionFor, speaking } from './who.ts'

/** The request header a caller names its run in. */
export let VIA = 'x-via'

/** What this module is given: the graph, once it is open. */
export type Host = { graph: Graph }

/** The `authenticate` function an HTTP server imports: it reads a request's
 * `x-via` header and returns the actor behind the request. */
export let authenticate =
  (host: Host): Authenticate =>
  async (request: Request): Promise<Actor | null> => {
    let said = request.headers.get(VIA)
    if (!said) return null
    let s = await sessionFor(host.graph, said)
    return s ? speaking(s) : null
  }
