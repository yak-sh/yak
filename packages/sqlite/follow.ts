// A graph's schema follows its vocabulary wherever the graph is opened for
// writing (D-121389). Everything a file needs is one composed schema, and the
// schema has one print. A file records each print it has been brought to, as
// the `server_meta` row `schema:<print>`; an opener whose print is recorded
// opens with no DDL and no write lock, and one whose print is missing runs the
// pass that brings the file to it, then records it. A recorded print stays
// recorded, so a process still running the vocabulary a landing replaced finds
// its own print and changes nothing.
//
// Two openers that find the same print missing both run the pass: every step
// of it reads the file under the write lock before it changes anything, so the
// second one finds nothing left to do. Work whose cost grows with rows (an
// index over a populated table, a table's refit, filling a text index) still
// runs in the pass; D-121389 moves it to windows the effects worker works off.

import { type Column, type Driver, render, type Stmt } from '@yaks/sql/core'
import { sha256 } from '@yaks/graph/sha256'
import { meta, PRINTED, printed } from './meta.ts'
import { unit } from './unit.ts'

/** The print of a composed schema: a store's own print (`Store.print`) and
 * every further statement the file needs, rendered. */
export let printOf = (store: string, stmts: Stmt[]): string =>
  sha256([store, ...stmts.map((s) => render(s).sql)].join(';\n'))

// A column as `add column` takes it onto a standing table: SQLite refuses a
// key or a unique column there, a NOT NULL without a literal default, and a
// default that is an expression. The CHECK waits for the table's refit, since
// adding one reads every row; admission holds the writes meanwhile.
let added = (c: Column): Column => {
  let d = c.default?.t == 'lit' ? c.default : undefined
  return {
    name: c.name,
    type: c.type,
    notNull: c.notNull && !!d,
    default: d,
    ref: c.ref,
  }
}

/** The `add column` statements the tables `stmts` create are missing where
 * they already stand: `create table if not exists` does nothing to a table
 * that is there, so a column a table gained after it was made arrives here. */
export let grow = (driver: Driver, stmts: Stmt[]): Stmt[] =>
  stmts.flatMap((s) => {
    if (s.t != 'create table') return []
    let has = new Set(
      driver.query({ t: 'pragma', name: 'table_info', arg: s.name })
        .map((r) => String(r.name)),
    )
    if (!has.size) return []
    return s.cols.filter((c) => !has.has(c.name)).map((c) => ({
      t: 'alter table' as const,
      table: s.name,
      add: added(c),
    }))
  })

/** Run `stmts`, each of which only adds what is missing, then the columns
 * their standing tables lack, in one unit under the write lock. */
export let add = (driver: Driver, stmts: Stmt[]): void =>
  unit(driver, () => {
    for (let s of stmts) driver.query(s)
    for (let s of grow(driver, stmts)) driver.query(s)
  })

/** Bring a file to the composed schema `print` names: nothing, where the file
 * has recorded it; otherwise `pass`, which adds what is missing, and then the
 * record. True when the pass ran. */
export let follow = (
  driver: Driver,
  print: string,
  pass: () => void,
): boolean => {
  if (printed(driver, print)) return false
  pass()
  unit(
    driver,
    () => meta(driver).set(PRINTED + print, new Date().toISOString()),
  )
  return true
}
