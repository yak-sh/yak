// A person's comment on an open task no live session holds starts a session
// on it, with the comment as its first input.
//
// Whether a start is owed is settled in the comment's own commit, by the
// match the vocabulary declares for `session_start`: a person's comment not
// yet said to anyone, on a task that is open, not blocked, and unclaimed or
// claimed by a session that has ended. An agent's comment owes none, and
// neither does a comment committed before this effect was declared: nothing
// looks back for one.
//
// The run is the start any door makes (a session, and an entry that asks its
// model for a turn), as one batch with the claim on the task and the mark
// that the comment was said (./listen.ts `deliver`). The batch is guarded by
// what the commit saw, so it lands whole or not at all: a comment someone
// heard meanwhile, or a task that was closed, blocked or taken, starts
// nothing. From that batch on the task is held, so his next comment reaches
// this session through the bus (./bus.ts) and owes no second start.
//
// At most `limit` sessions started this way are at work at once. A start past
// that keeps its run and waits in the pool (@yaks/effects `Attempt.defer`),
// asking again every `wait` ms; its comment stays unsaid meanwhile, and
// nobody else hears it (./listen.ts `taken`). One process decides one start
// at a time, so two comments arriving together cannot both take the last
// place; two workers could, by one.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import type { Handlers } from '@yaks/effects'
import { human } from '@yaks/id'
import { effectsIn } from '@yaks/vocab'
import { absent, and, eq, fields, present } from '@yaks/query'
import { input } from './bus.ts'
import { CLAIM, SESSION } from './comp.ts'
import { atWork, deliver, said } from './listen.ts'
import type { Beside } from './recall.ts'

let str = (v: unknown): string => typeof v == 'string' ? v : ''
let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

/** What a host opens a session on a piece of work with. */
export type Opening = {
  /** the persona the session wears, where the work's project has one */
  persona?: Eid
  /** the model its first input asks: `using{provider, model}` */
  using: Comp
}

/** How sessions are started on comments. */
export type Starting = {
  /** what this host opens a session on a task with */
  opening: (task: Eid) => Opening | Promise<Opening>
  /** the most sessions started on comments at work at once (default 2) */
  limit?: number
  /** how long a start past the limit waits before it asks again, in
   * milliseconds (default ten seconds) */
  wait?: number
  /** sets under a comment its person wrote what they said before
   * (./recall.ts) */
  beside?: Beside
}

/** The sessions started on a comment that are at work now, mid-turn. */
export let busy = async (
  g: Pick<Graph, 'read'>,
): Promise<Eid[]> =>
  atWork(
    g,
    (await g.read(and(
      present(`${SESSION}.source.comment`),
      absent(`${SESSION}.ended`),
      fields('entity.eid'),
    ))).map((b) => b.entity.eid),
  )

// Whether a write guarded by `$was` landed: false where the graph has moved.
let guarded = async (write: () => unknown): Promise<boolean> => {
  try {
    await write()
    return true
  } catch (error) {
    if (error instanceof Stale) return false
    throw error
  }
}

// Whether a session has its `ended` mark, read alone: the rest of `session`
// is derived from its whole log.
let over = async (g: Pick<Graph, 'read'>, session: Eid): Promise<boolean> =>
  comp(
    (await g.read(
      and(eq('entity.eid', session), fields(`${SESSION}.ended`)),
    ))[0],
    SESSION,
  ).ended == true

/** Start a session on the task `comment` is on, as its holder, with the
 * comment as its first input. Answers the session, or nothing where the
 * comment or its task has moved since the commit that owed the start. */
export let start = async (
  g: Pick<Graph, 'vocab' | 'read' | 'get' | 'apply'>,
  comment: Eid,
  opening: Starting['opening'],
  beside: Beside = (owed) => Promise.resolve(owed),
): Promise<Eid | undefined> => {
  let [item] = await g.get([comment])
  let on = str(comp(item, 'comment').target)
  let [task] = on ? await g.get([on]) : []
  if (!item || !task) return
  // A live holder hears the comment itself, through the bus. A lock is
  // released before another session takes it (./lease.ts), and one a session
  // that is over still holds goes with that session anyway.
  let held = str(comp(task, CLAIM).session)
  if (held) {
    if (!await over(g, held)) return
    let free = {
      entity: { eid: on },
      [CLAIM]: null,
      $was: { [CLAIM]: { session: token(held) } },
    }
    if (!await guarded(() => g.apply([free], { trusted: true }))) return
  }
  let session = derivedEid(`session start ${comment}`)
  let by = str(comp(item, 'created').by)
  let id = human(g.vocab)(task)
  let names = new Map([on, by].filter(Boolean).map((eid) => [eid, eid]))
  for (let b of await g.get([...names.keys()])) {
    names.set(b.entity.eid, human(g.vocab)(b))
  }
  let [{ line }] = await beside([{
    item,
    line: said(g.vocab, item, (eid) => names.get(eid) ?? eid, undefined, by),
  }])
  let { persona, using } = await opening(on)
  let project = str(comp(task, 'filed').project)
  let unmarked = ['completed', 'cancelled'].filter((c) => g.vocab.comp(c))
  let landed = await deliver(g, null, item, [
    {
      entity: { eid: session },
      [SESSION]: {
        id: session.slice(0, 8),
        operator: false,
        source: comment,
        ...persona ? { persona } : {},
      },
      native: {},
      ...project ? { filed: { project } } : {},
    },
    {
      ...input(
        session,
        comment,
        `${line}\n\nNo session held ${id}, so this one was started on it ` +
          `and holds it now. Reply first with a comment on ${id}, so its ` +
          'writer sees it was picked up, then do what the comment asks.',
      ),
      using,
    },
    {
      entity: { eid: on },
      [CLAIM]: { session },
      $was: {
        [CLAIM]: { session: token(null) },
        ...Object.fromEntries(unmarked.map((c) => [c, { at: token(null) }])),
        ...g.vocab.comp('blocked') ? { blocked: { since: token(null) } } : {},
      },
    },
  ])
  return landed ? session : undefined
}

// One decision at a time, so two starts cannot both see the last free place.
let serially = () => {
  let line: Promise<unknown> = Promise.resolve()
  return <T>(job: () => Promise<T>): Promise<T> => {
    let run = line.then(job)
    line = run.catch(() => {})
    return run
  }
}

/**
 * The `session_start` handler, for a host that can open a session: none where
 * the vocabulary declares no such effect.
 *
 * ```ts
 * import { starting } from '@yaks/session'
 *
 * // fx.handle(starting(graph, { opening: (task) => ({ using }) }))
 * ```
 */
export let starting = (g: Graph, options: Starting): Handlers => {
  if (!effectsIn(g.vocab.docs).some((e) => e.name == 'session_start')) {
    return {}
  }
  let { limit = 2, wait = 10_000 } = options
  let serial = serially()
  return {
    session_start: (e, _tx, _write, attempt) =>
      serial(async () => {
        if ((await busy(g)).length < limit) {
          await start(g, e.entity.eid, options.opening, options.beside)
        } else if (attempt?.defer) await attempt.defer(wait)
        else {
          throw new Error(
            `session_start: ${limit} sessions started on comments are at ` +
              'work, and this host keeps no pool for the next to wait in',
          )
        }
      }),
  }
}
