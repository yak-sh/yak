import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { relayFixture } from './relay-fixture.ts'

const rejected = await relayFixture(1)
const skipped = await relayFixture(1)
// Exhaust the pace bucket's remaining burst token at a fixed earlier epoch.
await skipped.next({ start: () => {}, end: () => {} }, 0)

test("a failed relay sample leaves the runtime's clock and timers alone", async () => {
  const date = Date.now, set = setTimeout, clear = clearTimeout
  await assertRejects(
    () =>
      rejected.next({
        start: () => {
          throw new Error('sample aborted')
        },
        end: () => {},
      }),
    Error,
    'sample aborted',
  )
  assertEquals(Date.now, date)
  assertEquals(setTimeout, set)
  assertEquals(clearTimeout, clear)
})

test('a pace-skipped value cannot produce a relay sample', async () => {
  const date = Date.now
  let samples = 0
  await assertRejects(
    () => skipped.next({ start: () => {}, end: () => samples++ }, 0),
    Error,
    'Relay finished without staging a value',
  )
  assertEquals(samples, 0)
  assertEquals(Date.now, date)
})
