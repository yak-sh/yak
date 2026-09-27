import { assertEquals } from '@std/assert'
import { pageRanked, parseQuery, windowOf } from './query.ts'

Deno.test('a web query pages past an entity without a number', () => {
  let win = windowOf(parseQuery('.limit=2&.after=child:abc'))
  assertEquals(win, { limit: 2, after: 'child:abc' })
  assertEquals(
    pageRanked([
      { eid: 'first' },
      { eid: 'child:abc' },
      { eid: 'last' },
    ], win).map((row) => row.eid),
    ['last'],
  )
})
