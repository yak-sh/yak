// A project's helper: the run that takes what waits for its operator, so the
// operator's own session, with its whole context, is not woken for it.
//
// ./routine.ts marks a knock `routine{project}` in the write that leaves it.
// `session_help` runs after that commit and starts the helper: one session
// wearing the project's `helper{persona}`, marked `helping{project}`, whose
// first input is every routine knock waiting, each said whole as a listener
// would say it and marked `notified` in the same write. That input carries
// `using`, so the run is started the way any is: by whatever answers a
// `using` (@yaks/spawn for a command-line provider).
//
// One helper is at work at a time, and it takes everything waiting, so a
// storm of bugs is one helper's batch. Knocks that come while it works wait
// for its `exit`, which asks again. Two workers racing to start one read the
// same waiting knocks, and the guard on each knock's `notified` lets one
// write through.
//
// Only a hand-up reaches the operator: a knock written through a helper,
// which ./routine.ts leaves unmarked. The helper writes its own with
// `session_handup` ({@link handed}), and so does a session opened on a topic,
// which is no helper and has no other way to reach another session. This file
// writes two, each naming what the helper had taken: one that ended badly,
// and one the next routine item stops because it said nothing for
// {@link QUIET} or was still going after {@link LIMIT}. A run that has said
// its last words can linger for good on a background command it started, and
// everything behind it would wait.
//
// A run's ending and a task's mark are not routine to the session that
// started the run or watches the task, only their reading is. When a helper
// exits, each task it took one for reaches that session as one line: the
// task, its verdict as the helper leaves it (done, cancelled, not ready, or
// ended early for a run that did not end cleanly), and the report's id.
//
// The helpers' trail is `.helping.project=<project>`: each session, with what
// it wrote under `.created.via=<session>` and the knocks it took under
// `.notified.via=<session>`.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { mint } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { signed } from '@yaks/graph/provenance'
import { token } from '@yaks/graph/sha256'
import { human } from '@yaks/id'
import { absent, and, eq, every, fields, present } from '@yaks/query'
import { SESSION } from './comp.ts'
import { ended as over, type Owed, owing, worksFor } from './listen.ts'
import { HELPER, HELPING, ROUTINE } from './routine.ts'
import { operatorOf } from './watch.ts'
import { STOP_ENTRY } from './native.ts'
import { cleanEnd } from './wake.ts'
import { statusOf } from '@yaks/task'

type G = Pick<Graph, 'vocab' | 'read' | 'get' | 'apply'>

/** How long a helper may go on before the next routine item stops it and
 * starts another (ms). */
export let LIMIT = 30 * 60_000

/** How long a helper may say nothing, its transcript gaining no entry, before
 * the next routine item stops it and starts another (ms). */
export let QUIET = 5 * 60_000

/** What a test holds still: the clock, {@link LIMIT} and {@link QUIET}. */
export type Opts = { now?: () => number; limit?: number; quiet?: number }

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''
let s = (n: number) => n == 1 ? '' : 's'
let unique = (ids: string[]): Eid[] => [...new Set(ids.filter(Boolean))]

// A turn the model or a tool owes an answer: a helper not yet launched.
let WORKING = ['pending', 'running']

/** The routine knocks and letters waiting for a project's helper. */
export let waiting = (g: G, project: Eid): Promise<Bundle[]> =>
  Promise.resolve(g.read(and(
    eq(`${ROUTINE}.project`, project),
    absent('notified'),
    every(),
  )))

// Who hears a project's hand-up: its operator while one can hear, else the
// project, where it waits for the next session a person opens.
let hears = async (g: G, project: Eid): Promise<Eid> =>
  await operatorOf(g, project) ?? project

/** The knock `session` hands up with: one line at the operator of the project
 * it works for (a helper's `helping.project`, else the home of the persona it
 * wears), led by the id of the entity it concerns. The door writes it through
 * that session, which is what makes it a hand-up for a helper and for a
 * session opened on a topic (./routine.ts). None where the session works for
 * no project. */
export let handed = async (
  g: G,
  session: Eid,
  about: Eid,
  line: string,
): Promise<Bundle | undefined> => {
  let [from] = await g.get([session], [HELPING, SESSION])
  let project = str(comp(from, HELPING).project) ||
    (await worksFor(g, from))[0]
  if (!project) return
  let [concerns] = await g.get([about])
  return {
    entity: { eid: '$knock' },
    knock: { target: await hears(g, project), about },
    doc: { body: `${human(g.vocab)(concerns)}: ${line.trim()}` },
  }
}

// A knock at the operator written through `helper`, which makes it a hand-up
// (./routine.ts). Named for what it tells, so a run again tells it once.
let handUp = async (
  g: G,
  helper: Bundle,
  key: string,
  body: string,
  to?: Eid,
) => {
  to ??= await hears(g, str(comp(helper, HELPING).project))
  try {
    await g.apply(
      signed([{
        entity: {
          eid: derivedEid(`session help ${key} ${helper.entity.eid}`),
        },
        knock: { target: to },
        doc: { body },
        $was: { knock: { target: null } },
      }], { via: helper.entity.eid }),
      { trusted: true },
    )
  } catch (error) {
    if (!(error instanceof Stale)) throw error
  }
}

// What a helper had taken, as the ids a reader looks them up by.
let taken = async (g: G, helper: Eid): Promise<string> => {
  let held = await g.read(and(
    present(ROUTINE),
    eq('notified.via', helper),
    every(),
  ))
  return held.length
    ? `${held.length} taken and maybe not handled: ` +
      held.map(human(g.vocab)).join(', ')
    : 'nothing taken'
}

// The helpers of a project that are not over: no `exit`, nobody asked to
// stop, and a process running or a first turn still owed.
let going = async (g: G, project: Eid): Promise<Bundle[]> => {
  let has = (name: string) => !!g.vocab.comp(name)
  let rows = await g.read(and(
    eq(`${HELPING}.project`, project),
    ...['exit', 'stop'].filter(has).map((name) => absent(name)),
    fields(
      `${HELPING}.project`,
      'created.at',
      `${SESSION}.status`,
      ...has('process') ? ['process.pid'] : [],
    ),
  ))
  return rows.filter((b) =>
    b.process || WORKING.includes(str(comp(b, SESSION).status))
  )
}

// A transcript's newest entry.
let newest = async (g: G, session: Eid): Promise<Bundle | undefined> =>
  (await g.read(`.entry.session=${session}&.order=-entry.seq&.limit=1&*`))[0]

let fold = (text: string, max: number): string => {
  let line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}

// Whether a helper is at work for the project. One that said nothing for
// `quiet`, or is past the limit, is asked to stop and handed up with its last
// words, and does not count: what waits behind it would otherwise wait for
// good.
let atWork = async (g: G, project: Eid, o: Opts): Promise<boolean> => {
  let now = (o.now ?? Date.now)()
  let limit = o.limit ?? LIMIT, quiet = o.quiet ?? QUIET
  let since = (b: Bundle | undefined) =>
    now - Date.parse(str(comp(b, 'created').at))
  let min = (ms: number) => Math.round(ms / 60_000)
  let busy = false
  for (let b of await going(g, project)) {
    let last = await newest(g, b.entity.eid)
    let over = since(b) >= limit
    if (!over && since(last ?? b) < quiet) {
      busy = true
      continue
    }
    await g.apply([{ entity: { eid: b.entity.eid }, stop: {} }])
    let words = last?.output ? fold(str(comp(last, 'content').body), 200) : ''
    await handUp(
      g,
      b,
      'overdue',
      `helper ${human(g.vocab)(b)} ` +
        (over
          ? `was still going after ${min(limit)} min`
          : `said nothing for ${min(quiet)} min`) +
        ` and was stopped, with ${await taken(g, b.entity.eid)}` +
        (words ? `. Its last words: ${words}` : ''),
    )
  }
  return busy
}

// What a helper is told: whose place it takes, how to hand up, and each
// waiting knock whole. How each kind is handled is its persona's to say.
let brief = (g: G, home: Bundle, owed: Owed[]): string => {
  let name = human(g.vocab)
  let project = [name(home), str(comp(home, 'doc').title)].filter(Boolean)
    .join(' ')
  return [
    `You are the helper of ${project}'s operator. ${owed.length} ` +
    `item${s(owed.length)} arrived for the operator and ${
      owed.length == 1 ? 'is' : 'are'
    } yours to take in its place, so its own session is not woken. Handle ` +
    'each as the operator would and record what you did in the graph, where ' +
    "the work lives. Hand up only what needs the operator's judgment or a " +
    'person, as one short line about the entity it concerns: ' +
    // Quoted: an id with no number reads `#…`, which a shell takes for a
    // comment.
    '`yak session handup \'<id>\' "<line>"`.',
    ...owed.map((o) => o.line),
  ].join('\n\n')
}

/** Start the project's helper on everything waiting for it, unless one is at
 * work or nothing waits. A project that no longer wears `helper`, or whose
 * `helper` names no provider, gives what waits back to its operator. */
export let take = async (g: G, project: Eid, o: Opts = {}): Promise<void> => {
  // Read what waits before asking who is at work: two workers that both find
  // nobody at work then hold a knock in common, and its guard lets one write.
  let knocks = await waiting(g, project)
  if (!knocks.length) return
  let [home] = await g.get([project])
  let { persona, provider, model, effort } = comp(home, HELPER)
  if (!provider) {
    await g.apply(
      knocks.map((b) => ({ entity: { eid: b.entity.eid }, [ROUTINE]: null })),
      { trusted: true },
    )
    return
  }
  if (await atWork(g, project, o)) return
  let owed = await owing(g, knocks)
  let at = await operatorOf(g, project)
  let [operator] = at ? await g.get([at], [SESSION]) : []
  let session = mint()
  let by = persona ? { by: str(persona) } : {}
  let said = (b: Bundle, guarded: boolean): Bundle => ({
    entity: { eid: b.entity.eid },
    notified: {},
    ...guarded ? { $was: { notified: { at: token(null) } } } : {},
    $actor: { ...by, via: session },
  })
  try {
    await g.apply([
      {
        entity: { eid: session },
        [SESSION]: { operator: false, ...persona ? { persona } : {} },
        [HELPING]: { project },
        ...operator && g.vocab.comp('spawned')
          ? { spawned: { parent: operator.entity.eid } }
          : {},
        $actor: by,
      },
      {
        entity: { eid: mint() },
        entry: { session },
        content: { body: brief(g, home, owed) },
        using: {
          provider,
          ...model ? { model } : {},
          ...effort ? { effort } : {},
        },
        $actor: by,
      },
      ...owed.flatMap(({ item, same }) => [
        said(item, true),
        ...same.map((b) => said(b, false)),
      ]),
    ], { trusted: true })
  } catch (error) {
    // Another worker's helper took one of these first: its exit asks again
    // for whatever it did not take.
    if (!(error instanceof Stale)) throw error
  }
}

// A helper that ended any way but cleanly, when nobody asked it to stop, is
// handed up with what it had taken.
let ended = async (g: G, helper: Bundle): Promise<void> => {
  let code = comp(helper, 'exit').code
  if (code === 0 || helper.stop) return
  await handUp(
    g,
    helper,
    'ended',
    `helper ${human(g.vocab)(helper)} ` +
      `${code == null ? 'ended with no exit code' : `exited ${code}`}, with ` +
      await taken(g, helper.entity.eid),
  )
}

// Where a taken item's line goes: the session it knocked while that can still
// hear, else the operator.
let hearer = async (g: G, item: Bundle): Promise<Eid | undefined> => {
  let to = str(comp(item, 'knock').target)
  let [row] = to ? await g.get([to], [SESSION]) : []
  return row?.[SESSION] && !(await over(g, [row])).has(to) ? to : undefined
}

// The verdict on a task as a helper leaves it: settled, or for a run that did
// not end cleanly, ended early, and otherwise not ready.
let verdict = (g: G, task: Bundle, run?: Bundle): string => {
  let status = statusOf(g.vocab, task) ?? ''
  if (status == 'done' || status == 'cancelled') return status
  return run && !cleanEnd(run) ? 'ended early' : 'not ready'
}

// Each task a helper took a run's ending (its report, a comment on the task)
// or a mark for, as one line to whoever it knocked. A comment anyone else
// wrote stays the helper's.
let verdicts = async (g: G, helper: Bundle): Promise<void> => {
  let has = (name: string) => !!g.vocab.comp(name)
  if (!has('task')) return
  let held = await g.read(and(
    present(ROUTINE),
    present('knock'),
    eq('notified.via', helper.entity.eid),
    every(),
  ))
  let ran = (b: Bundle) => b.comment ? str(comp(b, 'comment').target) : ''
  let marked = (b: Bundle) => b.comment ? '' : str(comp(b, 'knock').about)
  let about = unique(held.map((b) => ran(b) || marked(b)))
  if (!about.length) return
  let tasks = new Map(
    (await g.get(about)).filter((b) => b.task).map((b) => [b.entity.eid, b]),
  )
  let name = human(g.vocab)
  let seen = new Set<Eid>()
  // A run's report first: where a run and a mark tell of one task, the line
  // names the report.
  for (let item of [...held.filter(ran), ...held.filter((b) => !ran(b))]) {
    let task = tasks.get(ran(item) || marked(item))
    if (!task || seen.has(task.entity.eid)) continue
    seen.add(task.entity.eid)
    let via = ran(item) ? str(comp(item, 'created').via) : ''
    let [run] = via
      ? await g.get([via], ['process', 'exit', STOP_ENTRY].filter(has))
      : []
    let title = fold(str(comp(task, 'doc').title), 80)
    await handUp(
      g,
      helper,
      `told ${task.entity.eid}`,
      `${name(task)} ${verdict(g, task, run?.process ? run : undefined)}` +
        (title ? `: ${title}` : '') +
        (ran(item) ? ` (report ${name(item)})` : ''),
      await hearer(g, item),
    )
  }
}

/** The code behind `session_help`, for the entity a commit moved: a routine
 * knock, a helper that exited, or a project whose `helper` went. */
export let help = async (g: G, eid: Eid, o: Opts = {}): Promise<void> => {
  let has = (name: string) => !!g.vocab.comp(name)
  let [row] = await g.get(
    [eid],
    [ROUTINE, HELPING, 'project', 'exit', 'stop'].filter(has),
  )
  if (!row) return
  if (row[HELPING] && row.exit) {
    await ended(g, row)
    await verdicts(g, row)
  }
  let project = str(comp(row, ROUTINE).project) ||
    str(comp(row, HELPING).project) || (row.project ? eid : '')
  if (project) await take(g, project, o)
}
