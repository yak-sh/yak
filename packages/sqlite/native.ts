// The {@link Driver} over one native @db/sqlite handle. Internal to this
// package: ./db.ts `open()` is the door, and the handle never leaves it.

import './sqlitepath.ts'
import type { Database } from '@db/sqlite'
import { STOCK } from '@yaks/sql'
import type { Driver } from './driver.ts'

/*
 * The {@link Driver} over one open embedded database.
 *
 * It keeps the statements it prepares. The adapter asks the same
 * parameterized gathers and writes thousands of times a session, and
 * preparing each one afresh costs a compile for nothing; the cache is bounded
 * and `Database.close()` finalizes what it holds.
 *
 * A database on disk is a file other processes may have open too, so the
 * driver reports that ({@link Driver.file}) and the outermost unit takes the
 * write lock up front. An in-memory one belongs to this process alone and sets
 * nothing.
 */
export let driver = (db: Database): Driver => {
  let cache = new Map<string, ReturnType<Database['prepare']>>()
  // Whether this is a file other processes may have open, asked of SQLite
  // itself rather than of the string somebody passed: `main` has a path on
  // disk, and an in-memory or temporary database has none.
  let file = !!(db.prepare(
    `select file from pragma_database_list where name = 'main'`,
  ).all()[0] as { file?: string } | undefined)?.file
  let live = () => {
    // @db/sqlite closes and finalizes its native handles without invalidating
    // the JS Statement objects. Calling a cached one after close is a SIGSEGV,
    // not a catchable SQLite error. Refuse at the boundary, before any FFI.
    if (!db.open) throw new Error('the database is closed')
  }
  return {
    query: (sql, params) => {
      live()
      let statement = cache.get(sql)
      if (!statement) {
        if (cache.size >= 256) {
          let oldest = cache.keys().next().value!
          cache.get(oldest)!.finalize()
          cache.delete(oldest)
        }
        statement = db.prepare(sql)
        cache.set(sql, statement)
      }
      try {
        return statement.all(...params)
      } catch (error) {
        // @db/sqlite resets all() on success, but an exception while decoding
        // a row can leave a RETURNING statement at SQLITE_ROW. Retaining it
        // then prevents every later SAVEPOINT on this connection. Evict only
        // the failed statement; never retry SQL with possible side effects.
        cache.delete(sql)
        try {
          statement.finalize()
        } catch (cleanup) {
          throw new AggregateError(
            [error, cleanup],
            String(error) +
              '; SQLite statement finalization also reported an error',
            { cause: error },
          )
        }
        throw error
      }
    },
    exec: (sql) => {
      live()
      db.exec(sql)
    },
    file,
    arms: STOCK,
  }
}
