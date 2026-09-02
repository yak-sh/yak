// A Durable Object's SQLite as the store seam's second adapter (D-32318
// §Storage): `ctx.storage.sql` behind the Sql interface (store/sql.ts), so
// db.ts runs unchanged inside a Worker. Everything Cloudflare-shaped about the
// store lives here and in workers/yak/; nothing above the seam knows. The
// storage surface is typed structurally below — the slice this adapter
// touches, mirroring @cloudflare/workers-types — so src/ carries no Cloudflare
// dependency and `deno check` reads it without one.
//
// Each choice below was checked against workerd itself (1.20251008 under
// wrangler 4.42.2), not the docs alone; the probe's answers are recorded at
// the member that depends on them.
import {
  type Can,
  type RunResult,
  type Sql,
  type SqlValue,
  type Statement,
} from './sql.ts'

export type SqlCursor<T> = Iterable<T> & {
  toArray(): T[]
  rowsWritten: number
}

export type DoStorage = {
  sql: {
    exec<T extends Record<string, unknown> = Record<string, unknown>>(
      query: string,
      ...bindings: unknown[]
    ): SqlCursor<T>
  }
  transactionSync<T>(fn: () => T): T
  kv: {
    get(key: string): unknown
    put(key: string, value: unknown): void
  }
}

// workerd binds only number | string | null | ArrayBuffer(view): a bigint
// throws ("Cannot convert a BigInt value to a number"), a boolean binds as the
// TEXT 'true', a Date as its toString. Every SqlValue the file driver accepts
// is spelled the way @db/sqlite stores it before it reaches the cursor.
let bind = (v: SqlValue): unknown =>
  v === undefined
    ? null
    : typeof v == 'bigint'
    ? Number(v)
    : typeof v == 'boolean'
    ? (v ? 1 : 0)
    : v instanceof Date
    ? v.toISOString()
    : v instanceof Uint8Array
    ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)
    : v != null && typeof v == 'object'
    ? JSON.stringify(v)
    : v

// A blob comes back as an ArrayBuffer; the file driver hands db.ts a
// Uint8Array, so every consumer sees one shape.
let unbind = <T extends Record<string, unknown>>(row: T): T => {
  for (let k in row) {
    let v = row[k]
    if (v instanceof ArrayBuffer) {
      ;(row as Record<string, unknown>)[k] = new Uint8Array(v)
    }
  }
  return row
}

// workerd throws a plain Error whose message ends in the result code's name
// ("FOREIGN KEY constraint failed: SQLITE_CONSTRAINT"); the extended code the
// seam promises (787 = SQLITE_CONSTRAINT_FOREIGNKEY, what db.ts reads to name
// an FK bounce) is recovered from the message.
let tag = (e: unknown) => {
  if (e instanceof Error && !('errcode' in e)) {
    let m = e.message
    let code = /FOREIGN KEY constraint failed/.test(m)
      ? 787
      : /UNIQUE constraint failed/.test(m)
      ? 2067
      : /NOT NULL constraint failed/.test(m)
      ? 1299
      : /SQLITE_CONSTRAINT/.test(m)
      ? 19
      : /SQLITE_AUTH/.test(m)
      ? 23
      : 1
    Object.defineProperty(e, 'errcode', { value: code })
  }
  return e
}

export class DoStatement implements Statement {
  #db: DoSql
  #sql: string

  constructor(db: DoSql, sql: string) {
    this.#db = db
    this.#sql = sql
  }

  get<T extends object = Record<string, unknown>>(...args: SqlValue[]) {
    return this.all<T>(...args)[0]
  }

  all<T extends object = Record<string, unknown>>(...args: SqlValue[]): T[] {
    return this.#db.cursor(this.#sql, args).toArray().map(unbind) as T[]
  }

  // The cursor's rowsWritten counts index entries too (an insert into a table
  // with one unique index reports 2), so `changes` is SQLite's own changes()
  // read right after the statement, the number the file driver reports.
  run(...args: SqlValue[]): RunResult {
    this.#db.cursor(this.#sql, args).toArray()
    let { c, r } = this.#db.cursor(
      'select changes() as c, last_insert_rowid() as r',
      [],
    ).toArray()[0] as { c: number; r: number }
    return { changes: c, lastInsertRowid: r }
  }
}

export class DoSql implements Sql {
  #storage: DoStorage
  #depth = 0
  // FTS5 is compiled in (unicode61 and trigram tokenizers both answered), so
  // the FTS DDL plants and search() serves. `create temp table` is refused by
  // workerd's authorizer ("not authorized: SQLITE_AUTH"), so db.ts keeps its
  // scratch sets in ordinary tables here.
  can: Can = { fts: true, temp: false }

  constructor(storage: DoStorage) {
    this.#storage = storage
    // Allowed by the authorizer; a file adapter sets it per connection too.
    this.exec('pragma foreign_keys = on')
  }

  // The object's key-value slots beside its SQL: the schema version lives in
  // one (below), and the Worker keeps the object's own name in another.
  get kv() {
    return this.#storage.kv
  }

  cursor(sql: string, args: SqlValue[]) {
    try {
      return this.#storage.sql.exec(sql, ...args.map(bind))
    } catch (e) {
      throw tag(e)
    }
  }

  prepare(sql: string) {
    return new DoStatement(this, sql)
  }

  // Multiple statements in one string run in order, exactly what db.ts's
  // multi-statement DDL execs expect; bindings would apply to the last only,
  // and exec passes none.
  exec(sql: string) {
    this.cursor(sql, []).toArray()
  }

  // workerd refuses BEGIN, COMMIT, ROLLBACK and SAVEPOINT as SQL, inside or
  // outside transactionSync ("please use the state.storage.transaction() or
  // state.storage.transactionSync() APIs"). transactionSync IS the seam's
  // transaction: it nests — each level is a savepoint under the hood, an
  // inner throw rolls back only the inner run and the outer keeps its writes —
  // and a throw out of the outermost level leaves nothing written, which is
  // how a failing apply() leaves no partial write. `immediate` is moot: the
  // object is its store's only writer, and a write outside any transaction is
  // coalesced into workerd's implicit one for the event-loop turn.
  transaction<T>(fn: () => T, _immediate = false): T {
    this.#depth++
    try {
      return this.#storage.transactionSync(fn)
    } finally {
      this.#depth--
    }
  }

  get inTransaction() {
    return this.#depth > 0
  }

  get lastInsertRowId() {
    return (this.cursor('select last_insert_rowid() as r', []).toArray()[0] as {
      r: number
    }).r
  }

  get isOpen() {
    return true
  }

  // `pragma user_version` is refused both ways (not on the authorizer's pragma
  // list), so the schema version keeps in the object's own KV store, the one
  // header-like slot it has.
  get version() {
    return Number(this.#storage.kv.get('schema_version') ?? 0)
  }

  set version(v: number) {
    this.#storage.kv.put('schema_version', v)
  }

  // The object's storage closes with the object; nothing to do.
  close() {}
}
