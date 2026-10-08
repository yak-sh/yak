// The {@link Driver} over one native @db/sqlite handle. Internal to this
// package: ./db.ts `open()` is the door, and the handle never leaves it. The
// one other caller is ./testing.ts, whose stand-ins imitate engines that take
// text.

import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { context, leaf, peek } from '@yaks/trace'
import { excerpt, statement, writing } from '@yaks/sql'
import {
  call,
  col,
  type Driver,
  eq,
  type Expr,
  lit,
  type Param,
  render,
  type Row,
  select,
  type Stmt,
  STOCK,
  table,
  val,
} from '@yaks/sql'

// SQLite can read an unknown double-quoted index column as a string literal.
// Once a later migration adds that column, the index still holds the literal
// keys and disagrees with its table. Check the AST against the table first.
let refs = (e: Expr): string[] => {
  switch (e.t) {
    case 'col':
      return [e.name]
    case 'fn':
      return e.args.flatMap(refs)
    case 'op':
      return e.parts.flatMap(refs)
    case 'not':
    case 'neg':
    case 'null':
    case 'cast':
    case 'as':
    case 'desc':
      return refs(e.e)
    case 'in':
      return [
        ...refs(e.e),
        ...(Array.isArray(e.set) ? e.set.flatMap(refs) : []),
      ]
    case 'case':
      return [
        ...(e.of ? refs(e.of) : []),
        ...e.arms.flatMap((arm) => arm.flatMap(refs)),
        ...(e.else ? refs(e.else) : []),
      ]
    case 'over':
      return [
        ...refs(e.fn),
        ...(e.partition ?? []).flatMap(refs),
        ...(e.order ?? []).flatMap(refs),
      ]
    default:
      return []
  }
}

/*
 * Text in, rows out, over one open embedded database: what {@link driver}
 * renders every statement into.
 *
 * It keeps the statements it prepares. The adapter asks the same
 * parameterized gathers and writes thousands of times a session, and
 * preparing each one afresh costs a compile for nothing; the cache is bounded
 * and `Database.close()` finalizes what it holds. A kept statement outlives no
 * schema change: SQLite recompiles one after DDL on its first step, but
 * @db/sqlite reads the columns before that step, so a kept `select *` would
 * answer with the columns it was prepared under. The cache empties whenever
 * the schema version moves, a rolled-back change included.
 *
 * Text a stand-in was handed can hold several statements, as a Durable
 * Object's `exec` takes; they all run, and answer no rows. Parameters bind to
 * one statement, so such a string with parameters is refused rather than cut
 * short. A rendered statement is always one.
 */
export let prepared = (db: Database) => {
  // SQLite integers are 64-bit. The library's default reader truncates them
  // to 32 bits; safe JS integers must round-trip through every driver caller.
  db.int64 = true
  let prepare = (sql: string) => {
    let statement = db.prepare(sql)
    let original = statement.getRowObject.bind(statement)
    let names: string[] | undefined
    let decode: ReturnType<typeof original> | undefined
    // Inspect the columns as @db/sqlite does on every read. Only the generated
    // decoder is reusable: it reads each value's live type and receives the
    // integer/JSON options for this call. Temp and attached schemas can change
    // independently of main's version, so metadata itself never stays cached.
    statement.getRowObject = () => {
      let current = statement.columnNames()
      if (
        !decode || names!.length != current.length ||
        names!.some((name, i) => name !== current[i])
      ) {
        names = current
        decode = original()
      }
      return decode
    }
    return statement
  }
  let cache = new Map<string, ReturnType<Database['prepare']>>()
  let schema = db.prepare(
    render({ t: 'pragma', schema: 'main', name: 'schema_version' }).sql,
  )
  let version: unknown
  let forget = () => {
    for (let statement of cache.values()) statement.finalize()
    cache.clear()
  }
  let live = () => {
    // @db/sqlite closes and finalizes its native handles without invalidating
    // the JS Statement objects. Calling a cached one after close is a SIGSEGV,
    // not a catchable SQLite error. Refuse at the boundary, before any FFI.
    if (!db.open) throw new Error('the database is closed')
    let now = schema.value()![0]
    if (now === version) return
    forget()
    version = now
  }
  // `forget` drops every kept statement, for a database whose whole content
  // was just replaced under them.
  return Object.assign((sql: string, params: Param[] = []): Row[] => {
    live()
    let statement = cache.get(sql)
    if (!statement) {
      statement = prepare(sql)
      if (sql.slice(statement.sql.length).trim()) {
        statement.finalize()
        if (params.length) {
          throw new Error(`parameters bind to one statement, not several`)
        }
        db.exec(sql)
        return []
      }
      if (cache.size >= 256) {
        let oldest = cache.keys().next().value!
        cache.get(oldest)!.finalize()
        cache.delete(oldest)
      }
      cache.set(sql, statement)
    }
    try {
      return statement.all(...params)
    } catch (error) {
      // @db/sqlite resets all() on success, but an exception while decoding
      // a row can leave a RETURNING statement at SQLITE_ROW. Retaining it
      // then prevents every later SAVEPOINT on this connection. Evict only
      // the failed statement; never retry SQL with possible side effects.
      // Finalizing a statement whose step failed reports that same failure
      // again, so the step's error is the one thrown.
      cache.delete(sql)
      try {
        statement.finalize()
      } catch { /* the step's error, repeated */ }
      throw error
    }
  }, { forget })
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

/**
 * The {@link Driver} over one open embedded database.
 *
 * A database on disk is a file other processes may have open too, so the
 * driver reports that ({@link Driver.file}) and the outermost unit takes the
 * write lock up front. An in-memory one belongs to this process alone and sets
 * nothing.
 */
export let driver = (db: Database): Driver => {
  let run = prepared(db)
  // Whether this is a file other processes may have open, asked of SQLite
  // itself rather than of the string somebody passed: `main` has a path on
  // disk, and an in-memory or temporary database has none.
  let main = render(select({
    cols: [col('file')],
    from: call('pragma_database_list', []),
    where: eq(col('name'), val('main')),
  }))
  let file = !!run(main.sql, main.params)[0]?.file
  // An index is checked against its table before it is made: the check is a
  // statement of its own, run first.
  let covers = (s: Stmt) => {
    if (s.t != 'create index') return
    let cols = new Set(
      query({ t: 'pragma', name: 'table_info', arg: s.on })
        .map((r) => String(r.name)),
    )
    for (
      let name of [...s.cols, ...(s.where ? [s.where] : [])].flatMap(refs)
    ) {
      if (!cols.has(name)) {
        throw new Error(`index ${s.name} names missing column ${s.on}.${name}`)
      }
    }
  }
  let query = (s: Stmt): Row[] => {
    covers(s)
    let rendered = render(s), { sql, params } = rendered
    let at = context()
    let c = at?.channel ?? peek(d)
    if (!c) return run(sql, params)
    // Rendered before the span begins, so the span can say what it ran; the
    // span times the engine's work on it. A statement begins nothing of its
    // own, so it runs as a leaf: no task-local context is made for it.
    let wrote = writing(s)
    // Rows come from this execution, never a telemetry query or a stale
    // changes count on a failed write, and the attempt counts even if SQLite
    // refuses it.
    let n = 0
    return leaf(
      c.begin({
        kind: 'sql',
        name: statement(s),
        package: '@yaks/sqlite',
        parent: at?.channel == c ? at.parent : undefined,
        sql: excerpt(rendered),
      }),
      () => {
        let rows = run(sql, params)
        n = wrote ? db.changes : rows.length
        return rows
      },
      () => ({
        statements: 1,
        rowsRead: wrote ? 0 : n,
        rowsWritten: wrote ? n : 0,
      }),
      () => ({ rows: n }),
    )
  }
  let d: Driver = {
    query,
    file,
    arms: STOCK,
    // A database in memory is this process's alone, and copying a schema into
    // one is a page copy where making it is hundreds of statements. One on
    // disk is made in place: another process may have it open.
    ...file ? {} : {
      template: (key: string, make: () => void) => {
        let before = holding(query)
        if (!before.empty || db.inTransaction) return make()
        let at = key + '\n' + before.objects
        let kept = templates.get(at)
        if (kept) {
          kept.backup(db)
          run.forget()
          return
        }
        make()
        let copy = new Database(':memory:')
        db.backup(copy)
        templates.set(at, copy)
      },
    },
  }
  return d
}
