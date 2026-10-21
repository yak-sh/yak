// What the file keeps, as SQLite's page statistics (`dbstat`) count it: each
// table's bytes with its indexes folded in, and its rows, which are the cells
// of its own leaf pages; and the file's bytes and how many of them are free.
// `dbstat` reads every page it counts, which on a file of gigabytes takes a
// minute, so the walk takes one b-tree at a time, each in a read unit, and
// lets its thread's other work run between them.

import {
  as,
  catalogue,
  col,
  type Driver,
  eq,
  fn,
  lit,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'
import { sleep } from '@yaks/fp'
import type { Measure } from '@yaks/graph'
import { unit } from './unit.ts'

// One b-tree's bytes, and the cells of its leaf pages.
let pages = (name: string): Stmt =>
  select({
    cols: [
      as(fn('total', col('pgsize')), 'bytes'),
      as(
        fn(
          'total',
          fn('iif', eq(col('pagetype'), lit('leaf')), col('ncell'), lit(0)),
        ),
        'cells',
      ),
    ],
    from: table('dbstat'),
    where: eq(col('name'), val(name)),
  })

// How long the walk keeps its thread before letting the rest of its work run.
let HOLD = 20

let pragma = (driver: Driver, name: string) =>
  Number(Object.values(driver.query({ t: 'pragma', name })[0] ?? {})[0] ?? 0)

/**
 * Measure the file, a b-tree at a time; undefined once `signal` aborts.
 *
 * ```ts
 * import { col, val } from '@yaks/sql'
 * import { mem } from './testing.ts'
 * import { measure } from './measure.ts'
 * import { equal, ok } from '@yaks/testing'
 *
 * let db = mem()
 * db.query({ t: 'pragma', name: 'page_size', value: 512 })
 * db.query({ t: 'create table', name: 'note', cols: [{ name: 'body' }] })
 * db.query({ t: 'create index', name: 'note_body', on: 'note', cols: [col('body')] })
 * let body = [val('x'.repeat(100))]
 * db.query({ t: 'insert', into: 'note', cols: ['body'], rows: Array(12).fill(body) })
 * let m = (await measure(db))!
 * equal(m.tables.note[1], 12)
 * ok(m.tables.note[0] >= 4 * 512, 'the table and its index, folded in')
 * equal('note_body' in m.tables, false)
 * ok(m.bytes >= m.tables.note[0])
 * ```
 */
export let measure = async (
  driver: Driver,
  signal?: AbortSignal,
): Promise<Measure | undefined> => {
  let size = pragma(driver, 'page_size')
  let tables: Measure['tables'] = {}
  let trees = catalogue(driver).filter((o) =>
    o.type == 'table' || o.type == 'index'
  )
  let held = performance.now()
  for (let o of trees) {
    if (signal?.aborted) return
    let [r] = unit(driver, () => driver.query(pages(o.name)), 'read')
    let kept = tables[o.tbl_name] ??= [0, 0]
    kept[0] += Number(r?.bytes ?? 0)
    if (o.type == 'table') kept[1] = Number(r?.cells ?? 0)
    if (performance.now() - held > HOLD) {
      await sleep(0)
      held = performance.now()
    }
  }
  // A virtual table keeps no pages of its own; its shadow tables do.
  for (let [name, [bytes]] of Object.entries(tables)) {
    if (!bytes) delete tables[name]
  }
  return {
    bytes: pragma(driver, 'page_count') * size,
    free: pragma(driver, 'freelist_count') * size,
    tables,
  }
}
