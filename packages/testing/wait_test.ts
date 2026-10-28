// Polling checks the fact after every yield, including one delayed beyond the
// deadline. A clock that runs each poll late reproduces a busy event loop
// without a wall-clock wait.
import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStrictEquals } from '@std/assert'
import { until } from './wait.ts'

// A clock, and the same clock as a busy event loop keeps it: every timer
// `until` sets runs `ms` late.
let busy = (ms: number) => {
  let time = clock()
  let late = {
    now: time.now,
    after: (wait: number, go: () => void) => time.after(wait + ms, go),
  }
  return { time, late }
}

test('until rechecks a settled fact after a delayed poll', async () => {
  let { time, late } = busy(6)
  let ready = false
  let waiting = until(() => ready, { timeout: 10, poll: 5, clock: late })
  await Promise.resolve() // let the first check schedule its poll
  time.after(8, () => {
    ready = true
  })
  await time.advance(11) // the poll resumes after the fact settled and the deadline
  assertEquals(await waiting, true)
})

test('until still times out with its final state in the label', async () => {
  let { time, late } = busy(6)
  let checks = 0
  let waiting = until(() => {
    checks++
    return false
  }, { timeout: 10, poll: 5, label: () => `check ${checks}`, clock: late })
  await Promise.resolve()
  let timedOut = assertRejects(
    () => waiting,
    Error,
    'until: timed out after 10ms waiting for check 2',
  )
  await time.advance(11)
  await timedOut
  assertEquals(checks, 2)
})

test('until preserves the fact value and errors', async () => {
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

test('until counts its timeout on the clock it is given', async () => {
  let ticks = 0
  let time = {
    now: () => 1000 * ticks++,
    after: (_ms: number, go: () => void) => (go(), () => {}),
  }
  await assertRejects(
    () => until(() => false, { timeout: 1000, clock: time }),
    Error,
    'until: timed out after 1000ms',
  )
})
