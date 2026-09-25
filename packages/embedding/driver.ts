// The handle this package runs statements through. It is deliberately the
// smallest shape a SQLite binding can satisfy — one function that runs a
// statement with bound params and returns rows, one that runs a statement for
// its effect — so nothing here names a concrete library, and an application
// that already has a database hands over the two methods it has.
//
// A vector rides as a BLOB, so a bound param may be bytes as well as a scalar.

import type { Param } from '@yaks/sql'

export type { Param }

/** One row, a bag of column values keyed by name — what a SELECT yields. */
export type Row = Record<string, unknown>

/**
 * A database handle, reduced to what this package calls:
 * `query` runs a parameterized statement and returns every row, `exec` runs one
 * for its effect (the schema, a delete).
 */
export type Driver = {
  query: (sql: string, params: Param[]) => Row[]
  exec: (sql: string) => void
}
