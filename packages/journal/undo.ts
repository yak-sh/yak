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

import type { Actor, Bundle, Change, Comp, Eid, Graph, Was } from '@yaks/graph'
import { token, TOMBSTONE } from '@yaks/graph'
import type { Batch } from './batch.ts'
import type { Log } from './log.ts'

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
let side = (batch: Batch, want: 'before' | 'after', guard = false): Change => {
  let order: Eid[] = []
  let held = new Map<Eid, Map<string, Comp | null>>()
  let died = new Set<Eid>()
  // What the batch LEFT in each column, hashed: the guard an undo carries so a
  // column somebody else has moved since refuses the whole reversal rather
  // than quietly clobbering it. Only the backward side wants one — replaying
  // forward is a recast, not a write.
  let was = new Map<Eid, Was>()
  let guarded = (eid: Eid, comp: string, column: string, after: unknown) => {
    let w = was.get(eid)
    if (!w) was.set(eid, w = {})
    w[comp] = { ...w[comp], [column]: token(after) }
  }
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
    if (guard) guarded(d.target, d.comp, d.column, d.after)
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
    let moved = false
    for (let [comp, value] of held.get(eid)!) {
      moved = true
      // The spine is the bundle's own IDENTITY, not a component beside it: a
      // recorded patch to `entity` merges into the key that says who this
      // bundle is about, and never lands on top of the eid. A graph this
      // package journals never records one (the hook skips the spine), but a
      // log imported from elsewhere holds them, and a bundle with no eid is
      // not a bundle.
      if (comp == 'entity') {
        if (value) b.entity = { ...b.entity, ...value }
        continue
      }
      b[comp] = value
    }
    if (!moved) continue
    let w = was.get(eid)
    // A guard names only columns this bundle restores: a component the undo
    // removes whole has no column to hold a token.
    if (w) {
      let mine: Was = {}
      for (let [comp, cols] of Object.entries(w)) {
        if (b[comp] != null) mine[comp] = cols
      }
      if (Object.keys(mine).length) b.$was = mine
    }
    out.push(b)
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

/** How an undo is built. */
export type UndoneOpts = {
  /** carry a `$was` guard on every restored column, hashed from the value the
   * batch left there, so a column that moved since refuses the reversal */
  guard?: boolean
}

/**
 * The change that reverses a batch: every column back to the value it held,
 * every component that went restored whole, every component that appeared
 * dropped. Throws {@link Final} if the batch deleted an entity.
 */
export let undone = (batch: Batch, opts: UndoneOpts = {}): Change =>
  side(batch, 'before', opts.guard)

/**
 * Undo a committed batch by its `seq`: read it back out of the log, build the
 * inverse from what was written down, and apply it through the graph — so the
 * undo is admitted, stamped and journaled like any other write.
 *
 * ```ts
 * undo(g, j)(7, { by: 'ada' })
 * ```
 *
 * Throws {@link Final} if the batch deleted an entity, and a plain `Error` if
 * no batch has that seq. The inverse is applied as trusted, since restoring a
 * column the server owns is the graph's own reconstruction, not a client's
 * write. Every restored column carries a `$was` guard, so a column somebody
 * else has moved since refuses the whole reversal rather than clobbering it.
 */
export let undo =
  (g: Graph, j: Log) =>
  (seq: number, actor?: Actor): Bundle[] | Promise<Bundle[]> => {
    let batch = j.at(seq)
    if (!batch) throw new Error(`no journal batch #${seq}`)
    let change = undone(batch, { guard: true })
    if (!change.length) return []
    if (actor) change[0] = { ...change[0], $actor: actor }
    return g.apply(change, { trusted: true })
  }
