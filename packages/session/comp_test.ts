// The vocabulary is a file (`vocab.json`) and the lifecycle is a list
// (words.ts). They used to be one declaration — the document read its enum off
// `STATUSES` — so this is what keeps them the same list now that they are two.

import { assertEquals } from '@std/assert'
import { STATUSES } from './words.ts'
import { pages } from './harness.ts'

Deno.test('a run wears every status the lifecycle spells, and no other', () => {
  assertEquals(pages.column('session', 'status')!.values, STATUSES)
})
