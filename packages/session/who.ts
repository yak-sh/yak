// The transcript a caller names, and the actor it writes as. One resolution
// for both, because the CLI and the HTTP server are asking the same question.
//
// `--session` used to mean two things: an eid or a human-readable id to
// `claim take`, and the harness's own id for the run to
// `session brief|wrap|context`. So `claim take --session S-37703` locked
// something for the session a person could see, and `session wrap S-37703`
// returned `[]` and released nothing — the same id, two different entities. It
// means the SESSION entity now, resolved the way any id is resolved here:
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
  then,
  TOMBSTONE,
  type Tx,
} from '@yaks/graph'
import { SESSION } from './comp.ts'

/**
 * The transcripts these ids are the runner's own ids of (`session.id`), each
 * to its eid: the key only a session has, which is how an id meant to name a
 * session resolves where no plugin knows it as an eid or a name (the
 * plugin's `address`, asked with the kind `session`).
 */
export let runners = (
  tx: Pick<Tx, 'read'>,
  ids: string[],
): Map<string, Eid> | Promise<Map<string, Eid>> =>
  ids.reduce<Map<string, Eid> | Promise<Map<string, Eid>>>(
    (at, id) =>
      then(at, (found) =>
        then(
          tx.read(`.${SESSION}.id=${JSON.stringify(id)}`),
          ([b]) => b ? new Map([...found, [id, b.entity.eid]]) : found,
        )),
    new Map(),
  )

/**
 * The transcript an id names: the entity it addresses, else the one carrying it
 * as its runner's own id. Nothing is minted here — resolution only reads, and a
 * tool that wants a transcript created does that itself.
 */
export let sessionFor = async (
  g: Pick<Graph, 'address' | 'storage' | 'read'>,
  said: string,
): Promise<Bundle | undefined> => {
  if (!said) return undefined
  let [eid] = await addressed(g, [said])
  let [row] = await detached(g.storage).get([eid])
  if (row?.[SESSION] && row[TOMBSTONE] == null) return row
  let run = (await runners(g, [said])).get(said)
  return run ? (await detached(g.storage).get([run]))[0] : undefined
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
