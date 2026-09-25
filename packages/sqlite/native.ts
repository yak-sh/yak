// The {@link Driver} over one native @db/sqlite handle. Internal to this
// package: ./db.ts `open()` is the door, and the handle never leaves it. The
// one other caller is ./testing.ts, whose stand-ins imitate engines that take
// text.

import './sqlitepath.ts'
import type { Database } from '@db/sqlite'
import {
  call,
  col,
  type Driver,
  eq,
  type Param,
  render,
  type Row,
  select,
  STOCK,
  val,
} from '@yaks/sql'

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
  let cache = new Map<string, ReturnType<Database['prepare']>>()
  let schema = db.prepare(
    render({ t: 'pragma', schema: 'main', name: 'schema_version' }).sql,
  )
  let version: unknown
  let live = () => {
    // @db/sqlite closes and finalizes its native handles without invalidating
    // the JS Statement objects. Calling a cached one after close is a SIGSEGV,
    // not a catchable SQLite error. Refuse at the boundary, before any FFI.
    if (!db.open) throw new Error('the database is closed')
    let now = schema.value()![0]
    if (now === version) return
    for (let statement of cache.values()) statement.finalize()
    cache.clear()
    version = now
  }
  return (sql: string, params: Param[] = []): Row[] => {
    live()
    let statement = cache.get(sql)
    if (!statement) {
      statement = db.prepare(sql)
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
  }
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
  return {
    query: (s) => {
      let { sql, params } = render(s)
      return run(sql, params)
    },
    file,
    arms: STOCK,
  }
}
