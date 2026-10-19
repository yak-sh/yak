// What a session hears about its work, one line at a time: a comment on an
// entity it created or holds a lock on, a knock at it or at that entity, a letter
// delivered to it, a letter answering one it wrote. `yak session listen` is
// the command a harness runs under a monitor — Claude Code's Monitor tool reads
// each line a command prints as one event — so a running agent learns about its
// work while it works. With `once` it ends at the first lines it says, for a
// harness that wakes its agent when a background command ends (Claude Code's
// background Bash), so an idle agent is woken by what arrives.
//
// A line is marked said as it is printed, so the printing is the delivery: the
// command's output goes to the agent's own harness, never to a file a second
// loop watches, which can vanish and take every line after it.
//
// Person-written comments on records a session created follow it without a
// claim; once it ends they are held for the project the record is filed under,
// just like mail.
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
// "The next session" is one at work. A native transcript at rest (settled
// between turns, however long ago) hears only what is addressed to it, never
// what is held for its project: a settled transcript is never over, so every
// one the project ever ran would otherwise stay an heir, and each item would
// wake one to spend a model turn on news meant for a live line of work.
//
// Nothing starts a session when none comes: a held reply waits for one. That
// is where a managed spawn will plug in, once T-95308 lifts the ban on
// starting sessions (C-121250) and the owner picks its provider, model and
// spend: an owing (D-121352) on the rows {@link held} reads, a letter nobody
// else can hear and that nobody has heard, starting @yaks/spawn's run in the
// project's checkout with the thread as its brief and the project's common
// persona as its own. The session it starts is then a session of the project,
// and hears the reply through this same rule.
//
// Each item is marked `notified` as it is said, so it is said once, including
// one that arrived while nothing was listening: a monitor that expired and was
// armed again hears the gap. A session never hears what it wrote itself.
//
// The graph is a file other processes write, so this reads it again every few
// seconds rather than waiting on commits: @yaks/client's `watch` hears only the
// commits made in its own process.

import type { Actor, Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { signed } from '@yaks/graph/provenance'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { human } from '@yaks/id'
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

let str = (v: unknown): string => typeof v == 'string' ? v : ''
let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let fold = (text: string): string => text.replace(/\s+/g, ' ').trim()
let value = (eids: Eid[]): Input => eids.length == 1 ? eids[0] : list(...eids)

/** The queries for what is addressed to one session and not yet said. Each
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
        unsaid(present('knock'), eq('knock.target', session)),
        unsaid(present('knock'), eq(`knock.target.${CLAIM}.session`, session)),
      ]
      : [],
    ...has('deliver')
      ? [unsaid(present('deliver'), eq('deliver.to', session))]
      : [],
  ]
}

/** Whether a session is over: its harness ended it, or its transcript
 * stopped or failed. One between turns is not. */
export let over = async (
  graph: Pick<Graph, 'read'>,
  s: Bundle,
): Promise<boolean> => {
  if (comp(s, SESSION).ended == true) return true
  // Late results can follow a stop without reopening it. The graph's status
  // reads that boundary; a tail of entries can hide it.
  return (await graph.read(and(
    eq('entity.eid', s.entity.eid),
    eq(`${SESSION}.status`, list('stopped', 'failed')),
    fields('entity.eid'),
  ))).length > 0
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
      ...graph.vocab.prop(SESSION, 'log') ? [absent(`${SESSION}.log`)] : [],
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

// Which of these native transcripts are at work, mid-turn: only such a one
// hears what is held for its project. A status is read off the transcript's
// entries, so it is asked of native transcripts alone, never of an outside
// session's long log.
let atWork = async (
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

// A project and the projects filed under it at any depth (`->`), or above it
// (`<-`): @yaks/project's sub-projects, read through `filed.project`.
let family = async (
  graph: Pick<Graph, 'vocab' | 'read'>,
  project: Eid,
  dir: '->' | '<-',
): Promise<Eid[]> => [
  project,
  ...graph.vocab.prop('filed', 'project') && graph.vocab.comp('project')
    ? (await graph.read(
      and(present('project'), walk('filed.project', dir, project)),
    )).map((b) => b.entity.eid)
    : [],
]

/** The projects a session works for: the home of the persona it wears, and
 * every project filed under that home at any depth. None when it wears no
 * persona. */
export let worksFor = async (
  graph: Pick<Graph, 'vocab' | 'read' | 'get'>,
  s: Bundle | undefined,
): Promise<Eid[]> => {
  let persona = str(comp(s, SESSION).persona)
  if (!persona || !graph.vocab.prop('persona', 'home')) return []
  let [worn] = await graph.read(
    and(eq('entity.eid', persona), fields('persona.home')),
  )
  let home = str(comp(worn, 'persona').home)
  return home ? await family(graph, home, '->') : []
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
      (await Promise.all(reached.map((p) => family(graph, p, '<-')))).flat(),
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
    projects ? eq('mail.target', value(projects)) : present('mail.target'),
    absent(NOTIFIED),
  )

/** The knocks at these projects (any project, left out), unsaid. */
export let knocked = (projects?: Eid[]): And =>
  and(
    present('knock'),
    projects
      ? eq('knock.target', value(projects))
      : present('knock.target.project'),
    absent(NOTIFIED),
  )

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
  let comments =
    graph.vocab.comp('comment') && graph.vocab.prop('filed', 'project')
      ? await graph.read(and(...commented(projects).clauses, every()))
      : []
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
  let gone = new Set<Eid>()
  for (let s of sessions) {
    if (s.entity.eid != session && await over(graph, s)) gone.add(s.entity.eid)
  }
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

/** One item as the line a monitor shows. `named` gives the readable id of an
 * entity the item points at, where it could be read. */
export let said = (
  vocab: Vocab,
  b: Bundle,
  named: (eid: string) => string,
): string => {
  let id = human(vocab)(b)
  let doc = comp(b, 'doc')
  let text = fold(str(doc.body) || str(doc.title))
  let from = author(b) ? ` from ${named(author(b))}` : ''
  let line = b.comment
    ? `comment ${id} on ${named(str(comp(b, 'comment').target))}${from}`
    : b.knock
    ? `knock ${id} at ${named(str(comp(b, 'knock').target))}${from}`
    : `mail ${id} from ${str(comp(b, 'mail').from) || named(author(b))}`
  let words = b.deliver ? fold(str(doc.title)) : text
  return safe(words ? `${line}: ${words}` : line)
}

/** What {@link listen} needs besides the tool's own context. */
export type Ear = {
  /** where each line goes; the command line prints it */
  out: (line: string) => void
  /** how long to wait between reads, in milliseconds, or what to wait for */
  every: number | (() => Promise<void>)
  /** end after the first read that says anything */
  once?: boolean
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

type Routes = { items: Bundle[]; creators: Map<Eid, string> }
export type News = { comments: Routes; replies: Routes }

let routed = async (
  graph: Pick<Graph, 'vocab' | 'read'>,
  query: And,
  name: string,
  prop: string,
): Promise<Routes> => {
  let items = graph.vocab.comp(name) ? await graph.read(query) : []
  let targets = [...new Set(items.map((b) => str(comp(b, name)[prop])))]
  let rows = targets.length
    ? await graph.read(and(
      eq('entity.eid', value(targets)),
      fields('created.via'),
    ))
    : []
  return {
    items,
    creators: new Map(
      rows.map((b) => [b.entity.eid, str(comp(b, 'created').via)]),
    ),
  }
}

/** Unread human comments and their targets' creators, through the caller's scope. */
export let comments = (graph: Pick<Graph, 'vocab' | 'read'>): Promise<Routes> =>
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
  )

/** Unread replies and the writers they answer, without walking a writer's work. */
export let replies = (graph: Pick<Graph, 'vocab' | 'read'>): Promise<Routes> =>
  routed(
    graph,
    and(
      present('mail.reply_to'),
      absent(NOTIFIED),
      fields('mail.reply_to', 'mail.target'),
    ),
    'mail',
    'reply_to',
  )

/** What this session has yet to hear, as the item and its readable line. */
export let pending = async (
  graph: Pick<Graph, 'vocab' | 'read' | 'get'>,
  session: Eid,
  news?: News,
): Promise<{ item: Bundle; line: string }[]> => {
  let vocab = graph.vocab
  // Ordinary claimed-thread comments stay out of native transcripts. Replies
  // on records a session created reach native and outside sessions alike.
  let [owner] = await graph.read(
    and(
      eq('entity.eid', session),
      fields('session.persona'),
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
    r.items.filter((b) => r.creators.get(str(comp(b, name)[prop])) == session)
      .map((b) => b.entity.eid)
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
  let projects = await worksFor(graph, owner)
  let working = !native ||
    (projects.length > 0 && (await atWork(graph, [session])).length > 0)
  let items = await pendingItems(
    session,
    native,
    working,
    addressed,
    () => held(graph, session, projects),
  )
  if (!items.length) return []
  let pointed = [
    ...new Set(
      items.flatMap((b) => [
        str(comp(b, 'comment').target),
        str(comp(b, 'knock').target),
        author(b),
      ]).filter(Boolean),
    ),
  ]
  let names = new Map<string, string>()
  for (let b of await graph.get(pointed)) {
    names.set(b.entity.eid, human(vocab)(b))
  }
  let named = (eid: string) => names.get(eid) ?? eid
  return items.map((item) => ({ item, line: said(vocab, item, named) }))
}

/** Mark an item only if nobody has delivered it meanwhile. The optional
 * entry makes a native session's input and the mark one committed batch. */
export let deliver = async (
  graph: Pick<Graph, 'apply'>,
  actor: Actor | null,
  item: Bundle,
  entry?: Bundle,
): Promise<boolean> => {
  try {
    await graph.apply(signed([
      ...entry ? [entry] : [],
      {
        entity: { eid: item.entity.eid },
        [NOTIFIED]: {},
        $was: { [NOTIFIED]: { at: token(null) } },
      },
    ], actor))
    return true
  } catch (error) {
    if (error instanceof Stale) return false
    throw error
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
  for (let { item, line } of await pending(graph, session)) {
    out(line)
    if (!await deliver(graph, actor, item)) continue
    count++
  }
  return count
}

/** Say everything addressed to the session as it arrives, until `stop`
 * aborts, or until the first read that says anything when `once`. */
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
  while (!ear.stop?.aborted) {
    // Sample before reading: a commit during hear must be read next beat.
    // SQLite revisions include other processes' commits; watch does not.
    let revision = graph.storage?.revision?.()
    if (first || revision === undefined || revision !== prior) {
      first = false
      prior = revision
      let lines = 0
      await hear(graph, actor, session, (line) => (lines++, ear.out(line)))
      if (ear.once && lines) return
    }
    await pause(ear.every, ear.stop)
  }
}
