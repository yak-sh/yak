// The /proc walk, proven against the live tree: this test process IS a
// deno under something, so it can walk from itself without a fixture.
import { assertEquals } from '@std/assert'
import { agentPid, ancestor, commOf, descends, parentOf } from './proc.ts'

Deno.test('commOf names this process', () => {
  assertEquals(commOf(Deno.pid), 'deno')
})

Deno.test('parentOf climbs toward init', () => {
  assertEquals(typeof parentOf(Deno.pid), 'number')
})

Deno.test('ancestor finds self first', () => {
  assertEquals(ancestor('deno'), Deno.pid)
  assertEquals(agentPid('deno'), Deno.pid)
})

Deno.test('ancestor tops out as undefined, never throws', () => {
  assertEquals(ancestor('no-such-comm'), undefined)
  assertEquals(parentOf(0), undefined)
})

Deno.test('descends crosses provider shims but not sibling launches', () => {
  let parents = new Map([[9, 7], [7, 5], [5, 1], [8, 5], [1, 0]])
  let parent = (pid: number) => parents.get(pid)
  assertEquals(descends(9, 5, parent), true)
  assertEquals(descends(9, 7, parent), true)
  assertEquals(descends(8, 7, parent), false)
})
