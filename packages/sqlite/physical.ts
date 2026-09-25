import {
  as,
  col,
  count,
  type Driver,
  eq,
  fn,
  select,
  table,
  val,
} from '@yaks/sql'

/** Every table the file's schema lists, by name. */
export let tables = (driver: Driver): string[] =>
  driver.query(select({
    cols: [col('name')],
    from: table('sqlite_schema'),
    where: eq(col('type'), val('table')),
    order: [col('name')],
  })).map((r) => String(r.name))

/**
 * Component tables actually in the file, irrespective of the loaded vocabulary.
 * Virtual/FTS shadow tables and infrastructure are not component tables. A
 * component table has an integer entity primary key. Tombstone and archetype
 * are component tables (the latter's own archetype is the one-element fixed
 * point).
 */
export function componentTables(driver: Driver): string[] {
  let ordinary = new Set(
    driver.query({ t: 'pragma', name: 'table_list' })
      .filter((r) => r.schema == 'main' && r.type == 'table')
      .map((r) => String(r.name)),
  )
  return tables(driver)
    .filter((name) =>
      ordinary.has(name) && !['entity', 'journal', 'hit'].includes(name) &&
      !name.startsWith('sqlite_') && !/^_+cf_/i.test(name)
    )
    .filter((name) =>
      driver.query({ t: 'pragma', name: 'table_info', arg: name })
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
  let [row] = driver.query(select({
    cols: [
      as(count(), 'n'),
      as(fn('total', fn('length', col('sql'))), 'bytes'),
    ],
    from: table('sqlite_schema'),
  }))
  return `${row.n}/${row.bytes}`
}
