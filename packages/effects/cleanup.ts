// One owner-invoked cleanup for legacy successful runs. Failed/pending work,
// other components on a run, and its target's human-readable data stay intact.
import {
  type Access,
  type Bundle,
  type Comp,
  comps,
  Stale,
  token,
} from '@yaks/graph'

/** Guarded successful settlement, preserving any other data on the run. */
export let finishedRun = (row: Bundle): Bundle[] => {
  let effect = row.effect as Comp
  let guards = Object.fromEntries(
    Object.entries({
      lease_owner: null,
      lease_token: null,
      attempts: null,
      ...effect,
    })
      .map(([p, v]) => [p, token(v ?? null)]),
  )
  let other = comps(row).some(([name]) =>
    !['effect', 'created', 'updated'].includes(name)
  )
  return [{
    entity: row.entity,
    ...(other ? { effect: null } : { $delete: true }),
    $was: { effect: guards },
  }]
}

export let doneRun = (row: Bundle): Bundle[] =>
  (row.effect as Comp | undefined)?.state == 'done' ? finishedRun(row) : []

export let cleanupDone = async (
  g: Access,
  batch = 100,
  limit = Infinity,
): Promise<number> => {
  if (!Number.isInteger(batch) || batch < 1) {
    throw Error('positive cleanup batch required')
  }
  let removed = 0
  while (removed < limit) {
    let rows = await g.read(
      `.effect.state=done&.limit=${Math.min(batch, limit - removed)}&*`,
    )
    if (!rows.length) return removed
    try {
      await g.apply(rows.flatMap(doneRun), { trusted: true })
      removed += rows.length
    } catch (e) {
      if (!(e instanceof Stale)) throw e
    }
  }
  return removed
}

/** Owner-invoked settlement of pending errands that the declaration no longer
 * owes. The predicate is conservative; active claims and failures stay intact.
 * It completes through the same guarded graph writes as successful-run cleanup. */
export let settleStale = async (
  g: Access,
  handler: string,
  needed: (effect: Comp) => boolean | Promise<boolean>,
): Promise<number> => {
  let settled = 0
  for (
    let row of await g.read(
      `.effect.handler=${handler} .effect.state=pending *`,
    )
  ) {
    let effect = row.effect as Comp
    if (effect.lease_owner || await needed(effect)) continue
    try {
      await g.apply(finishedRun(row), { trusted: true })
      settled++
    } catch (e) {
      if (!(e instanceof Stale)) throw e
    }
  }
  return settled
}
