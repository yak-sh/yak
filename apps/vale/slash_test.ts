import { assertEquals } from '@std/assert'
import { slash } from './slash.ts'

Deno.test('chat keeps ordinary speech, and handles every slash locally', () => {
  assertEquals(slash('hello /damage on'), null)
  assertEquals(slash('/damage on'), {
    command: { kind: 'damage', on: true },
  })
  assertEquals(slash('/damage off'), {
    command: { kind: 'damage', on: false },
  })
  assertEquals(slash('/teleport tombsands'), {
    command: { kind: 'teleport', target: { level: 'tombsands' } },
  })
  assertEquals(slash('/teleport -12.5 48'), {
    command: { kind: 'teleport', target: { x: -12.5, z: 48 } },
  })
  assertEquals(slash('/teleport unknown'), { error: 'Unknown land: unknown.' })
  assertEquals(slash('/teleport constructor'), {
    error: 'Unknown land: constructor.',
  })
  assertEquals(slash('/teleport 1 Infinity'), {
    error: 'Use /teleport <land> or /teleport <x> <z>.',
  })
  assertEquals(slash('/damage maybe'), {
    error: 'Use /damage on or /damage off.',
  })
  assertEquals(slash('/unknown'), { error: 'Unknown command: /unknown.' })
})
