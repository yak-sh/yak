// What a session hears about its work, one line at a time: a comment on an
// entity it created or holds a lock on, a knock at it or at that entity, a letter
// delivered to it, a letter answering one it wrote. `yak session listen` is
// the command a harness runs under a monitor — Claude Code's Monitor tool reads
// each line a command prints as one event — so a running agent learns about its
// work while it works. With `once` it ends once it has said something, for a
// harness that wakes its agent when a background command ends (Claude Code's
// background Bash), so an idle agent is woken by what arrives. A wake costs
// such an agent a read of its whole context, so one wake carries all that is
// waiting: the command stays up through a quiet window after each line and
// ends when nothing new came in it, with everything that arrived meanwhile.
//
// A line is marked said as it is printed, so the printing is the delivery: the
// command's output goes to the agent's own harness, never to a file a second
// loop watches, which can vanish and take every line after it.
//
// Person-written comments on records a session created follow it without a
// claim; once it ends they are held for the project the record is filed under,
// just like mail. On a record a session holds, an outside session hears every
// comment but its own, and a native transcript only a person's: each input
// wakes it for a model turn.
//
// A person's comment on an open task that is not blocked is for the session at
// work on it, and for nobody else ({@link taken}): the holder hears it, and
// where no live session holds the task one is started on it with the comment
// as its first input (./start.ts). It follows neither the session that filed
// the task nor its project, so the operator is not asked to relay it.
// A reply is the old session's while it may still hear it, and the project's
// once it cannot. The session that wrote a letter hears the answer, wherever
// the far side sent it, until that session is over (its harness ended it, or
// its transcript stopped or failed). From then on the reply is held for the
// project it reached (the letter went out from the project's address, so the
// answer is routed to the project, @yaks/mail's `mail.target`), and the next
// session of that project hears it. A session's project is the home of the
// persona it wears (@yaks/persona's `persona.home`, "the project it works
// for"), with every project filed under that home at any depth, since a
// sub-project's work is done under its parent's persona (@yaks/project). A
// session wearing no persona has no project and hears only its own replies.
//
// A letter no session wrote to, or whose writer can no longer hear it, is the
// project's from the start: a new letter to the project's address (a platform
// alert, a person's feedback), an answer to a tracker's letter (another graph
// sent it, so this one never kept it), or to a letter that arrived here.
// Nobody else could ever hear it. An address filed under the project
// (@yaks/project's `filed.project` on an entity wearing @yaks/mail's `email`)
// is the project's too, since an entity wears one address: hello@yaks.app,
// where every platform letter asks to be answered, is filed under the
// platform's project, which wears hello@bot.yak.sh. A knock at the project is
// held the same way: the graph's own news for whoever works for it, such as
// a bug the tracker opened (@yaks/heal knocks with the task it files).
//
// What is held for a project a person operates is the operator's alone: a
// project is operated when a session a person opened (`session.operator`)
// wears a persona homed at it or at a project it is filed under. TaskMaster is
// such a session, and the agents it starts wear the same persona, so without
// this the first of them to call a tool would take the platform's feedback
// at its hook. While no operator can hear, the item stays held, and the next
// session a person opens for the project hears it. Only a project nobody has
// ever operated gives what is held for it to any session that works for it.
//
// "The next session" is one at work. A native transcript at rest (settled
// between turns, however long ago) hears only what is addressed to it, never
// what is held for its project: a settled transcript is never over, so every
// one the project ever ran would otherwise stay an heir, and each item would
// wake one to spend a model turn on news meant for a live line of work.
//
// Nothing starts a session for a held reply when none comes: it waits for
// one. Only a person's comment on an open task does (./start.ts).
//
// Where a project wears `helper`, what is addressed to its operator and no
// person wrote is a helper's to take (./routine.ts marks it `routine` as it is
// written, ./help.ts starts the helper): no session hears a marked item, so
// the operator's own is woken only by a person's words and a helper's hand-up.
//
// Each item is marked `notified` as it is said, so it is said once, including
// one that arrived while nothing was listening: a monitor that expired and was
// armed again hears the gap. A session never hears what it wrote itself, and a
// knock left at two addresses it hears (itself and its project) is said once.
//
// A line carries the item whole, so reading it needs no second command. A
// managed run's receipt (@yaks/spawn's completion: the run's report as a
// comment on its task that knocks whoever started it) is said as the knock it
// is, with where the task stands now.
//
// The graph is a file other processes write, so this reads it again every few
// seconds rather than waiting on commits: @yaks/client's `watch` hears only the
// commits made in its own process.

import type { Actor, Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { signed } from '@yaks/graph/provenance'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { human } from '@yaks/id'
import { statusOf } from '@yaks/task'
import {
  absent,
  type And,
  and,
  type Clause,
  eq,
  every,
  fields,
  type Input,
  list,
  or,
  present,
  walk,
} from '@yaks/query'
import { safe } from '@yaks/text'
import type { Vocab } from '@yaks/vocab'
import { CLAIM, SESSION } from './comp.ts'

let NOTIFIED = 'notified'
// A helper's to take (./help.ts): no session's listener says it.
let ROUTINE = 'routine'

let str = (v: unknown): string => typeof v == 'string' ? v : ''
let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let fold = (text: string): string => text.replace(/\s+/g, ' ').trim()
let value = (eids: Eid[]): Input => eids.length == 1 ? eids[0] : list(...eids)

/** The queries for what is addressed to one session and not yet said, with
 * every comment on what it holds unless `claimedComments` is false. Each
 * asks about one component the graph declares; a graph without knocks or
 * letters has nothing to hear about them. */
let addressedTo = (
  vocab: Vocab,
  session: Eid,
  claimedComments = true,
): And[] => {
  let has = (name: string) => !!vocab.comp(name)
  let unsaid = (...clauses: Clause[]) => and(...clauses, absent(NOTIFIED))
  return [
    ...has('comment') && claimedComments
      ? [
        unsaid(
          present('comment'),
          eq(`comment.target.${CLAIM}.session`, session),
        ),
      ]
      : [],
    ...has('knock')
      ? [
        unsaid(present('knock'), absent(ROUTINE), eq('knock.target', session)),
        unsaid(
          present('knock'),
          absent(ROUTINE),
          eq(`knock.target.${CLAIM}.session`, session),
        ),
      ]
      : [],
    ...has('deliver')
      ? [unsaid(present('deliver'), eq('deliver.to', session))]
      : [],
  ]
}

/** The sessions whose harness ended or whose transcript stopped or failed.
 * Late output cannot hide a stop; a settled turn is still live. */
export let ended = async (
  graph: Pick<Graph, 'read'>,
  sessions: Bundle[],
): Promise<Set<Eid>> => {
  let gone = sessions.filter((s) => comp(s, SESSION).ended == true)
  let live = sessions.filter((s) => comp(s, SESSION).ended != true)
  return new Set([
    ...gone,
    ...live.length
      ? await graph.read(and(
        eq('entity.eid', value(live.map((s) => s.entity.eid))),
        eq(`${SESSION}.status`, list('stopped', 'failed')),
        fields('entity.eid'),
      ))
      : [],
  ].map((s) => s.entity.eid))
}

let eids = (rows: Bundle[]): Eid[] => rows.map((b) => b.entity.eid)

/** The native transcripts among the sessions `clauses` pick, read with
 * `props`: no `process` running it outside the graph, no outside harness's
 * `log` read into it, and a `using` entry. The session's own row is asked
 * first, in a read of its own: in one statement SQLite looks for the `using`
 * through every candidate's entries whatever the tests beside it say, an
 * imported transcript's whole log included, on every pass of the bus. */
export let natives = async (
  graph: Pick<Graph, 'vocab' | 'read'>,
  clauses: Clause[],
  props: string[],
): Promise<Bundle[]> => {
  let own = eids(
    await graph.read(and(
      ...clauses,
      present(SESSION),
      ...graph.vocab.comp('process') ? [absent('process')] : [],
      ...graph.vocab.prop(SESSION, 'transcript')
        ? [absent(`${SESSION}.transcript`)]
        : [],
      fields('entity.eid'),
    )),
  )
  return own.length
    ? await graph.read(and(
      eq('entity.eid', value(own)),
      present('entries.using'),
      fields(...props),
    ))
    : []
}

// The transcript statuses of a turn in progress: the model or a tool owes it
// an answer.
let WORKING = ['pending', 'running']

/** Which of these native transcripts are at work, mid-turn: only such a one
 * hears what is held for its project. A status is read off the transcript's
 * entries, so it is asked of native transcripts alone, never of an outside
 * session's long log. */
export let atWork = async (
  graph: Pick<Graph, 'read'>,
  sessions: Eid[],
): Promise<Eid[]> =>
  sessions.length
    ? eids(
      await graph.read(and(
        eq('entity.eid', value(sessions)),
        eq(`${SESSION}.status`, list(...WORKING)),
        fields(`${SESSION}.persona`),
      )),
    )
    : []

/** Every project, by the project it is filed under (@yaks/project's
 * sub-projects, `filed.project`), or '' at the top. */
export type Projects = Map<Eid, Eid>

/** The graph's {@link Projects}: one read of the projects alone. A walk down
 * `filed.project` from a project would pass through every task filed there. */
export let projects = async (
  graph: Pick<Graph, 'vocab' | 'read'>,
): Promise<Projects> =>
  new Map(
    graph.vocab.prop('filed', 'project') && graph.vocab.comp('project')
      ? (await graph.read(and(present('project'), fields('filed.project'))))
        .map((b) => [b.entity.eid, str(comp(b, 'filed').project)])
      : [],
  )

/** A project and every project filed under it at any depth. */
export let below = (tree: Projects, project: Eid): Eid[] => {
  let found = [project], seen = new Set(found)
  for (let i = 0; i < found.length; i++) {
    for (let [p, parent] of tree) {
      if (parent == found[i] && !seen.has(p)) found.push(p), seen.add(p)
    }
  }
  return found
}

/** The projects a session works for: the home of the persona it wears, and
 * every project filed under that home at any depth, from `tree` when the
 * caller keeps one. None when it wears no persona. */
export let worksFor = async (
  graph: Pick<Graph, 'vocab' | 'read' | 'get'>,
  s: Bundle | undefined,
  tree?: Projects,
): Promise<Eid[]> => {
  let persona = str(comp(s, SESSION).persona)
  if (!persona || !graph.vocab.prop('persona', 'home')) return []
  let [worn] = await graph.read(
    and(eq('entity.eid', persona), fields('persona.home')),
  )
  let home = str(comp(worn, 'persona').home)
  return home ? below(tree ?? await projects(graph), home) : []
}

/** The projects among `reach` that no person operates: none of them is the
 * home, or filed under the home, of a persona a session a person opened
 * (`session.operator`) wears, whether or not that session can hear now. What
 * is held for an operated project waits for its operator. */
let unoperated = async (
  graph: Pick<Graph, 'vocab' | 'read' | 'get'>,
  reach: Eid[],
  tree?: Projects,
): Promise<Eid[]> => {
  if (!reach.length || !graph.vocab.prop(SESSION, 'operator')) return reach
  let worn = await graph.read(
    `.${SESSION}.operator=true&.${SESSION}.persona` +
      `&.fields=${SESSION}.persona`,
  )
  let personas = [...new Set(worn.map((b) => str(comp(b, SESSION).persona)))]
  let homes = personas.length ? await graph.get(personas, ['persona']) : []
  let run = homes.map((b) => str(comp(b, 'persona').home)).filter(Boolean)
  if (!run.length) return reach
  let known = tree ?? await projects(graph)
  let operated = new Set(run.flatMap((home) => below(known, home)))
  return reach.filter((p) => !operated.has(p))
}

/** The native transcripts at work that may hear these items once they are
 * held: mid-turn, each wearing a persona whose home is a project an item
 * reached, or a project that one is filed under. One settled between turns
 * hears none of it, and an outside session hears it on its own calls, so the
 * feed never reads either. Whether an item is held yet is {@link held}'s to
 * say. */
export let heirs = async (
  graph: Pick<Graph, 'vocab' | 'read' | 'get'>,
  letters: Bundle[],
): Promise<Eid[]> => {
  if (!graph.vocab.prop('persona', 'home')) return []
  // Many unread comments can share a target. Read each target's filing once
  // through this same caller's graph, then retain the items' project order.
  let targets = [
    ...new Set(
      letters.filter((b) => b.comment).map((b) =>
        str(comp(b, 'comment').target)
      ),
    ),
  ]
  let filed = new Map(
    (targets.length ? await graph.get(targets, ['filed']) : []).map((
      b,
    ) => [b.entity.eid, str(comp(b, 'filed').project)]),
  )
  let reached = [
    ...new Set(
      letters.map((b) =>
        b.comment
          ? filed.get(str(comp(b, 'comment').target)) ?? ''
          : str(comp(b, 'mail').target) || str(comp(b, 'knock').target)
      ).filter(Boolean),
    ),
  ]
  if (!reached.length) return []
  let homes = [
    ...new Set(
      [
        ...reached,
        ...graph.vocab.prop('filed', 'project') && graph.vocab.comp('project')
          ? eids(
            await graph.read(and(
              present('project'),
              or(...reached.map((p) => walk('filed.project', '<-', p))),
              fields('entity.eid'),
            )),
          )
          : [],
      ],
    ),
  ]
  // The native transcripts wearing a persona homed there, then those at work.
  // The status is a read of its own: in one statement SQLite reads it off
  // every session the path finds, outside ones included, before the tests
  // beside it.
  let homed = await natives(
    graph,
    [eq(`${SESSION}.persona.persona.home`, value(homes))],
    [`${SESSION}.persona`],
  )
  return atWork(graph, eids(homed))
}

/** The letters that reached these projects (any, left out), unsaid: every
 * arrival (no `deliver`), a new letter or an answer, whether or not this graph
 * kept the letter it answers. */
export let arrived = (projects?: Eid[]): And =>
  and(
    present('mail'),
    absent('deliver'),
    absent(ROUTINE),
    projects ? eq('mail.target', value(projects)) : present('mail.target'),
    absent(NOTIFIED),
  )

/** The knocks at these projects (any project, left out), unsaid, less those a
 * helper takes (./help.ts `routine`). */
export let knocked = (projects?: Eid[]): And =>
  and(
    present('knock'),
    absent(ROUTINE),
    projects
      ? eq('knock.target', value(projects))
      : present('knock.target.project'),
    absent(NOTIFIED),
  )

/** Which of these comments a session at work on their task takes up: a
 * person's, on an open task that is not blocked. The vocabulary's
 * `session_start` owes a start for one whose task no live session holds, by
 * these same tests. None in a graph that knows no person or task. */
export let taken = async (
  graph: Pick<Graph, 'vocab' | 'read'>,
  comments: Eid[],
): Promise<Set<Eid>> => {
  let has = (name: string) => !!graph.vocab.comp(name)
  if (!comments.length || !has('person') || !has('task')) return new Set()
  return new Set(eids(
    await graph.read(and(
      eq('entity.eid', value(comments)),
      present('created.by.person'),
      absent('created.via.session'),
      present('comment.target.task'),
      ...['completed', 'cancelled', 'blocked'].filter(has)
        .map((mark) => absent(`comment.target.${mark}`)),
      fields('entity.eid'),
    )),
  ))
}

/** Unsaid person-written comments on records filed under these projects and
 * created through a session. They are that session's while it can hear, then
 * the project's. */
export let commented = (projects?: Eid[]): And =>
  and(
    present('comment'),
    present('comment.target.created.via.session'),
    absent('created.via.session'),
    projects
      ? eq('comment.target.filed.project', value(projects))
      : present('comment.target.filed.project'),
    absent(NOTIFIED),
  )

/** The addresses filed under these projects: entities wearing `email` that
 * are not projects themselves. A letter to one reached the project. */
let addresses = async (
  graph: Pick<Graph, 'vocab' | 'read'>,
  projects: Eid[],
): Promise<Eid[]> =>
  graph.vocab.comp('email') && graph.vocab.prop('filed', 'project')
    ? (await graph.read(and(
      present('email'),
      absent('project'),
      eq('filed.project', value(projects)),
    ))).map((b) => b.entity.eid)
    : []

/** What is held for these projects, unsaid: every knock at one, each letter
 * that answers no letter or one no session wrote, and replies to letters or
 * comments on records created by another session that is over. */
export let held = async (
  graph: Pick<Graph, 'vocab' | 'read' | 'get'>,
  session: Eid,
  projects: Eid[],
): Promise<Bundle[]> => {
  if (!projects.length) return []
  let knocks = graph.vocab.comp('knock')
    ? await graph.read(and(...knocked(projects).clauses, every()))
    : []
  let filed =
    graph.vocab.comp('comment') && graph.vocab.prop('filed', 'project')
      ? await graph.read(and(...commented(projects).clauses, every()))
      : []
  // A comment a session at work takes up is never the project's.
  let working = await taken(graph, eids(filed))
  let comments = filed.filter((b) => !working.has(b.entity.eid))
  let reach = [...projects, ...await addresses(graph, projects)]
  let mail = graph.vocab.comp('mail')
    ? await graph.read(and(...arrived(reach).clauses, every()))
    : []
  let replies = [...mail, ...comments]
  if (!replies.length) return knocks
  let to = (b: Bundle) =>
    str(comp(b, 'comment').target) || str(comp(b, 'mail').reply_to)
  let answered = [...new Set(replies.map(to).filter(Boolean))]
  let writer = new Map(
    (answered.length ? await graph.get(answered, ['created']) : [])
      .map((b) => [b.entity.eid, str(comp(b, 'created').via)]),
  )
  let vias = [...new Set(writer.values())].filter(Boolean)
  let sessions = vias.length
    ? await graph.read(and(
      eq('entity.eid', value(vias)),
      present(SESSION),
      fields('session.ended'),
    ))
    : []
  let gone = await ended(graph, sessions.filter((s) => s.entity.eid != session))
  let wrote = new Set(sessions.map((s) => s.entity.eid))
  let by = (b: Bundle) => writer.get(to(b)) ?? ''
  return [
    ...knocks,
    ...replies.filter((b) =>
      gone.has(by(b)) || (!b.comment && !wrote.has(by(b)))
    ),
  ]
}

/** Who wrote an item: the run it came through, else the identity. */
let author = (b: Bundle): string =>
  str(comp(b, 'created').via) || str(comp(b, 'created').by)

// An item's words. A knock's ride in `doc` or, from a session's own notices
// (wake.ts), in `content{body}`; a letter delivered is said by its subject.
let words = (b: Bundle): string => {
  let doc = comp(b, 'doc')
  return fold(
    b.deliver
      ? str(doc.title)
      : str(doc.body) || str(doc.title) || str(comp(b, 'content').body),
  )
}

/** Who an item is said to be from: the session it came through, else the
 * identity that wrote it. A door that is no session (a web process a person
 * wrote through) is not who it is from. */
export let writer = (b: Bundle, sessions: Set<Eid>): string => {
  let { by, via } = comp(b, 'created')
  return sessions.has(str(via)) ? str(via) : str(by) || str(via)
}

/** One item as the line a monitor shows. `named` gives the readable id of an
 * entity the item points at, where it could be read, `state` where a task
 * it is about stands, and `by` who it is from ({@link writer}). */
export let said = (
  vocab: Vocab,
  b: Bundle,
  named: (eid: string) => string,
  state: (eid: string) => string = () => '',
  by = author(b),
): string => {
  let id = human(vocab)(b)
  let from = by ? ` from ${named(by)}` : ''
  let on = str(comp(b, 'comment').target)
  let stands = state(on) ? ` (${state(on)})` : ''
  let line = b.comment && b.knock
    ? `knock ${id} on ${named(on)}${stands}${from}`
    : b.comment
    ? `comment ${id} on ${named(on)}${from}`
    : b.knock
    ? `knock ${id} at ${named(str(comp(b, 'knock').target))}${from}`
    : `mail ${id} from ${str(comp(b, 'mail').from) || named(by)}`
  let text = words(b)
  return safe(text ? `${line}: ${text}` : line)
}

/** What {@link listen} needs besides the tool's own context. */
export type Ear = {
  /** where each line goes; the command line prints it */
  out: (line: string) => void
  /** how long to wait between reads, in milliseconds, or what to wait for */
  every: number | (() => Promise<void>)
  /** end once something was said and nothing new came for `quiet` */
  once?: boolean
  /** with `once`, how long nothing new must come before it ends, in
   * milliseconds (default 0: end with the first read that says anything) */
  quiet?: number
  /** the clock the quiet window is read from (default `Date.now`) */
  now?: () => number
  /** stops the loop when it aborts; a command under a monitor stops when its
   * process is killed, so this is for a program that runs it in-process */
  stop?: AbortSignal
}

let pause = (every: Ear['every'], stop?: AbortSignal) =>
  typeof every == 'function' ? every() : new Promise<void>((done) => {
    let finish = () => {
      clearTimeout(timer)
      stop?.removeEventListener('abort', finish)
      done()
    }
    let timer = setTimeout(finish, every)
    stop?.addEventListener('abort', finish, { once: true })
    if (stop?.aborted) finish()
  })

/** Select what this listener hears. Addressed items do not wait for a turn;
 * project-held items do, for native transcripts only. Read held items lazily:
 * a native transcript at rest must neither consume nor read its project's news.
 * Author exclusion and deduplication are shared by the native bus and outside
 * listeners. */
export let pendingItems = async (
  session: Eid,
  native: boolean,
  working: boolean,
  addressed: Bundle[],
  held: () => Bundle[] | Promise<Bundle[]>,
): Promise<Bundle[]> => {
  let seen = new Set<Eid>()
  let items: Bundle[] = []
  for (
    let b of [
      ...addressed,
      ...!native || working ? await held() : [],
    ]
  ) {
    if (
      seen.has(b.entity.eid) || author(b) == session
    ) {
      continue
    }
    seen.add(b.entity.eid)
    items.push(b)
  }
  return items
}

/** Unsaid items, and for the record each answers the session that created it
 * and, where asked, the session holding it, with the comments among them only
 * that holder hears ({@link taken}). */
export type Routes = {
  items: Bundle[]
  creators: Map<Eid, string>
  holders: Map<Eid, string>
  taken: Set<Eid>
}

/** The session an item follows for having created what it answers: none for a
 * comment a session at work takes up. */
export let creatorOf = (r: Routes, b: Bundle, on: string): string =>
  r.taken.has(b.entity.eid) ? '' : r.creators.get(on) ?? ''
/** What a caller already read for {@link pending}: the unsaid comments and
 * replies it may route, and the graph's projects when it keeps them. */
export type News = { comments: Routes; replies: Routes; projects?: Projects }

let routed = async (
  graph: Pick<Graph, 'vocab' | 'read'>,
  query: And,
  name: string,
  prop: string,
  ids?: Eid[],
  claimed = false,
): Promise<Routes> => {
  let none = new Map<Eid, string>()
  if (ids && !ids.length) {
    return { items: [], creators: none, holders: none, taken: new Set() }
  }
  let items = graph.vocab.comp(name)
    ? await graph.read(
      ids ? and(eq('entity.eid', value(ids)), ...query.clauses) : query,
    )
    : []
  let targets = [...new Set(items.map((b) => str(comp(b, name)[prop])))]
  let rows = targets.length
    ? await graph.read(and(
      eq('entity.eid', value(targets)),
      fields('created.via', ...claimed ? [`${CLAIM}.session`] : []),
    ))
    : []
  let by = (name: string, prop: string) =>
    new Map(rows.map((b) => [b.entity.eid, str(comp(b, name)[prop])]))
  return {
    items,
    creators: by('created', 'via'),
    holders: claimed ? by(CLAIM, 'session') : none,
    taken: claimed ? await taken(graph, eids(items)) : new Set(),
  }
}

/** Unread human comments, their targets' creators and the sessions holding
 * those targets, through the caller's scope: every one, or those among `ids`. */
export let comments = (
  graph: Pick<Graph, 'vocab' | 'read'>,
  ids?: Eid[],
): Promise<Routes> =>
  routed(
    graph,
    and(
      present('comment'),
      absent(NOTIFIED),
      absent('created.via.session'),
      fields('comment.target'),
    ),
    'comment',
    'target',
    ids,
    true,
  )

/** Unread replies and the writers they answer, without walking a writer's
 * work: every one, or those among `ids`. */
export let replies = (
  graph: Pick<Graph, 'vocab' | 'read'>,
  ids?: Eid[],
): Promise<Routes> =>
  routed(
    graph,
    and(
      present('mail.reply_to'),
      absent(NOTIFIED),
      absent(ROUTINE),
      fields('mail.reply_to', 'mail.target'),
    ),
    'mail',
    'reply_to',
    ids,
  )

/** One thing a session has yet to hear: the item, its readable line, and the
 * other knocks that say the same from the same writer, left at another
 * address the session hears (itself and its project, say). They are one
 * knock, said once and marked said together. */
export type Owed = { item: Bundle; line: string; same: Bundle[] }

/** What this session has yet to hear. */
export let pending = async (
  graph: Pick<Graph, 'vocab' | 'read' | 'get'>,
  session: Eid,
  news?: News,
): Promise<Owed[]> => {
  let vocab = graph.vocab
  // A person's comment on a record the session created or holds reaches
  // native and outside sessions alike, and one a session at work takes up
  // only its holder. An agent's comment on a held record reaches an outside
  // session only.
  let [owner] = await graph.read(
    and(
      eq('entity.eid', session),
      fields('session.persona', 'session.operator'),
    ),
  )
  let [process] = vocab.comp('process')
    ? await graph.get([session], ['process'])
    : []
  let native = !process?.process &&
    (await graph.read(
        `.entity.eid=${session}&.entries.using&.fields=entity.eid&.limit=1`,
      )).length > 0
  let addressed: Bundle[] = []
  // Restrict to unsaid human comments before inspecting the creator of each
  // target. A correlated target join scanned already-delivered history.
  let received = news ??
    { comments: await comments(graph), replies: await replies(graph) }
  let mine = (r: Routes, name: string, prop: string) =>
    r.items.filter((b) => {
      let on = str(comp(b, name)[prop])
      return creatorOf(r, b, on) == session || r.holders.get(on) == session
    }).map((b) => b.entity.eid)
  let ids = [
    ...mine(received.comments, 'comment', 'target'),
    ...mine(received.replies, 'mail', 'reply_to'),
  ]
  if (ids.length) addressed.push(...await graph.get(ids))
  let queries = addressedTo(vocab, session, !native)
  if (queries.length) {
    addressed.push(...await graph.read(and(or(...queries), every())))
  }
  // A session with no project can hear only its addressed items. Deriving
  // its transcript status cannot change that answer and reads its whole log.
  let reach = await worksFor(graph, owner, news?.projects)
  let working = !native ||
    (reach.length > 0 && (await atWork(graph, [session])).length > 0)
  // A session a person opened hears all that is held for its projects; any
  // other only what is held for projects nobody operates. Most passes find
  // nothing held, so the operators are read only when something is.
  let operator = comp(owner, SESSION).operator == true
  let owed = async () => {
    let found = await held(graph, session, reach)
    if (operator || !found.length) return found
    let open = await unoperated(graph, reach, news?.projects)
    return open.length == reach.length ? found : held(graph, session, open)
  }
  return owing(
    graph,
    await pendingItems(session, native, working, addressed, owed),
  )
}

/** These items as what is owed: each with its line, and a knock that says
 * the same as an earlier one from the same writer folded into that one. */
export let owing = async (
  graph: Pick<Graph, 'vocab' | 'get'>,
  items: Bundle[],
): Promise<Owed[]> => {
  if (!items.length) return []
  let vocab = graph.vocab
  let pointed = [
    ...new Set(
      items.flatMap((b) => [
        str(comp(b, 'comment').target),
        str(comp(b, 'knock').target),
        str(comp(b, 'created').via),
        str(comp(b, 'created').by),
      ]).filter(Boolean),
    ),
  ]
  let names = new Map<string, string>(), states = new Map<string, string>()
  let sessions = new Set<Eid>()
  for (let b of await graph.get(pointed)) {
    names.set(b.entity.eid, human(vocab)(b))
    if (b.task) states.set(b.entity.eid, statusOf(vocab, b) ?? '')
    if (b[SESSION]) sessions.add(b.entity.eid)
  }
  let named = (eid: string) => names.get(eid) ?? eid
  let state = (eid: string) => states.get(eid) ?? ''
  let out: Owed[] = [], knocks = new Map<string, Owed>()
  for (let item of items) {
    let key = item.knock && !item.comment && words(item)
      ? `${author(item)} ${words(item)}`
      : ''
    let first = knocks.get(key)
    if (first) {
      first.same.push(item)
      continue
    }
    let line = said(vocab, item, named, state, writer(item, sessions))
    let owed = { item, line, same: [] }
    if (key) knocks.set(key, owed)
    out.push(owed)
  }
  return out
}

/** Mark an item only if nobody has delivered it meanwhile, and with it the
 * knocks that say the `same` ({@link Owed}). What rides `together` lands in
 * that one committed batch or not at all: a native session's input, and for a
 * session started on the item, the session and its claim (./start.ts). A
 * guard among them that no longer holds leaves the item unmarked too. */
export let deliver = async (
  graph: Pick<Graph, 'apply'>,
  actor: Actor | null,
  item: Bundle,
  together: Bundle[] = [],
  same: Bundle[] = [],
): Promise<boolean> => {
  try {
    await graph.apply(signed([
      ...together,
      {
        entity: { eid: item.entity.eid },
        [NOTIFIED]: {},
        $was: { [NOTIFIED]: { at: token(null) } },
      },
      ...same.map((b) => ({ entity: { eid: b.entity.eid }, [NOTIFIED]: {} })),
    ], actor))
    return true
  } catch (error) {
    if (error instanceof Stale) return false
    throw error
  }
}

/** Take back the mark {@link deliver} set on items whose lines never reached
 * the session, so they are owed again. */
export let undeliver = async (
  graph: Pick<Graph, 'apply'>,
  actor: Actor | null,
  items: Bundle[],
): Promise<void> => {
  if (items.length) {
    await graph.apply(signed(
      items.map((b) => ({ entity: { eid: b.entity.eid }, [NOTIFIED]: null })),
      actor,
    ))
  }
}

/** One pass: say what is addressed to the session and mark each line said. */
export let hear = async (
  graph: Pick<Graph, 'vocab' | 'read' | 'get' | 'apply'>,
  actor: Actor | null,
  session: Eid,
  out: (line: string) => void,
): Promise<number> => {
  let count = 0
  for (let { item, line, same } of await pending(graph, session)) {
    out(line)
    if (!await deliver(graph, actor, item, [], same)) continue
    count++
  }
  return count
}

// How many quiet windows a `once` listener stays up at most after its first
// line. Knocks that keep coming inside each window would otherwise hold what
// was already said from the agent for as long as they came.
let HOLD = 6

/** Say everything addressed to the session as it arrives, until `stop`
 * aborts or, when `once`, until something was said and nothing new came for
 * `quiet`. */
export let listen = async (
  graph:
    & Pick<Graph, 'vocab' | 'read' | 'get' | 'apply'>
    & Partial<Pick<Graph, 'storage'>>,
  actor: Actor | null,
  session: Eid,
  ear: Ear,
): Promise<void> => {
  if (!graph.vocab.comp(NOTIFIED)) {
    throw new Error(
      'session listen marks what it said with `notified`, which @yaks/mail ' +
        'declares — compose that plugin',
    )
  }
  let first = true, prior: unknown
  let now = ear.now ?? Date.now, quiet = ear.quiet ?? 0
  let began: number | undefined, last = 0
  while (!ear.stop?.aborted) {
    // Sample before reading: a commit during hear must be read next beat.
    // SQLite revisions include other processes' commits; watch does not.
    let revision = await graph.storage?.revision?.()
    if (first || revision === undefined || revision !== prior) {
      first = false
      prior = revision
      let lines = 0
      await hear(graph, actor, session, (line) => (lines++, ear.out(line)))
      if (lines) {
        last = now()
        began ??= last
      }
    }
    if (
      ear.once && began !== undefined &&
      (now() - last >= quiet || now() - began >= quiet * HOLD)
    ) return
    await pause(ear.every, ear.stop)
  }
}
