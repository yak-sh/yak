// The handle this package runs statements through: the smallest shape a
// SQLite binding can satisfy, one function that runs a statement with bound
// params and returns rows, one that runs a statement for its effect. Nothing
// here names a concrete library; an application hands over the two methods it
// already has.

/** One row, a bag of column values keyed by name. */
export type Row = Record<string, unknown>

/** A bound parameter; nothing is ever concatenated into the SQL text. */
export type Param = string | number | null

/**
 * A database handle reduced to what this package calls: `query` runs a
 * parameterized statement and returns every row, `exec` runs one for its
 * effect (the schema).
 */
export type Driver = {
  query: (sql: string, params: Param[]) => Row[]
  exec: (sql: string) => void
}
