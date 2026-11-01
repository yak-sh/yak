// One object's SQLite, copied table by table into another object at a new
// address. Cloudflare moves no Durable Object, so an object that should stand
// somewhere else is a new one holding the same file: every table's rows under
// their own rowids, then the indexes, triggers and views the catalogue keeps.
//
// The rows go first and the triggers after, so a copied row fires nothing, and
// foreign keys stay off while they arrive, since a table may reference one
// that comes later. A full-text index is made anew from its content table, so
// its own shadow tables never travel. The planner's statistics live in tables an object may not
// write, so the far end analyzes what it now holds. Both ends tally what they
// hold in the same order (`tallied`), which is how a copy knows it arrived.

import { as, col, type Driver, eq, gt, select, table, val } from '@yaks/sql'
import { reserved } from './sql.ts'

/** A value on its way between objects: a blob travels as base64. */
export type Cell = string | number | null | { bytes: string }

/** Everything a far end must make before rows reach it, and after. */
export type Plan = {
  tables: { name: string; sql: string; cols: string[] }[]
  /** views, made once the rows are in: a full-text index may read one */
  views: string[]
  /** indexes and triggers, made last */
  after: string[]
  /** full-text indexes, made and rebuilt from their content tables */
  fts: { name: string; sql: string }[]
  /** where each AUTOINCREMENT table's counter stands */
  sequences: { name: string; seq: number }[]
}

/** How far a table has been read, and what it holds so far. */
export type Copied = { rows: number; digest: number }

const ROWID = '_rowid_'

let schema = (driver: Driver) =>
  driver.query(select({
    cols: [col('type'), col('name'), col('sql')],
    from: table('sqlite_schema'),
  })).filter((o) => !reserved(String(o.name)) && o.sql != null)

let virtual = (sql: unknown) => /^create\s+virtual\b/i.test(String(sql))

/** What this object's file is made of. A table it can't rebuild, one without a
 * rowid or a virtual one other than full text, is refused rather than copied
 * wrong. */
export let plan = (driver: Driver): Plan => {
  let objects = schema(driver)
  let fts = objects.filter((o) => virtual(o.sql)).map((o) => {
    let [name, sql] = [String(o.name), String(o.sql)]
    if (!/\busing\s+fts5\b/i.test(sql)) {
      throw new Error(`${name} cannot be copied row by row: ${sql}`)
    }
    return { name, sql }
  })
  let shadow = (name: string) =>
    fts.some((f) =>
      ['data', 'idx', 'content', 'docsize', 'config'].some((s) =>
        name == `${f.name}_${s}`
      )
    )
  let tables = objects.filter((o) =>
    o.type == 'table' && !virtual(o.sql) && !shadow(String(o.name))
  ).map((o) => {
    let [name, sql] = [String(o.name), String(o.sql)]
    if (/\bwithout\s+rowid\s*$/i.test(sql)) {
      throw new Error(`${name} cannot be copied row by row: ${sql}`)
    }
    let cols = driver.query({ t: 'pragma', name: 'table_xinfo', arg: name })
      .filter((c) => Number(c.hidden) == 0).map((c) => String(c.name))
    return { name, sql, cols }
  })
  let sequences = objects.some((o) => /\bautoincrement\b/i.test(String(o.sql)))
    ? driver.query(select({
      cols: [col('name'), col('seq')],
      from: table('sqlite_sequence'),
    })).map((r) => ({ name: String(r.name), seq: Number(r.seq) }))
    : []
  return {
    tables,
    fts,
    views: objects.filter((o) => o.type == 'view').map((o) => String(o.sql)),
    after: objects.filter((o) => o.type == 'index' || o.type == 'trigger')
      .map((o) => String(o.sql)),
    sequences,
  }
}

let encoded = (bytes: Uint8Array) => {
  let text = ''
  for (let b of bytes) text += String.fromCharCode(b)
  return btoa(text)
}

let cell = (v: unknown): Cell =>
  v instanceof Uint8Array ? { bytes: encoded(v) } : v as Cell

let bound = (c: Cell) =>
  c != null && typeof c == 'object'
    ? Uint8Array.from(atob(c.bytes), (b) => b.charCodeAt(0))
    : c

// A row's mark on its table's running digest (a 32-bit FNV-1a). It finds a copy
// gone wrong; nothing here is adversarial.
let mixed = (digest: number, row: Cell[]) => {
  let text = JSON.stringify(row)
  for (let i = 0; i < text.length; i++) {
    digest = Math.imul(digest ^ text.charCodeAt(i), 16777619)
  }
  return digest >>> 0
}

/** A table not yet read. */
export let raised = (): Copied => ({ rows: 0, digest: 2166136261 })

/** The next rows of a table after a rowid, each led by its rowid, and the
 * tally with them in it. A page stops at `limit` rows or near `bytes`, so an
 * answer stays small whatever its rows hold. */
export let page = (
  driver: Driver,
  t: Plan['tables'][number],
  after: number,
  held: Copied,
  limit = 200,
  bytes = 256 * 1024,
): { rows: Cell[][]; last: number | null; held: Copied } => {
  let read = driver.query(select({
    cols: [as(col(ROWID), ROWID), ...t.cols.map((c) => col(c))],
    from: table(t.name),
    where: gt(col(ROWID), val(after)),
    order: [col(ROWID)],
    limit: val(limit),
  }))
  let rows: Cell[][] = [], size = 0, { rows: n, digest } = held
  for (let r of read) {
    let row = [r[ROWID] as number, ...t.cols.map((c) => cell(r[c]))]
    rows.push(row)
    n++
    digest = mixed(digest, row)
    size += JSON.stringify(row).length
    if (size > bytes) break
  }
  return {
    rows,
    last: rows.length ? rows[rows.length - 1][0] as number : null,
    held: { rows: n, digest },
  }
}

/** What a whole table holds, read as `page` reads it. */
export let tallied = (driver: Driver, t: Plan['tables'][number]): Copied => {
  let held = raised(), after = 0
  while (true) {
    let next = page(driver, t, after, held)
    if (next.last == null) return next.held
    ;({ held } = next)
    after = next.last
  }
}

let txOf = <R>(driver: Driver, body: () => R) =>
  driver.tx ? driver.tx(body) : body()

/** The far end's first step: its tables made, empty, with foreign keys off for
 * this connection until `ending` turns them back on. */
export let copied = (driver: Driver, p: Plan): void => {
  driver.query({ t: 'pragma', name: 'foreign_keys', value: 'off' })
  txOf(driver, () => {
    for (let t of p.tables) driver.query({ t: 'catalogued', sql: t.sql })
  })
}

/** Rows into their table, under the rowids they have always had. */
export let arrived = (
  driver: Driver,
  t: Plan['tables'][number],
  rows: Cell[][],
): void => {
  driver.query({ t: 'pragma', name: 'foreign_keys', value: 'off' })
  txOf(driver, () => {
    for (let row of rows) {
      driver.query({
        t: 'insert',
        or: 'replace',
        into: t.name,
        cols: [ROWID, ...t.cols],
        rows: [row.map((c) => val(bound(c)))],
      })
    }
  })
}

/** The far end's last step: indexes, triggers, views, counters and statistics,
 * foreign keys on, and every table's tally to compare with the source's. */
export let ending = (driver: Driver, p: Plan): Record<string, Copied> => {
  txOf(driver, () => {
    for (let sql of p.views) driver.query({ t: 'catalogued', sql })
    for (let { name, sql } of p.fts) {
      driver.query({ t: 'catalogued', sql })
      driver.query({
        t: 'insert',
        into: name,
        cols: [name],
        rows: [[val('rebuild')]],
      })
    }
    for (let sql of p.after) driver.query({ t: 'catalogued', sql })
    for (let { name, seq } of p.sequences) {
      driver.query({
        t: 'update',
        table: 'sqlite_sequence',
        set: { seq: val(seq) },
        where: eq(col('name'), val(name)),
      })
    }
  })
  driver.query({ t: 'pragma', name: 'foreign_keys', value: 'on' })
  let tallies: Record<string, Copied> = {}
  for (let t of p.tables) {
    tallies[t.name] = tallied(driver, t)
    if (tallies[t.name].rows) driver.query({ t: 'analyze', table: t.name })
  }
  return tallies
}
