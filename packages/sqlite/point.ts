import { canonical, eidOf } from '@yaks/archetype/sets'
import { col, eq, oneOf, select, sub, table, val, type Write } from '@yaks/sql'
import { mintSql } from './write.ts'

/** Classification for a deferred adapter that already knows each whole shape.
 * These statements belong in the same batch as the rows they describe. */
export let pointSql = (
  shapes: { eid: string; tables: string[] }[],
): Write[] => {
  if (!shapes.length) return []
  let sets = new Map<string, { tables: string[]; owners: string[] }>()
  let own = (names: string[], eid: string) => {
    let tables = canonical(names), key = eidOf(tables)
    let set = sets.get(key)
    if (!set) sets.set(key, set = { tables, owners: [] })
    set.owners.push(eid)
  }
  for (let { eid, tables } of shapes) own(tables, eid)
  let descriptors = [...sets.keys()]
  own(['archetype'], eidOf(['archetype']))
  for (let eid of descriptors) own(['archetype'], eid)
  let id = (eid: string) =>
    sub(select({
      cols: [col('id')],
      from: table('entity'),
      where: eq(col('eid'), val(eid)),
    }))
  return [
    ...[...sets.keys()].map((eid) => mintSql(eid)),
    ...[...sets].map(([eid, { tables }]): Write => ({
      t: 'insert',
      into: 'archetype',
      cols: ['entity', 'tables'],
      rows: [[id(eid), val(JSON.stringify(tables))]],
      upsert: [{ on: [col('entity')] }],
    })),
    ...[...sets].map(([eid, { owners }]): Write => ({
      t: 'update',
      table: 'entity',
      set: { archetype: id(eid) },
      where: oneOf(col('eid'), owners),
    })),
  ]
}
