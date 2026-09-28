import { assertEquals } from '@std/assert'
import { slash } from './slash.ts'

Deno.test('chat keeps ordinary speech, and handles every slash locally', () => {
  assertEquals(slash('hello /health on'), null)
  assertEquals(slash('/health on'), {
    command: { kind: 'health', enabled: true },
  })
  assertEquals(slash('/health off'), {
    command: { kind: 'health', enabled: false },
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
  assertEquals(slash('/health maybe'), {
    error: 'Use /health on or /health off.',
  })
  assertEquals(slash('/unknown'), { error: 'Unknown command: /unknown.' })
})
