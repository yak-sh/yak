import { assertEquals } from '@std/assert'
import { micHint, type MicSignal, senderActive } from './mic-health.ts'

let time = { now: 12_000, startedAt: 1_000, lastInput: 1_000 }
let live: MicSignal = {
  ready: true,
  enabled: true,
  connected: true,
  level: 0,
  energy: 0,
  duration: 10,
  packets: 100,
}
Deno.test('local plate distinguishes blocked, missing and stopped mic', () => {
  assertEquals(
    micHint('denied', null, null, null, time)?.includes('allow'),
    true,
  )
  assertEquals(
    micHint('missing', null, null, null, time)?.includes('select'),
    true,
  )
  assertEquals(
    micHint('on', 'ended', null, live, time)?.includes('select'),
    true,
  )
  assertEquals(
    micHint('on', 'live', null, { ...live, enabled: false }, time)?.includes(
      'stopped',
    ),
    true,
  )
})
Deno.test('a sustained quiet mic prompts browser-input test without calling a pause a failure', () => {
  assertEquals(
    micHint('on', 'live', { talking: false }, live, { ...time, now: 7_000 }),
    null,
  )
  assertEquals(
    micHint('on', 'live', { talking: false }, live, time)?.includes('browser'),
    true,
  )
  assertEquals(micHint('on', 'live', { talking: true }, live, time), null)
  assertEquals(micHint('off', null, null, null, time), null)
})

Deno.test('outgoing light requires fresh packets and audible sender samples', () => {
  let next = { ...live, packets: 103, level: 0.12, energy: 0.02, duration: 11 }
  assertEquals(senderActive(live, next), true)
  assertEquals(senderActive(null, next), false)
  assertEquals(senderActive(live, { ...next, packets: 100 }), false)
  assertEquals(senderActive(live, { ...next, connected: false }), false)
  assertEquals(
    senderActive(live, { ...next, level: null, energy: null }),
    false,
  )
  assertEquals(senderActive(live, { ...next, level: null }), true)
})
