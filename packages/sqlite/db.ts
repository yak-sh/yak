// The embedded driver itself — @db/sqlite, opened against a library that
// works. This is the one door onto it: `import { Database } from
// '@yaks/sqlite/db'`, never from '@db/sqlite' directly, so ./sqlitepath.ts has
// already named the system library by the time the FFI initializes. Importing
// the driver straight is a segfault on Linux with nothing on stderr
// (src/store/sqlitepath_test.ts holds that line for the whole repo).
//
// ./mod.ts stays free of it on purpose: the adapter there speaks to any
// `Driver`, and only a host that wants an in-process database needs this.

import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { STOCK } from '@yaks/sql'
import type { Driver } from './driver.ts'

export * from '@db/sqlite'
export { sqlitePath } from './sqlitepath.ts'

/**
 * A {@link Driver} over an open embedded database — what a host binds
 * `storage()` to.
 *
 * It keeps the statements it prepares. The adapter asks the same
 * parameterized gathers and writes thousands of times a session, and
 * preparing each one afresh costs a compile for nothing; the cache is bounded
 * and `Database.close()` finalizes what it holds.
 *
 * ```ts
 * import { Database, driver } from '@yaks/sqlite/db'
 *
 * let sql = driver(new Database(':memory:'))
 * ```
 */
export let driver = (db: Database): Driver => {
  let cache = new Map<string, ReturnType<Database['prepare']>>()
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
    arms: STOCK,
  }
}
