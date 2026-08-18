// The server's synchronous SQLite door. It keeps the small node:sqlite API
// the graph uses while the driver beneath it supplies working loadable
// extensions. Linux uses the system library because @db/sqlite's 0.13.0
// bundled x86_64 library crashes during sqlite3_initialize on Deno 2.9.

let paths: Record<string, string> = {
  linux: 'libsqlite3.so.0',
  darwin: '/usr/lib/libsqlite3.dylib',
  windows: 'sqlite3.dll',
}
let path = Deno.env.get('DENO_SQLITE_PATH') ?? paths[Deno.build.os]
if (!path) throw new Error(`No system SQLite library for ${Deno.build.os}`)
Deno.env.set('DENO_SQLITE_PATH', path)

let sqlite = await import('@db/sqlite')
let DriverDatabase = sqlite.Database
type DriverStatement = InstanceType<typeof sqlite.Statement>
type Params = Parameters<DriverStatement['run']>
export type SQLInputValue = import('@db/sqlite').BindValue

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
let bytesAt = (pointer: Deno.PointerObject, size: number) =>
  new Uint8Array(new Deno.UnsafePointerView(pointer).getArrayBuffer(size))

type Options = {
  readOnly?: boolean
}

export type RunResult = {
  changes: number
  lastInsertRowid: number | bigint
}

export class StatementSync {
  #db: DatabaseSync
  #statement: DriverStatement

  constructor(db: DatabaseSync, statement: DriverStatement) {
    this.#db = db
    this.#statement = statement
  }

  get<T extends object = Record<string, unknown>>(...args: Params) {
    try {
      return this.#statement.get<T>(...args)
    } catch (error) {
      throw this.#failed(error)
    }
  }

  all<T extends object = Record<string, unknown>>(...args: Params) {
    try {
      return this.#statement.all<T>(...args)
    } catch (error) {
      throw this.#failed(error)
    }
  }

  run(...args: Params): RunResult {
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

export class DatabaseSync {
  #db: InstanceType<typeof DriverDatabase>

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

  // True while a transaction is open (autocommit off). A rollback in a catch
  // reads this so a `begin` that never took the lock (SQLITE_BUSY) is not
  // rolled back — an empty rollback throws and would mask the real error.
  get inTransaction() {
    return this.#db.inTransaction
  }

  get lastInsertRowId() {
    return this.#db.lastInsertRowId
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
