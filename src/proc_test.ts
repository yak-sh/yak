// The /proc walk, proven against the live tree: this test process IS a
// deno under something, so it can walk from itself without a fixture.
import { assertEquals } from '@std/assert'
import { ancestor, commOf, parentOf } from './proc.ts'

Deno.test('commOf names this process', () => {
  assertEquals(commOf(Deno.pid), 'deno')
})

Deno.test('parentOf climbs toward init', () => {
  assertEquals(typeof parentOf(Deno.pid), 'number')
})

Deno.test('ancestor finds self first', () => {
  assertEquals(ancestor('deno'), Deno.pid)
})

Deno.test('ancestor tops out as undefined, never throws', () => {
  assertEquals(ancestor('no-such-comm'), undefined)
  assertEquals(parentOf(0), undefined)
})
