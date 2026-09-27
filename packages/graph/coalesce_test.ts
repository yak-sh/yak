/// <reference lib="deno.ns" />
// A later partial patch must not restore properties cleared while it waited.

import { assertEquals } from '@std/assert'
import { coalesced } from './coalesce.ts'

Deno.test('coalesced patches retain the clear before a later partial value', () => {
  assertEquals(
    coalesced([
      { entity: { eid: 'a' }, position: { x: 1, y: 2 } },
      { entity: { eid: 'a' }, position: null },
      { entity: { eid: 'a' }, position: { x: 3 } },
    ]),
    [
      { entity: { eid: 'a' }, position: null },
      { entity: { eid: 'a' }, position: { x: 3 } },
    ],
  )
})
