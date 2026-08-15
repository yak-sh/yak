// The Peek keyboard seam: an editor spends Escape before its floating card.
import { assertEquals } from '@std/assert'
import { peekKey, peekMove, peekSize, popPeek } from './Peek.tsx'

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

Deno.test('peek movement and sizing settle to whole pixels', () => {
  assertEquals(peekMove(20, 30, 10.6, -5.2), { left: 31, top: 25 })
  assertEquals(peekSize(400, 200, 20.4, 30.7), { w: 420, h: 231 })
  assertEquals(peekSize(400, 200, -1000, -1000), { w: 340, h: 80 })
})
