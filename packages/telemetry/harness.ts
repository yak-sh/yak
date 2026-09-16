// Shared test fixtures (not published): an in-memory SQLite driver with the log
// table installed, and a unique name per test so tests can share one handle.

import { Database } from '@yaks/sqlite/db'
import type { Driver } from './driver.ts'
import { schema } from './ddl.ts'

/** A Driver over a fresh in-memory database with the log table installed. */
export let mem = (): Driver => {
  let db = new Database(':memory:')
  let d: Driver = {
    query: (sql, params) => db.prepare(sql).all(...params),
    exec: (sql) => db.exec(sql),
  }
  for (let stmt of schema()) d.exec(stmt)
  return d
}

/** A name no other test used. */
export let tag = (): string => `t-${crypto.randomUUID().slice(0, 8)}`
