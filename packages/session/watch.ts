// Who hears a task change. A task's watchers are the session that filed it,
// every session whose own words mention its id (what it said, or what it was
// told; a tool's result is what it read, not what it said), the writer of any
// task, comment or letter whose text mentions it, and each actor whose
// @yaks/notify `subscription` watches it; an actor muting it hears nothing.
// A person who commented on it watches it too: they spoke to that work.
// When the task is completed, cancelled or answered, or someone comments on
// it, `session_watch` knocks each of them once (./listen.ts says the knock).
//
// A knock goes to the watcher's session while it can hear, and once that
// session is over, to its project's operator: the session a person opened for
// that project (`session.operator`) that spoke last and is not over, else the
// project itself, held for whoever works for it next. A watcher that is a
// persona or a project is that project's from the start.
//
// A person hears through their assistant: the session standing here for the
// conversation they hold with it in another store (`session.person`,
// ./who.ts `standIn`), which whoever keeps that door passes on (@yaks/tunnel).
// Their comment carries no session, since a comment written through one is an
// agent's, so the watcher is the person and the session is found from them. A
// person with no such conversation is knocked nowhere, and nobody is told of
// their own act. A task assigned to a person knocks that same session, and
// nobody else: an assignment is news to the one it names.
//
// A person's assistant hears news, not traffic: work they spoke to finishing
// (completed, cancelled or answered), work newly assigned to them, and a
// comment that answers one of their own (`comment.reply_to`). Any other
// comment knocks no session standing for a person, however it watches.
//
// Each change knocks a target once, named for the target and the change, so
// two watchers routed to one session make one knock and a run that is tried
// again knocks nobody twice. A person's comment already reaches the session
// that filed the task and the one holding it (./listen.ts), so those two are
// not knocked for it.
//
// Nobody is knocked about their own write, and a session's subagents write
// for it: a subagent runs inside its parent's process and hands what it did
// back as the result of the parent's own call, so a knock about its comment
// would tell the parent what it just read (`writers`).
//
// One event is one knock. A managed run that ends leaves its whole report as
// a comment on its task that knocks whoever started it (`reported`, which
// @yaks/spawn's completion writes by). That receipt is the knock for
// the run's work on the task: the session it knocks is knocked neither for
// the comment a second time nor, a little earlier, for the run marking the
// task completed or cancelled.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { addressed, argsOf } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { human } from '@yaks/id'
import { CLAIM, SESSION } from './comp.ts'
import { ended, type Projects, projects, taken } from './listen.ts'

type G = Pick<Graph, 'vocab' | 'read' | 'get' | 'apply'>
// A reader that also resolves the ids a call was given (`T-12`) to eids.
type Addressing = G & Pick<Graph, 'address'>

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''
let fold = (text: string, max = 200): string => {
  let line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// A human id worth looking for in text: a prefix and a number. A bare hash is
// not how anyone mentions a task.
let NUMBERED = /^[A-Z]+-\d+$/

/** Whether `text` mentions `id` as a whole id, not the start of a longer one:
 * `T-14429` is not mentioned by `T-144294`. */
export let mentions = (text: string, id: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9-])${id}(?![0-9])`).test(text)

/** The sessions and actors that mention the task `id` names: the sessions
 * whose own entries do, and the writer of each other entity whose `doc.body`
 * does, by the session it came through or else the actor. */
let mentioners = async (g: G, task: Eid, id: string): Promise<Eid[]> => {
  if (!NUMBERED.test(id)) return []
  let said = g.vocab.prop('content', 'body') && g.vocab.comp('entry')
    ? await g.read(
      `.content.body~=${id}&.entry&!result&!notice` +
        `&.fields=entry.session,content.body&.limit=500`,
    )
    : []
  let written = g.vocab.prop('doc', 'body')
    ? await g.read(
      `${id}&.doc&.fields=created.by,created.via,doc.body&.limit=200`,
    )
    : []
  return [
    ...said.filter((b) => mentions(str(comp(b, 'content').body), id))
      .map((b) => str(comp(b, 'entry').session)),
    ...written.filter((b) =>
      b.entity.eid != task && mentions(str(comp(b, 'doc').body), id)
    ).map((b) => str(comp(b, 'created').via) || str(comp(b, 'created').by)),
  ].filter(Boolean)
}

/** The actors whose subscription to `task` is in `mode`. */
let subscribed = async (g: G, task: Eid, mode: string): Promise<Eid[]> =>
  g.vocab.prop('subscription', 'mode')
    ? (await g.read(
      `.subscription.target=${task}&.subscription.mode=${mode}` +
        `&.fields=subscription.actor`,
    )).map((b) => str(comp(b, 'subscription').actor)).filter(Boolean)
    : []

// A person's own words: by a person and through no session, as
// `session_start` reads a person's comment.
let OWN = `.created.by.person&!created.via.${SESSION}`

/** The people who commented on `task` themselves. */
let spoke = async (g: G, task: Eid): Promise<Eid[]> =>
  g.vocab.comp('person') && g.vocab.comp('comment')
    ? (await g.read(
      `.comment.target=${task}&${OWN}&.fields=created.by&.limit=500`,
    )).map((b) => str(comp(b, 'created').by)).filter(Boolean)
    : []

/** The person whose own comment `row` answers, if it answers one. */
let answered = async (g: G, row: Bundle): Promise<Eid> => {
  let to = str(comp(row, 'comment').reply_to)
  if (!to || !g.vocab.comp('person')) return ''
  let [own] = await g.read(
    `.entity.eid=${JSON.stringify(to)}&${OWN}&.fields=created.by`,
  )
  return str(comp(own, 'created').by)
}

/** The session standing here for the conversation `person` holds with their
 * assistant in another store (./who.ts `standIn`): the newest one said to
 * be theirs. */
export let standingFor = async (
  g: G,
  person: Eid,
): Promise<Eid | undefined> =>
  g.vocab.prop(SESSION, 'person')
    ? (await g.read(
      `.${SESSION}.person=${person}&.${SESSION}.door` +
        `&.order=-created.at&.limit=1&.fields=entity.eid`,
    ))[0]?.entity.eid
    : undefined

/** Everyone watching `task`, as sessions or actors, and those muting it. */
export let watchers = async (
  g: G,
  task: Bundle,
): Promise<{ watching: Eid[]; muting: Set<Eid> }> => {
  let made = comp(task, 'created')
  return {
    watching: [
      ...new Set([
        str(made.via) || str(made.by),
        ...await mentioners(g, task.entity.eid, human(g.vocab)(task)),
        ...await spoke(g, task.entity.eid),
        ...await subscribed(g, task.entity.eid, 'watch'),
      ].filter(Boolean)),
    ],
    muting: new Set(await subscribed(g, task.entity.eid, 'mute')),
  }
}

// The project a watcher answers to: a session's persona's home, a persona's
// home, or the project itself. None for anyone else.
let projectOf = (rows: Map<Eid, Bundle>, eid: Eid): Eid => {
  let b = rows.get(eid)
  if (b?.project) return eid
  let persona = b?.[SESSION] ? str(comp(b, SESSION).persona) : eid
  return str(comp(rows.get(persona), 'persona').home)
}

// A project and every project it is filed under, nearest first.
let above = (tree: Projects, project: Eid): Eid[] => {
  let found = [project]
  for (let up = tree.get(project); up && !found.includes(up);) {
    found.push(up)
    up = tree.get(up)
  }
  return found
}

/** The operator of a project still able to hear: a session a person opened
 * wearing a persona homed there or at a project it is filed under (the
 * projects ./listen.ts gives such a session what is held for), not over, the
 * one that spoke last. */
export let operatorOf = async (
  g: G,
  project: Eid,
): Promise<Eid | undefined> => {
  if (!g.vocab.prop(SESSION, 'operator')) return
  let homes = above(await projects(g), project)
  let open = await g.read(
    `.${SESSION}.operator=true` +
      `&.${SESSION}.persona.persona.home=${homes.join(',')}` +
      `&!${SESSION}.ended&.fields=${SESSION}.ended`,
  )
  let gone = await ended(g, open)
  let live = open.filter((s) => !gone.has(s.entity.eid))
  let last = await Promise.all(live.map(async (s) => {
    let [entry] = await g.read(
      `.entry.session=${s.entity.eid}&.order=-entry.seq&.limit=1` +
        `&.fields=created.at`,
    )
    return { eid: s.entity.eid, at: str(comp(entry, 'created').at) }
  }))
  return last.toSorted((a, b) => b.at.localeCompare(a.at))[0]?.eid
}

/** Where each watcher's knock goes: its session while that can hear, else
 * its project's operator, else the project. A person's goes to the session
 * standing for their conversation with their assistant ({@link standingFor}),
 * unless the act is their own (`by`). Anyone muting the task is left out, and
 * with `relay` false, so is a session that is over. */
export let targets = async (
  g: G,
  watching: Eid[],
  muting: Set<Eid>,
  relay = true,
  by?: Eid,
): Promise<Eid[]> => {
  let rows = new Map(
    (watching.length
      ? await g.get(
        watching,
        [SESSION, 'persona', 'project', 'person'].filter((c) =>
          g.vocab.comp(c)
        ),
      )
      : [])
      .map((b) => [b.entity.eid, b]),
  )
  let homes = [
    ...new Set(
      [...rows.values()].map((b) => str(comp(b, SESSION).persona))
        .filter(Boolean),
    ),
  ]
  let personas = homes.length && g.vocab.comp('persona')
    ? await g.get(homes, ['persona'])
    : []
  for (let b of personas) {
    rows.set(b.entity.eid, b)
  }
  let sessions = [...rows.values()].filter((b) => b[SESSION])
  let gone = await ended(g, sessions)
  let operators = new Map<Eid, Eid | undefined>()
  let out = new Set<Eid>()
  for (let w of watching) {
    let project = projectOf(rows, w)
    if (muting.has(w) || (project && muting.has(project))) continue
    if (rows.get(w)?.[SESSION]) {
      if (!gone.has(w)) out.add(w)
      if (!gone.has(w) || !relay) continue
    }
    if (rows.get(w)?.person) {
      let heard = w == by ? undefined : await standingFor(g, w)
      if (heard) out.add(heard)
      continue
    }
    if (!project) continue
    if (!operators.has(project)) {
      operators.set(project, await operatorOf(g, project))
    }
    out.add(operators.get(project) ?? project)
  }
  return [...out]
}

// How far a line of sessions is followed up before it stops: a longer one is
// a cycle someone wrote.
let DEPTH = 8

// What places a session in its line, read alone: the rest of `session` (its
// computed status above all) is derived from its whole log.
let placed = async (g: G, eid: Eid): Promise<Bundle | undefined> =>
  (await g.read(
    `.entity.eid=${JSON.stringify(eid)}&.${SESSION}&.fields=` +
      [`${SESSION}.source`, `${SESSION}.ended`, `${SESSION}.transcript`]
        .concat(g.vocab.comp('spawned') ? ['spawned.parent'] : [])
        .concat(g.vocab.comp('helping') ? ['helping.project'] : []).join(','),
  ))[0]

let managed = async (g: G, eid: Eid): Promise<Bundle | undefined> =>
  g.vocab.comp('process')
    ? (await g.get([eid], ['process', 'exit']))[0]
    : undefined

/** The sessions a write through `via` is the own write of: that session, and
 * while it is a subagent (a transcript its harness keeps in a file and runs
 * inside its parent's process, as a Claude Code subagent is), each session up
 * its line. A managed run or a native child is a line of work of its own. */
export let writers = async (g: G, via: Eid): Promise<Set<Eid>> => {
  let own = new Set<Eid>()
  for (let at = via; at && !own.has(at) && own.size < DEPTH;) {
    own.add(at)
    let s = await placed(g, at)
    let parent = str(comp(s, 'spawned').parent)
    at = parent && comp(s, SESSION).transcript &&
        !(await managed(g, at))?.process
      ? parent
      : ''
  }
  return own
}

// The task an id a call was given names, or none where it names nothing now.
let named = async (g: Addressing, id: string): Promise<Eid | ''> => {
  if (!id) return ''
  try {
    return (await addressed(g, [id], 'task'))[0]
  } catch (error) {
    if (error instanceof Refused) return ''
    throw error
  }
}

/**
 * Where a managed run's ending is reported: the task its spawn call names,
 * else the tasks it holds, and the session to knock, which is the one that
 * started it or, that one being over, the nearest up its own line that can
 * still hear. @yaks/spawn's completion writes its receipt by this, and
 * {@link knocks} leaves that receipt to be the one knock. A helper's own
 * ending (./help.ts) knocks nobody: what it did is in the graph, and what
 * needs its operator it handed up itself.
 *
 * ```ts
 * import { reported } from '@yaks/session'
 *
 * // let { tasks, to } = await reported(graph, run)
 * ```
 */
export let reported = async (
  g: Addressing,
  run: Eid,
): Promise<{ tasks: Eid[]; to?: Eid }> => {
  let row = await placed(g, run)
  let source = str(comp(row, SESSION).source)
  let [call] = source ? await g.get([source], ['call', 'entry', 'created']) : []
  // Claims may already have been released by the terminal-entry effect, or
  // by the agent itself. The originating spawn call still names its task, as
  // its caller wrote it (`T-12`).
  let task = call?.call ? await named(g, str(argsOf(call).task)) : ''
  let tasks = task
    ? [task]
    : g.vocab.comp('task')
    ? (await g.read(`.task&.${CLAIM}.session=${run}`)).map((b) => b.entity.eid)
    : []
  if (row?.helping) return { tasks }
  let seen = new Set<Eid>([run])
  let at = str(comp(row, 'spawned').parent) ||
    str(comp(call, 'entry').session) || str(comp(call, 'created').via)
  while (at && !seen.has(at) && seen.size < DEPTH) {
    seen.add(at)
    let s = await placed(g, at)
    if (!s) break
    if (!(await ended(g, [s])).has(at)) return { tasks, to: at }
    at = str(comp(s, 'spawned').parent)
  }
  return { tasks }
}

// Who hears a change another way, so is not knocked for it: the session a
// comment itself knocks, and, for a mark a managed run made while still at
// work on the task, whoever its receipt will knock.
let told = async (
  g: Addressing,
  row: Bundle,
  task: Eid,
  via: Eid,
): Promise<Eid[]> => {
  if (row.comment) return [str(comp(row, 'knock').target)].filter(Boolean)
  let run = via ? await managed(g, via) : undefined
  if (!run?.process || run.exit) return []
  let { tasks, to } = await reported(g, via)
  return to && tasks.includes(task) ? [to] : []
}

/** A change worth telling: what happened, what it says (the task's title, or
 * the comment's words), who did it and through what. */
type Change = { key: string; what: string; text: string; by: Eid; via: Eid }

// A task's newest mark: answered, completed or cancelled.
let marked = (g: G, task: Bundle): Change | undefined => {
  let id = human(g.vocab)(task)
  let decided = comp(task, 'decided')
  let mark = task.decided && task.completed
    ? { name: 'decided', what: `${id} answered "${str(decided.choice)}"` }
    : task.cancelled
    ? { name: 'cancelled', what: `${id} cancelled` }
    : task.completed
    ? { name: 'completed', what: `${id} completed` }
    : undefined
  if (!mark) return
  let c = comp(task, mark.name)
  let reason = mark.name == 'cancelled' && str(c.reason)
    ? ` (${fold(str(c.reason))})`
    : ''
  return {
    key: `${task.entity.eid} ${mark.name} ${str(c.at)}`,
    what: `${mark.what}${reason}`,
    text: str(comp(task, 'doc').title),
    by: str(c.by),
    via: str(c.via),
  }
}

// An open task's assignment to a person, as it stands: to whom, and by its
// last writer. `at` is when the commit that assigned it owed its run, so each
// assignment is a change of its own and a run tried again is the same one.
let assigned = async (
  g: G,
  task: Bundle,
  at = '',
): Promise<Change & { to: Eid } | undefined> => {
  let to = str(comp(task, 'filed').assignee)
  if (!to || task.completed || task.cancelled) return
  let [who] = await g.get(
    [to],
    ['doc', 'person'].filter((c) => g.vocab.comp(c)),
  )
  if (!who?.person) return
  let wrote = comp(task, 'updated').by ? 'updated' : 'created'
  return {
    to,
    key: `${task.entity.eid} assigned ${to} ${at}`,
    what: `${human(g.vocab)(task)} assigned to ${
      str(comp(who, 'doc').title) || human(g.vocab)(who)
    }`,
    text: str(comp(task, 'doc').title),
    by: str(comp(task, wrote).by),
    via: str(comp(task, wrote).via),
  }
}

/** The change a run of `session_watch` is for: the component that moved
 * (`filed` for an assignment) and when its commit owed the run. */
export type Moved = { name?: string; at?: string }

/**
 * The knocks a change to a task owes its watchers: the task itself (a mark)
 * or a comment on it. None where `eid` is neither, the change is not one a
 * watcher hears, or every watcher wrote it or was told already. Where what
 * `moved` is the task's `filed`, the change is its assignment, owed to the
 * person it names alone.
 *
 * ```ts
 * import { knocks } from '@yaks/session'
 *
 * // await graph.apply(await knocks(graph, task), { trusted: true })
 * ```
 */
export let knocks = async (
  g: Addressing,
  eid: Eid,
  moved: Moved = {},
): Promise<Bundle[]> => {
  if (!g.vocab.comp('knock')) return []
  let [row] = await g.get([eid])
  let on = row?.comment ? str(comp(row, 'comment').target) : eid
  let [task] = on != eid ? await g.get([on]) : [row]
  if (!task?.task) return []
  let made = comp(row, 'created')
  let given = moved.name == 'filed'
    ? await assigned(g, task, moved.at)
    : undefined
  let change: Change | undefined = moved.name == 'filed'
    ? given
    : row.comment
    ? {
      key: `${eid} comment`,
      what: `${human(g.vocab)(row)} on ${human(g.vocab)(task)}`,
      text: str(comp(row, 'doc').body),
      by: str(made.by),
      via: str(made.via),
    }
    : marked(g, task)
  if (!change) return []
  let { watching, muting } = await watchers(g, task)
  if (given) watching = [given.to]
  let replied = row.comment ? await answered(g, row) : ''
  // A person's comment reaches the session that filed the task, and the one
  // holding it, through ./listen.ts already.
  let [writer] = change.via ? await g.get([change.via], [SESSION]) : []
  if (row.comment && !writer?.[SESSION]) {
    let told = [str(comp(task, 'created').via), str(comp(task, CLAIM).session)]
    watching = watching.filter((w) => !told.includes(w))
  }
  let own = change.via ? await writers(g, change.via) : new Set<Eid>()
  let knows = new Set([
    ...own,
    ...await told(g, row, task.entity.eid, change.via),
  ])
  watching = watching.filter((w) => !own.has(w))
  let worked = !!row.comment && (await taken(g, [eid])).has(eid)
  let to = (await targets(g, watching, muting, !worked, change.by))
    .filter((t) => !knows.has(t))
  // A comment reaches a person's assistant only when it answers them.
  if (row.comment && to.length) {
    let stood = new Map(
      (await g.get(to, [SESSION])).map((b) => [
        b.entity.eid,
        str(comp(b, SESSION).person),
      ]),
    )
    to = to.filter((t) => [replied, ''].includes(stood.get(t) ?? ''))
  }
  if (!to.length) return []
  let [who] = change.by ? await g.get([change.by], ['doc']) : []
  let name = who ? str(comp(who, 'doc').title) || human(g.vocab)(who) : ''
  // The words whole: a knock cut short costs its reader a second command,
  // and with it a second read of its whole context.
  let text = fold(change.text, Infinity)
  let body = `${change.what}${name ? ` by ${name}` : ''}` +
    (text ? `: ${text}` : '')
  let named = to.map((target) => ({
    target,
    eid: derivedEid(`session watch ${target} ${change.key}`),
  }))
  let had = new Set(
    (await g.get(named.map((n) => n.eid), ['knock']))
      .filter((b) => b.knock).map((b) => b.entity.eid),
  )
  return named.filter((n) => !had.has(n.eid)).map((n) => ({
    entity: { eid: n.eid },
    knock: { target: n.target, ...change.by ? { from: change.by } : {} },
    doc: { body },
  }))
}

/** The code behind `session_watch`: knock the watchers of the task `eid` is,
 * or that the comment `eid` is on, for what `moved`. */
export let watch = async (
  g: Addressing,
  eid: Eid,
  moved?: Moved,
): Promise<void> => {
  let owed = await knocks(g, eid, moved)
  if (owed.length) await g.apply(owed, { trusted: true })
}
