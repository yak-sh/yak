// The reload-handoff leak (T-19494): a predecessor that cedes the port keeps
// firing its registered intervals at the live db until drain() finally exits —
// an unbounded window. stop() is what drain calls first, so once we cede no
// sweep fires again. FakeTime drives the clock deterministically: no wall
// wait, so the seam holds its 1ms budget.
import { assertEquals } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { repeat, stop } from './timers.ts'

Deno.test('stop() silences every registered interval and reports the count', () => {
  using time = new FakeTime()
  let a = 0
  let b = 0
  repeat(() => a++, 1_000)
  repeat(() => b++, 5_000)

  time.tick(10_000) // a fires 10×, b fires 2×
  assertEquals([a, b], [10, 2])

  assertEquals(stop(), 2) // both were still live

  time.tick(60_000) // nothing fires past the cede
  assertEquals([a, b], [10, 2])
})

Deno.test('stop() is idempotent — a second cede, or one with nothing live, is a no-op', () => {
  using time = new FakeTime()
  let n = 0
  repeat(() => n++, 1_000)
  time.tick(3_000)

  assertEquals(stop(), 1)
  assertEquals(stop(), 0) // registry already empty
  time.tick(10_000)
  assertEquals(n, 3) // still frozen at the cede
})
