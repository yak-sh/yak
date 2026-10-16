import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { relayFixture } from './relay-fixture.ts'

// Warm outside the cases; each next() checks the exact observer delivery after
// timing, so a pace skip, refusal or an unstaged value cannot earn a sample.
const advancing = await relayFixture(1)
const rejected = await relayFixture(1)
const skipped = await relayFixture(1)
// Exhaust the pace bucket's remaining burst token at a fixed earlier epoch.
await skipped.next({
  start: () => {
    Date.now = () => 0
  },
  end: () => {},
})

for (let turn of ['first', 'second', 'third']) {
  test(`the ${turn} relay sample stages a paced value before fanout and restores globals`, async () => {
    const date = Date.now, set = setTimeout, clear = clearTimeout
    const events: string[] = []
    advancing.reset()
    await advancing.next({
      start: () => events.push('submit'),
      end: () => events.push('staged'),
    })
    assertEquals(events, ['submit', 'staged'])
    assertEquals(advancing.counts(), {
      sql: 0,
      reads: 0,
      writes: 0,
      transactions: 1,
    })
    assertEquals(Date.now, date)
    assertEquals(setTimeout, set)
    assertEquals(clearTimeout, clear)
  })
}

test('a failed relay sample restores the clock and timers', async () => {
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
    () =>
      skipped.next({
        start: () => {
          Date.now = () => 0
        },
        end: () => samples++,
      }),
    Error,
    'Relay finished without staging a value',
  )
  assertEquals(samples, 0)
  assertEquals(Date.now, date)
})
