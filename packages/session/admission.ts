// The bound on children, kept in the graph. A spawned transcript waits
// `queued` until fewer than `maxChildren` are `active`; admission is a guarded
// write to its `dispatch`, so two workers admitting one child settle it in the
// transaction, and the write owes the child a run (./run.ts). A child waiting
// on its own children steps aside (`waiting`) so they can be admitted, and
// queues again for its place when the wait is over.

import {
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  Stale,
  token,
} from '@yaks/graph'
import type { ChildLimits } from './children.ts'

let dispatch = (b: Bundle | undefined) => b?.dispatch as Comp | undefined

let state = async (g: Graph, eid: Eid) =>
  dispatch((await g.storage.tx((tx) => tx.get([eid])))[0])?.state

/** Patch a transcript's `dispatch` only if its state is still `was`. */
export let swap = async (
  g: Graph,
  eid: Eid,
  was: unknown,
  patch: Comp,
): Promise<boolean> => {
  try {
    await g.apply([{
      entity: { eid },
      dispatch: patch,
      $was: { dispatch: { state: token(was ?? null) } },
    }], { trusted: true })
    return true
  } catch (error) {
    if (error instanceof Stale) return false
    throw error
  }
}

/** The children waiting for a place, oldest first. */
export let queue = async (g: Graph): Promise<Bundle[]> =>
  (await g.read('.dispatch.state=queued&*')).toSorted((a, b) =>
    Number(dispatch(a)?.order ?? 0) - Number(dispatch(b)?.order ?? 0)
  )

/** How many children hold a place. */
export let active = async (g: Graph): Promise<number> =>
  (await g.read('.dispatch.state=active')).length

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
    while (!signal?.aborted && await state(g, session) == 'queued') {
      await new Promise((go) => setTimeout(go, 25))
    }
  }
}
