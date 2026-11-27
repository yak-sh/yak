// Count retained changes by component on the covering index. The daily file
// measurement can run this scan through its asynchronous statement reader.
import { as, col, fn, lit, type Row, select, type Stmt, table } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { names } from './names.ts'

export let heldSql = (): Stmt =>
  select({
    cols: [as(col('component'), 'c'), as(fn('count', lit('*')), 'n')],
    from: table('journal_change'),
    group: [col('component')],
  })

/** The counts by each component's label, where rows recorded it by label or
 * by identity (./names.ts). */
export let heldRows = (rows: Row[], vocab: Vocab): Record<string, number> => {
  let { compLabel } = names(vocab)
  let held: Record<string, number> = {}
  for (let r of rows) {
    let comp = compLabel(String(r.c))
    held[comp] = (held[comp] ?? 0) + Number(r.n ?? 0)
  }
  return held
}
