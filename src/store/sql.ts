// The store seam (D-32318 §"Not tied to Cloudflare"): the SQL a graph store
// needs, as one interface. db.ts speaks only this — prepare/get/all/run, exec,
// the transaction flag, the last rowid, close — so a backend is one adapter
// beside another (store/sqlite.ts is the first, the SQLite file via
// @db/sqlite), never a fork of the store. Nothing here imports a driver.
//
// What the interface promises beyond its methods, because db.ts relies on it:
// a thrown statement error carries `errcode` (SQLite's extended result code;
// db.ts reads 787 to name an FK bounce), a failed step leaves no statement in
// progress on the connection, and the `text_present` SQL function is
// registered with textPresent()'s semantics. A backend that lacks a whole
// feature says so in `can`, and db.ts plants what it can and refuses the door
// it cannot serve — search() without FTS5 throws, it never guesses.

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
}

export type Sql = {
  prepare(sql: string): Statement
  exec(sql: string): void
  // True while a transaction is open (autocommit off). A rollback in a catch
  // reads this so a `begin` that never took the lock is not rolled back — an
  // empty rollback throws and would mask the real error.
  readonly inTransaction: boolean
  readonly lastInsertRowId: number | bigint
  readonly isOpen: boolean
  readonly can: Can
  close(): void
}

// SQLite trim() only knows the characters named by its second argument. Agent
// evidence needs JavaScript's complete WhiteSpace + LineTerminator semantics,
// including NBSP, Unicode spaces, and BOM, without maintaining a codepoint list.
// Every adapter registers this as the `text_present` SQL function.
export let textPresent = (value: unknown) =>
  typeof value == 'string' && value.trim().length > 0
