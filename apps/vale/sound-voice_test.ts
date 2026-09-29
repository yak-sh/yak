import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { fireLevel } from './bus.ts'

test('speech ducks fire alone, and restores it at rest', () => {
  assertEquals(fireLevel(false), 1)
  assertEquals(fireLevel(true), 0.22)
})
