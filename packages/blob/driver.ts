// The handle the SQLite backend runs statements through. Deliberately the
// smallest shape a SQLite binding can satisfy — one function that runs a
// statement with bound params and returns rows, one that runs a statement for
// its effect — so nothing here names a concrete library, and an application
// that already has a database hands over the two methods it has (a storage
// adapter's driver is one of these).

import type { Row } from '@yaks/graph'

/** A bound parameter. Statements here are always parameterized, so a driver
 * only ever sees scalars. */
export type Param = string | number | bigint | boolean | null | Uint8Array

/** Runs a statement with its bound params and returns the rows. */
export type Rows = (sql: string, params: Param[]) => Row[]

/** Runs a statement for its effect. */
export type Exec = (sql: string) => void

/** A database handle: the two above. */
export type Driver = { query: Rows; exec: Exec }
