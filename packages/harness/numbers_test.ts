import { assertEquals } from '@std/assert'
import { compactCount } from './numbers.ts'

Deno.test('compact counts use lowercase units and promote rounded boundaries', () => {
  for (
    const [count, expected] of [
      [0, '0'],
      [12, '12'],
      [999, '999'],
      [1000, '1k'],
      [1200, '1.2k'],
      [273000, '273k'],
      [999999, '1m'],
      [1200000, '1.2m'],
      [1000000000, '1b'],
    ] as const
  ) assertEquals(compactCount(count), expected)
})
