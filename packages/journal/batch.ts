// The types the journal returns. A transaction — one call to `graph.apply()`,
// whose bundles all commit or none do — is the unit the log is kept in: one
// committed write, who wrote it, and every movement it made. A delta is one of
// those movements: a column that changed, or a whole component that appeared or
// went.
//
// These are the shapes the log DERIVES, not the shapes it stores: the tables
// keep after-images only (`./log.ts`), and the before-side of every movement is
// rebuilt at read time from the entity's own rows in the log. They live in
// their own file so `./undo.ts` can walk a transaction in either direction
// without knowing where the rows came from.

import type { Comp, Eid } from '@yaks/graph'

/**
 * One thing that moved. A delta with a `column` names the column that moved and
 * carries the value on each side of the write; a delta with NO column is about
 * the component as a whole — `after` set means the component appeared, `before`
 * set means it went, and either way the set side holds the columns it had.
 */
export type Delta = {
  /** the entity that changed */
  target: Eid
  /** the component that changed */
  comp: string
  /** the column that moved, or `null` for the whole component */
  column: string | null
  /** what it held before (`null` for nothing) */
  before: unknown
  /** what it holds after (`null` for nothing) */
  after: unknown
}

/** One committed transaction: where it sits in the log, who wrote it, and what
 * moved. */
export type Batch = {
  /** its place in the total order — the cursor a feed pages by */
  seq: number
  /** when it committed, ISO-8601 */
  at: string
  /** the identity it was written for, from the transaction's `$actor` */
  by: Eid | null
  /** the instrument it was written through */
  via: Eid | null
  /** what moved, in the order it moved */
  deltas: Delta[]
}

/**
 * One recorded operation: a component patched to `value`, or removed when
 * `value` is null. This is the unit the tables store directly, and the unit a
 * client that applies component patches can replay — a transaction is a list of
 * these, in the order they were applied.
 */
export type Patch = {
  /** the entity the operation was about */
  target: Eid
  /** the component it patched, or `entity` for the entity row itself */
  comp: string
  /** the columns it wrote, or `null` for a removal */
  value: Comp | null
}

/** One committed transaction as the tables hold it: who wrote it, the note the
 * writer left beside it, and what it did. */
export type Entry = {
  /** its place in the total order — the cursor a feed pages by */
  seq: number
  /** when it committed, ISO-8601 */
  at: string
  /** the identity it resolved to, or null when nobody was named */
  by: Eid | null
  /** the instrument it was written through */
  via: Eid | null
  /** whatever the writer wrote down beside the transaction, verbatim */
  note: string | null
  /** what it did, in the order it did it */
  patches: Patch[]
}
