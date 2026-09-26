import {
  among,
  as,
  by,
  col,
  count,
  type Driver,
  each,
  eq,
  fn,
  type Param,
  type Row,
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

/** What the file's schema holds — each table, index, view and trigger, with
 * the table it is on and its definition — or the entries these fields name. */
export let objects = (
  driver: Driver,
  fields: Record<string, Param> = {},
): Row[] =>
  driver.query(select({
    cols: [col('type'), col('name'), col('tbl_name'), col('sql')],
    from: table('sqlite_schema'),
    where: by(fields),
    order: [col('name')],
  }))

/** A table's columns, in declaration order. */
export let columns = (driver: Driver, name: string): string[] =>
  driver.query({ t: 'pragma', name: 'table_info', arg: name })
    .map((c) => String(c.name))

/**
 * Component tables actually in the file, irrespective of the loaded vocabulary.
 * Virtual/FTS shadow tables and infrastructure are not component tables. A
 * component table has an integer entity primary key. Tombstone and archetype
 * are component tables (the latter's own archetype is the one-element fixed
 * point). `known` names tables the caller already accounts for: they are left
 * out without being asked about.
 */
export function componentTables(
  driver: Driver,
  known: readonly string[] = [],
): string[] {
  let skip = new Set(['entity', 'journal', 'hit', ...known])
  let ordinary = new Set(
    driver.query({ t: 'pragma', name: 'table_list' })
      .filter((r) => r.schema == 'main' && r.type == 'table')
      .map((r) => String(r.name)),
  )
  return tables(driver)
    .filter((name) =>
      ordinary.has(name) && !skip.has(name) &&
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
 * How many of the named objects the file's schema holds and how long their
 * definitions run together: what moves when one of them is created, dropped
 * or altered, by any connection. Read from `sqlite_schema`, since a Durable
 * Object's SQLite refuses `pragma schema_version`. Only the named objects
 * count, so what is kept beside them (a search index and its triggers, a
 * plugin's own table, the `sqlite_stat1` the first analyze creates) is no
 * change to them.
 */
export let shape = (driver: Driver, names: readonly string[]): string => {
  let [row] = driver.query(select({
    cols: [
      as(count(), 'n'),
      as(fn('total', fn('length', col('sql'))), 'bytes'),
    ],
    from: table('sqlite_schema'),
    where: among(col('name'), each(names)),
  }))
  return `${row.n}/${row.bytes}`
}
