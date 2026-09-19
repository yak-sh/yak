// What a journal answers with. A batch is the unit the log is kept in — one
// committed write, its provenance, and every movement it made — and a delta is
// one of those movements: a column that changed, or a whole component that
// appeared or went.
//
// These are the shapes the log DERIVES, not the shapes it stores: the tables
// keep after-images only (`./log.ts`), and the before-side of every movement is
// rebuilt at read time from the entity's own slice of the log. They live apart
// from both so `./undo.ts` can walk a batch in either direction without knowing
// where the rows came from.

import type { Comp, Eid } from '@yaks/graph'

/**
 * One thing that moved. A `column` names the column that moved, with the value
 * on each side of the write; a delta with NO column is about the component as
 * a whole — `after` set is the component appearing, `before` set is the
 * component going, and both spellings carry the columns it held.
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

/** One committed batch: where it sits in the log, who wrote it, and what
 * moved. */
export type Batch = {
  /** its place in the total order — the cursor a feed pages by */
  seq: number
  /** when it committed, ISO-8601 */
  at: string
  /** the actor that wrote it, from the batch's `$actor` */
  by: Eid | null
  /** the instrument it was written through */
  via: Eid | null
  /** what moved, in the order it moved */
  deltas: Delta[]
}

/**
 * One recorded operation: a component patched to `value`, or removed when
 * `value` is null. The unit the tables store natively and the unit a wire that
 * speaks component patches replays — a batch is a list of these, in the order
 * they were applied.
 */
export type Patch = {
  /** the entity the operation was about */
  target: Eid
  /** the component it patched, or `entity` for the spine itself */
  comp: string
  /** the columns it wrote, or `null` for a removal */
  value: Comp | null
}

/** One committed batch as the tables hold it: its provenance, the note the
 * writer left beside it, and what it did. */
export type Entry = {
  /** its place in the total order — the cursor a feed pages by */
  seq: number
  /** when it committed, ISO-8601 */
  at: string
  /** the actor it resolved to, or null when unowned */
  by: Eid | null
  /** the instrument it was written through */
  via: Eid | null
  /** whatever the writer wrote down beside the batch, verbatim */
  note: string | null
  /** what it did, in the order it did it */
  patches: Patch[]
}
