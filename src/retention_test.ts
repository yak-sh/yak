import { assertEquals } from '@std/assert'
import { retention, RETENTION_ROWS } from './retention.ts'

Deno.test('retention has a named 20,000-row default', () => {
  assertEquals(RETENTION_ROWS, 20_000)
  let r = retention<number>()
  for (let i = 0; i <= RETENTION_ROWS; i++) r.put(String(i), i)
  assertEquals(r.rows.size, RETENTION_ROWS)
  assertEquals(r.get('0'), undefined)
  assertEquals(r.get('1'), 1)
})

Deno.test('retention bounds rows and evicts least recently read, not inserted', () => {
  let r = retention<number>(2)
  r.put('a', 1)
  r.put('b', 2)
  assertEquals(r.get('a'), 1)
  assertEquals(r.put('c', 3), ['b'])
  assertEquals([...r.rows], [['a', 1], ['c', 3]])
  r.put('a', 4)
  assertEquals(r.put('d', 5), ['c'])
  assertEquals([...r.rows], [['a', 4], ['d', 5]])
})
