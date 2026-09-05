// Walking a batch in either direction. A recorded batch carries both sides of
// every movement, so replaying it forward rebuilds the write that happened and
// replaying it backward builds the write that reverses it — one function, one
// argument apart.
//
// Forward is what a server recasts to its subscribers: the batch as committed,
// as bundles, without asking storage anything. Backward is undo, and undo is
// an ordinary write — it goes through `apply()` like any other, so it is
// admitted, guarded, stamped, and journaled in its turn. Undoing an undo is a
// redo, for free.
//
// The one thing that cannot be walked backward is a death. A deleted entity is
// tombstoned, never erased, and its id can never be reused — so an undo that
// would resurrect one is refused rather than half-applied.

import type { Actor, Bundle, Change, Comp, Eid, Graph } from '@yaks/graph'
import { then, TOMBSTONE } from '@yaks/graph'
import type { Batch, Source } from './read.ts'
import { at } from './read.ts'

/** A refused undo: the batch deleted an entity, and death is final. */
export class Final extends Error {
  /**
   * @param eid the entity the batch deleted
   * @param seq the batch it was deleted in
   */
  constructor(public eid: Eid, public seq: number) {
    super(`${eid} was deleted in batch #${seq} — a death cannot be undone`)
    this.name = 'Final'
  }
}

// One side of a batch, as a change. The deltas are replayed in order onto a
// component table per entity, which is what makes a batch that touched the
// same component twice come out as one bundle holding where it ended up.
let side = (batch: Batch, want: 'before' | 'after'): Change => {
  let order: Eid[] = []
  let held = new Map<Eid, Map<string, Comp | null>>()
  let died = new Set<Eid>()
  let of = (eid: Eid): Map<string, Comp | null> => {
    let t = held.get(eid)
    if (!t) {
      held.set(eid, t = new Map())
      order.push(eid)
    }
    return t
  }
  for (let d of batch.deltas) {
    if (d.comp == TOMBSTONE) {
      if (want == 'before') throw new Final(d.target, batch.seq)
      died.add(d.target)
      of(d.target)
      continue
    }
    let table = of(d.target)
    if (d.column == null) {
      let whole = d[want]
      table.set(d.comp, whole == null ? null : { ...(whole as Comp) })
      continue
    }
    let cur = table.get(d.comp)
    if (cur === null) continue // the component is not there on this side
    table.set(d.comp, { ...(cur ?? {}), [d.column]: d[want] ?? null })
  }
  let out: Bundle[] = []
  for (let eid of order) {
    if (died.has(eid)) {
      out.push({ entity: { eid }, $delete: true })
      continue
    }
    let b: Bundle = { entity: { eid } }
    for (let [comp, value] of held.get(eid)!) b[comp] = value
    if (Object.keys(b).length > 1) out.push(b)
  }
  return out
}

/**
 * The batch as committed, rebuilt from its deltas — the bundles a server casts
 * to its subscribers when it reads the feed, with no read of storage at all.
 * It carries what MOVED, so the provenance the batch row already holds (who,
 * when) is not repeated in it.
 */
export let applied = (batch: Batch): Change => side(batch, 'after')

/**
 * The change that reverses a batch: every column back to the value it held,
 * every component that went restored whole, every component that appeared
 * dropped. Throws {@link Final} if the batch deleted an entity.
 */
export let undone = (batch: Batch): Change => side(batch, 'before')

/**
 * Undo a committed batch by its `seq`: build the inverse from what was written
 * down and apply it through the graph, so the undo is admitted, stamped and
 * journaled like any other write.
 *
 * ```ts
 * undo(g)(7, { by: 'ada' })
 * ```
 *
 * Throws {@link Final} if the batch deleted an entity, and a plain `Error` if
 * no batch has that seq. The inverse is applied as trusted, since restoring a
 * column the server owns is the graph's own reconstruction, not a client's
 * write. A batch whose entities have moved on since is not detected here: pass
 * the undo through a `$was` guard yourself if you need one.
 */
export let undo =
  (g: Graph) => (seq: number, actor?: Actor): Bundle[] | Promise<Bundle[]> =>
    then(at(g as Source)(seq), (batch) => {
      if (!batch) throw new Error(`no journal batch #${seq}`)
      let change = undone(batch)
      if (!change.length) return []
      if (actor) change[0] = { ...change[0], $actor: actor }
      return g.apply(change, { trusted: true })
    }) as Bundle[] | Promise<Bundle[]>
