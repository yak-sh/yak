// The database handle this package runs statements through: the smallest
// interface a SQLite binding can satisfy — one function that runs a statement
// with bound parameters and returns rows, and one that runs a statement for its
// effect. Nothing here names a specific library; the application passes in the
// two methods it already has.

/** One row: its column values, keyed by column name. */
export type Row = Record<string, unknown>

/** A bound parameter; nothing is ever concatenated into the SQL text. */
export type Param = string | number | null

/**
 * A database handle reduced to what this package calls: `query` runs a
 * parameterized statement and returns every row, and `exec` runs one for its
 * effect (creating the schema).
 */
export type Driver = {
  query: (sql: string, params: Param[]) => Row[]
  exec: (sql: string) => void
}
