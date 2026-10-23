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
// write), and what it writes is attributed `by` the actor that run works as
// and `via` the run itself. An actor is one of a handful, and never a
// session: there are thousands of sessions, and the owner's word is that
// sessions never go in `by` (M-31958). The actor is the session's persona; the
// owner, verbatim: "the persona should always be the actor. it used to be the
// project. i was saying i think actually the persona is the right one", and
// "i guess you could have fallbacks still, but it should be rare to have
// agents with no persona". So a run works as its persona, else the actor it
// names (`session.actor`), else the project it is filed in, else whatever the
// session that spawned it works as (`actorOf`).
//
// A session created from the harness's own id takes its eid from that id
// (`sessionEid`): the id itself where it is a uuid, as Claude Code's and
// Codex's are, since an eid is a uuid; one derived from it otherwise. So
// whoever holds the harness's id holds the eid, and the hook and the importer
// that both create a session for one id land on one entity. A subagent's id
// (Claude Code's agent id, its transcript `agent-<id>.jsonl`) names it within
// its parent, so its eid derives from the two (`subagentSession`).

import { after } from '@yaks/fp'
import { and, eq, fields, limit, list, or, present } from '@yaks/query'
import type { Actor, Bundle, Comp, Eid, Graph, Tx } from '@yaks/graph'
import { addressed } from '@yaks/graph/call'
import { identityEid } from '@yaks/graph/identity'
import { TOMBSTONE } from '@yaks/graph/bundle'
import { SESSION } from './comp.ts'

/** Whether a request came from a person or their command, rather than an
 * agent or automation. An agent may speak for an identity, so both the author
 * and the instrument matter. A transcript's own stamp is not its parent. */
export let humanCaller = async (
  g: Pick<Graph, 'read' | 'vocab'>,
  actor: Actor | null,
  self?: Eid,
): Promise<boolean> => {
  let ids = [
    ...new Set(
      [actor?.by, actor?.via].filter((id): id is Eid => !!id && id != self),
    ),
  ]
  let kinds = ['session', 'effect', 'builder'].filter((name) =>
    g.vocab.comp(name)
  )
  if (!ids.length || !kinds.length) return true
  let callers = await g.read(and(
    eq('entity.eid', list(...ids)),
    or(...kinds.map((name) => present(name))),
    fields('entity.eid'),
    limit(1),
  ))
  return !callers.length
}

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
          tx.read(`.${SESSION}.id=${JSON.stringify(id)} .fields=entity.eid`),
          ([b]) => b ? new Map([...found, [id, b.entity.eid]]) : found,
        )),
    new Map(),
  )

/**
 * The transcript an id names: the entity it addresses, else the one carrying it
 * as its runner's own id. Nothing is minted here — resolution only reads, and a
 * tool that wants a transcript created does that itself. `{ id }` selects only
 * the runner's own session id, without trying entity addresses. `fields` selects only
 * the properties the caller reads, avoiding derived transcript history.
 */
export let sessionFor = async (
  g: Pick<Graph, 'address' | 'get' | 'read'>,
  said: string | { id: string },
  fields?: string[],
): Promise<Bundle | undefined> => {
  if (typeof said != 'string') {
    if (!said.id) return undefined
    return (await g.read(
      `.${SESSION}.id=${JSON.stringify(said.id)} ${
        fields ? `.fields=${fields.join(',')}` : '*'
      }`,
    ))[0]
  }
  if (!said) return undefined
  let [eid] = await addressed(g, [said])
  let get = async (id: Eid): Promise<Bundle | undefined> =>
    (fields
      ? await g.read(
        `.entity.eid=${JSON.stringify(id)} .${SESSION} .fields=${
          fields.join(',')
        }`,
      )
      : await g.get([id]))[0]
  let row = await get(eid)
  // A projected query already required session presence; its selected
  // properties may all be absent on a native transcript.
  if (row && (fields || row[SESSION]) && row[TOMBSTONE] == null) return row
  let run = (await runners(g, [said])).get(said)
  return run ? await get(run) : undefined
}

// How far `actorOf` follows a chain of spawning sessions before it stops: a
// chain longer than this is a cycle someone wrote, not a family.
let DEPTH = 8

let str = (v: unknown): string => typeof v == 'string' ? v : ''

/**
 * The actor a session works as: its persona, else the actor it names
 * (`session.actor`), else the project it is filed in (`filed.project`), else
 * whatever the session that spawned it works as, so a subagent works as the
 * persona it runs under. Never a session; `undefined` where nothing names one.
 * A session with no persona anywhere up its line should be rare, and a door
 * that starts one is worth fixing rather than falling back for.
 */
export let actorOf = async (
  g: Pick<Graph, 'get' | 'vocab'>,
  session: Eid,
): Promise<Eid | undefined> => {
  let filed = !!g.vocab.prop('filed', 'project')
  let comps = [SESSION, 'filed', 'spawned'].filter((c) => g.vocab.comp(c))
  let seen = new Set<Eid>()
  for (let at: Eid = session; at && !seen.has(at) && seen.size < DEPTH;) {
    seen.add(at)
    let [s] = await g.get([at], comps)
    if (!s?.[SESSION] || s[TOMBSTONE] != null) return
    let named = s[SESSION] as Comp
    let project = filed ? str((s.filed as Comp | undefined)?.project) : ''
    let by = str(named.persona) || str(named.actor) || project
    if (by) return by as Eid
    at = str((s.spawned as Comp | undefined)?.parent) as Eid
  }
}

/**
 * The actor a transcript writes as: `by` the actor it works as
 * ({@link actorOf}), the identity that survives a `/clear`, and `via` the run
 * itself. A session that works as nobody leaves `by` unsaid rather than
 * standing in it.
 */
export let speaking = async (
  g: Pick<Graph, 'get' | 'vocab'>,
  s: Bundle,
): Promise<Actor> => {
  let via = s.entity.eid
  let by = await actorOf(g, via)
  return by ? { by, via } : { via }
}

/**
 * The session of a subagent its harness knows by `id` within the session it
 * knows by `parent`: its eid, and the rows that write it where the graph has
 * not met it yet (with the parent, where that is new too), else none.
 */
export let spawning = async (
  g: Pick<Graph, 'get' | 'read' | 'address'>,
  parent: string,
  id: string,
): Promise<{ eid: Eid; rows: Bundle[] }> => {
  let eid = sessionEid(id, parent)
  let [s] = await g.get([eid], [SESSION])
  if (s?.[SESSION] && s[TOMBSTONE] == null) return { eid, rows: [] }
  let up = (await sessionFor(g, parent, ['session.id']))?.entity.eid
  return {
    eid,
    rows: [
      ...up ? [] : [{ entity: { eid: '$parent' }, [SESSION]: { id: parent } }],
      {
        entity: { eid },
        [SESSION]: { id },
        spawned: { parent: up ?? '$parent' },
      },
    ],
  }
}

/** The session of a subagent ({@link spawning}), written where it is new.
 * Answers its eid, or nothing where either id is empty. */
export let subagentSession = async (
  g: Pick<Graph, 'get' | 'read' | 'address' | 'apply'>,
  parent: string,
  id: string,
): Promise<Eid | undefined> => {
  if (!parent || !id) return
  let { eid, rows } = await spawning(g, parent, id)
  if (rows.length) await g.apply(rows)
  return eid
}
