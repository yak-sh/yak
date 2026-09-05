// The handle this package runs statements through. It is deliberately the
// smallest shape a SQLite binding can satisfy — one function that runs a
// statement with bound params and returns rows, one that runs a statement for
// its effect — so nothing here names a concrete library, and an application
// that already has a database hands over the two methods it has.
//
// The statement builders (`schema`, `hits`) need no driver at all: they answer
// SQL a caller may run through anything, including an async engine. Only the
// conveniences that run those statements (`search`, `heal`) take one.

import type { Row } from '@yaks/graph'

// Runs a statement with its bound params and returns the rows.
export type Rows = (sql: string, params: (string | number)[]) => Row[]

// Runs a statement for its effect.
export type Exec = (sql: string) => void

// A database handle: the two above.
export type Driver = { query: Rows; exec: Exec }
