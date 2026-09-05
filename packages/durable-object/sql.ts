// The Durable Object's SQLite, reduced to the two things a store needs from a
// connection — a parameterized statement, and a transaction — and shaped as
// @yaks/sqlite's `Driver`. That is the whole trick of this package: the schema,
// the compiled reads, the patches and the death cascade are @yaks/sqlite's
// already, and a Durable Object is one more place to run them.
//
// Two things about the runtime shape the code here, both checked against
// workerd rather than the docs alone:
//
//   VALUES ARE NARROW. A binding must be an ArrayBuffer, a string, a number or
//   null. A boolean would bind as the text 'true' and a bigint throws, so both
//   are converted before they reach the engine, and a blob comes back as an
//   ArrayBuffer where every other adapter hands back bytes.
//
//   TRANSACTIONS ARE NOT SQL. `begin`, `savepoint` and their friends are
//   refused as statements; `transactionSync` is the transaction, and it nests.
//   That is what `Driver.tx` exists for.

import type { Driver, Param, Row } from '@yaks/sqlite'

/** A value the engine will bind: everything else is converted first. */
export type SqlValue = ArrayBuffer | string | number | null

/** What `exec` hands back — the rows, drained with `toArray()`. */
export type SqlCursor<T> = Iterable<T> & {
  /** every remaining row, read at once */
  toArray(): T[]
}

/**
 * The synchronous SQLite handle of a Durable Object — the shape of
 * `ctx.storage.sql`, reduced to the one method this package calls. Naming just
 * this keeps the adapter free of any Cloudflare dependency; a `SqlStorage`
 * satisfies it.
 */
export type DurableSql = {
  /** run a statement with its bindings and hand back the rows */
  exec(query: string, ...bindings: SqlValue[]): SqlCursor<Row>
}

/**
 * The object's storage — the shape of `ctx.storage`: its SQLite handle, and
 * the transaction the runtime insists on. `transactionSync` nests, commits
 * when the body returns, and rolls back when it throws.
 */
export type DurableStorage = {
  /** the embedded SQLite engine */
  sql: DurableSql
  /** run a body as one all-or-nothing unit of work */
  transactionSync<T>(body: () => T): T
}

// A value as the engine takes it. `undefined` and `null` are the same absence;
// a boolean is the 0/1 an integer column holds; a bigint is a number (workerd
// refuses one outright); a byte array is the ArrayBuffer it is a window onto.
let bind = (value: Param): SqlValue =>
  value == null
    ? null
    : typeof value == 'boolean'
    ? Number(value)
    : typeof value == 'bigint'
    ? Number(value)
    : value instanceof Uint8Array
    ? value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ) as ArrayBuffer
    : value

// A row as the rest of the stack expects it: a blob is bytes, the way every
// other driver hands one back.
let unbind = (row: Row): Row => {
  for (let key in row) {
    let value = row[key]
    if (value instanceof ArrayBuffer) row[key] = new Uint8Array(value)
  }
  return row
}

/**
 * A {@link https://jsr.io/@yaks/sqlite | @yaks/sqlite} `Driver` over a Durable
 * Object's storage. It converts the values the engine will not take, hands the
 * transaction back to `transactionSync`, and turns foreign keys on — the
 * enforcement the schema's references are written for, which workerd leaves off
 * per connection.
 *
 * ```ts
 * // let store = storage(ctx.storage, vocab) // …which is this, bound
 * ```
 */
export let driver = (durable: DurableStorage): Driver => {
  let query = (sql: string, params: Param[]): Row[] =>
    durable.sql.exec(sql, ...params.map(bind)).toArray().map(unbind)
  query('pragma foreign_keys = on', [])
  return {
    query,
    // The cursor is lazy: draining it is what runs the statement.
    exec: (sql) => {
      durable.sql.exec(sql).toArray()
    },
    tx: (body) => durable.transactionSync(body),
  }
}
