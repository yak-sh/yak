// Canvas gesture settlement: cancellation forgets the pan without saving it.
import { assertEquals } from '@std/assert'
import { panEvents } from './Canvas.tsx'

Deno.test('a cancelled pan forgets movement and never settles', () => {
  let elem = new EventTarget()
  let moved = 0
  let settled = 0
  panEvents(elem, () => moved++, () => settled++)

  elem.dispatchEvent(new Event('pointercancel'))
  elem.dispatchEvent(new Event('pointermove'))
  elem.dispatchEvent(new Event('pointerup'))

  assertEquals({ moved, settled }, { moved: 0, settled: 0 })
})
