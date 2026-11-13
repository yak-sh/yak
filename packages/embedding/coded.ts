// Each vector's int8 codes, kept beside it on shared storage, so a native scan
// reads 384 bytes a vector where its floats take 1,536 and a page holds two.
// A search that has to read the corpus from disk, the box's page cache having
// let it go, reads a fifth as much (./native.ts), and the nearest few are
// still scored from their floats (./near.ts).
//
// Triggers delete a vector's codes when the vector changes or goes, and keep
// the owners of vectors that have none (./ddl.ts), whoever wrote either table.
// So a scan trusts the codes once that set is empty, which is one row to ask
// however many vectors there are. {@link put} codes what the sweep stores;
// {@link heal} codes what anyone else stored (a migration, an older process,
// every vector stored before the table was made).

import { col, eq, lit, select, type Statements, table, val } from '@yaks/sql'
import { CODE, TABLE, UNCODED } from './ddl.ts'
import { coded, floats } from './vector.ts'

// Whether this database keeps codes, asked again once its schema changes. The
// uncoded set is made after the codes, so it standing means both do.
let made = new WeakMap<Statements, { version: number; has: boolean }>()
export let has = (db: Statements): boolean => {
  let version = db.revision('schema')
  let kept = made.get(db)
  if (kept?.version == version) return kept.has
  let found = !!db.query(select({
    cols: [col('name')],
    from: table('sqlite_master'),
    where: eq(col('name'), val(UNCODED)),
  }))[0]
  made.set(db, { version, has: found })
  return found
}

/** Whether every stored vector has its codes: whether any owner is noted
 * uncoded, read off one row. */
export let complete = (db: Statements): boolean =>
  has(db) &&
  !db.query(select({
    cols: [lit(1)],
    from: table(UNCODED),
    limit: lit(1),
  })).length

/** Store the codes of the vector an owner was just given. */
export let put = (db: Statements, owner: number, vec: Float32Array): void => {
  if (!has(db)) return
  db.query({
    t: 'insert',
    or: 'replace',
    into: CODE,
    cols: ['owner', 'code'],
    rows: [[val(owner), val(coded(vec))]],
  })
}

/** Code up to `limit` stored vectors that have no codes, in owner order, and
 * say how many owners it settled. An owner noted with no vector standing is
 * forgotten. Nothing to code costs one row's read. */
export let heal = (db: Statements, limit = 2048): number | Promise<number> => {
  if (!has(db)) return 0
  return db.atomic(() => {
    let rows = db.query(select({
      cols: [col('owner', 'u'), col('vec', 'e')],
      from: table(UNCODED, 'u'),
      joins: [{
        how: 'left',
        src: table(TABLE, 'e'),
        on: eq(col('owner', 'e'), col('owner', 'u')),
      }],
      order: [col('owner', 'u')],
      limit: val(limit),
    }))
    for (let r of rows) {
      let owner = Number(r.owner)
      if (r.vec == null) {
        db.query({
          t: 'delete',
          from: UNCODED,
          where: eq(col('owner'), val(owner)),
        })
      } else put(db, owner, floats(r.vec as Uint8Array))
    }
    return rows.length
  })
}
