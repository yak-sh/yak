import type { Driver } from './driver.ts'

let quote = (name: string) => `"${name.replaceAll('"', '""')}"`

/**
 * Component tables actually in the file, irrespective of the loaded vocabulary.
 * Virtual/FTS shadow tables and infrastructure are not component tables. A
 * component table has an integer entity primary key. Tombstone and archetype
 * are component tables (the latter's own archetype is the one-element fixed
 * point).
 */
export function componentTables(driver: Driver): string[] {
  let ordinary = new Set(
    driver.query('pragma table_list', [])
      .filter((r) => r.schema == 'main' && r.type == 'table')
      .map((r) => String(r.name)),
  )
  return driver.query(
    "select name from sqlite_schema where type = 'table' order by name collate binary",
    [],
  )
    .map((r) => String(r.name))
    .filter((name) =>
      ordinary.has(name) && !['entity', 'journal', 'hit'].includes(name) &&
      !name.startsWith('sqlite_') && !/^_+cf_/i.test(name)
    )
    .filter((name) =>
      driver.query(`pragma table_info(${quote(name)})`, [])
        .some((r) =>
          r.name == 'entity' && Number(r.pk) == 1 &&
          String(r.type).toLowerCase() == 'integer'
        )
    )
}

/**
 * How many objects the file's schema holds and how long their definitions run
 * together: what moves when any table, index, view or trigger is created,
 * dropped or altered, by any connection. Read from `sqlite_schema`, since a
 * Durable Object's SQLite refuses `pragma schema_version`.
 */
export let shape = (driver: Driver): string => {
  let [row] = driver.query(
    'select count(*) as n, total(length(sql)) as bytes from sqlite_schema',
    [],
  )
  return `${row.n}/${row.bytes}`
}
