// The transcript a caller names, and the actor it writes as. One resolution
// for both, because the CLI and the HTTP server are asking the same question.
//
// `--session` used to mean two things: an eid or a human-readable id to
// `claim take`, and the harness's OWN id for the run to
// `session brief|wrap|context`. So `claim take --session S-37703` locked
// something for the session a person could see, and `session wrap S-37703`
// returned `[]` and released nothing — the same id, two different entities. It
// means the SESSION ENTITY now, resolved the way any id is resolved here:
// addressed first (an eid, `S-37703`, a name the graph resolves), and where
// nothing matches, read as the harness's own id for a transcript — which is the
// only one of the three that may not exist yet, and the one
// `session context --hook -` mints.
//
// The same sequence resolves an HTTP request. A request names which run it
// speaks for (in `x-via`, the fleet's own header for the instrument behind a
// write), and what it writes is attributed `by` the identity that run speaks as
// and `via` the run itself: a session's work is attributed to the persona,
// without losing which transcript did it.

import {
  type Actor,
  addressed,
  type Bundle,
  type Comp,
  detached,
  type Eid,
  type Graph,
  TOMBSTONE,
} from '@yaks/graph'
import { SESSION } from './comp.ts'

/** What resolving a session needs: the ids a caller may pass, and a read. A
 * tool passes its own context; an HTTP server passes the graph. */
export type Where = {
  graph: Pick<Graph, 'address' | 'storage'>
  read: (query: string) => Bundle[] | Promise<Bundle[]>
}

/** A tool context is one, and so is a graph. */
export let where = (g: Graph): Where => ({ graph: g, read: (q) => g.read(q) })

/**
 * The transcript an id names: the entity it addresses, else the one carrying it
 * as its runner's own id. Nothing is minted here — resolution only reads, and a
 * tool that wants a transcript created does that itself.
 */
export let sessionFor = async (
  ctx: Where,
  said: string,
): Promise<Bundle | undefined> => {
  if (!said) return undefined
  let [eid] = await addressed(ctx.graph, [said])
  let [row] = await detached(ctx.graph.storage).get([eid])
  if (row?.[SESSION] && row[TOMBSTONE] == null) return row
  return (await ctx.read(`.${SESSION}.id=${JSON.stringify(said)}`))[0]
}

/**
 * The actor a transcript writes as: `by` whoever it speaks for — the identity
 * that survives a `/clear` — and `via` the run itself. A session that speaks
 * for nobody speaks for itself.
 */
export let speaking = (s: Bundle): Actor => {
  let eid = s.entity.eid
  let actor = (s[SESSION] as Comp | undefined)?.actor
  return { by: actor ? String(actor) as Eid : eid, via: eid }
}
