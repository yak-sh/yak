// Walking a recorded transaction in either direction. A recorded transaction
// carries both sides of every movement, so replaying it forward rebuilds the
// write that happened and replaying it backward builds the write that reverses
// it — one function, one argument apart.
//
// Forward is what a server pushes to its subscribers: the transaction as
// committed, as bundles, without reading storage at all. Backward is undo, and
// undo is an ordinary write — it goes through `apply()` like any other, so it
// is admitted, guarded, stamped, and journaled in its turn. Undoing an undo is
// a redo, for free.
//
// A deletion walks backward like anything else. The journal knows every
// component the entity held as it went, so the reversal gives them back, and a
// write that gives a deleted entity a component is what clears its tombstone
// (@yaks/graph's mutate phase): it comes back with its eid and its number.
// Whatever the deletion cascaded is in the same transaction and comes back
// with it.

import type { Actor, Bundle, Comp, Eid, Graph, Was } from '@yaks/graph'
import { token, TOMBSTONE } from '@yaks/graph'
import type { Batch } from './batch.ts'
import type { Log } from './log.ts'

/** A refused undo: the transaction deleted an entity whose components the
 * journal never recorded — it was written before the journal began, or only
 * in components the journal skips — so nothing can bring it back, and bringing
 * back the rest would leave whatever pointed at it pointing at a grave. */
export class Final extends Error {
  /**
   * @param eid the entity the transaction deleted
   * @param seq the transaction it was deleted in
   */
  constructor(public eid: Eid, public seq: number) {
    super(
      `${eid} was deleted in batch #${seq}, and the journal holds none of ` +
        `its components to bring it back with`,
    )
    this.name = 'Final'
  }
}

// One side of a recorded transaction, as bundles. The deltas are replayed onto
// a per-entity table of components: forward for the side after, so a
// component the transaction touched twice comes out where it ended up, and
// backward for the side before, so it comes out where it started.
let side = (
  batch: Batch,
  want: 'before' | 'after',
  guard = false,
): Bundle[] => {
  let back = want == 'before'
  let order = [...new Set(batch.deltas.map((d) => d.target))]
  let held = new Map<Eid, Map<string, Comp | null>>()
  // Whether each entity the transaction deleted or brought back lies deleted
  // on this side, and which of them it deleted.
  let grave = new Map<Eid, boolean>()
  let killed = new Set<Eid>()
  // What the transaction left in each property, hashed: the precondition an
  // undo carries, so that a property somebody else has changed since refuses
  // the whole reversal rather than quietly overwriting it. Walking backward,
  // the first delta to name a property holds the last value the transaction
  // left there, and a component it removed, or an entity it deleted, left
  // nothing in any of them. Only the backward side needs one — replaying
  // forward is a push to subscribers, not a write.
  let was = new Map<Eid, Was>()
  let guarded = (eid: Eid, comp: string, prop: string, after: unknown) => {
    if (!guard) return
    let w = was.get(eid)
    if (!w) was.set(eid, w = {})
    let c = w[comp] ??= {}
    if (!(prop in c)) c[prop] = token(after)
  }
  let of = (eid: Eid): Map<string, Comp | null> => {
    let t = held.get(eid)
    if (!t) held.set(eid, t = new Map())
    return t
  }
  for (let d of back ? batch.deltas.toReversed() : batch.deltas) {
    if (d.comp == TOMBSTONE) {
      grave.set(d.target, d[want] != null)
      if (d.after != null) killed.add(d.target)
      continue
    }
    let table = of(d.target)
    if (d.prop == null) {
      let whole = d[want] as Comp | null
      table.set(d.comp, whole == null ? null : { ...whole })
      for (let prop of Object.keys(whole ?? {})) {
        guarded(d.target, d.comp, prop, null)
      }
      continue
    }
    guarded(d.target, d.comp, d.prop, d.after)
    let cur = table.get(d.comp)
    if (cur === null) continue // the component is not there on this side
    table.set(d.comp, { ...(cur ?? {}), [d.prop]: d[want] ?? null })
  }
  let out: Bundle[] = []
  for (let eid of order) {
    if (grave.get(eid)) {
      out.push({ entity: { eid }, $delete: true })
      continue
    }
    let table = held.get(eid)
    if (!table?.size) {
      if (back && killed.has(eid)) throw new Final(eid, batch.seq)
      continue
    }
    let b: Bundle = { entity: { eid } }
    for (let [comp, value] of table) {
      // The entity row is the bundle's own identity, not a component beside
      // it: a recorded patch to `entity` merges into the key naming which
      // entity this bundle is about, and never lands on top of the eid. A
      // graph this package journals never records one (the hook skips the
      // entity row), but a log imported from elsewhere can hold them, and a
      // bundle with no eid is not a bundle.
      if (comp == 'entity') {
        if (value) b.entity = { ...b.entity, ...value }
        continue
      }
      b[comp] = value
    }
    let w = was.get(eid)
    // A guard names only properties this bundle restores: a component the undo
    // removes whole has no property to hold a token.
    if (w) {
      let mine: Was = {}
      for (let [comp, props] of Object.entries(w)) {
        if (b[comp] != null) mine[comp] = props
      }
      if (Object.keys(mine).length) b.$was = mine
    }
    out.push(b)
  }
  return out
}

/**
 * The transaction as committed, rebuilt from its deltas — the bundles a server
 * pushes to its subscribers when it reads the feed, with no read of storage at
 * all. They carry what moved, so who wrote it and when, which the `journal_tx`
 * row already holds, are not repeated in them.
 */
export let applied = (batch: Batch): Bundle[] => side(batch, 'after')

/** How an undo is built. */
export type UndoneOpts = {
  /** carry a `$was` precondition on every restored property, hashed from the
   * value the transaction left there, so that a property changed since refuses
   * the reversal */
  guard?: boolean
}

/**
 * The bundles that reverse a transaction: every property back to the value it
 * held, every component that went restored with the properties it had, every
 * component that appeared removed, every entity it deleted given back the
 * components it held, and every entity it brought back deleted again. Throws
 * {@link Final} if the transaction deleted an entity the journal recorded none
 * of the components of.
 */
export let undone = (batch: Batch, opts: UndoneOpts = {}): Bundle[] =>
  side(batch, 'before', opts.guard)

/**
 * Undo a committed transaction by its `seq`: read it back out of the log, build
 * the inverse from what was written down, and apply it through the graph — so
 * the undo is admitted, stamped and journaled like any other write:
 * `undo(g, j)(7, { by: 'ada' })` reverses transaction 7 as `ada`.
 *
 * Throws {@link Final} if the transaction deleted an entity the journal holds
 * none of the components of, and a plain `Error` if no transaction has that
 * seq. The inverse is applied as trusted, since restoring a property the
 * server owns is the graph's own reconstruction rather than a client's write.
 * Every restored property carries a `$was` precondition, so a property
 * somebody else has changed since refuses the whole reversal instead of being
 * overwritten.
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
