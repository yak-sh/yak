import { Archetypes, namingOf } from '@yaks/archetype/sets'
import { col, eq, oneOf, select, sub, table, val, type Write } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { mintSql } from './write.ts'

/** Classification for a deferred adapter that already knows each whole shape,
 * each descriptor written by the identities of `vocab`, the one the adapter's
 * statements are written with. These statements belong in the same batch as
 * the rows they describe. */
export let pointSql = (
  shapes: { eid: string; tables: string[] }[],
  vocab?: Vocab,
): Write[] => {
  if (!shapes.length) return []
  let cache = new Archetypes(namingOf(vocab))
  let sets = new Map<string, { descriptor: string; owners: string[] }>()
  let own = (names: string[], eid: string) => {
    let set = cache.intern(names), held = sets.get(set.eid)
    if (!held) {
      let descriptor = JSON.stringify(set.descriptor)
      sets.set(set.eid, held = { descriptor, owners: [] })
    }
    held.owners.push(eid)
  }
  for (let { eid, tables } of shapes) own(tables, eid)
  let descriptors = [...sets.keys()]
  let meta = cache.intern(['archetype']).eid
  own(['archetype'], meta)
  for (let eid of descriptors) own(['archetype'], eid)
  let id = (eid: string) =>
    sub(select({
      cols: [col('id')],
      from: table('entity'),
      where: eq(col('eid'), val(eid)),
    }))
  return [
    ...[...sets.keys()].map((eid) => mintSql(eid)),
    ...[...sets].map(([eid, { descriptor }]): Write => ({
      t: 'insert',
      into: 'archetype',
      cols: ['entity', 'tables'],
      rows: [[id(eid), val(descriptor)]],
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
