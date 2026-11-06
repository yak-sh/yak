// The {@link Driver} over one native @db/sqlite handle. Internal to this
// package: ./db.ts `open()` is the door, and the handle never leaves it. The
// one other caller is ./testing.ts, whose stand-ins imitate engines that take
// text.

import { sqlitePath } from './sqlitepath.ts'
import { Database, Statement } from './legacy.ts'
import { driver as connection } from './driver.ts'
import { meter } from './budget.ts'
import { EPOCH, epochAt, meta } from './meta.ts'
import { scope } from '@yaks/trace'
import {
  call,
  col,
  type Driver,
  eq,
  lit,
  type Param,
  render,
  type Row,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'

// Database images belong to the testing facet. The native handle and SQLite's
// allocator stay here; each restored image gets its own resizeable buffer,
// which SQLite releases when the database closes.
let images: ReturnType<typeof bindImages> | undefined
let bindImages = () =>
  Deno.dlopen(sqlitePath, {
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
  })
let mainImage = new TextEncoder().encode('main\0')

export let serialize = (db: Database): Uint8Array => {
  let api = (images ??= bindImages()).symbols
  let size = new BigInt64Array(1)
  let pointer = api.sqlite3_serialize(db.unsafeHandle, mainImage, size, 0)
  if (!pointer) throw new Error('SQLite cannot serialize the database')
  try {
    let bytes = new Uint8Array(Number(size[0]))
    new Deno.UnsafePointerView(pointer).copyInto(bytes)
    return bytes
  } finally {
    api.sqlite3_free(pointer)
  }
}

export let deserialize = (db: Database, bytes: Uint8Array): void => {
  let api = (images ??= bindImages()).symbols
  let size = BigInt(bytes.length)
  let pointer = api.sqlite3_malloc64(size)
  if (!pointer) throw new Error('SQLite cannot allocate a database image')
  new Uint8Array(
    new Deno.UnsafePointerView(pointer).getArrayBuffer(bytes.length),
  )
    .set(bytes)
  // FREEONCLOSE | RESIZEABLE: writes may grow this private copy.
  let code = api.sqlite3_deserialize(
    db.unsafeHandle,
    mainImage,
    pointer,
    size,
    size,
    3,
  )
  if (code) {
    throw new Error(`SQLite cannot deserialize the database (${code})`)
  }
}

/*
 * Text in, rows out, over one open embedded database: what {@link driver}
 * renders every statement into.
 *
 * It keeps the statements it prepares. The adapter asks the same
 * parameterized gathers and writes thousands of times a session, and
 * preparing each one afresh costs a compile for nothing; the cache is bounded
 * and `Database.close()` finalizes what it holds. A kept statement lives
 * through a schema change, whoever made it: SQLite recompiles the statement at
 * its next step, against the schema as it is then. Its columns are read once
 * that step has made a row, since a `select *` can answer with more, fewer or
 * other columns than it was prepared with.
 *
 * Text a stand-in was handed can hold several statements, as a Durable
 * Object's `exec` takes; they all run, and answer no rows. Parameters bind to
 * one statement, so such a string with parameters is refused rather than cut
 * short. A rendered statement is always one.
 */
// The dependency's generated decoder closes over only its column reader. The
// connection, integer width and JSON options arrive with each row, so a column
// projection can share its compiled function across statements and databases.
type Decoder = ReturnType<Statement['getRowObject']>
let decoders = new Map<string, Decoder>()
// The reader of a statement that answers no columns.
let nothing: Decoder = () => undefined
// What a kept statement asks of SQLite that @db/sqlite does not bind.
let steps: ReturnType<typeof bindSteps> | undefined
let bindSteps = () =>
  Deno.dlopen(sqlitePath, {
    sqlite3_stmt_status: {
      parameters: ['pointer', 'i32', 'i32'],
      result: 'i32',
    },
    sqlite3_reset: { parameters: ['pointer'], result: 'i32' },
    sqlite3_db_config: {
      parameters: ['pointer', 'i32', 'i32', 'pointer'],
      result: 'i32',
    },
  })
let decoder = (names: string[], compile: Statement['getRowObject']) => {
  let key = JSON.stringify(names)
  let kept = decoders.get(key)
  if (kept) return kept
  if (decoders.size >= 256) decoders.delete(decoders.keys().next().value!)
  let made = compile()
  decoders.set(key, made)
  return made
}

export let prepared = (db: Database) => {
  // SQLite integers are 64-bit. The library's default reader truncates them
  // to 32 bits; safe JS integers must round-trip through every driver caller.
  db.int64 = true
  let { sqlite3_stmt_status: recompiled, sqlite3_reset: reset } =
    (steps ??= bindSteps()).symbols
  let commands = new WeakSet<ReturnType<Database['prepare']>>()
  let prepare = (sql: string) => {
    let statement = db.prepare(sql)
    // DDL, transaction boundaries and writes without RETURNING have no row
    // shape. Running them needs no decoder or repeated column-name reads. One
    // may still step more than once, as `pragma incremental_vacuum(n)` gives
    // back a page a step, so each is stepped to its end through a reader that
    // builds nothing.
    let names = statement.columnNames()
    if (!names.length) {
      statement.getRowObject = () => nothing
      commands.add(statement)
      return statement
    }
    let original = statement.getRowObject.bind(statement)
    let standard = statement.getRowObject == Statement.prototype.getRowObject
    let decode: Decoder | undefined
    // The columns the statement answers with now. Only the generated decoder
    // is reusable: it reads each value's live type and receives the
    // integer/JSON options for this call.
    let current = () => {
      // SQLite also recompiles for schema edits from another connection,
      // including temp/attached schemas and rollback. It alone knows when
      // the kept statement's metadata needs reading again.
      let changed = recompiled(statement.unsafeHandle, 5, 1) // REPREPARE
      if (!decode || changed) {
        if (changed) names = statement.columnNames()
        decode = standard ? decoder(names, original) : original()
      }
      return decode
    }
    // @db/sqlite asks for the decoder before its first step, while a
    // statement the schema has moved under still describes its old plan; the
    // step recompiles it. So the decoder it is handed reads the columns at
    // the first row, after that step, and decodes every row of the read
    // with what it found, each counted against the read running
    // (./budget.ts) before the next is made.
    statement.getRowObject = () => {
      let decode: Decoder | undefined
      return (h, int64, json) => {
        let row = (decode ??= current())(h, int64, json)
        meter(row)
        return row
      }
    }
    return statement
  }
  let cache = new Map<string, ReturnType<Database['prepare']>>()
  return (sql: string, params: Param[] = []): Row[] => {
    // @db/sqlite closes and finalizes its native handles without invalidating
    // the JS Statement objects. Calling a cached one after close is a SIGSEGV,
    // not a catchable SQLite error. Refuse at the boundary, before any FFI.
    if (!db.open) throw new Error('the database is closed')
    let statement = cache.get(sql)
    if (statement) {
      cache.delete(sql)
    } else {
      statement = prepare(sql)
      if (sql.slice(statement.sql.length).trim()) {
        statement.finalize()
        if (params.length) {
          throw new Error(`parameters bind to one statement, not several`)
        }
        db.exec(sql)
        return []
      }
      if (cache.size >= 1024) {
        let oldest = cache.keys().next().value!
        cache.get(oldest)!.finalize()
        cache.delete(oldest)
      }
    }
    cache.set(sql, statement)
    try {
      if (commands.has(statement)) {
        statement.all(...params)
        return []
      }
      return statement.all(...params)
    } catch (error) {
      // @db/sqlite resets a statement when its step succeeds, but leaves one
      // whose step failed where it stopped: a RETURNING statement whose row
      // failed to decode is still at SQLITE_ROW, and would prevent every
      // later SAVEPOINT on this connection. Reset, it is done, and stays
      // kept: a statement that fails, as a refused write does, is often asked
      // again. Resetting reports the step's failure again, so the step's
      // error is the one thrown; nothing with possible side effects retries.
      reset(statement.unsafeHandle)
      throw error
    }
  }
}

// The schemas this process's databases in memory were made with, each kept as
// a database of its own under what made it and what stood before
// (Driver.template).
let templates = new Map<string, Database>()

// What a database holds before its schema is made: each object's text, and
// whether any of its tables has a row. A template stands for a database that
// held those same objects and nothing in them.
let holding = (query: (s: Stmt) => Row[]) => {
  let objects = query(select({
    cols: [col('type'), col('name'), col('sql')],
    from: table('sqlite_schema'),
    order: [col('name')],
  }))
  let held = (name: string) =>
    query(select({ cols: [lit(1)], from: table(name), limit: lit(1) })).length
  let empty = !objects.some((o) => o.type == 'table' && held(String(o.name)))
  return { objects: JSON.stringify(objects), empty }
}

// Another connection's commit to a file moves its data_version, a pragma that
// reads no page, so looking every LOOK ms hears each process's commits within
// a few milliseconds for a few microseconds a look. (Deno's file watcher could
// hear them sooner, but closing one while events are in flight can block the
// thread for good.) The timer holds no process open and runs outside any
// trace, so its reads are nobody's spans. A look that fails stops looking:
// whoever listens still passes on a timer of its own.
let LOOK = 5
let listen = (version: () => unknown) => (changed: () => void): () => void => {
  let last = version()
  let look = () => {
    try {
      let now = version()
      if (now === last) return
      last = now
      changed()
    } catch (error) {
      clearInterval(timer)
      console.error('sqlite watch —', error)
    }
  }
  let timer = scope(undefined, () => setInterval(look, LOOK))
  Deno.unrefTimer(timer)
  return () => clearInterval(timer)
}

// The `sqlite3_db_config` switches this package turns, by their C names.
let CONFIGS = {
  SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE: 1006,
  SQLITE_DBCONFIG_DQS_DDL: 1014,
}

/** Turn one of a connection's `sqlite3_db_config` switches on or off. */
export let configure = (
  db: Database,
  name: keyof typeof CONFIGS,
  on: boolean,
): void => {
  let code = (steps ??= bindSteps()).symbols.sqlite3_db_config(
    db.unsafeHandle,
    CONFIGS[name],
    on ? 1 : 0,
    null,
  )
  if (code) throw new Error(`SQLite refused ${name} (${code})`)
}

/**
 * The {@link Driver} over one open embedded database.
 *
 * A database on disk is a file other processes may have open too, so the
 * driver reports that ({@link Driver.file}) and the outermost unit takes the
 * write lock up front. An in-memory one belongs to this process alone and sets
 * nothing.
 */
export let driver = (
  db: Database,
  { lend = false }: { lend?: boolean } = {},
): Driver & { close: () => void; database: () => Database } => {
  let run = runner(db)
  // Memory and temporary names have no file. For every other name ask SQLite:
  // the flags may still have made it a database in memory.
  let main = render(select({
    cols: [col('file')],
    from: call('pragma_database_list', []),
    where: eq(col('name'), val('main')),
  }))
  let file = db.path != ':memory:' && db.path != '' &&
    !!run(main.sql, main.params)[0]?.file
  let version = render({ t: 'pragma', name: 'data_version' })
  // Refuse unknown double-quoted columns in DDL rather than letting SQLite
  // interpret them as string literals. The parser checks expressions and WHERE
  // clauses too, without one table_info query per index on every startup.
  configure(db, 'SQLITE_DBCONFIG_DQS_DDL', false)
  // The key of the template this connection holds under its savepoint, while
  // it is lent (`spares`).
  let lent: string | undefined
  let closed = false
  // How deep the templates being made here are nested.
  let making = 0
  let d = connection((sql, params) => {
    if (closed) throw new Error('the database is closed')
    return run(sql, params)
  }, { file, changes: () => db.changes })
  let query = d.query
  // A lent connection is already inside its savepoint, so a caller's own
  // transaction is a savepoint within it, as nested units already are. A
  // setting said outside any of them, which SQLite would ignore inside a
  // transaction, ends the loan first: the store keeps what it wrote, and the
  // connection, no longer its template, closes with it.
  let nested: string[] = []
  d.query = (s) => {
    if (!lent) return query(s)
    if (s.t == 'pragma' && s.value !== undefined && !nested.length) {
      query({ t: 'release', name: LENT })
      lent = undefined
      return query(s)
    }
    let said = standing(s)
    for (let t of said) {
      if (t.t == 'savepoint') nested.push(t.name)
      else if (t.t == 'release' && nested.includes(t.name)) {
        nested.splice(nested.lastIndexOf(t.name))
      }
    }
    return said.flatMap(query)
  }
  let watch = listen(() => run(version.sql, version.params)[0]?.data_version)
  let lendFrom = (at: string, spare?: Database) => {
    if (spare) {
      db.close()
      db = spare
      run = runner(spare)
    }
    query({ t: 'savepoint', name: LENT })
    lent = at
  }
  return Object.assign(d, {
    // A database in memory is this process's alone, and copying a schema into
    // one is a page copy where making it is hundreds of statements. One on
    // disk is made in place: another process may have it open.
    ...file ? { watch } : {
      template: (key: string, make: () => void) => {
        let before = holding(query)
        if (!before.empty || db.inTransaction) return make()
        let at = key + '\n' + before.objects
        // A schema made inside another's making (the store's own, inside its
        // host's) is part of the outer template, which alone is lent.
        let lending = lend && !making
        let spare = lending ? spares.get(at)?.pop() : undefined
        let kept = templates.get(at)
        if (spare || kept) {
          if (!spare) kept!.backup(db)
          if (lending) lendFrom(at, spare)
          // A copy is a store of its own: it never takes the lineage
          // identity of the one its template was made in (./meta.ts `epoch`).
          if (epochAt(d)) meta(d).set(EPOCH, crypto.randomUUID())
          return
        }
        making++
        try {
          make()
        } finally {
          making--
        }
        let copy = new Database(':memory:')
        db.backup(copy)
        templates.set(at, copy)
        if (lending) lendFrom(at)
      },
    },
    database: () => db,
    // A lent connection goes back as its template, rolled back to the
    // savepoint it was lent at, with every statement it compiled kept.
    close: () => {
      if (closed) return
      closed = true
      let at = lent
      lent = undefined
      if (at && db.inTransaction) {
        try {
          for (let s of LEAVE) run(s.sql, s.params)
        } catch (error) {
          db.close()
          throw error
        }
        let held = spares.get(at) ?? []
        if (!db.inTransaction && held.length < SPARES) {
          spares.set(at, [...held, db])
          return
        }
      }
      db.close()
    },
  })
}

// The savepoint a lent connection stands in: what it rolls back to when its
// store closes.
let LENT = 'yaks_lent'
let LEAVE = [
  render({ t: 'rollback', to: LENT }),
  render({ t: 'release', name: LENT }),
]

// A caller's transaction, said to a lent connection: one savepoint within the
// one it stands in, as a nested unit's is (./unit.ts).
let standing = (s: Stmt): Stmt[] =>
  s.t == 'begin'
    ? [{ t: 'savepoint', name: 'yaks_begun' }]
    : s.t == 'commit'
    ? [{ t: 'release', name: 'yaks_begun' }]
    : s.t == 'rollback' && !s.to
    ? [{ t: 'rollback', to: 'yaks_begun' }, {
      t: 'release',
      name: 'yaks_begun',
    }]
    : [s]

// Connections in memory whose stores have closed, each holding the template
// it was made from, by that template's key. A store lent one starts with
// every statement the last compiled for that same schema: SQLite compiles
// per connection, and a statement survives a rollback, where a copy of the
// template recompiles all of them. A test suite opens thousands of stores in
// memory, each of whose first model turn compiled two hundred statements.
let spares = new Map<string, Database[]>()
let SPARES = 8

// Each connection's statements, kept with it however many stores it serves.
let runners = new WeakMap<Database, ReturnType<typeof prepared>>()
let runner = (db: Database) => {
  let run = runners.get(db)
  if (!run) runners.set(db, run = prepared(db))
  return run
}
