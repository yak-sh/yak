/**
 * @yaks/journal — the memory of a yaks graph: who wrote what, when, and how to
 * walk it forwards or backwards.
 *
 * Every change committed through {@link https://jsr.io/@yaks/graph | @yaks/graph}'s
 * `apply()` passes through this package's journal phase, which records an
 * attributed {@link Entry} — the change, its author, and the moment. From that
 * one log everything else is derived:
 *
 * - **history** — the entries touching a given entity, newest first;
 * - **undo** — the inverse change that reverts an entry;
 * - **cursors** — a per-reader marker into the log, so a client resumes where
 *   it left off;
 * - **deltas** — the changes since a cursor, the feed a live client replays;
 * - **effect-feed** — the same stream an effect worker consumes at-most-once.
 *
 * This package owns the recording and the derivations; it does not own the
 * store — it writes through whatever {@link Storage} the graph is bound to.
 *
 * @module
 */

import type { Change, Eid } from '@yaks/graph'

/** Who authored a change: an actor id and, optionally, the instrument used. */
export type Attribution = { by: Eid | null; via?: string }

/** One recorded change: a monotonically increasing seq, the change, its author. */
export type Entry = {
  /** the log position — monotonic, the unit a cursor names */
  seq: number
  /** when it committed */
  at: string
  /** who committed it */
  who: Attribution
  /** the change as applied */
  change: Change
}

/** A reader's marker into the log — the last seq it has seen. */
export type Cursor = { reader: string; seq: number }

/**
 * The journal seam: record a committed change, then read history, invert an
 * entry, or stream the entries after a cursor. The implementation lands with
 * the package; this is the shape it satisfies.
 */
export type Journal = {
  /** append an attributed entry for a committed change */
  record: (change: Change, who: Attribution) => Entry
  /** the entries touching an entity, newest first */
  history: (entity: Eid) => Entry[]
  /** the change that reverts an entry (undo) */
  invert: (seq: number) => Change
  /** the entries after a cursor's seq — the delta a client replays */
  since: (cursor: Cursor) => Entry[]
}
