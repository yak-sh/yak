// One object's SQLite, copied table by table into another object at a new
// address. Cloudflare moves no Durable Object, so an object that should stand
// somewhere else is a new one holding the same file: every table's rows under
// their own rowids, then the indexes, triggers and views the catalogue keeps.
//
// The rows go first and the triggers after, so a copied row fires nothing, and
// foreign keys stay off while they arrive, since a table may reference one
// that comes later. The rows travel while the source still serves, so a second
// look (`chunks`, `stale`, `overwritten`) compares what each end holds a chunk
// at a time and sends again only what changed. A full-text index is made anew
// from its content table, so its shadow tables never travel. The planner's
// statistics live in tables an object may not write, so the far end analyzes
// what it now holds.

import {
  and,
  as,
  col,
  type Driver,
  type Drop,
  eq,
  fn,
  gt,
  le,
  queryPhysical,
  select,
  table,
  val,
} from '@yaks/sql'
import { reserved } from './sql.ts'
import { unit } from '@yaks/sqlite/unit'
import { fromBase64, toBase64 } from '@yaks/fp'

/** A value on its way between objects: a blob travels as base64. */
export type Cell = string | number | null | { bytes: string }
export type Cursor = number | string | null

/** Everything a far end must make before rows reach it, and after. */
export type Plan = {
  tables: { name: string; sql: string; cols: string[]; key?: string }[]
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
type Table = Plan['tables'][number]

/** The cursor before a table's first copy page. */
export let first = (t: Table): Cursor => t.key ? null : 0

let schema = (driver: Driver) =>
  driver.query(select({
    cols: [col('type'), col('name'), col('sql')],
    from: table('sqlite_schema'),
  })).filter((o) => !reserved(String(o.name)) && o.sql != null)

let virtual = (sql: unknown) => /^create\s+virtual\b/i.test(String(sql))

/** What this object's file is made of. A table without a rowid uses its
 * primary key to page through rows. */
export let plan = (driver: Driver): Plan => {
  let objects = schema(driver)
  let fts = ftsOf(objects)
  let tables = objects.filter((o) => rowed(o, fts)).map((o) =>
    tableOf(driver, o)
  )
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

/** One table of the plan, as `plan` would give it, or null when the plan has
 * none of that name: what a page of it asks, without a plan's every table. */
export let planFor = (
  driver: Driver,
  name: string,
): Plan['tables'][number] | null => {
  let objects = schema(driver)
  let o = objects.find((o) => o.name == name)
  return o && rowed(o, ftsOf(objects)) ? tableOf(driver, o) : null
}

type Listed = ReturnType<typeof schema>[number]

let ftsOf = (objects: Listed[]) =>
  objects.filter((o) => virtual(o.sql)).map((o) => {
    let [name, sql] = [String(o.name), String(o.sql)]
    if (!/\busing\s+fts5\b/i.test(sql)) {
      throw new Error(`${name} cannot be copied row by row: ${sql}`)
    }
    return { name, sql }
  })

// Whether an object is a table whose rows travel: not a full-text index, and
// not one of the shadow tables an index is made anew from.
let rowed = (o: Listed, fts: Plan['fts']) =>
  o.type == 'table' && !virtual(o.sql) &&
  !fts.some((f) =>
    ['data', 'idx', 'content', 'docsize', 'config'].some((s) =>
      o.name == `${f.name}_${s}`
    )
  )

let tableOf = (driver: Driver, o: Listed) => {
  let [name, sql] = [String(o.name), String(o.sql)]
  let columns = queryPhysical(driver, {
    t: 'pragma',
    name: 'table_xinfo',
    arg: name,
  })
    .filter((c) => Number(c.hidden) == 0)
  let cols = columns.map((c) => String(c.name))
  if (/\bwithout\s+rowid\s*$/i.test(sql)) {
    let keys = columns.filter((c) => Number(c.pk) > 0)
    if (keys.length != 1 || !/^(text|integer)$/i.test(String(keys[0].type))) {
      throw new Error(
        `${name} needs one text or integer primary key to copy its rows`,
      )
    }
    return { name, sql, cols, key: String(keys[0].name) }
  }
  return { name, sql, cols }
}

let between = (t: Table, after: Cursor, last: Cursor) => {
  let key = col(t.key ?? ROWID)
  return and(
    ...after == null ? [] : [gt(key, val(after))],
    ...last == null ? [] : [le(key, val(last))],
  )
}

let cell = (v: unknown): Cell =>
  v instanceof Uint8Array ? { bytes: toBase64(v) } : v as Cell

let bound = (c: Cell) =>
  c != null && typeof c == 'object' ? fromBase64(c.bytes) : c

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

/** The next rows of a table after a rowid, up to `until` when one is named,
 * each led by its rowid, and the tally with them in it. A page stops at
 * `limit` rows or near `bytes`, so an answer stays small whatever its rows
 * hold; `ended` says nothing is left to ask past it. */
export let page = (
  driver: Driver,
  t: Plan['tables'][number],
  after: Cursor,
  held: Copied,
  limit = 200,
  bytes = 256 * 1024,
  until?: Cursor,
): { rows: Cell[][]; last: Cursor; held: Copied; ended: boolean } => {
  let read = ranged(driver, t, after, until ?? null, limit)
  let rows: Cell[][] = [], size = 0, { rows: n, digest } = held
  for (let row of read) {
    rows.push(row)
    n++
    digest = mixed(digest, row)
    size += JSON.stringify(row).length
    if (size > bytes) break
  }
  return {
    rows,
    last: rows.length ? rows[rows.length - 1][0] as Cursor : null,
    held: { rows: n, digest },
    ended: rows.length == read.length &&
      (read.length < limit || (until != null && rows.at(-1)?.[0] == until)),
  }
}

/** Each table's last rowid as it stands, 0 for an empty one, so a reader
 * can ask a long table in ranges at once. */
export let tips = (driver: Driver, p: Plan): Record<string, number> =>
  Object.fromEntries(
    p.tables.filter((t) => !t.key).map((t) => [
      t.name,
      Number(
        queryPhysical(
          driver,
          select({
            cols: [as(fn('max', col(ROWID)), 'tip')],
            from: table(t.name),
          }),
        )[0]?.tip ?? 0,
      ),
    ]),
  )

/** One run of a table's rows, its digest and where it ends. */
export type Chunk = {
  table: string
  after: Cursor
  /** the last rowid in the run; null runs past every rowid the far end holds */
  last: Cursor
  held: Copied
}

let ranged = (
  driver: Driver,
  t: Plan['tables'][number],
  after: Cursor,
  last: Cursor,
  limit?: number,
) =>
  queryPhysical(
    driver,
    select({
      cols: [
        ...t.key ? [] : [as(col(ROWID), ROWID)],
        ...t.cols.map((c) => col(c)),
      ],
      from: table(t.name),
      where: between(t, after, last),
      order: [col(t.key ?? ROWID)],
      ...limit ? { limit: val(limit) } : {},
    }),
  ).map((r) => [r[t.key ?? ROWID] as Cursor, ...t.cols.map((c) => cell(r[c]))])

let digestOf = (rows: Cell[][]): Copied => {
  let held = raised()
  for (let row of rows) {
    held = { rows: held.rows + 1, digest: mixed(held.digest, row) }
  }
  return held
}

/** Every table as runs of `size` rows with their digests. Each table's last run
 * stands for everything past the rows it has, so rows the far end holds that
 * this end no longer does read as a difference too. */
export let chunks = (driver: Driver, p: Plan, size = 500): Chunk[] =>
  p.tables.flatMap((t) => {
    let found: Chunk[] = [], after = first(t)
    while (true) {
      let rows = ranged(driver, t, after, null, size)
      if (rows.length < size) {
        found.push({ table: t.name, after, last: null, held: digestOf(rows) })
        return found
      }
      let last = rows[rows.length - 1][0] as Cursor
      found.push({ table: t.name, after, last, held: digestOf(rows) })
      after = last
    }
  })

/** Those of a source's chunks that this end holds differently. */
export let stale = (driver: Driver, p: Plan, source: Chunk[]): Chunk[] => {
  let tables = new Map(p.tables.map((t) => [t.name, t]))
  return source.filter((c) => {
    let held = digestOf(ranged(driver, tables.get(c.table)!, c.after, c.last))
    return held.rows != c.held.rows || held.digest != c.held.digest
  })
}

/** A source's rows for a chunk. */
export let reread = (driver: Driver, p: Plan, c: Chunk): Cell[][] =>
  ranged(driver, p.tables.find((t) => t.name == c.table)!, c.after, c.last)

/** A chunk's rows put in place of what this end holds there. */
export let overwritten = (
  driver: Driver,
  p: Plan,
  c: Chunk,
  rows: Cell[][],
): void => {
  let t = p.tables.find((t) => t.name == c.table)!
  driver.query({ t: 'pragma', name: 'foreign_keys', value: 'off' })
  unit(driver, () => {
    queryPhysical(driver, {
      t: 'delete',
      from: t.name,
      where: between(t, c.after, c.last),
    })
  })
  arrived(driver, t, rows)
}

/** What a whole table holds, read as `page` reads it. */
export let tallied = (driver: Driver, t: Plan['tables'][number]): Copied => {
  let held = raised(), after = first(t)
  while (true) {
    let next = page(driver, t, after, held)
    if (next.last == null) return next.held
    ;({ held } = next)
    after = next.last
  }
}

/** The far end's first step: its tables made, empty, with foreign keys off for
 * this connection until `ending` turns them back on. */
export let copied = (driver: Driver, p: Plan): void => {
  driver.query({ t: 'pragma', name: 'foreign_keys', value: 'off' })
  unit(driver, () => {
    for (let t of p.tables) driver.query({ t: 'catalogued', sql: t.sql })
  })
}

/** Fit the far end's tables to a newer plan before comparing ranges. Keep
 * rows in tables whose definitions still match. If the schema moved, leave
 * indexes, triggers and views for `ending` once the rows agree. */
export let align = (driver: Driver, p: Plan): boolean => {
  let objects = schema(driver)
  let fts = ftsOf(objects)
  let tables = objects.filter((o) => rowed(o, fts))
  let virtuals = objects.filter((o) => virtual(o.sql))
  let others = objects.filter((o) => o.type != 'table')
  let held = new Set([...tables, ...virtuals, ...others].map((o) => o.sql))
  let wanted = [
    ...p.tables.map((t) => t.sql),
    ...p.fts.map((t) => t.sql),
    ...p.views,
    ...p.after,
  ]
  if (held.size == wanted.length && wanted.every((sql) => held.has(sql))) {
    return true
  }

  let definitions = new Set(p.tables.map((t) => t.sql))
  let changed = tables.filter((o) => !definitions.has(String(o.sql)))
  driver.query({ t: 'pragma', name: 'foreign_keys', value: 'off' })
  unit(driver, () => {
    for (let o of [...others, ...virtuals, ...changed]) {
      queryPhysical(driver, {
        t: 'drop',
        kind: o.type as Drop['kind'],
        name: String(o.name),
      })
    }
    for (let t of p.tables) {
      if (!held.has(t.sql)) driver.query({ t: 'catalogued', sql: t.sql })
    }
  })
  return false
}

/** Rows into their table, under the rowids they have always had. */
export let arrived = (
  driver: Driver,
  t: Plan['tables'][number],
  rows: Cell[][],
): void => {
  driver.query({ t: 'pragma', name: 'foreign_keys', value: 'off' })
  unit(driver, () => {
    for (let row of rows) {
      driver.query({
        t: 'insert',
        or: 'replace',
        into: t.name,
        cols: t.key ? t.cols : [ROWID, ...t.cols],
        rows: [(t.key ? row.slice(1) : row).map((c) => val(bound(c)))],
      })
    }
  })
}

/** The far end's last step: indexes, triggers, views, counters and statistics,
 * and foreign keys on. */
export let ending = (driver: Driver, p: Plan): void => {
  unit(driver, () => {
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
  for (let t of p.tables) driver.query({ t: 'analyze', table: t.name })
}
