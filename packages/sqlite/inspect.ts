// Bounded physical facts about a SQLite store. The caller sees names and
// counts, never definitions, statement text, or row values.

import { type Driver, tally } from '@yaks/sql'

export type TableSize = {
  name: string
  rows: number
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
  let shown = names.slice(0, Math.max(0, Math.min(limit, 160))).map((name) => {
    let indexes = db.query({ t: 'pragma', name: 'index_list', arg: name })
      .map((r) => String(r.name))
    return {
      name,
      rows: tally(db, name),
      indexCount: indexes.length,
      indexes: indexes.slice(0, 16),
    }
  })
  return { tables: names.length, shown, omitted: names.length - shown.length }
}
