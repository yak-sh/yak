// The answer must carry every column the phases wrote, not just the last
// patch's columns. Clearing a component resets that fold; clearing a column
// remains an explicit null for the caller's cache.

import { assertEquals } from '@std/assert'
import { composed } from './compose.ts'
import type { Comp } from './bundle.ts'

let fold = (...parts: (Comp | null)[]) =>
  composed(parts.map((book) => ({ entity: { eid: 'b1' }, book })))[0].book

Deno.test('composed merges phase patches by column and preserves clears', () => {
  assertEquals(fold({ pages: 412 }, { status: 'sold' }), {
    pages: 412,
    status: 'sold',
  })
  assertEquals(fold({ pages: 412, status: 'sold' }, { status: null }), {
    pages: 412,
    status: null,
  })
  assertEquals(fold({ pages: 412 }, null), null)
  assertEquals(fold({ pages: 412 }, null, { status: 'sold' }), {
    status: 'sold',
  })
})
