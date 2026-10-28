// Bounded physical facts about a SQLite store. The caller sees names and
// counts, never definitions, statement text, or row values.

import { populations } from './population.ts'
import { by, col, type Driver, gt, lit, select, table } from '@yaks/sql'

export type DeletionWindow = { since: string; until: string; after?: number }
export type Deletions = {
  scanned: number
  count: number
  minutes: Record<string, number>
  next: number | null
}

/** Count deletions in [since, until), reading at most 1,000 graves from the
 * primary key. Continue with `next` until null; timestamps need no new index. */
export let deletions = (db: Driver, window: DeletionWindow): Deletions => {
  let since = Date.parse(window.since), until = Date.parse(window.until)
  let after = window.after ?? 0
  if (
    !Number.isFinite(since) || !Number.isFinite(until) || since >= until ||
    !Number.isSafeInteger(after) || after < 0
  ) {
    throw new RangeError(
      'deletions needs since < until and a nonnegative cursor',
    )
  }
  let rows = db.query(select({
    cols: [col('entity'), col('deleted_at')],
    from: table('tombstone'),
    where: gt(col('entity'), lit(after)),
    order: [col('entity')],
    limit: lit(1000),
  }))
  let minutes: Record<string, number> = {}, count = 0
  for (let row of rows) {
    let at = Date.parse(String(row.deleted_at))
    if (!(at >= since && at < until)) continue
    let minute = new Date(Math.floor(at / 60_000) * 60_000).toISOString()
    minutes[minute] = (minutes[minute] ?? 0) + 1
    count++
  }
  return {
    scanned: rows.length,
    count,
    minutes,
    next: rows.length == 1000 ? Number(rows.at(-1)!.entity) : null,
  }
}

export type TableSize = {
  name: string
  /** Exact live owners for components, unknown for physical infrastructure. */
  rows: number | null
  indexCount: number
  indexes: string[]
}

export type StoreSize = {
  tables: number
  shown: TableSize[]
  omitted: number
}

/** The ordinary tables and indexes the file holds, including tables no
 * longer named by the current vocabulary. Counting is capped so a diagnostic
 * remains bounded even after a store has seen many schemas. */
export let inspect = (
  db: Driver,
  limit = 160,
  preferred: readonly string[] = [],
): StoreSize => {
  let first = new Set(['entity', 'journal', 'yak_writes', ...preferred])
  let names = db.query({ t: 'pragma', name: 'table_list' })
    .filter((r) => r.schema == 'main' && r.type == 'table')
    .map((r) => String(r.name))
    .filter((name) => !/^(_+cf_|sqlite_)/i.test(name))
    .sort((a, b) =>
      Number(first.has(b)) - Number(first.has(a)) ||
      a.localeCompare(b)
    )
  let buckets = populations(db)
  let shown = names.slice(0, Math.max(0, Math.min(limit, 160))).map((name) => {
    let indexes = db.query({ t: 'pragma', name: 'index_list', arg: name })
      .map((r) => String(r.name))
    return {
      name,
      rows: buckets && (name == 'entity' || buckets.some((b) =>
          b.tables.includes(name)
        ))
        ? buckets.reduce((n, b) =>
          n + (name == 'entity' || b.tables.includes(name) ? b.n : 0), 0)
        : null,
      indexCount: indexes.length,
      indexes: indexes.slice(0, 16),
    }
  })
  return { tables: names.length, shown, omitted: names.length - shown.length }
}

export type Identity = {
  eid: string
  exists: boolean
  tombstoned: boolean
  tables: string[]
  omitted: number
}

/** Physical identity and component presence, never component values. */
export let identity = (db: Driver, eid: string): Identity => {
  let [row] = db.query(select({
    cols: [col('id')],
    from: table('entity'),
    where: by({ eid }),
  }))
  if (!row) {
    return { eid, exists: false, tombstoned: false, tables: [], omitted: 0 }
  }
  let names = db.query({ t: 'pragma', name: 'table_list' })
    .filter((r) => r.schema == 'main' && r.type == 'table')
    .map((r) => String(r.name))
    .filter((name) => !/^(_+cf_|sqlite_)/i.test(name))
    .sort((a, b) =>
      Number(b == 'tombstone') - Number(a == 'tombstone') || a.localeCompare(b)
    )
  let checked = names.slice(0, 160).filter((name) =>
    db.query({ t: 'pragma', name: 'table_info', arg: name })
      .some((column) => column.name == 'entity')
  )
  let tables = checked.filter((name) =>
    db.query(select({
      cols: [col('entity')],
      from: table(name),
      where: by({ entity: Number(row.id) }),
      limit: lit(1),
    })).length
  ).sort()
  return {
    eid,
    exists: true,
    tombstoned: tables.includes('tombstone'),
    tables,
    omitted: Math.max(0, names.length - 160),
  }
}
