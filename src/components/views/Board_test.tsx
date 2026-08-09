// Large board columns stay bounded until the operator asks for their tail.
import { assertEquals } from '@std/assert'

// Enter through the registry, as the app does; importing Board first would
// invert its deliberate Entity render cycle.
await import('../Entity.tsx')
let { CAP, visible } = await import('./Board.tsx')

Deno.test('board columns reveal a bounded first page and report the tail', () => {
  let rows = Array.from({ length: CAP + 7 }, (_, i) => i)
  assertEquals(visible(rows, false), {
    rows: rows.slice(0, CAP),
    more: 7,
  })
  assertEquals(visible(rows, true), { rows, more: 0 })
})
