// Delivery of the session bus. A native transcript gets an input in the same
// batch that marks the item said; a caller using a tool sees owed lines in
// that tool's reply, or, when its harness reports to the hook door, the
// context that harness adds after a call of its own (./routes.ts). The
// listener for an outside harness uses listen.ts.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { who } from '@yaks/graph/call'
import {
  absent,
  and,
  type Clause,
  eq,
  fields,
  list,
  or,
  present,
} from '@yaks/query'
import { CLAIM, SESSION } from './comp.ts'
import {
  arrived,
  comments,
  deliver,
  ended,
  heirs,
  knocked,
  natives,
  type News,
  pending,
  replies as replyRoutes,
} from './listen.ts'
import { sessionFor } from './who.ts'

let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp

// Find pending items first. Most sessions have no bus work, so a timer never
// needs to scan their transcripts.
let candidates = async (
  g: Graph,
  news: News,
): Promise<Eid[]> => {
  let route = (...props: string[]) =>
    fields(...props.filter((p) => {
      let [c, key] = p.split('.')
      return g.vocab.prop(c, key)
    }))
  let unsaid = (component: string, ...clauses: Clause[]) =>
    and(present(component), ...clauses, absent('notified'))
  let queries = [
    ...g.vocab.comp('knock')
      ? [
        unsaid(
          'knock',
          present('knock.target.session'),
        ),
        unsaid('knock', present('knock.target.claim.session')),
      ]
      : [],
    ...g.vocab.comp('deliver')
      ? [unsaid(
        'deliver',
        present('deliver.to.session'),
      )]
      : [],
  ]
  // A reply is for the session that wrote the letter or record it answers, and once
  // that session is over, for a session of the project it reached; any other
  // letter that reached a project, and a knock at one, is that project's from
  // the start.
  let reached = g.vocab.comp('mail')
    ? await g.read(
      and(...arrived().clauses, route('mail.target', 'mail.reply_to')),
    )
    : []
  let projects = g.vocab.comp('knock') && g.vocab.comp('project')
    ? await g.read(and(...knocked().clauses, route('knock.target')))
    : []
  // First select unsaid human comments, then inspect only their targets.
  // Following target.created.via.session inside the global comment scan made
  // SQLite repeat the target chain over every historical comment each tick.
  let creators = [
    ...new Set([
      ...news.comments.creators.values(),
      ...news.replies.creators.values(),
    ]),
  ].filter(Boolean)
  let sessions = new Set(
    creators.length
      ? (await g.read(and(
        eq('entity.eid', list(...creators)),
        present('session'),
        fields('entity.eid'),
      ))).map((b) => b.entity.eid)
      : [],
  )
  let replies = news.replies.items.filter((b) =>
    sessions.has(
      news.replies.creators.get(String(comp(b, 'mail').reply_to)) ?? '',
    )
  )
  let items = [
    ...news.comments.items.filter((b) =>
      sessions.has(
        news.comments.creators.get(String(comp(b, 'comment').target)) ?? '',
      )
    ),
    ...queries.length
      ? await g.read(and(
        or(...queries),
        route('knock.target', 'deliver.to'),
      ))
      : [],
  ]
  let comments = g.vocab.prop('filed', 'project')
    ? items.filter((b) => b.comment)
    : []
  let targets = [
    ...new Set(
      [
        ...items.map((b) =>
          comp(b, 'comment').target ?? comp(b, 'knock').target ??
            comp(b, 'deliver').to
        ),
        ...replies.map((b) =>
          news.replies.creators.get(String(comp(b, 'mail').reply_to))
        ),
      ].filter((id): id is Eid => typeof id == 'string'),
    ),
  ]
  // A target is a session itself, or names the session that created or
  // claimed it; only those two references are read, never the whole record.
  let rows = targets.length
    ? await g.read(and(
      eq('entity.eid', list(...targets)),
      fields('created.via', `${CLAIM}.session`),
    ))
    : []
  return [
    ...new Set([
      ...targets,
      ...rows.flatMap((b) =>
        [comp(b, 'created').via, comp(b, CLAIM).session].filter((
          id,
        ): id is Eid => typeof id == 'string')
      ),
      ...await heirs(g, [...replies, ...reached, ...projects, ...comments]),
    ]),
  ]
}

// The native transcripts among these entities which are not over. An outside
// session's long log is never loaded to tell.
let hearing = async (g: Graph, ids: Eid[]): Promise<Eid[]> => {
  let found = ids.length
    ? await natives(g, [eq('entity.eid', list(...ids))], [`${SESSION}.ended`])
    : []
  let gone = await ended(g, found)
  return found.filter((s) => !gone.has(s.entity.eid)).map((s) => s.entity.eid)
}

/** A line a native transcript is owed: the item, what is said of it, and the
 * session it is said to. */
export type Due = { session: Eid; item: Bundle; line: string }

/** What one pass over native sessions owes them, read and not yet said: the
 * lines {@link feed} appends. */
export let due = async (g: Graph): Promise<Due[]> => {
  if (!g.vocab.comp('notified')) return []
  let out: Due[] = []
  let news = { comments: await comments(g), replies: await replyRoutes(g) }
  for (let id of await hearing(g, await candidates(g, news))) {
    for (let said of await pending(g, id, news)) {
      out.push({ session: id, ...said })
    }
  }
  return out
}

/** One pass over native sessions: each line {@link due} is appended as an
 * input. A failed append leaves the item unmarked, so the next pass can retry
 * it, and an item another session was given first is not said twice.
 * `attention` wakes the effects role's runner. */
export let feed = async (g: Graph): Promise<number> => {
  let count = 0
  for (let { session, item, line } of await due(g)) {
    let entry: Bundle = {
      entity: { eid: derivedEid(`session bus ${session} ${item.entity.eid}`) },
      entry: { session },
      content: { body: line },
      attention: {},
    }
    if (await deliver(g, null, item, entry)) count++
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

// Whether a session's harness reports to the hook door. Both doors below run
// on every tool call, so they read `hooked` and the session's id, never the
// session whole: that derives its status and cost from its log, tens of
// milliseconds of the web's one thread for a long transcript.
let hooked = async (g: Graph, id: Eid): Promise<boolean> =>
  !!(await g.get([id], ['hooked']))[0]?.hooked

/** Lines owed to an outside caller, appended to a direct tool reply. A
 * session whose harness reports to the hook door ({@link heard}) hears there
 * instead: its forks and subagents call tools under its id too, and the first
 * of them to call would take what its own line of work is owed. */
export let reply = async (g: Graph, call: Bundle): Promise<Bundle[]> => {
  if (!g.vocab.comp('notified')) return []
  let id = who(call)?.via
  if (!id) return []
  let [session] = await g.read(
    and(eq('entity.eid', id), fields(`${SESSION}.id`)),
  )
  if (
    !session?.session || await hooked(g, id) ||
    (await hearing(g, [id])).length
  ) return []
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
 * session is owed waits for the session. The first event, a subagent's too,
 * marks the session `hooked`, and from then on the bus says nothing in a tool
 * reply to it, which cannot tell the session from its subagents.
 */
export let heard = async (g: Graph, hook: Hook): Promise<object> => {
  if (!g.vocab.comp('notified')) return {}
  let said = typeof hook.session_id == 'string' ? hook.session_id : ''
  let session = said ? await sessionFor(g, said, [`${SESSION}.id`]) : undefined
  if (!session?.session) return {}
  let id = session.entity.eid
  if (!await hooked(g, id)) await g.apply([{ entity: { eid: id }, hooked: {} }])
  if (hook.agent_id) return {}
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
