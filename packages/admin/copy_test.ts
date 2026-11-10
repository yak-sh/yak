import { equal, test } from '@yaks/testing'
import { open } from '@yaks/sqlite/db'
import { page, plan, raised } from '@yaks/durable-object'
import { col, select, table, val } from '@yaks/sql'
import { copy, type Copying } from './copy.ts'

// A source over a file of its own, read out the way the Builder's door reads
// one (workers/yak/operator-copy.ts), a page of two rows at a time.
let source = open(':memory:')
source.query({ t: 'create table', name: 'note', cols: [{ name: 'body' }] })
for (let body of ['a', 'b', 'c']) {
  source.query({
    t: 'insert',
    into: 'note',
    cols: ['body'],
    rows: [[val(body)]],
  })
}
let empty = open(':memory:')
let asking = (sql: typeof source) =>
(
  _: string,
  asked: { table?: string; after?: number },
): Promise<Copying> => {
  let made = plan(sql)
  if (!asked.table) return Promise.resolve({ plan: made })
  let t = made.tables.find((t) => t.name == asked.table)!
  let { rows, last } = page(sql, t, asked.after ?? 0, raised(), 2)
  return Promise.resolve({ rows, last })
}

test('a space’s store is copied table by table, and one with none says so', async () => {
  let made = open(':memory:')
  let lines: string[] = []
  let stores = { ada: source, bea: empty }
  for (let [slug, sql] of Object.entries(stores)) {
    await copy({
      spaces: [{ eid: slug, slug }],
      page: asking(sql),
      open: () => ({ ...made, close: () => {} }),
      out: (line) => lines.push(line),
      stopping: new AbortController().signal,
    })
  }
  equal(lines, ['ada  1 tables, 3 rows', 'bea  no store'])
  equal(
    made.query(select({ cols: [col('body')], from: table('note') })),
    [{ body: 'a' }, { body: 'b' }, { body: 'c' }],
  )
})
