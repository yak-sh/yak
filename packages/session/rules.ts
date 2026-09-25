// What a batch means about a transcript, and who is writing it: the graph
// plugins exported as `@yaks/session/rules` — entry sequencing, the reference
// checks a fork and a `using` must pass, the lease on any entity, and the
// conflict row written when two sessions want the same thing — and
// `authenticate`, which every door over the graph asks who a request is from.
//
// A client names which run it speaks for, in the `x-via` request header — the
// fleet's own header name, naming the instrument behind a write rather than a
// credential — and it is resolved the way every other id a caller types is
// resolved (./who.ts): an eid, a human-readable id, a name, or the harness's
// own id for the transcript. What it names is a lease and an attribution, never
// an authorization: a server that gates access checks a key and lets this
// identify the run alongside it. A command line asks the same question about
// the session it speaks for (@yaks/cli `signer`), which is why this is part of
// what a write means rather than one of the routes.
//
// A request that names nothing, or names a run this graph has never heard of,
// is left to the host's own fallback — the composer attributes those to the
// process itself (@yaks/cli `writer`), so a write is attributed either way.

import type { Authenticate } from '@yaks/api'
import type { Actor, Graph, Plugin } from '@yaks/graph'
import { sessions } from './plugin.ts'
import { sessionFor, speaking } from './who.ts'

/** Transcripts, leases and the audit of a bounced claim. */
export let rules = (): Plugin[] => [sessions()]

/** The request header a caller names its run in. */
export let VIA = 'x-via'

/** What `authenticate` is given: the graph, once it is open. */
export type Host = { graph: Graph }

/** Who a request is from: the run its `x-via` header names, as the actor
 * behind what it writes. */
export let authenticate =
  (host: Host): Authenticate =>
  async (request: Request): Promise<Actor | null> => {
    let said = request.headers.get(VIA)
    if (!said) return null
    let s = await sessionFor(host.graph, said)
    return s ? speaking(s) : null
  }
