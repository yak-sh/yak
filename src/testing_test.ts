// Polling checks the fact after every yield, including one delayed beyond the
// deadline. FakeTime advances the clock without giving promise continuations
// a turn, reproducing a busy event loop without a wall-clock wait.
import { assertEquals, assertRejects, assertStrictEquals } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { until } from './testing.ts'

Deno.test('until rechecks a settled fact after a delayed poll', async () => {
  using time = new FakeTime(0)
  let ready = false
  let waiting = until(() => ready, { timeout: 10, poll: 5 })
  await Promise.resolve() // let the first check schedule its poll
  setTimeout(() => ready = true, 8)
  time.tick(11) // the poll resumes after the fact settled and the deadline
  assertEquals(await waiting, true)
})

Deno.test('until still times out with its final state in the label', async () => {
  using time = new FakeTime(0)
  let checks = 0
  let waiting = until(() => {
    checks++
    return false
  }, { timeout: 10, poll: 5, label: () => `check ${checks}` })
  await Promise.resolve()
  time.tick(10)
  await assertRejects(
    () => waiting,
    Error,
    'until: timed out after 10ms waiting for check 2',
  )
  assertEquals(checks, 2)
})

Deno.test('until preserves the fact value and errors', async () => {
  let value = { ready: true }
  assertStrictEquals(await until(() => value, { timeout: 0 }), value)
  let error = new Error('failed check')
  assertStrictEquals(
    await until(() => {
      throw error
    }).catch((e) => e),
    error,
  )
})
