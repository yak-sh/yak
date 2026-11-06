// Who hears a task change. A task's watchers are the session that filed it,
// every session whose own words mention its id (what it said, or what it was
// told; a tool's result is what it read, not what it said), the writer of any
// task, comment or letter whose text mentions it, and each actor whose
// @yaks/notify `subscription` watches it; an actor muting it hears nothing.
// When the task is completed, cancelled or answered, or someone comments on
// it, `session_watch` knocks each of them once (./listen.ts says the knock).
//
// A knock goes to the watcher's session while it can hear, and once that
// session is over, to its project's operator: the session a person opened for
// that project (`session.operator`) that spoke last and is not over, else the
// project itself, held for whoever works for it next. A watcher that is a
// persona or a project is that project's from the start. A person has an
// inbox, so nothing here knocks one.
//
// Each change knocks a target once, named for the target and the change, so
// two watchers routed to one session make one knock and a run that is tried
// again knocks nobody twice. Nobody is knocked about their own write. A
// person's comment already reaches the session that filed the task and the one
// holding it (./listen.ts), so those two are not knocked for it.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { human } from '@yaks/id'
import { CLAIM, SESSION } from './comp.ts'
import { ended } from './listen.ts'

type G = Pick<Graph, 'vocab' | 'read' | 'get' | 'apply'>

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

/** The operator of a project still able to hear: a session a person opened
 * wearing a persona homed there, not over, the one that spoke last. */
let operatorOf = async (g: G, project: Eid): Promise<Eid | undefined> => {
  if (!g.vocab.prop(SESSION, 'operator')) return
  let open = await g.read(
    `.${SESSION}.operator=true&.${SESSION}.persona.persona.home=${project}` +
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
 * its project's operator, else the project. Persons and anyone muting the
 * task are left out. */
export let targets = async (
  g: G,
  watching: Eid[],
  muting: Set<Eid>,
): Promise<Eid[]> => {
  let rows = new Map(
    (watching.length
      ? await g.get(
        watching,
        [SESSION, 'persona', 'project'].filter((c) => g.vocab.comp(c)),
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
    if (rows.get(w)?.[SESSION] && !gone.has(w)) {
      out.add(w)
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

/**
 * The knocks a change to a task owes its watchers: the task itself (a mark)
 * or a comment on it. None where `eid` is neither, the change is not one a
 * watcher hears, or every watcher wrote it or was told already.
 *
 * ```ts
 * import { knocks } from '@yaks/session'
 *
 * // await graph.apply(await knocks(graph, task), { trusted: true })
 * ```
 */
export let knocks = async (g: G, eid: Eid): Promise<Bundle[]> => {
  if (!g.vocab.comp('knock')) return []
  let [row] = await g.get([eid])
  let on = row?.comment ? str(comp(row, 'comment').target) : eid
  let [task] = on != eid ? await g.get([on]) : [row]
  if (!task?.task) return []
  let made = comp(row, 'created')
  let change: Change | undefined = row.comment
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
  // A person's comment reaches the session that filed the task, and the one
  // holding it, through ./listen.ts already.
  let [writer] = change.via ? await g.get([change.via], [SESSION]) : []
  if (row.comment && !writer?.[SESSION]) {
    let told = [str(comp(task, 'created').via), str(comp(task, CLAIM).session)]
    watching = watching.filter((w) => !told.includes(w))
  }
  watching = watching.filter((w) => w != change.via)
  let to = (await targets(g, watching, muting)).filter((t) => t != change.via)
  if (!to.length) return []
  let [who] = change.by ? await g.get([change.by], ['doc']) : []
  let name = who ? str(comp(who, 'doc').title) || human(g.vocab)(who) : ''
  let text = fold(change.text)
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
    knock: { target: n.target },
    doc: { body },
  }))
}

/** The code behind `session_watch`: knock the watchers of the task `eid` is,
 * or that the comment `eid` is on. */
export let watch = async (g: G, eid: Eid): Promise<void> => {
  let owed = await knocks(g, eid)
  if (owed.length) await g.apply(owed, { trusted: true })
}
