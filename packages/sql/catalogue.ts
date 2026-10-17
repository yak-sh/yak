// The file's schema as SQLite lists it (`sqlite_schema`): every table, index,
// view and trigger, the table it is on and the statement that made it. SQLite
// keeps no index on that list, so every question asked of it reads all of it,
// and a store bills each of those rows. A pass that asks after many objects
// reads it once per schema revision (./revision.ts) instead.
//
// Any DDL moves that revision, even a `create … if not exists` SQLite does
// nothing with, so a pass that makes what is missing (`erect`) leaves out what
// already stands, and reads the list again only after it changed something.
import { col, select, type Stmt, table } from './ast.ts'
import type { Driver } from './driver.ts'
import { revision } from './revision.ts'

/** One object the file's schema holds. `sql` is null for an index SQLite
 * made itself (a key's or a unique column's). */
export type SchemaObject = {
  type: string
  name: string
  tbl_name: string
  sql: string | null
}

type Held = {
  at: number
  entries: readonly SchemaObject[]
  kinds: ReadonlyMap<string, string>
}

// The namespace SQLite keeps an object of this type in, as far as `if not
// exists` goes: a table, a virtual table and a view are one kind, an index
// another, a trigger a third. A create over a name another kind holds is
// refused, not left out.
let kind = (type: string): string =>
  type == 'view' || type == 'virtual table' ? 'table' : type

// By driver, not connection: a statement through a driver no revision has
// seen yet moves no token, so a driver that has read nothing reads afresh.
let held = new WeakMap<Driver, Held>()

let read = (driver: Driver): Held => {
  let at = revision(driver, 'schema')
  let kept = held.get(driver)
  if (kept?.at === at) return kept
  // Sorted here: SQLite would read every row twice to sort them.
  let entries = driver.query(select({
    cols: [col('type'), col('name'), col('tbl_name'), col('sql')],
    from: table('sqlite_schema'),
  })).map((r): SchemaObject => ({
    type: String(r.type),
    name: String(r.name),
    tbl_name: String(r.tbl_name),
    sql: r.sql == null ? null : String(r.sql),
  })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  kept = {
    at,
    entries,
    kinds: new Map(entries.map((o) => [o.name, kind(o.type)])),
  }
  held.set(driver, kept)
  return kept
}

/** Every object the file's schema holds, in name order: read once while the
 * schema stands, and again after it moves. */
export let catalogue = (driver: Driver): readonly SchemaObject[] =>
  read(driver).entries

/**
 * Run `stmts` in order, leaving out each `create … if not exists` of an object
 * the schema already holds by that name and kind, which SQLite would leave as
 * it is. One over a name another kind holds runs, and SQLite refuses it (an
 * index named for a table). The schema is read once, before the first; what
 * the statements themselves make and drop is counted as they go.
 *
 * ```ts
 * import { catalogue, erect, revision, type Stmt } from '@yaks/sql'
 * import { catalogueExample as db } from './catalogue_fixture.ts'
 * import { equal } from '@yaks/testing'
 *
 * let made: Stmt = { t: 'create table', name: 'x', ifNot: true, cols: [{ name: 'a' }] }
 * let drop: Stmt = { t: 'drop', kind: 'table', name: 'x' }
 * erect(db, [made, made])
 * let at = revision(db, 'schema')
 * erect(db, [made])
 * equal(revision(db, 'schema'), at)
 * erect(db, [drop, made])
 * equal(catalogue(db).map((o) => o.name), ['x'])
 * erect(db, [drop])
 * equal(catalogue(db), [])
 * ```
 */
export let erect = (driver: Driver, stmts: readonly Stmt[]): void => {
  let held = new Map(stmts.length ? read(driver).kinds : [])
  for (let s of stmts) {
    let made = s.t.startsWith('create ') && 'name' in s ? s.name : null
    let as = kind(s.t.slice('create '.length))
    if (made != null && 'ifNot' in s && s.ifNot && held.get(made) == as) {
      continue
    }
    driver.query(s)
    if (made != null) held.set(made, as)
    if (s.t == 'drop') held.delete(s.name)
  }
}
