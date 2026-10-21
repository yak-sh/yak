// Waking a parked transcript. A transcript is parked on a task when its run is
// over (a native transcript has settled; a managed one's process exited
// cleanly, nobody having stopped it) and the task it holds still waits on a
// dependency (@yaks/task `dependencies`). It is woken the way any transcript
// is asked for its next turn: an input carrying the `using` in force, which
// ./run.ts answers for a provider a host lent a model for and @yaks/spawn
// answers by running the command line again on the same thread. So one rule
// wakes both kinds: `session_wake` writes that input when a dependency
// finishes or its link goes away, and a managed run that ends calls
// {@link rouse} itself, for news that came while it ran.
//
// News is a dependency that finished after the claim was taken, by somebody
// other than the transcript, or the link to one that had not finished going
// away. A wake is named for the transcript, the task and what it tells of, so
// the same news is told once, and a wake that lands while a run is starting is
// refused rather than lost: it is written beside the precondition that the run
// is still over, and the run starting clears that first (@yaks/spawn).

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { human } from '@yaks/id'
import {
  dependencies,
  dependents,
  settled,
  statusOf as taskStatus,
} from '@yaks/task'
import { CLAIM } from './comp.ts'
import { STOP_ENTRY } from './native.ts'
import { currentStatus } from './react.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let one = async (g: Graph, eid: Eid, names: string[]) =>
  (await g.get([eid], names.filter((n) => g.vocab.comp(n))))[0]

// Whether transcripts here can hold tasks at all.
let holds = (g: Graph) =>
  g.vocab.comps.includes('task') && g.vocab.comps.includes(CLAIM)

/** Whether a managed run is over and was let be: its process exited cleanly
 * and nobody asked it to stop. */
export let cleanEnd = (row: Bundle | undefined): boolean =>
  !!row?.process && comp(row, 'exit')?.code === 0 && !row[STOP_ENTRY]

// What says whether a transcript's run is over: a managed one's process, how
// it exited, and whether it was asked to stop.
let SEEN = ['process', 'exit', STOP_ENTRY]

/** Whether a transcript's run is over, so that a request starts its next: a
 * native transcript has settled, and a managed one ended cleanly
 * ({@link cleanEnd}) with its ending read in, every request it had answered.
 * `seen` is the session's row, where the caller has read it already. */
export let resting = async (
  g: Graph,
  session: Eid,
  seen?: Bundle,
): Promise<boolean> => {
  let row = seen ?? await one(g, session, SEEN)
  return row?.process
    ? cleanEnd(row) && !await requested(g, session)
    : await currentStatus(g, session) == 'settled'
}

// Where what a transcript's last turn or run was given ends: the entry its
// newest ask read through, or its newest stop, whichever is later; 0 where it
// has neither.
let given = async (g: Graph, session: Eid): Promise<number> => {
  let newest = (q: string) =>
    g.read(`.entry.session=${session}&${q}&.order=-entry.seq&.limit=1`)
  let [[ask], [stop]] = await Promise.all([
    newest('.ask'),
    newest(`.${STOP_ENTRY}`),
  ])
  let through = comp(ask, 'ask')?.through
  let [read] = through == null ? [] : await g.get([String(through)], ['entry'])
  return Math.max(
    ...[read, stop].map((b) => Number(comp(b, 'entry')?.seq ?? 0)),
  )
}

/**
 * What a transcript was told that its last turn or run was not given: the
 * inputs written after the entry its newest ask read through, and after its
 * newest stop, in order. A managed run's next run is given these.
 *
 * ```ts
 * import { unanswered } from '@yaks/session'
 *
 * // let said = await unanswered(graph, session)
 * ```
 */
export let unanswered = async (g: Graph, session: Eid): Promise<Bundle[]> =>
  await g.read(
    `.entry.session=${session}&.entry.seq>${await given(g, session)}` +
      `&.content&!output&!${STOP_ENTRY}&!notice` +
      (g.vocab.comp('lines') ? '&!lines' : '') +
      '&.order=entry.seq&*',
  )

/** Whether a request waits in a transcript for its next turn or run: an input
 * asking for one that its newest ask was not given. */
export let requested = async (g: Graph, session: Eid): Promise<boolean> =>
  (await unanswered(g, session)).some((b) => b.using)

let finished = (b: Bundle): Comp | undefined =>
  comp(b, 'cancelled') ?? comp(b, 'completed')

// A held task's dependencies, read once for all a wake says of them: how many
// are still open (one the graph does not hold counts, since it cannot be shown
// to have finished), and the news, those that finished since its claim was
// taken, by somebody other than its holder: what the holder has not been told.
// Where an instant is not known, a finished dependency counts.
type Deps = { left: number; news: Bundle[] }
let looked = async (g: Graph, task: Bundle): Promise<Deps> => {
  let ids = await dependencies(g, task.entity.eid)
  let over = (ids.length ? await g.get(ids) : [])
    .filter((b) => settled(taskStatus(g.vocab, b)))
  let claim = comp(task, CLAIM)
  let since = claim?.at == null ? '' : String(claim.at)
  let holder = claim?.session
  return {
    left: ids.length - over.length,
    news: over.filter((b) => {
      let mark = finished(b)
      return mark?.by != holder && mark?.via != holder &&
        (!since || mark?.at == null || String(mark.at) >= since)
    }),
  }
}

// What a wake tells of a held task: the dependencies that finished, and those
// whose link went away.
type Told = { done: Bundle[]; gone: Bundle[] }

// One wake per transcript, task and set of things told: a finished dependency
// by its eid, a link gone by `-` and the eid.
let named = (session: Eid, task: Eid, { done, gone }: Told) =>
  derivedEid(
    `session wake ${session} ${task} ${
      [
        ...done.map((b) => b.entity.eid),
        ...gone.map((b) => `-${b.entity.eid}`),
      ].toSorted().join(' ')
    }`,
  )

// The news a held task has that no wake told yet, with `gone`, the
// dependencies whose link the caller saw go away; or nothing.
let untold = async (
  g: Graph,
  task: Bundle,
  deps: Deps,
  gone: Bundle[] = [],
): Promise<Told | undefined> => {
  let told = { done: deps.news, gone }
  if (!told.done.length && !gone.length) return
  let session = String(comp(task, CLAIM)?.session)
  let [said] = await g.get([named(session, task.entity.eid, told)], ['entry'])
  return said?.entry ? undefined : told
}

/**
 * Whether a task a transcript holds waits on something the transcript is to be
 * woken for: the task is open, and a dependency of it is open or finished
 * without the transcript having been told. A managed run that ends keeps such
 * a claim: it is parked there.
 *
 * ```ts
 * import { waits } from '@yaks/session'
 *
 * // if (!await waits(graph, session, task)) release it
 * ```
 */
export let waits = async (
  g: Graph,
  session: Eid,
  task: Eid,
): Promise<boolean> => {
  let [row] = await g.get([task])
  if (!row?.task || comp(row, CLAIM)?.session != session) return false
  if (settled(taskStatus(g.vocab, row))) return false
  let deps = await looked(g, row)
  return deps.left > 0 || !!await untold(g, row, deps)
}

/**
 * Whether a transcript whose run is over is parked: a request waits for its
 * next run, or a task it holds {@link waits}.
 */
export let parked = async (g: Graph, session: Eid): Promise<boolean> => {
  if (await requested(g, session)) return true
  let held = holds(g) ? await g.read(`.task&.${CLAIM}.session=${session}`) : []
  for (let b of held) {
    if (await waits(g, session, b.entity.eid)) return true
  }
  return false
}

// The line a wake says: what finished, what it waits on no more, and how many
// of its dependencies are left.
let telling = (g: Graph, task: Bundle, { done, gone }: Told, left: number) => {
  let id = human(g.vocab)
  let and = (them: string[]) =>
    them.length > 1
      ? `${them.slice(0, -1).join(', ')} and ${them.at(-1)}`
      : them[0]
  let them = done.map((b) => `${id(b)} (${taskStatus(g.vocab, b)})`)
  return [
    done.length && `${and(them)}, which ${id(task)} waits on, ` +
      `${done.length > 1 ? 'have' : 'has'} finished`,
    gone.length && `${id(task)} no longer waits on ${and(gone.map(id))}`,
    left
      ? `${left} of its dependencies still open`
      : 'nothing it waits on is open',
  ].filter(Boolean).join('; ') + '.'
}

/**
 * Wake a transcript for news of the tasks it holds: where its run is over,
 * append an input carrying the `using` in force for each held task with a
 * dependency finished that it was not told of, or one in `gone` (by held
 * task) whose link went away. Whoever answers that provider runs the turn. A
 * transcript still running is left alone; a managed run calls this as it ends.
 *
 * ```ts
 * import { rouse } from '@yaks/session'
 *
 * // await rouse(graph, session)
 * ```
 */
export let rouse = async (
  g: Graph,
  session: Eid,
  gone: Record<Eid, Bundle[]> = {},
): Promise<void> => {
  if (!holds(g)) return
  let row = await one(g, session, SEEN)
  if (!await resting(g, session, row)) return
  let [asked] = await g.read(
    `.entry.session=${session}&.using&.order=-entry.seq&.limit=1`,
  )
  let using = comp(asked, 'using')
  if (!using) return
  let held = await g.read(`.task&.${CLAIM}.session=${session}&*`)
  let wakes: Bundle[] = []
  for (let task of held) {
    if (settled(taskStatus(g.vocab, task))) continue
    let deps = await looked(g, task)
    let told = await untold(g, task, deps, gone[task.entity.eid])
    if (!told) continue
    wakes.push({
      entity: { eid: named(session, task.entity.eid, told) },
      entry: { session },
      content: { body: telling(g, task, told, deps.left) },
      using,
      $was: { entry: { session: null } },
    })
  }
  if (!wakes.length) return
  try {
    await g.apply([
      ...wakes,
      ...row?.exit
        ? [{
          entity: { eid: session },
          $was: { exit: { code: token(comp(row, 'exit')?.code) } },
        }]
        : [],
    ], { trusted: true })
  } catch (err) {
    // Told already, or a run started under it, which reads the news itself
    // and is roused again as it ends.
    if (!(err instanceof Stale)) throw err
  }
}

/**
 * The code behind `session_wake`: a task finished, so every transcript
 * parked on a task that waits on it is {@link rouse}d.
 */
export let wake = async (g: Graph, task: Eid): Promise<void> => {
  let [row] = await g.get([task], ['task'])
  if (!row?.task) return
  let waiting = await g.get(await dependents(g, task), [CLAIM])
  let holders = new Set(
    waiting.map((b) => comp(b, CLAIM)?.session)
      .filter((s): s is string => typeof s == 'string'),
  )
  for (let session of holders) await rouse(g, session)
}

/**
 * The code behind `session_wake` for a dependency link that went away: the
 * transcript parked on `task`, the end it led from, is {@link rouse}d and told
 * `task` waits on `dep` no more, where `dep` had not finished. A dependency
 * deleted with its link is told too, since whether it had finished went with
 * it.
 *
 * ```ts
 * import { unlinked } from '@yaks/session'
 *
 * // await unlinked(graph, 'y', 'x') // y requires x no more
 * ```
 */
export let unlinked = async (
  g: Graph,
  task: Eid,
  dep: Eid,
): Promise<void> => {
  let session = comp(await one(g, task, [CLAIM]), CLAIM)?.session
  if (typeof session != 'string') return
  let [row] = await g.get([dep])
  if (row && settled(taskStatus(g.vocab, row))) return
  await rouse(g, session, { [task]: [row ?? { entity: { eid: dep } }] })
}
