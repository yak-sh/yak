// The database handle this package runs statements through. It is deliberately
// the smallest interface a SQLite binding can satisfy — one function that runs
// a statement with bound params and returns rows, one that runs a statement for
// its effect — so nothing here depends on a particular library, and an
// application that already has a database passes in the two methods it has.
//
// The functions that only build statements (`schema`, `hits`) need no driver at
// all: they return SQL the caller may run through anything, including an async
// engine. Only the convenience functions that run those statements (`find`,
// `heal`, `adopt`) take one.

import type { Row } from '@yaks/graph'
import type { Param } from '@yaks/sql'

// Runs a statement with its bound params and returns the rows.
export type Rows = (sql: string, params: Param[]) => Row[]

// Runs a statement for its effect.
export type Exec = (sql: string) => void

// A database handle: the two above.
export type Driver = { query: Rows; exec: Exec }
