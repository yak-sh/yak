// The Peek keyboard seam: an editor spends Escape before its floating card.
import { assertEquals } from '@std/assert'
import { peekKey, popPeek } from './Peek.tsx'

Deno.test('peek closes only after its focused input has blurred', () => {
  assertEquals(peekKey('Escape', true), false)
  assertEquals(peekKey('Escape', false), true)
  assertEquals(peekKey('q', true), false)
  assertEquals(peekKey('q', false), true)
})

Deno.test('peek dismissal removes only the newest card', () => {
  let stack = [
    { eid: 'a', x: 1, y: 2 },
    { eid: 'b', x: 3, y: 4 },
  ]
  assertEquals(popPeek(stack), [stack[0]])
})
