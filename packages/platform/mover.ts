// What the store mover answers about a store (workers/yak mover.ts, D-45640):
// the stores a sweep asks, where each rule stands in one, and what a
// rehearsal of it found.

/** A rule's name: where its stamp is kept in a store's memory, and the
 * `BOUNDARIES` entry its live release adds. */
export type Mark = `yak/store/${string}`

/** How far one rule got in one store. `after` is the last row it moved past;
 * `unspoken` is a word the rule reads that this store does not declare, so
 * it held nothing to move. */
export type Stamp = {
  moved: number
  /** Durable destination records; present only for forwarding rules. */
  forwarded?: number
  at: string
  after?: string
  done?: string
  unspoken?: string
  failed?: string
}

/** Where one rule stands in one store, as a wake answers it. */
export type Standing = Partial<Stamp> & { mark: Mark; live: boolean }

/** What one rule's rehearsal found in one store: the rows it would move, and
 * how many it moved, in how many batches, before its bound. */
export type Rehearsal = {
  mark: Mark
  rows: number
  moved: number
  forwarded?: number
  batches: number
  unspoken?: string
  failed?: string
}

/** One store a sweep asks: its name, and what a person calls it. */
export type Swept = { store: string; at: string }
