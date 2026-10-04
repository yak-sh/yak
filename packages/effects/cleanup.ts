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

export let doneRun = (row: Bundle): Bundle[] => {
  let effect = row.effect as Comp | undefined
  if (effect?.state != 'done') return []
  let guards = Object.fromEntries(
    Object.entries(effect).map(([p, v]) => [p, token(v ?? null)]),
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
