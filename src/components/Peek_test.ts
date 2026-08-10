// The Peek keyboard seam: an editor spends Escape before its floating card.
import { assertEquals } from '@std/assert'
import { peekKey } from './Peek.tsx'

Deno.test('peek closes only after its focused input has blurred', () => {
  assertEquals(peekKey('Escape', true), false)
  assertEquals(peekKey('Escape', false), true)
  assertEquals(peekKey('q', true), false)
  assertEquals(peekKey('q', false), true)
})
