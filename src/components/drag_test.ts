import { assertEquals } from '@std/assert'
import { cardData, moved, resetSize, resizeDirs, sized } from './drag.ts'

Deno.test('card geometry moves and sizes every edge on whole pixels', () => {
  assertEquals(resizeDirs, ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'])
  assertEquals(resetSize('n'), { h: 0 })
  assertEquals(resetSize('se'), { w: 0, h: 0 })
  assertEquals(moved(20, 30, 10.6, -5.2), { x: 31, y: 25 })
  assertEquals(sized({ x: 20, y: 30, w: 400, h: 200 }, 'se', 20.4, 30.7), {
    w: 420,
    h: 231,
  })
  assertEquals(sized({ x: 20, y: 30, w: 400, h: 200 }, 'nw', 1000, 1000), {
    x: 260,
    y: 170,
    w: 160,
    h: 60,
  })
})

Deno.test('card drag data names one entity and rejects foreign payloads', () => {
  assertEquals(cardData('{"target":"thing","view":"Full"}'), {
    target: 'thing',
  })
  assertEquals(cardData('{"target":2}'), undefined)
  assertEquals(cardData('not json'), undefined)
})
