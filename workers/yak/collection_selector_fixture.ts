import { driver, type DurableStorage } from '@yaks/durable-object'
import { call, col, each, select, val } from '@yaks/sql'

export let collectionSelectorCost = (db: DurableStorage) => {
  let read = 0
  let sql = driver(db, (s) => read += s.rowsRead)
  let values = ["can't", '雪', 'a,b', null, true, false, 3, 2.5]
  let rows = sql.query(each(values))
  let cost = read
  let parity = [
    [],
    ['nul\0value', '雪'],
    ['x'.repeat(4097), 'y'],
    Array.from({ length: 600 }, (_, i) => `owner-${i}`),
  ].map((values) => ({
    actual: sql.query(each(values)),
    expected: sql.query(select({
      cols: [col('value')],
      from: call('json_each', [val(JSON.stringify(values))]),
    })),
  }))
  return { rows, read: cost, parity }
}
