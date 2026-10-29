// Collection values cross SQL adapters without losing type or text.
import { equal, test } from '@yaks/testing'
import { driver } from '@yaks/durable-object'
import { call, col, each, select, val } from '@yaks/sql'
import { durable } from '../../packages/durable-object/testing.ts'

let sql = driver(durable())
let cases = [
  ["can't", '雪', 'a,b', null, true, false, 3, 2.5],
  [],
  ['nul\0value', '雪'],
  ['x'.repeat(4097), 'y'],
  Array.from({ length: 600 }, (_, i) => `owner-${i}`),
]
for (let [i, values] of cases.entries()) {
  test(`collection selector preserves values in case ${i}`, () => {
    equal(
      sql.query(each(values)),
      sql.query(select({
        cols: [col('value')],
        from: call('json_each', [val(JSON.stringify(values))]),
      })),
    )
  })
}
