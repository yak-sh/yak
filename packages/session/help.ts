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
// `yak session send`. This file writes two: a helper that ended badly, and one
// still going after {@link LIMIT} that the next knock stops, each naming the
// knocks it had taken.
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
import { type Owed, owing } from './listen.ts'
import { HELPER, HELPING, ROUTINE } from './routine.ts'
import { operatorOf } from './watch.ts'

type G = Pick<Graph, 'vocab' | 'read' | 'get' | 'apply'>

/** How long a helper may go on before the next routine knock stops it and
 * starts another (ms). */
export let LIMIT = 30 * 60_000

/** What a test holds still: the clock, and {@link LIMIT}. */
export type Opts = { now?: () => number; limit?: number }

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''
let s = (n: number) => n == 1 ? '' : 's'

// A turn the model or a tool owes an answer: a helper not yet launched.
let WORKING = ['pending', 'running']

/** The routine knocks and letters waiting for a project's helper. */
export let waiting = (g: G, project: Eid): Promise<Bundle[]> =>
  Promise.resolve(g.read(and(
    eq(`${ROUTINE}.project`, project),
    absent('notified'),
    every(),
  )))

// A knock at the operator written through `helper`, which makes it a hand-up
// (./routine.ts). Named for what it tells, so a run again tells it once.
let handUp = async (g: G, helper: Bundle, key: string, body: string) => {
  let project = str(comp(helper, HELPING).project)
  let to = await operatorOf(g, project) ?? project
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

// Whether a helper is at work for the project. One past the limit is asked
// to stop and handed up, and does not count: the knocks waiting behind it
// would otherwise wait for good.
let atWork = async (g: G, project: Eid, o: Opts): Promise<boolean> => {
  let now = (o.now ?? Date.now)(), limit = o.limit ?? LIMIT
  let busy = false
  for (let b of await going(g, project)) {
    if (now - Date.parse(str(comp(b, 'created').at)) < limit) {
      busy = true
      continue
    }
    await g.apply([{ entity: { eid: b.entity.eid }, stop: {} }])
    await handUp(
      g,
      b,
      'overdue',
      `helper ${human(g.vocab)(b)} was still going after ` +
        `${Math.round(limit / 60_000)} min and was stopped, with ` +
        await taken(g, b.entity.eid),
    )
  }
  return busy
}

// What a helper is told: whose place it takes, how to hand up, and each
// waiting knock whole. How each kind is handled is its persona's to say.
let brief = (
  g: G,
  home: Bundle,
  operator: Bundle | undefined,
  owed: Owed[],
): string => {
  let name = human(g.vocab)
  let project = [name(home), str(comp(home, 'doc').title)].filter(Boolean)
    .join(' ')
  // With no operator's session open, the hand-up waits at the project for the
  // next one a person opens. Each command names its entity by eid: a session
  // with no number reads `#…`, which a shell takes for a comment.
  let up = operator
    ? `\`yak session send ${operator.entity.eid} "<line>"\``
    : `\`yak graph apply '$k .knock.target=${home.entity.eid} ` +
      `.doc.body="<line>"'\``
  return [
    `You are the helper of ${project}'s operator. ${owed.length} ` +
    `item${s(owed.length)} arrived for the operator and ${
      owed.length == 1 ? 'is' : 'are'
    } yours to take in its place, so its own session is not woken. Handle ` +
    'each as the operator would and record what you did in the graph, where ' +
    "the work lives. Hand up only what needs the operator's judgment or a " +
    `person, as one short line with the id: ${up}.`,
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
        content: { body: brief(g, home, operator, owed) },
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

/** The code behind `session_help`, for the entity a commit moved: a routine
 * knock, a helper that exited, or a project whose `helper` went. */
export let help = async (g: G, eid: Eid, o: Opts = {}): Promise<void> => {
  let has = (name: string) => !!g.vocab.comp(name)
  let [row] = await g.get(
    [eid],
    [ROUTINE, HELPING, 'project', 'exit', 'stop'].filter(has),
  )
  if (!row) return
  if (row[HELPING] && row.exit) await ended(g, row)
  let project = str(comp(row, ROUTINE).project) ||
    str(comp(row, HELPING).project) || (row.project ? eid : '')
  if (project) await take(g, project, o)
}
