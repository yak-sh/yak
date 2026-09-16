// The two methods every @yaks/* storage package runs its statements through,
// over the seam this server already holds.
//
// Each package declares its own structural driver — `query` for rows, `exec`
// for effect — deliberately naming no SQLite library, so an application hands
// over the methods it has. They differ only in which bound values they admit
// (a vector rides as bytes, a log row never does), and a binding that takes
// every SqlValue satisfies all of them at once. So there is ONE adapter here,
// not one per package, and a package never learns how this server prepares a
// statement.
//
// Bound once per handle: the packages are stateless and this is only the
// wiring, but the statement cache behind `prepare` is worth not rebuilding.

import type { Sql, SqlValue } from './sql.ts'

/** A connection reduced to what a storage package calls. */
export type Driver = {
  query: (sql: string, params: SqlValue[]) => Record<string, unknown>[]
  exec: (sql: string) => void
}

let bound = new WeakMap<Sql, Driver>()

/** The driver for this handle, made once. */
export let driverOf = (db: Sql): Driver => {
  let held = bound.get(db)
  if (!held) {
    held = {
      query: (sql, params) => db.prepare(sql).all(...params),
      exec: (sql) => db.exec(sql),
    }
    bound.set(db, held)
  }
  return held
}
