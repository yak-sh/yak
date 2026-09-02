// The SQLite file, as the store seam's first adapter: @db/sqlite behind the
// Sql interface (store/sql.ts), plus everything only a file store has — the
// path of the owner's live graph, DB_PATH, the WAL integrity check at boot,
// the connection pragmas, the vector extension, and the FFI serialize/
// deserialize the test fixture clones with. Nothing above this module names
// the driver; db.ts speaks Sql. Linux uses the system library because
// @db/sqlite's 0.13.0 bundled x86_64 library crashes during sqlite3_initialize
// on Deno 2.9.

// Declaration order is load-bearing: the prelude sets DENO_SQLITE_PATH, and
// module evaluation (post-order, declaration order) runs it before the driver
// initializes. Static + fully qualified (same pin as deno.json) because a
// worker's module graph resolves no bare specifiers and a dynamic import
// under --frozen wedges silently inside a worker.
import { sqlitePath as path } from './sqlitepath.ts'
import * as sqlite from 'jsr:@db/sqlite@0.13.0'
import { dirname, resolve } from 'node:path'
import { backfillEdges, freshStats, migrate } from '../db.ts'
import { loadVector } from '../vector.ts'
import {
  type Can,
  type RunResult,
  type Sql,
  type SqlValue,
  type Statement,
} from './sql.ts'
let DriverDatabase = sqlite.Database
type DriverStatement = InstanceType<typeof sqlite.Statement>

let native = Deno.dlopen(path, {
  sqlite3_serialize: {
    parameters: ['pointer', 'buffer', 'buffer', 'u32'],
    result: 'pointer',
  },
  sqlite3_deserialize: {
    parameters: ['pointer', 'buffer', 'pointer', 'i64', 'i64', 'u32'],
    result: 'i32',
  },
  sqlite3_malloc64: { parameters: ['u64'], result: 'pointer' },
  sqlite3_free: { parameters: ['pointer'], result: 'void' },
  sqlite3_extended_errcode: { parameters: ['pointer'], result: 'i32' },
  sqlite3_reset: { parameters: ['pointer'], result: 'i32' },
})

// node:sqlite's driver steps a statement and only resets it AFTER, so a step
// that returns SQLITE_BUSY throws before the reset ever runs and leaves the
// statement in progress on the connection — enough that a later COMMIT on the
// same handle fails with "cannot commit transaction - SQL statements in
// progress". Reset the failed statement ourselves so the wrapper always keeps
// db.ts's stated invariant — every use steps to completion and resets — even on
// error, for prep()'s cached statements and throwaway ones alike. Reset ignores
// its own return (it repeats the step's error code); it clears the VM either way.
let reset = (statement: DriverStatement) => {
  let handle = statement.unsafeHandle
  if (handle) native.symbols.sqlite3_reset(handle)
}

let MAIN = new TextEncoder().encode('main\0')
let depth = 0
let bytesAt = (pointer: Deno.PointerObject, size: number) =>
  new Uint8Array(new Deno.UnsafePointerView(pointer).getArrayBuffer(size))

type Options = {
  readOnly?: boolean
}

export class StatementSync implements Statement {
  #db: DatabaseSync
  #statement: DriverStatement

  constructor(db: DatabaseSync, statement: DriverStatement) {
    this.#db = db
    this.#statement = statement
  }

  get<T extends object = Record<string, unknown>>(...args: SqlValue[]) {
    try {
      return this.#statement.get<T>(...args)
    } catch (error) {
      throw this.#failed(error)
    }
  }

  all<T extends object = Record<string, unknown>>(...args: SqlValue[]) {
    try {
      return this.#statement.all<T>(...args)
    } catch (error) {
      throw this.#failed(error)
    }
  }

  run(...args: SqlValue[]): RunResult {
    try {
      let changes = this.#statement.run(...args)
      return { changes, lastInsertRowid: this.#db.lastInsertRowId }
    } catch (error) {
      throw this.#failed(error)
    }
  }

  // A failed step leaves the statement in progress (see reset() above); reset it
  // before surfacing the error so the connection is left clean for a later
  // commit, then hand back the errcode-tagged error.
  #failed(error: unknown) {
    reset(this.#statement)
    return this.#db.error(error)
  }
}

export class DatabaseSync implements Sql {
  #db: InstanceType<typeof DriverDatabase>
  can: Can = { fts: true, temp: true }

  constructor(path: string | URL, options: Options = {}) {
    this.#db = new DriverDatabase(path, {
      int64: true,
      parseJson: false,
      readonly: options.readOnly,
    })
    this.#db.exec('pragma foreign_keys = on')
  }

  get isOpen() {
    return this.#db.open
  }

  get inTransaction() {
    return this.#db.inTransaction
  }

  get lastInsertRowId() {
    return this.#db.lastInsertRowId
  }

  get version() {
    return (this.#db.prepare('pragma user_version').get() as {
      user_version: number
    }).user_version
  }

  set version(v: number) {
    this.exec(`pragma user_version = ${v}`)
  }

  // A file's transaction is the SQL: the outer level is BEGIN (IMMEDIATE takes
  // the reserved lock before the first read, so a peer waits on busy_timeout
  // instead of failing on a deferred upgrade), a nested one a savepoint.
  // Roll back only what began: a `begin immediate` that fails on SQLITE_BUSY
  // opens no transaction, and an unconditional `rollback` there throws "no
  // transaction is active" and MASKS the BUSY (T-19044).
  transaction<T>(fn: () => T, immediate = false): T {
    let nested = this.inTransaction
    let name = `tx_${++depth}`
    this.exec(
      nested ? `savepoint ${name}` : immediate ? 'begin immediate' : 'begin',
    )
    try {
      let value = fn()
      this.exec(nested ? `release ${name}` : 'commit')
      return value
    } catch (e) {
      if (nested) {
        this.exec(`rollback to ${name}`)
        this.exec(`release ${name}`)
      } else if (this.inTransaction) this.exec('rollback')
      throw e
    }
  }

  prepare(sql: string) {
    return new StatementSync(this, this.#db.prepare(sql))
  }

  exec(sql: string) {
    try {
      this.#db.exec(sql)
    } catch (error) {
      throw this.error(error)
    }
  }

  error(error: unknown) {
    if (error instanceof Error && !('errcode' in error)) {
      Object.defineProperty(error, 'errcode', {
        value: native.symbols.sqlite3_extended_errcode(this.#db.unsafeHandle),
      })
    }
    return error
  }

  backup(destination: DatabaseSync) {
    this.#db.backup(destination.#db)
  }

  serialize() {
    let size = new BigInt64Array(1)
    let pointer = native.symbols.sqlite3_serialize(
      this.#db.unsafeHandle,
      MAIN,
      size,
      0,
    )
    if (!pointer) throw new Error('SQLite serialization failed')
    try {
      return bytesAt(pointer, Number(size[0])).slice()
    } finally {
      native.symbols.sqlite3_free(pointer)
    }
  }

  deserialize(bytes: Uint8Array) {
    let pointer = native.symbols.sqlite3_malloc64(BigInt(bytes.byteLength))
    if (!pointer) throw new Error('SQLite deserialization allocation failed')
    bytesAt(pointer, bytes.byteLength).set(bytes)
    let result = native.symbols.sqlite3_deserialize(
      this.#db.unsafeHandle,
      MAIN,
      pointer,
      BigInt(bytes.byteLength),
      BigInt(bytes.byteLength),
      3, // SQLite owns the allocation and may grow it with sqlite3_realloc64.
    )
    if (result) {
      native.symbols.sqlite3_free(pointer)
      throw new Error(`SQLite deserialization failed: ${result}`)
    }
  }

  loadExtension(path: string) {
    this.#db.enableLoadExtension = true
    try {
      this.#db.loadExtension(path)
    } finally {
      this.#db.enableLoadExtension = false
    }
  }

  close() {
    this.#db.close()
  }
}

// ---- the file ---------------------------------------------------------------

// The owner's live graph — the one path a test must never open (connect()
// below refuses it under `deno test`). A function, not a constant, so it
// re-reads HOME and the guard that holds this can't drift from a stale literal.
export let liveDb = () => `${Deno.env.get('HOME')}/.tasks/tasks.db`

// Same database by canonical path when it exists, normalized spelling when it
// does not. Service-plane guards use this so a symlink cannot disguise owner
// data as a disposable parity copy.
export let sameGraphFile = (a: string, b: string) => {
  let canonical = (path: string) => {
    try {
      return Deno.realPathSync(path)
    } catch {
      return resolve(path)
    }
  }
  return canonical(a) == canonical(b)
}

// The db lives outside the repo (this is open source): a home-dir dotpath by
// default, overridable with DB_PATH.
// Exported because it is this process's IDENTITY on a shared port: which
// graph it serves is what a joining peer must check (src/bind.ts).
export let file = Deno.env.get('DB_PATH') ?? liveDb()

// A WAL-present boot follows a crash or overlaps another healthy connection,
// so verify the complete SQLite view before migrations write anything. A
// failed check is never repaired in place: WAL and SHM are live parts of the
// database, and renaming either behind an open connection creates two WAL
// generations. Recovery is an offline operation over a preserved copy of the
// database/WAL/SHM set.
let exists = (p: string) => {
  try {
    Deno.statSync(p)
    return true
  } catch {
    return false
  }
}
let probe = (db: DatabaseSync) => {
  let row = db.prepare('pragma quick_check(1)').get() as Record<string, string>
  let verdict = row?.quick_check ?? Object.values(row ?? {})[0]
  if (verdict != 'ok') throw new Error(`quick_check: ${verdict}`)
}
let verifyWal = (db: DatabaseSync, path: string): DatabaseSync => {
  if (path == ':memory:' || !exists(`${path}-wal`)) return db
  try {
    probe(db)
    return db
  } catch (e) {
    throw new Error(
      `SQLite integrity check failed for ${path} while ${path}-wal exists: ` +
        `${e}. Startup stopped without copying, renaming, or deleting the ` +
        `database, WAL, or SHM files. Stop every process using this graph, ` +
        `preserve the three files as one set, and diagnose or recover an ` +
        `offline copy.`,
      { cause: e },
    )
  }
}

// Connect without migration. open() composes this with migrate(); read-only
// consumers use connect() directly.
export let connect = (path = file, vector = false, readOnly = false) => {
  // A test must NEVER open the owner's live graph. Under `deno test` the main
  // module is always a *_test.ts file; reaching the live path there means a
  // caller forgot DB_PATH (the `test` task sets :memory:). Refuse before we
  // mkdir/migrate/lock it — loudly, so the next module-scope import that would
  // reintroduce this footgun fails at the door instead of quietly reseeding
  // the owner's board (T-14260).
  if (
    Deno.mainModule.endsWith('_test.ts') &&
    sameGraphFile(path, liveDb())
  ) {
    throw new Error(
      `refusing to open the live graph (${path}) under a test — set DB_PATH`,
    )
  }
  Deno.mkdirSync(dirname(path), { recursive: true })
  // readOnly (the app-plane reader, db.ts appPlane()): writing is made
  // impossible at the SQLite layer, not merely avoided per-door.
  let db = verifyWal(new DatabaseSync(path, { readOnly }), path)
  // The vector extension is OPT-IN, because it is write-capable and connect()
  // is the LIBRARY door (D-22530: such an extension loads only in the
  // distribution that owns its write). Loading it here handed one to every
  // consumer — the CLI's read arm, a probe, any future library client — and it
  // is what put a native writer in a second process (T-22622). Only
  // live_db.ts, the server-side handle, asks for it.
  if (vector) loadVector(db)
  // Connection-local settings only: busy_timeout and synchronous both live in
  // the connection; the persistent journal-mode setting stays in wal().
  db.exec('pragma busy_timeout = 5000')
  // Durability is tunable for throwaway graphs (TASKS_SYNC, like TASKS_BACKOFF):
  // the default (unset) leaves SQLite's own `full`, which fsyncs every DDL
  // statement — and migrate() runs ~200 of them (schema + migrations), so a
  // fresh file on real disk costs ~2s. A test graph is ephemeral and never
  // survives a crash, so the test task sets `off` and every file-backed open
  // drops from ~2s to ~10ms. Production never sets it and stays fully durable.
  let sync = Deno.env.get('TASKS_SYNC')
  // Durability is a writer's concern; a read-only handle never fsyncs, so skip
  // the pragma rather than run a connection setting a reader has no use for.
  if (sync && !readOnly) db.exec(`pragma synchronous = ${sync}`)
  return db
}

// WAL lets readers proceed during a write, removing the reader/writer
// blocking of the default rollback journal. The fleet supports many
// ordinary read-write connections; SQLite serializes their write
// transactions. Unconditional since T-19444 (validated live via T-13905); an
// in-memory db answers `memory` and stays there — that is its only mode,
// not a failure. WAL's -wal/-shm sidecars are gitignored, and bin/backup's
// VACUUM INTO reads a consistent snapshot under WAL unchanged. Setting
// synchronous = normal is WAL's crash-safe pairing (a checkpoint still
// fsyncs), unless TASKS_SYNC already named a mode.
//
// This persistent setting rides the writer's door, open(), never connect():
// a read-only handle has no business changing the file's header, and SQLite
// serializes the change with every other connection.
let wal = (db: DatabaseSync) => {
  let got = (db.prepare('pragma journal_mode = wal').get() as
    | { journal_mode: string }
    | undefined)?.journal_mode
  if (got == 'wal') {
    if (!Deno.env.get('TASKS_SYNC')) db.exec('pragma synchronous = normal')
  } else if (got != 'memory') {
    console.warn(`journal_mode is ${got}, not wal`)
  }
  return db
}

// Open the file, migrate it transactionally in place, plant missing schema,
// and seed once if the graph is empty. SQLite serializes concurrent openers.
// The scratch handle is for a legacy reshape that reads target DDL off a
// fresh graph (db.ts scratchOf). Planner statistics are refreshed after the
// migration commits (db.ts freshStats), never inside the DDL it records — and
// the edge backfill (db.ts backfillEdges) runs after them both, for the same
// reason plus one: it commits in batches, which the schema transaction could
// not give it.
export let open = (path = file, vector = false) => {
  let db = migrate(wal(connect(path, vector)), () => connect(':memory:'))
  freshStats(db)
  backfillEdges(db)
  return db
}

// `deno task seed` (or a direct run) bootstraps the file without the server.
if (import.meta.main) {
  let db = open()
  let n = (q: string) => (db.prepare(q).get() as { n: number }).n
  console.log(
    `seeded ${n('select count(*) as n from task')} tasks, ${
      n('select count(*) as n from edge')
    } edges`,
  )
}
