// The tiny surface @yaks/sqlite needs from a SQLite connection, and nothing
// more. Naming just these two methods keeps the adapter honest about what it
// touches and lets it sit over any driver: an embedded in-process SQLite, a
// pooled server handle, a remote HTTP-backed database. A driver is DATA-LAST
// config passed to `storage()` — the adapter never constructs one.
//
// The contract is deliberately synchronous: SQLite is a synchronous engine,
// the compiled statements are single round trips, and a synchronous seam keeps
// the read/write vocabulary free of promise plumbing. A driver whose engine is
// async wraps it at its own boundary.

// One row, a bag of column values keyed by name — exactly what a SELECT yields.
export type Row = Record<string, unknown>

// A bound parameter. The compiled SQL is always parameterized (values ride as
// binds, never as concatenated literals), so a driver only ever sees scalars.
export type Param = string | number | bigint | boolean | null | Uint8Array

// The connection, reduced to what the adapter calls:
//   query  run a parameterized statement and return every row
//   exec   run one or more statements for effect (DDL, writes) — no rows back
export type Driver = {
  query: (sql: string, params: Param[]) => Row[]
  exec: (sql: string) => void
}
