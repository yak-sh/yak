// Delivery of the session bus. A native transcript gets an input in the same
// batch that marks the item said; a caller using a tool sees owed lines in
// that tool's reply, or, when its harness reports to the hook door, the
// context that harness adds after a call of its own (./routes.ts). The
// listener for an outside harness uses listen.ts.
//
// The native side follows the graph's commits ({@link follow}): its own
// graph's, and through the host's feed every other process's. A pass looks at
// what was written since the last one, so its cost follows what can be said,
// not the unsaid history (thousands of agents' comments and letters nobody
// hears), and a quiet graph reads nothing. A written item is asked about
// alone. A transcript entry asks again about its own session, which may have
// come to work and so hear what is held for its project. Any other way an
// item reaches a session (a claim, a session's persona, where a record is
// filed) changes rarely, and the pass after it asks about everything, as the
// first pass does.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import type { Feed } from '@yaks/host'
import { sleep } from '@yaks/fp'
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
  type Routes,
  undeliver,
} from './listen.ts'
import { sessionFor } from './who.ts'

let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp

/** What a pass looks at: every unsaid item, or the items written and the
 * sessions whose transcripts moved since the last pass. */
export type Scope = { all: boolean; items: Set<Eid>; sessions: Set<Eid> }

/** A scope with nothing in it, or with everything. */
export let scope = (all = false): Scope => ({
  all,
  items: new Set(),
  sessions: new Set(),
})

let idle = (s: Scope) => !s.all && !s.items.size && !s.sessions.size

// The components an item is, and those that route one to a session.
let ITEMS = ['comment', 'knock', 'deliver', 'mail', 'notified']
let ROUTES = [
  CLAIM,
  SESSION,
  'process',
  'persona',
  'filed',
  'project',
  'using',
  'email',
]

let item = (b: Bundle) => ITEMS.some((c) => c in b)

/** Add to `into` what these committed bundles give a pass to look at. */
export let noted = (into: Scope, bundles: Bundle[]): Scope => {
  for (let b of bundles) {
    if (ROUTES.some((c) => c in b)) into.all = true
    else if (item(b)) into.items.add(b.entity.eid)
    let session = comp(b, 'entry').session
    if (typeof session == 'string') into.sessions.add(session)
  }
  return into
}

/** Hand `hear` every commit: this graph's own through its `effect` phase,
 * and every other process's through the host's feed. Without a feed the
 * others' commits cannot be heard, so nothing is heard, and the caller asks
 * about everything instead. Returns what unsubscribes the feed. */
let heed = (
  host: { graph: Graph; feed?: Feed },
  name: string,
  hear: (bundles: Bundle[], missed: boolean) => void,
): (() => void) | undefined => {
  let stop = host.feed?.((news) => hear(news.applied.flat(), news.missed))
  if (stop) {
    host.graph.use({
      name,
      hooks: { effect: (bundles) => (hear(bundles, false), bundles) },
    })
  }
  return stop
}

let merge = (into: Scope, from: Scope): Scope => {
  into.all ||= from.all
  for (let id of from.items) into.items.add(id)
  for (let id of from.sessions) into.sessions.add(id)
  return into
}

let among = (ids?: Eid[]): Clause[] =>
  ids ? [eq('entity.eid', ids.length == 1 ? ids[0] : list(...ids))] : []

// Find pending items first. Most sessions have no bus work, so a timer never
// needs to scan their transcripts. `ids` keeps to those items.
let candidates = async (
  g: Graph,
  news: News,
  ids?: Eid[],
): Promise<Eid[]> => {
  let route = (...props: string[]) =>
    fields(...props.filter((p) => {
      let [c, key] = p.split('.')
      return g.vocab.prop(c, key)
    }))
  let unsaid = (component: string, ...clauses: Clause[]) =>
    and(present(component), ...among(ids), ...clauses, absent('notified'))
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
      and(
        ...among(ids),
        ...arrived().clauses,
        route('mail.target', 'mail.reply_to'),
      ),
    )
    : []
  let projects = g.vocab.comp('knock') && g.vocab.comp('project')
    ? await g.read(
      and(...among(ids), ...knocked().clauses, route('knock.target')),
    )
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
 * lines {@link feed} appends. A scope keeps the pass to the items it names and
 * the sessions it names, each asked about all it is owed. */
export let due = async (g: Graph, at: Scope = scope(true)): Promise<Due[]> => {
  if (!g.vocab.comp('notified')) return []
  let out: Due[] = []
  let ids = at.all ? undefined : [...at.items]
  let news = {
    comments: await comments(g, ids),
    replies: await replyRoutes(g, ids),
  }
  let found = !ids || ids.length ? await candidates(g, news, ids) : []
  for (let id of await hearing(g, [...new Set([...found, ...at.sessions])])) {
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
export let feed = async (g: Graph, at?: Scope): Promise<number> => {
  let count = 0
  for (let { session, item, line } of await due(g, at)) {
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

/** Feed native sessions until `signal` aborts: a first pass over everything,
 * then a pass each time a commit gives one something to look at, at once. A
 * host with no feed cannot hear other processes' commits, so it asks about
 * everything every `every` ms. A pass that fails is reported and its scope
 * asked about again after `every` ms; `wait` is the clock that waits. */
export let follow = async (
  host: {
    graph: Graph
    feed?: Feed
    report?: (error: unknown) => void | Promise<void>
  },
  signal: AbortSignal,
  options: {
    every?: number
    wait?: (ms: number, signal: AbortSignal) => Promise<unknown>
  } = {},
): Promise<void> => {
  let { every = 1000, wait = sleep } = options
  let next = scope(true)
  let bell = Promise.withResolvers<void>()
  let ring = () => bell.resolve()
  signal.addEventListener('abort', ring, { once: true })
  let stop = signal.aborted
    ? undefined
    : heed(host, '@yaks/session/bus', (bundles, missed) => {
      if (signal.aborted) return
      noted(next, bundles).all ||= missed
      if (!idle(next)) ring()
    })
  try {
    while (true) {
      let now = stop ? next : scope(true)
      next = scope()
      try {
        if (!idle(now)) await feed(host.graph, now)
      } catch (error) {
        await (host.report?.(error) ?? console.error('session bus —', error))
        merge(next, now)
        await wait(every, signal)
      }
      if (signal.aborted) return
      if (!stop) await wait(every, signal)
      else if (idle(next)) await bell.promise
      bell = Promise.withResolvers()
    }
  } finally {
    stop?.()
    signal.removeEventListener('abort', ring)
  }
}

/** A process's book of the unsaid person-written comments and replies, by
 * the creator of what each answers: what {@link pending} reads for one
 * outside session at its doors instead of every unsaid item in the graph. */
export type Ledger = {
  /** The comments and replies owed to this session, read again by id. */
  owed: (session: Eid) => Promise<News>
}

/** What a door over this host's graph needs to hear for one session. */
export type Door = {
  graph: Graph
  feed?: Feed
  stopping?: AbortSignal
}

let ledgers = new WeakMap<Graph, Ledger>()

// How many written items a ledger keeps to read again before it reads
// everything instead: a door unused for long costs one full read, not memory
// that grows with every commit meanwhile.
let BACKLOG = 5000

/** The graph's ledger, kept from its commits, as {@link follow} keeps the
 * native bus: the first use reads every unsaid comment and reply once, and
 * each later use reads again only the items written since, so a door's read
 * costs what its session is owed and what was written meanwhile. What routes
 * an item here, the creator of what it answers, is written before it and
 * never changes. A said item is dropped when its mark is heard. Undefined for
 * a host with no feed, whose doors read everything each time; a missed commit
 * reads everything again. */
export let ledger = (host: Door): Ledger | undefined => {
  let kept = ledgers.get(host.graph)
  if (kept || !host.feed) return kept
  let g = host.graph
  let by = new Map<Eid, Set<Eid>>(), whose = new Map<Eid, Eid>()
  let written = new Set<Eid>(), stale = true
  let stop = heed(host, '@yaks/session/ledger', (bundles, missed) => {
    stale ||= missed
    for (let b of bundles) if (item(b)) written.add(b.entity.eid)
    if (written.size > BACKLOG) stale = true
    if (stale) written.clear()
  })
  host.stopping?.addEventListener('abort', () => stop?.(), { once: true })
  let enter = (r: Routes, name: string, prop: string) => {
    for (let b of r.items) {
      let creator = r.creators.get(String(comp(b, name)[prop]))
      if (!creator) continue
      by.set(creator, (by.get(creator) ?? new Set()).add(b.entity.eid))
      whose.set(b.entity.eid, creator)
    }
  }
  let drop = (id: Eid) => {
    by.get(whose.get(id) ?? '')?.delete(id)
    whose.delete(id)
  }
  let read = async (ids?: Eid[]) => {
    let news = {
      comments: await comments(g, ids),
      replies: await replyRoutes(g, ids),
    }
    enter(news.comments, 'comment', 'target')
    enter(news.replies, 'mail', 'reply_to')
    return news
  }
  let update = async () => {
    let ids = stale ? undefined : [...written]
    if (ids && !ids.length) return
    stale = false
    written.clear()
    if (ids) ids.forEach(drop)
    else {
      by.clear()
      whose.clear()
    }
    try {
      await read(ids)
    } catch (error) {
      stale = true
      throw error
    }
  }
  // One use at a time, so two doors at once never index a read twice.
  let turn: Promise<unknown> = Promise.resolve()
  let made: Ledger = {
    owed: (session) => {
      let done = turn.then(async () => {
        await update()
        let ids = [...by.get(session) ?? []]
        ids.forEach(drop)
        return read(ids)
      })
      turn = done.catch(() => {})
      return done
    },
  }
  ledgers.set(g, made)
  return made
}

// Every line owed to an outside session, each marked said as it is taken.
let owed = async (
  host: Door,
  id: Eid,
): Promise<{ item: Bundle; line: string }[]> => {
  let g = host.graph
  let out: { item: Bundle; line: string }[] = []
  for (let said of await pending(g, id, await ledger(host)?.owed(id))) {
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
export let reply = async (host: Door, call: Bundle): Promise<Bundle[]> => {
  let g = host.graph
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
  return (await owed(host, id)).map(({ item, line }) => ({
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
 *
 * The lines are marked said as they are taken, and `reaches` then asks the
 * door whether its answer can still reach the harness. A harness that gave up
 * on the hook while the lines were read and marked gets none of them, and
 * they stay owed for its next hook or `yak session listen`: a line said twice
 * beats a line lost.
 */
export let heard = async (
  host: Door,
  hook: Hook,
  reaches: () => Promise<boolean> = () => Promise.resolve(true),
): Promise<object> => {
  let g = host.graph
  if (!g.vocab.comp('notified')) return {}
  let said = typeof hook.session_id == 'string' ? hook.session_id : ''
  let session = said ? await sessionFor(g, said, [`${SESSION}.id`]) : undefined
  if (!session?.session) return {}
  let id = session.entity.eid
  if (!await hooked(g, id)) await g.apply([{ entity: { eid: id }, hooked: {} }])
  if (hook.agent_id) return {}
  let taken = await owed(host, id)
  if (!taken.length) return {}
  if (!await reaches()) {
    await undeliver(g, null, taken.map(({ item }) => item))
    return {}
  }
  return {
    hookSpecificOutput: {
      hookEventName: String(hook.hook_event_name ?? 'PostToolUse'),
      additionalContext: taken.map(({ line }) => line).join('\n'),
    },
  }
}
