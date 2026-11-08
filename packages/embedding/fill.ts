// Reconciliation is a queue too: a schema or model change can owe the whole
// corpus. Persist source-table cursors so each pass seeks a bounded window,
// and a restart resumes it without one enormous INSERT SELECT.
import {
  and,
  as,
  col,
  each,
  eq,
  fn,
  from,
  gt,
  type Insert,
  le,
  lit,
  op,
  select,
  type Statements,
  table,
  val,
} from '@yaks/sql'
import { FILL, OWED, TABLE } from './ddl.ts'
import { type Field, tablesIn, wearers } from './fields.ts'

/** Queue owners, retaining the generation a concurrent write advances. */
export let queue = (rows: Pick<Insert, 'rows' | 'q'>): Insert => ({
  t: 'insert',
  into: OWED,
  cols: ['owner', 'n'],
  ...rows,
  upsert: [{ on: [col('owner')], set: { n: op('+', col('n'), lit(1)) } }],
})

let key = (name: string) => name == TABLE ? 'owner' : 'entity'

/** Schedule source tables through their current high key. New writes are
 * already covered by the installed triggers. Rescheduling restarts a table,
 * so another fields change cannot skip owners the earlier fields excluded. */
export let schedule = (db: Statements, names: Iterable<string>): void => {
  for (let name of new Set(names)) {
    let [r] = db.query(select({
      cols: [as(fn('max', col(key(name))), 'last')],
      from: table(name),
    }))
    if (r.last == null) continue
    db.query({
      t: 'insert',
      into: FILL,
      cols: ['name', 'after', 'last'],
      rows: [[val(name), lit(0), val(Number(r.last))]],
      upsert: [{
        on: [col('name')],
        set: { after: lit(0), last: col('last', 'excluded') },
      }],
    })
  }
}

/** Whether reconciliation still has source rows to visit. */
export let filling = (db: Statements): boolean =>
  db.query(select({ cols: [lit(1)], from: table(FILL), limit: lit(1) }))
    .length > 0

/** Queue at most `limit` candidate rows, including rows without eligible
 * text. Applying the keyset window before eligibility also bounds a long
 * excluded tail. Advancing the cursor and queueing its owners commit together. */
export let fill = (db: Statements, fields: Field[], limit = 256): void => {
  if (!filling(db)) return
  db.atomic(() => {
    let names = tablesIn(db)
    while (limit > 0) {
      let [job] = db.query(select({
        cols: [col('name'), col('after'), col('last')],
        from: table(FILL),
        order: [col('name')],
        limit: lit(1),
      }))
      if (!job) return
      let name = String(job.name)
      let where = eq(col('name'), val(name))
      let rows = names.has(name)
        ? db.query(select({
          cols: [as(col(key(name)), 'owner')],
          from: table(name),
          where: and(
            gt(col(key(name)), val(Number(job.after))),
            le(col(key(name)), val(Number(job.last))),
          ),
          order: [col(key(name))],
          limit: val(limit),
        }))
        : []
      let owners = rows.map((r) => Number(r.owner))
      if (owners.length) {
        let candidates = select({
          cols: [as(col('value'), 'owner')],
          from: from(each(owners), 'ids'),
        })
        let vectors = select({
          cols: [col('owner', 'v')],
          from: from(candidates, 'o'),
          joins: [{
            how: 'cross',
            src: table(TABLE, 'v'),
            on: eq(col('owner', 'v'), col('owner', 'o')),
          }],
        })
        for (let q of [...wearers(fields, db.arms, candidates), vectors]) {
          db.query(queue({
            q: select({ cols: [col('owner'), lit(1)], from: from(q, 'w') }),
          }))
        }
      }
      if (rows.length < limit || owners.at(-1) == Number(job.last)) {
        db.query({ t: 'delete', from: FILL, where })
      } else {
        db.query({
          t: 'update',
          table: FILL,
          set: { after: val(owners.at(-1)!) },
          where,
        })
      }
      limit -= rows.length
    }
  })
}
