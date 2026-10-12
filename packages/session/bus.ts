// Delivery of the session bus. A native transcript gets an input in the same
// batch that marks the item said; a caller using a tool sees owed lines in
// that tool's reply, or, when its harness reports to the hook door, the
// context that harness adds after a call of its own (./routes.ts). The
// listener for an outside harness uses listen.ts.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { who } from '@yaks/graph/call'
import { absent, and, type Clause, every, present } from '@yaks/query'
import { arrived, deliver, heirs, knocked, over, pending } from './listen.ts'
import { sessionFor } from './who.ts'

let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp

// Find pending items first. Most sessions have no bus work, so a timer never
// needs to scan their transcripts.
let candidates = async (g: Graph): Promise<Eid[]> => {
  let unsaid = (...clauses: Clause[]) =>
    and(...clauses, absent('notified'), every())
  let queries = [
    ...g.vocab.comp('knock')
      ? [
        unsaid(
          present('knock'),
          present('knock.target.session'),
        ),
        unsaid(present('knock'), present('knock.target.claim.session')),
      ]
      : [],
    ...g.vocab.comp('deliver')
      ? [unsaid(
        present('deliver'),
        present('deliver.to.session'),
      )]
      : [],
  ]
  // A reply is for the session that wrote the letter it answers, and once
  // that session is over, for a session of the project it reached; any other
  // letter that reached a project, and a knock at one, is that project's from
  // the start.
  let [replies, reached] = g.vocab.comp('mail')
    ? await Promise.all([
      g.read(
        unsaid(present('mail'), present('mail.reply_to.created.via.session')),
      ),
      g.read(and(...arrived().clauses, every())),
    ])
    : [[], []]
  let projects = g.vocab.comp('knock') && g.vocab.comp('project')
    ? await g.read(and(...knocked().clauses, every()))
    : []
  let items = (await Promise.all(queries.map((q) => g.read(q)))).flat()
  let answered = await g.get(
    replies.map((b) => String(comp(b, 'mail').reply_to)),
  )
  let targets = [
    ...new Set(
      [
        ...items.map((b) =>
          comp(b, 'comment').target ?? comp(b, 'knock').target ??
            comp(b, 'deliver').to
        ),
        ...answered.map((b) => comp(b, 'created').via),
      ].filter((id): id is Eid => typeof id == 'string'),
    ),
  ]
  let rows = await g.get(targets)
  return [
    ...new Set([
      ...rows.flatMap((b) => [
        ...b.session ? [b.entity.eid] : [],
        ...typeof comp(b, 'claim').session == 'string'
          ? [String(comp(b, 'claim').session)]
          : [],
      ]),
      ...await heirs(g, [...replies, ...reached, ...projects]),
    ]),
  ]
}

// Indexed, bounded reads distinguish a native transcript from an outside
// session without loading its transcript on every tool reply.
let native = async (g: Graph, session: Bundle): Promise<boolean> => {
  if (!session.session || session.process) return false
  let id = session.entity.eid
  let [using, ended] = await Promise.all([
    g.read(`.entry.session=${id}&.using&.limit=1`),
    over(g, session),
  ])
  return using.length > 0 && !ended
}

/** One pass over native sessions. A failed append leaves the item unmarked, so
 * the next pass can retry it. `attention` wakes the effects role's runner. */
export let feed = async (g: Graph): Promise<number> => {
  if (!g.vocab.comp('notified')) return 0
  let count = 0
  for (let id of await candidates(g)) {
    let [session] = await g.get([id])
    if (!session || !await native(g, session)) continue
    for (let { item, line } of await pending(g, id)) {
      let entry: Bundle = {
        entity: { eid: derivedEid(`session bus ${id} ${item.entity.eid}`) },
        entry: { session: id },
        content: { body: line },
        attention: {},
      }
      if (await deliver(g, null, item, entry)) count++
    }
  }
  return count
}

// Every line owed to an outside session, each marked said as it is taken.
let owed = async (
  g: Graph,
  id: Eid,
): Promise<{ item: Bundle; line: string }[]> => {
  let out: { item: Bundle; line: string }[] = []
  for (let said of await pending(g, id)) {
    if (await deliver(g, null, said.item)) out.push(said)
  }
  return out
}

/** Lines owed to an outside caller, appended to a direct tool reply. A
 * session whose harness reports to the hook door ({@link heard}) hears there
 * instead: its forks and subagents call tools under its id too, and the first
 * of them to call would take what its own line of work is owed. */
export let reply = async (g: Graph, call: Bundle): Promise<Bundle[]> => {
  if (!g.vocab.comp('notified')) return []
  let id = who(call)?.via
  if (!id) return []
  let [session] = await g.get([id])
  if (!session?.session || session.hooked || await native(g, session)) {
    return []
  }
  return (await owed(g, id)).map(({ item, line }) => ({
    entity: {
      eid: derivedEid(`session reply ${call.entity.eid} ${item.entity.eid}`),
    },
    content: { body: line },
  }))
}

/** What a harness hook reports: the harness's id for its session, and the
 * subagent the event came from, when it came from one (Claude Code's
 * `session_id` and `agent_id`). */
export type Hook = {
  session_id?: unknown
  agent_id?: unknown
  hook_event_name?: unknown
}

/**
 * The hook door's answer to one event: the lines owed to the session, when
 * the event came from the session's own line of work, as the context the
 * harness adds to it. An event from a subagent hears nothing, so what the
 * session is owed waits for the session. The first event marks the session
 * `hooked`, and from then on the bus says nothing in a tool reply to it.
 */
export let heard = async (g: Graph, hook: Hook): Promise<object> => {
  if (!g.vocab.comp('notified') || hook.agent_id) return {}
  let said = typeof hook.session_id == 'string' ? hook.session_id : ''
  let session = said ? await sessionFor(g, said) : undefined
  if (!session?.session) return {}
  let id = session.entity.eid
  if (!session.hooked) await g.apply([{ entity: { eid: id }, hooked: {} }])
  let lines = (await owed(g, id)).map(({ line }) => line)
  return lines.length
    ? {
      hookSpecificOutput: {
        hookEventName: String(hook.hook_event_name ?? 'PostToolUse'),
        additionalContext: lines.join('\n'),
      },
    }
    : {}
}
