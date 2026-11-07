// Each vector's int8 codes, kept beside it on shared storage, so a native scan
// reads 384 bytes a vector where its floats take 1,536 and a page holds two.
// A search that has to read the corpus from disk, the box's page cache having
// let it go, reads a fifth as much (./native.ts), and the nearest few are
// still scored from their floats (./near.ts).
//
// The table only ever lacks codes: triggers delete a vector's codes when the
// vector changes or goes (./ddl.ts), whoever wrote it. So it holds every
// vector's codes exactly when it has as many rows as there are vectors, and a
// scan asks that before it trusts them. {@link put} codes what the sweep
// stores; {@link heal} codes what anyone else stored (a migration, an older
// process, every vector stored before the table was made).

import {
  and,
  as,
  col,
  count,
  eq,
  exists,
  gt,
  lit,
  not,
  select,
  type Statements,
  table,
  val,
} from '@yaks/sql'
import { CODE, TABLE } from './ddl.ts'
import { coded, floats } from './vector.ts'

let tally = (db: Statements, name: string): number =>
  Number(db.query(select({ cols: [as(count(), 'n')], from: table(name) }))[0].n)

// Whether this database has the table, asked again once its schema changes.
let made = new WeakMap<Statements, { version: number; has: boolean }>()
export let has = (db: Statements): boolean => {
  let version = db.revision('schema')
  let kept = made.get(db)
  if (kept?.version == version) return kept.has
  let found = !!db.query(select({
    cols: [col('name')],
    from: table('sqlite_master'),
    where: eq(col('name'), val(CODE)),
  }))[0]
  made.set(db, { version, has: found })
  return found
}

/** Whether every stored vector has its codes: counted off the two tables'
 * narrowest indexes, never their payloads. */
export let complete = (db: Statements): boolean =>
  has(db) && tally(db, CODE) == tally(db, TABLE)

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

// Where the last heal stopped, so a pass reads each vector at most once.
let after = new WeakMap<Statements, number>()

/** Code up to `limit` stored vectors that have no codes, in owner order from
 * where the last call stopped, and say how many it coded. Nothing to code
 * costs two counts. */
export let heal = (db: Statements, limit = 2048): number => {
  if (!has(db) || complete(db)) return 0
  let from = after.get(db) ?? 0
  let rows = db.query(select({
    cols: [col('owner', 'e'), col('vec', 'e')],
    from: table(TABLE, 'e'),
    where: and(
      gt(col('owner', 'e'), val(from)),
      not(exists(select({
        cols: [lit(1)],
        from: table(CODE, 'c'),
        where: eq(col('owner', 'c'), col('owner', 'e')),
      }))),
    ),
    order: [col('owner', 'e')],
    limit: val(limit),
  }))
  after.set(db, rows.length < limit ? 0 : Number(rows.at(-1)!.owner))
  db.atomic(() => {
    for (let r of rows) {
      put(db, Number(r.owner), floats(r.vec as Uint8Array))
    }
  })
  return rows.length
}
