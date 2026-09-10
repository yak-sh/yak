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
//   tx     optional: the engine's own transaction, when SQL cannot open one
export type Driver = {
  query: (sql: string, params: Param[]) => Row[]
  /** Run a write without materializing rows and return its affected-row count
   * (excluding triggers). Optional for query-only drivers. */
  run?: (sql: string, params: Param[]) => number
  exec: (sql: string) => void
  /**
   * Run `body` as one all-or-nothing unit — commit when it returns, roll back
   * when it throws — for an engine that owns transactions itself. Most drivers
   * omit this and the store opens a SAVEPOINT with plain SQL; a Cloudflare
   * Durable Object refuses `savepoint` as a statement and hands out
   * `transactionSync` instead, which is what this seam is for. It must nest,
   * and it is SYNCHRONOUS: a body that returns a promise commits when the body
   * returns, not when the promise settles.
   */
  tx?: <R>(body: () => R) => R
  /**
   * How many terms one compound SELECT may carry on this engine. Workerd — the
   * SQLite under a Durable Object — is built with SQLITE_MAX_COMPOUND_SELECT =
   * 5 and answers a sixth term with `too many terms in compound SELECT`, where
   * an embedded SQLite carries the stock 500. The adapter cuts its
   * vocabulary-wide probes to this, and the DEFAULT is workerd's (@yaks/sql
   * `ARMS`), so a driver that says nothing asks in more statements rather than
   * asking one the engine refuses. A driver over an embedded SQLite says
   * @yaks/sql `STOCK` and gets its whole vocabulary in one probe.
   */
  arms?: number
}
