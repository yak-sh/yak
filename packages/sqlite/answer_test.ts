// Cached answers preserve every scalar and isolate values returned to callers.
import { equal, ok, test } from '@yaks/testing'
import { copied, packed } from './answer.ts'

let id = (i: number) =>
  `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
let rows = Array.from({ length: 50 }, (_, i) => ({
  eid: id(i),
  target: id(i % 3),
  case: 'ABCDEF00-0000-4000-8000-000000000001',
  empty: '',
  nil: null,
  absent: undefined,
  zero: i % 2 ? -0 : 0,
  bool: i % 2 == 0,
  large: 2n ** 60n,
}))
let held = packed(rows, 4096)!
let answer = copied(held)
answer[0].target = 'changed'
test('a packed projection preserves scalar values and identity order', () => {
  ok(!('rows' in held))
  equal(copied(held), rows)
  equal(Object.keys(copied(held)[0]), Object.keys(rows[0]))
})
let nested = [{ value: { items: [1, 2] }, bytes: new Uint8Array([3, 4]) }]
let deep = packed(nested)!
let changed = copied(deep)
;(changed[0].value as { items: number[] }).items.push(5)
test('ordinary cached answers keep nested and binary values isolated', () =>
  equal(copied(deep), nested))
