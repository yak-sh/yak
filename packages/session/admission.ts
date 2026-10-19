// The bound on children, kept in the graph. A spawned transcript waits
// `queued` until fewer than `maxChildren` are `active`; admission is a guarded
// write to its `dispatch`, so two workers admitting one child settle it in the
// transaction, and the write owes the child a run (./run.ts). A child waiting
// on its own children steps aside (`waiting`) so they can be admitted, and
// queues again for its place when the wait is over.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { and, limit, ne, order, present, want } from '@yaks/query'
import type { ChildLimits } from './children.ts'
import { changes } from './wait.ts'

let dispatch = (b: Bundle | undefined) => b?.dispatch as Comp | undefined

/** During expansion the old server's value wins. After conversion only marks
 * remain; no dispatch means no place, not a queued root. */
export let dispatchStatus = (b: Bundle | undefined): unknown => {
  let d = dispatch(b)
  if (!d) return null
  return d.state ??
    (b?.waiting ? 'waiting' : b?.admitted ? 'active' : 'queued')
}

// What admission reads of a transcript: its place and the marks naming it,
// never the rest it wears (a session's computed status reads every entry).
// A narrow consumer's vocabulary may lack the marks.
let marks = (g: Graph) =>
  ['admitted', 'waiting'].filter((name) => g.vocab.comp(name))

let place = async (g: Graph, eid: Eid) =>
  (await g.get([eid], ['dispatch', ...marks(g)]))[0]

// The children in `status`. A legacy row keeps its dispatch once settled, and
// those outnumber the rest many times over: they are never read.
let placed = async (g: Graph, status: string): Promise<Bundle[]> =>
  (await g.read(and(
    present('dispatch'),
    ne('dispatch.state', 'settled'),
    ...marks(g).map(want),
  ))).filter((b) => dispatchStatus(b) == status)

let state = async (g: Graph, eid: Eid) => dispatchStatus(await place(g, eid))

/** Patch a transcript's `dispatch` only if its state is still `was`. */
export let swap = async (
  g: Graph,
  eid: Eid,
  was: unknown,
  patch: Comp,
  together: Bundle[] = [],
): Promise<boolean> => {
  let b = await place(g, eid)
  if (dispatchStatus(b) != was || !b?.dispatch) return false
  let d = dispatch(b)!
  let next = patch.state
  // Narrow consumers may still load only the old session vocabulary. They
  // keep writing the legacy shape; marks-only rows require both core marks.
  let marks = g.vocab.comps.includes('admitted') &&
    g.vocab.comps.includes('waiting')
  try {
    await g.apply([{
      entity: { eid },
      dispatch: next == 'settled' && d.state == null
        ? null
        : { ...patch, ...(d.state == null ? { state: null } : {}) },
      ...(marks
        ? next == 'active'
          ? { admitted: {}, waiting: null }
          : next == 'waiting'
          ? { admitted: null, waiting: {} }
          : next == 'queued' || next == 'settled'
          ? { admitted: null, waiting: null }
          : {}
        : {}),
      $was: {
        dispatch: {
          state: token(d.state ?? null),
          order: token(d.order ?? null),
          args: token(d.args ?? null),
        },
        ...marks
          ? {
            ...Object.fromEntries(['admitted', 'waiting'].map((name) => [
              name,
              Object.fromEntries(['at', 'by', 'via'].map((prop) => [
                prop,
                token((b[name] as Comp)?.[prop]),
              ])),
            ])),
          }
          : {},
      },
    }, ...together], { trusted: true })
    return true
  } catch (error) {
    if (error instanceof Stale) return false
    throw error
  }
}

/** The children waiting for a place, oldest first. */
export let queue = async (g: Graph): Promise<Bundle[]> =>
  (await placed(g, 'queued')).toSorted((a, b) =>
    Number(dispatch(a)?.order ?? 0) - Number(dispatch(b)?.order ?? 0)
  )

/** How many children hold a place. */
export let active = async (g: Graph): Promise<number> =>
  (await placed(g, 'active')).length

/** The order a child joining the queue takes: behind every other. */
export let tail = async (g: Graph): Promise<number> => {
  let [last] = await g.read(
    and(present('dispatch.order'), order('-dispatch.order'), limit(1)),
  )
  return Math.max(0, Number(dispatch(last)?.order ?? 0)) + 1
}

/** Admit the oldest queued children while fewer than the bound are active. */
export let admitNext = async (
  g: Graph,
  limits: ChildLimits = {},
): Promise<void> => {
  let free = (limits.maxChildren ?? 32) - await active(g)
  for (let b of (await queue(g)).slice(0, Math.max(0, free))) {
    await swap(g, b.entity.eid, 'queued', { state: 'active' })
  }
}

/** Give up a child's place while it waits, and answer how to take one back:
 * queue again and return once admitted, or once `signal` aborts. A transcript
 * holding no place (a root) has nothing to give up. */
export let aside = async (
  g: Graph,
  session: Eid,
  limits: ChildLimits,
  signal?: AbortSignal,
): Promise<() => Promise<void>> => {
  if (!await swap(g, session, 'active', { state: 'waiting' })) {
    return () => Promise.resolve()
  }
  await admitNext(g, limits)
  return async () => {
    await swap(g, session, 'waiting', { state: 'queued' })
    await admitNext(g, limits)
    for await (let over of changes(g, { signal, clock: limits.clock })) {
      if (over || await state(g, session) != 'queued') return
    }
  }
}
