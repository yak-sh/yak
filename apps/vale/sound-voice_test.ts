import { assertEquals } from '@std/assert'
import { fireLevel } from './sound.ts'

Deno.test('speech ducks fire alone, and restores it at rest', () => {
  assertEquals(fireLevel(false), 1)
  assertEquals(fireLevel(true), 0.22)
})
