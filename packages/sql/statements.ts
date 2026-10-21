// The statement capability a storage adapter lends to indexes beside its
// graph. It carries no connection, file, native-library path or schema cache.
import type { Row } from './driver.ts'
import type { Stmt } from './ast.ts'

/** Synchronous statements over the same storage and transaction as the graph.
 * An adapter may omit this capability when its storage is not SQL-backed. */
export type Statements = {
  query: (statement: Stmt) => Row[]
  /** Whether other hosts can write this storage. */
  ownership: 'exclusive' | 'shared'
  /** Compound-select limit of the adapter's statement engine. */
  arms?: number
  /** Entity rows point at the standard archetype table. A null pointer still
   * needs component-table presence checks until it is classified. */
  archetypes?: boolean
  /** Invalidation tokens include writes, DDL and rollback, and other hosts. */
  revision: (scope: 'schema' | 'catalog' | 'data') => number
  /** A synchronous unit on the adapter's transaction, nested where needed. */
  atomic: <R>(body: () => R) => R
  /** Named engine facilities; only the adapter knows how to load them. */
  facilities?: { vector?: () => void }
  /** What this connection reads, where it is not main as it stands: main as
   * of a transaction, or a branch, whose writes reach no other host. */
  mode?: Mode
}

/** What a store keeps history with, as statements its history plugin hands
 * it (@yaks/journal over @yaks/sqlite): `clock` takes the id of the
 * transaction a unit's versions name, and `tip` reads the newest one's; each
 * answers it as `id`. */
export type History = { clock: Stmt; tip: Stmt }

/** What a connection to a store with history reads: main as of a
 * transaction, or a branch, which reads main as it stood at its fork under
 * its own rows. */
export type Mode = { at: number } | { branch: number; fork: number }

/** Require the SQL capability rather than guessing where the host stores data. */
export let statements = (storage: { statements?: Statements }): Statements => {
  if (!storage.statements) {
    throw new Error('this storage offers no SQL statements')
  }
  return storage.statements
}
