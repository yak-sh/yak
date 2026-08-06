import { assertEquals } from '@std/assert'
import { compTone } from './comp.ts'

Deno.test('component names keep distinct tones in the session inspector', () => {
  let tones = ['doc', 'session', 'spawn', 'created', 'updated'].map(compTone)
  assertEquals(new Set(tones).size, tones.length)
})
