// What a batch means about a transcript, and who is writing it: the graph
// plugins exported as `@yaks/session/graph` — entry sequencing, the reference
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
// A request naming no run in `x-via` may still be a harness's tool call the
// hook door was told about: an MCP call carries the harness's id for the call
// in its `_meta`, and the run the hook paired with that id is the one speaking
// (./announce.ts). This is how a call through the MCP tools, which one harness
// connection carries for a session and every subagent, is told apart.
//
// A request that names nothing, or names a run this graph has never heard of,
// is left to the host's own fallback — the composer attributes those to the
// process itself (@yaks/cli `writer`), so a write is attributed either way.

import type { Authenticate } from '@yaks/api'
import type { Actor, Bundle, Graph, Plugin } from '@yaks/graph'
import { announced, callIn } from './announce.ts'
import { reply as owed } from './bus.ts'
import { sessions } from './plugin.ts'
import { sessionFor, speaking } from './who.ts'

export { callIn } from './announce.ts'

/** Transcripts, leases and the audit of a bounced claim. */
export let plugins = (): Plugin[] => [sessions()]

/** What a direct tool call owes the session speaking through it. */
export let reply = (host: Host) => (call: Bundle): Promise<Bundle[]> =>
  owed(host.graph, call)

/** The request header a caller names its run in. */
export let VIA = 'x-via'

/** What `authenticate` is given: the graph, once it is open. */
export type Host = { graph: Graph }

/** Who a request is from: the run its `x-via` header names, else the run the
 * hook door said makes the harness call its message names, as the actor behind
 * what it writes. */
export let authenticate =
  (host: Host): Authenticate =>
  async (request: Request, message?: unknown): Promise<Actor | null> => {
    let call = callIn(message)
    let said = request.headers.get(VIA) ||
      (call ? await announced(host.graph, call) : undefined)
    if (!said) return null
    let s = await sessionFor(host.graph, said, ['session.id'])
    return s ? await speaking(host.graph, s) : null
  }
