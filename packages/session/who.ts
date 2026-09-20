// The transcript a caller names, and the actor it writes as. One meaning for
// both, because they are the same question asked at two doors.
//
// `--session` used to mean two things: an eid or a human id to `claim take`,
// and the harness's OWN name for the run to `session brief|wrap|context`. So
// `claim take --session S-37703` locked something for the session a person
// could see, and `session wrap S-37703` answered `[]` and released nothing —
// the same word, two graphs apart. It means the SESSION ENTITY now, reached
// the way any id is reached here: addressed first (an eid, `S-37703`, a name
// the graph resolves), and where nothing answers to it, read as the harness's
// own name for a transcript — which is the only one of the three that may not
// exist yet, and the one `session context --hook -` mints.
//
// The same ladder answers the DOOR. A request says which run it speaks for
// (`x-via`, the fleet's own spelling for the instrument behind a write), and
// what it writes is signed `by` the identity that run speaks as and `via` the
// run itself: a session's work reads as the persona's, without losing which
// transcript did it.

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

/** What reaching a session needs: the ids a caller may say, and a read. A
 * tool passes its own context; a door passes the graph. */
export type Where = {
  graph: Pick<Graph, 'address' | 'storage'>
  read: (query: string) => Bundle[] | Promise<Bundle[]>
}

/** A tool context is one, and so is a graph. */
export let where = (g: Graph): Where => ({ graph: g, read: (q) => g.read(q) })

/**
 * The transcript a word names: the entity it addresses, else the one wearing
 * it as its runner's own name. Nothing is minted here — a door reads, and a
 * tool that wants a transcript reified says so itself.
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
 * that survives a `/clear` — and `via` the run itself. A session speaking for
 * nobody speaks for itself.
 */
export let speaking = (s: Bundle): Actor => {
  let eid = s.entity.eid
  let actor = (s[SESSION] as Comp | undefined)?.actor
  return { by: actor ? String(actor) as Eid : eid, via: eid }
}
