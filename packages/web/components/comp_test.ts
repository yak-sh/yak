import { test } from '@yaks/testing'
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { compTone } from './comp.ts'

test('component names keep distinct tones in the session inspector', () => {
  let tones = ['doc', 'session', 'spawn', 'created', 'updated'].map(compTone)
  assertEquals(new Set(tones).size, tones.length)
})
