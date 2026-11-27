// Outdated: a row a step made before the step's last edit. Editing a step
// changes what happens next, never what was made, so nothing is rewritten;
// the rows read as outdated instead, from the journal (@yaks/journal's `_change`
// and `_tx` rows), with no fingerprint stored on them. A rerun on the cases
// someone picks (./run.ts `rerun`) makes them again.

import { after, together } from '@yaks/fp'
import type { Access, Bundle, Comp, Eid } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { whole } from '@yaks/query'

/** What `outdated` reads through: a graph, or a view's reader (@yaks/inspect
 * `useReading`) with the vocabulary beside it. */
export type Journaled = Pick<Access, 'vocab' | 'read'> & {
  get: (eids: Eid[], comps?: string[]) => Bundle[] | Promise<Bundle[]>
}

// The latest transaction, by sequence, of each change's target.
let latest = (
  g: Journaled,
  changes: Bundle[],
): Map<Eid, number> | Promise<Map<Eid, number>> => {
  let txs = [
    ...new Set(changes.map((c) => (c._change as Comp).tx as Eid)),
  ]
  return after(g.get(txs, ['_tx']), (rows) => {
    let seq = new Map(
      rows.map((r) => [r.entity.eid, Number((r._tx as Comp).seq)]),
    )
    let out = new Map<Eid, number>()
    for (let c of changes) {
      let { target, tx } = c._change as { target: Eid; tx: Eid }
      out.set(target, Math.max(out.get(target) ?? 0, seq.get(tx) ?? 0))
    }
    return out
  })
}

/**
 * The rows `step` made before its `step` component was last edited, by eid:
 * each one whose `made` was written in an earlier transaction than that edit.
 * Needs the journal's rows; a graph without them is refused.
 */
export let outdated = (g: Journaled, step: Eid): Eid[] | Promise<Eid[]> => {
  if (!g.vocab.comp('_change')) {
    throw new Refused('outdated reads the journal, and this graph has none')
  }
  let read = (q: string) => g.read(whole(q))
  return after(
    together([
      read(`._change.target=${step}, _change.component=step`),
      read(`._change.component=made, _change.target.made.step=${step}`),
    ]),
    ([edits, made]) =>
      after(
        together([latest(g, edits), latest(g, made)]),
        ([edited, rows]) => {
          let last = edited.get(step) ?? 0
          return [...rows].filter(([, seq]) => seq < last).map(([eid]) => eid)
        },
      ),
  )
}
