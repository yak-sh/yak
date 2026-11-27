// The file's schema as SQLite lists it (`sqlite_schema`): every table, index,
// view and trigger, the table it is on and the statement that made it. A
// component's table is listed by the name statements write it by, its label,
// though the file names it as the driver's vocabulary stores it
// (./driver.ts `storeAs`), as ./render.ts writes it the other way. SQLite
// keeps no index on that list, so every question asked of it reads all of it,
// and a store bills each of those rows. A pass that asks after many objects
// reads it once per schema revision (./revision.ts) instead.
//
// Any DDL moves that revision, even a `create … if not exists` SQLite does
// nothing with, so a pass that makes what is missing (`erect`) leaves out what
// already stands, and reads the list again only after it changed something.
import type { Vocab } from '@yaks/vocab'
import { col, select, type Stmt, table } from './ast.ts'
import type { Driver, Row } from './driver.ts'
import { related, relatedNames, stored } from './layout.ts'
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
  v?: Vocab
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
  let at = revision(driver, 'schema'), v = driver.stored?.v
  let kept = held.get(driver)
  if (kept?.at === at && kept.v === v) return kept
  let label = labels(v)
  // Sorted here: SQLite would read every row twice to sort them.
  let entries = driver.query(select({
    cols: [col('type'), col('name'), col('tbl_name'), col('sql')],
    from: table('sqlite_schema'),
  })).map((r): SchemaObject => ({
    type: String(r.type),
    name: r.type == 'table' ? label(String(r.name)) : String(r.name),
    tbl_name: label(String(r.tbl_name)),
    sql: r.sql == null ? null : String(r.sql),
  })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  kept = {
    at,
    v,
    entries,
    kinds: new Map(entries.map((o) => [o.name, kind(o.type)])),
  }
  held.set(driver, kept)
  return kept
}

/** A table's name as a statement writes it: the label of the component the
 * file stores under it (`Vocab.stored`), or the name itself. */
export let tableAsWritten = (v: Vocab | undefined, name: string): string =>
  labels(v)(name)

// Each component's table, from the name the vocabulary stores it under to its
// label.
let named = new WeakMap<Vocab, Map<string, string>>()
let labels = (v?: Vocab) => {
  if (!v) return (name: string) => name
  let held = named.get(v)
  if (!held) {
    held = new Map([...v.all, ...relatedNames(v)].flatMap((c) => {
      let at = stored(v, c)
      return at == c ? [] : [[at, c] as const]
    }))
    named.set(v, held)
  }
  let map = held
  return (name: string) => map.get(name) ?? name
}

/**
 * What a pragma about one table answered, each column under the name a
 * statement writes it by: a component's stored column under its label, as
 * {@link catalogue} lists its table (`table_info`, `table_xinfo`,
 * `index_info`, `index_xinfo` name a column; `foreign_key_list` its `from`).
 * Rows of any other statement are as they came.
 */
export let asWritten = (s: Stmt, rows: Row[], v?: Vocab): Row[] => {
  if (s.t == 'raw') {
    return s.origin && !s.physical ? asWritten(s.origin, rows, v) : rows
  }
  if (!v || s.t != 'pragma' || typeof s.arg != 'string') return rows
  let key = COLUMN[s.name]
  if (!key) return rows
  let table = s.name.startsWith('index_')
    ? indexed(v, s.arg)
    : v.comp(s.arg) || related(v, s.arg)
    ? s.arg
    : undefined
  if (!table) return rows
  let back = columnsBack(v, table)
  if (!back.size) return rows
  return rows.map((r) =>
    typeof r[key] == 'string' && back.has(r[key] as string)
      ? { ...r, [key]: back.get(r[key] as string) }
      : r
  )
}
let COLUMN: Record<string, string> = {
  table_info: 'name',
  table_xinfo: 'name',
  index_info: 'name',
  index_xinfo: 'name',
  foreign_key_list: 'from',
}

// The component an index is on, where its name says (./sqlite.ts
// `indexName`): a stored table's name and an underscore.
let indexed = (v: Vocab, index: string): string | undefined => {
  let at = index.indexOf('_')
  return at > 0 ? labels(v)(index.slice(0, at)) : undefined
}

// A component's columns, from the name each is stored under to the one a
// statement writes it by.
let backs = new WeakMap<Vocab, Map<string, Map<string, string>>>()
let columnsBack = (v: Vocab, comp: string): Map<string, string> => {
  let all = backs.get(v)
  if (!all) backs.set(v, all = new Map())
  let held = all.get(comp)
  if (!held) {
    held = new Map(
      v.props(related(v, comp)?.comp ?? comp).flatMap((p) => {
        let k = p == 'entity' ? '$entity' : p, at = stored(v, comp, k)
        return at == k ? [] : [[at, k] as const]
      }),
    )
    all.set(comp, held)
  }
  return held
}

/** A physical column under the label its table's statements use. */
export let columnAsWritten = (
  v: Vocab | undefined,
  table: string,
  name: string,
): string => v ? columnsBack(v, table).get(name) ?? name : name

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
