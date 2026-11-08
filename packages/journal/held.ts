// Count retained changes by component on the covering index. The daily file
// measurement can run this scan through its asynchronous statement reader.
import { as, col, fn, lit, type Row, select, type Stmt, table } from '@yaks/sql'

export let heldSql = (): Stmt =>
  select({
    cols: [as(col('component'), 'c'), as(fn('count', lit('*')), 'n')],
    from: table('journal_change'),
    group: [col('component')],
  })

export let heldRows = (rows: Row[]): Record<string, number> =>
  Object.fromEntries(rows.map((r) => [String(r.c), Number(r.n ?? 0)]))
