import type { Driver } from './driver.ts'

let quote = (name: string) => `"${name.replaceAll('"', '""')}"`

/**
 * Component TABLES actually in the file, irrespective of the loaded vocabulary.
 * Virtual/FTS shadow tables and infrastructure are not entity facets. A facet
 * has an integer entity primary key. Tombstone and archetype ARE facets (the
 * latter's own archetype is the one-element fixed point).
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
      !name.startsWith('sqlite_')
    )
    .filter((name) =>
      driver.query(`pragma table_info(${quote(name)})`, [])
        .some((r) =>
          r.name == 'entity' && Number(r.pk) == 1 &&
          String(r.type).toLowerCase() == 'integer'
        )
    )
}
