// The store seam (D-32318 §"Not tied to Cloudflare"): the SQL a graph store
// needs, as one interface. db.ts speaks only this — prepare/get/all/run, exec,
// transaction, the last rowid, the schema version, close — so a backend is one
// adapter beside another (store/sqlite.ts is the SQLite file via @db/sqlite,
// store/do.ts a Durable Object's SQLite), never a fork of the store. Nothing
// here imports a driver.
//
// What the interface promises beyond its methods, because db.ts relies on it:
// a thrown statement error carries `errcode` (SQLite's extended result code;
// db.ts reads 787 to name an FK bounce), and a failed step leaves no statement
// in progress on the connection. A backend that lacks a whole feature says so
// in `can`, and db.ts plants what it can and refuses the door it cannot serve
// — search() without FTS5 throws, it never guesses.

export type SqlValue =
  | number
  | string
  | bigint
  | boolean
  | null
  | undefined
  | Date
  | Uint8Array
  | SqlValue[]
  | { [key: string]: SqlValue }

export type RunResult = {
  changes: number
  lastInsertRowid: number | bigint
}

export type Statement = {
  get<T extends object = Record<string, unknown>>(
    ...args: SqlValue[]
  ): T | undefined
  all<T extends object = Record<string, unknown>>(...args: SqlValue[]): T[]
  run(...args: SqlValue[]): RunResult
}

// What a backend offers beyond plain SQL. The file adapter answers true to
// all of it; a hosted SQLite answers per its runtime.
export type Can = {
  // FTS5 virtual tables: doc_fts/doc_gram, the search() and text-predicate
  // doors that read them.
  fts: boolean
  // `create temp table`: a connection-scoped scratch table. Without it db.ts
  // stages its scratch sets (snapshot's omit set, the keyed reader's hits) in
  // ordinary tables, cleared before each use.
  temp: boolean
}

export type Sql = {
  prepare(sql: string): Statement
  exec(sql: string): void
  // The one transaction door. Runs fn atomically and returns its value; a
  // throw rolls back what fn wrote and rethrows. Nests: inside an open
  // transaction the inner run is a savepoint, so an inner failure caught by
  // the outer leaves the outer's writes intact. `immediate` takes the write
  // lock up front (a file store's `begin immediate`, so a waiter serializes
  // at the door instead of failing on upgrade); a store that owns its one
  // writer ignores it. No caller issues begin/commit/rollback/savepoint as SQL:
  // a hosted SQLite refuses the statements (workerd routes every transaction
  // through transactionSync), so the statements live in the file adapter only.
  transaction<T>(fn: () => T, immediate?: boolean): T
  // True while a transaction is open (autocommit off).
  readonly inTransaction: boolean
  readonly lastInsertRowId: number | bigint
  readonly isOpen: boolean
  readonly can: Can
  // The schema version the store carries: SQLite's user_version on a file
  // (the Rust kernel reads the same header slot), wherever a hosted store can
  // keep one integer. migrate() and plant() stamp it; a newer version than the
  // serving binary knows fails closed.
  version: number
  close(): void
}

// SQLite trim() only knows the characters named by its second argument. Agent
// evidence needs JavaScript's complete WhiteSpace + LineTerminator semantics,
// including NBSP, Unicode spaces, and BOM. textPresent is that truth in JS;
// present() is the same test as a SQL expression, so no adapter needs a
// user-defined function (a hosted SQLite has none). The list is ECMAScript's
// (WhiteSpace ∪ LineTerminator: TAB VT FF SP NBSP ZWNBSP, category Zs, LF CR
// LS PS); sql_test.ts proves it equals String.prototype.trim over the BMP,
// which is where every Unicode space lives.
export let textPresent = (value: unknown) =>
  typeof value == 'string' && value.trim().length > 0

export let WHITESPACE = [
  0x9,
  0xa,
  0xb,
  0xc,
  0xd,
  0x20,
  0xa0,
  0x1680,
  0x2000,
  0x2001,
  0x2002,
  0x2003,
  0x2004,
  0x2005,
  0x2006,
  0x2007,
  0x2008,
  0x2009,
  0x200a,
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
  0xfeff,
]

// `col` is a column reference (never a value); the expression is null-safe
// in a WHERE the way text_present(null) was false.
export let present = (col: string) =>
  `trim(${col}, char(${WHITESPACE.join(',')})) != ''`
