// Cloudflare D1, reduced to the three calls a store makes — prepare a
// statement, bind and run it, send a list of statements as one batch — plus the
// value conversions the engine's own type table demands. Naming just this keeps
// the adapter free of any Cloudflare dependency at runtime; ./conform.ts is
// where the claim is checked against the runtime's published types.
//
// Two facts about D1 shape everything above this file:
//
//   IT IS ASYNC. There is no synchronous door. Every read is a round trip, so
//   the adapter gathers what it can into one `batch()` rather than issuing a
//   statement per question.
//
//   A BATCH IS THE ONLY TRANSACTION. `begin`, `savepoint` and their friends are
//   not statements you may send; `batch()` runs its list sequentially inside one
//   implicit transaction and rolls the whole list back if any statement fails.
//   There is no interactive transaction — nothing holds a lock open while your
//   code decides what to write next. ./store.ts is built around that.

/** A value D1 binds: its documented type table, and nothing else. A boolean
 * rides as the 0/1 an integer column holds; bytes ride as an ArrayBuffer. */
export type D1Value = ArrayBuffer | string | number | boolean | null

/** One row: a bag of column values keyed by name. */
export type Row = Record<string, unknown>

/** What a run hands back — the rows it selected. */
export type D1Result<T> = { results: T[] }

/**
 * A prepared statement, generic over the type the binding hands back. The
 * adapter treats one as OPAQUE: it binds values, runs it for rows, or passes it
 * straight back to {@link D1Like.batch}. Keeping the type a parameter is what
 * lets a `D1PreparedStatement` be used as itself rather than narrowed to a
 * slice — a statement appears both as a return and as an argument, and a
 * narrowed slice cannot be both.
 */
export type Stmt<S> = {
  /** bind positional parameters, returning the bound statement */
  bind: (...values: D1Value[]) => S
  /** run the statement and resolve its result rows */
  all: <T = Row>() => Promise<D1Result<T>>
}

/** The default statement shape, for a caller naming {@link D1Like} without a
 * binding of its own: this package's own slice, closed over itself. */
export type D1Stmt = {
  /** bind positional parameters, returning the bound statement */
  bind: (...values: D1Value[]) => D1Stmt
  /** run the statement and resolve its result rows */
  all: <T = Row>() => Promise<D1Result<T>>
}

/**
 * The async surface this adapter needs from a `D1Database`: prepare a
 * statement, and send a list of them as one atomic batch. A Cloudflare
 * `D1Database` satisfies it — see ./conform.ts.
 */
export type D1Like<S extends Stmt<S> = D1Stmt> = {
  /** prepare a parameterized statement for binding and running */
  prepare: (sql: string) => S
  /** run these statements sequentially, as one all-or-nothing transaction */
  batch: (statements: S[]) => Promise<D1Result<Row>[]>
}

/** One statement: the SQL, and the values it binds. A read builds these here, a
 * write builds them in @yaks/sqlite; ./store.ts prepares and sends them
 * together, putting every value through {@link bind} on the way — which is why
 * the values are unnarrowed until then. */
export type Sql = { sql: string; params: readonly unknown[] }

/**
 * A value as D1 takes it. `undefined` and `null` are the same absence; a bigint
 * becomes a number (D1 refuses one outright); a byte array becomes the
 * ArrayBuffer it is a window onto. A boolean passes through — D1 stores it as
 * 0/1 — so nothing here has to know a column's affinity.
 */
export let bind = (value: unknown): D1Value =>
  value == null
    ? null
    : typeof value == 'bigint'
    ? Number(value)
    : value instanceof Uint8Array
    ? value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ) as ArrayBuffer
    : value as D1Value

/**
 * A row as the rest of the stack expects it. D1 hands a BLOB back as an array
 * of byte values; every other adapter hands back bytes, so it is converted here
 * and a caller never learns which database answered.
 */
export let unbind = (row: Row): Row => {
  for (let key in row) {
    let value = row[key]
    if (Array.isArray(value)) row[key] = Uint8Array.from(value as number[])
  }
  return row
}
