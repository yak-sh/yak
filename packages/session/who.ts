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
//
// A session created from the harness's own id takes its eid from that id
// (`sessionEid`): the id itself where it is a uuid, as Claude Code's and
// Codex's are, since an eid is a uuid; one derived from it otherwise. So
// whoever holds the harness's id holds the eid, and the hook and the importer
// that both create a session for one id land on one entity. A subagent's id
// (Claude Code's `agent-<id>`) names it within its parent, so its eid derives
// from the two.

import { after } from '@yaks/fp'
import {
  type Actor,
  addressed,
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  identityEid,
  TOMBSTONE,
  type Tx,
} from '@yaks/graph'
import { SESSION } from './comp.ts'

// A uuid, whatever its version.
let UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The eid of the session a harness knows by `id`: the id itself where it is a
 * uuid, and otherwise one derived from it. A subagent's, whose id names it
 * within its `parent`, derives from both.
 *
 * ```ts
 * import { sessionEid } from '@yaks/session'
 * import { assertEquals } from '@std/assert'
 *
 * let id = '49805559-ca98-4c0a-873e-45c19ec7316c'
 * assertEquals(sessionEid(id), id)
 * ```
 */
export let sessionEid = (id: string, parent?: string): Eid =>
  parent
    ? identityEid(SESSION, [parent, id])
    : UUID.test(id)
    ? id
    : identityEid(SESSION, [id])

/** A command speaks for its own transcript, never its launcher's. Clearing
 * the other harness IDs also matters when `yak` chooses the first one it sees. */
export let sessionEnv = (
  session: string,
  env: Record<string, string>,
): Record<string, string> => {
  let {
    CLAUDE_CODE_SESSION_ID: _claude,
    CODEX_THREAD_ID: _codex,
    TASKS_SESSION: _tasks,
    ...rest
  } = env
  return { ...rest, TASKS_SESSION: session }
}

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
      after(at, (found) =>
        after(
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
  g: Pick<Graph, 'address' | 'get' | 'read'>,
  said: string,
): Promise<Bundle | undefined> => {
  if (!said) return undefined
  let [eid] = await addressed(g, [said])
  let [row] = await g.get([eid])
  if (row?.[SESSION] && row[TOMBSTONE] == null) return row
  let run = (await runners(g, [said])).get(said)
  return run ? (await g.get([run]))[0] : undefined
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
