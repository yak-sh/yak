import { equal, test } from '@yaks/testing'
import { count } from './read.ts'

let values = [
  0,
  -0,
  1,
  -1,
  999,
  1000,
  -1000,
  1234567,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  1.23456,
  -1.23456,
  1e21,
  NaN,
  Infinity,
  -Infinity,
]
let formatter = new Intl.NumberFormat('en-US')
let expected = values.map((n) => formatter.format(n))

test('counts preserve English grouping, rounding and special numbers', () => {
  equal(values.map(count), expected)
})
