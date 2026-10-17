// A shutdown reports its in-memory blockers without waiting on graph reads.
import { assert, assertEquals } from '@std/assert'
import { drain } from './drain.ts'

Deno.test('drain reports full targets and effect ids until the pool stops', async () => {
  let stopped = Promise.withResolvers<void>()
  let lines: string[] = []
  let running = true
  let pending = drain(
    {
      stop: () => stopped.promise,
      running: () =>
        running
          ? [{
            eid: 'effect-id',
            handler: 'session_run',
            target: 'session-id',
            since: Date.now(),
          }]
          : [],
    },
    (line) => lines.push(line),
    1,
  )
  assertEquals(lines, [], 'reporting waits for the first interval')
  while (!lines.length) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assert(lines[0].includes('session_run session-id'))
  assert(lines[0].includes('[runs: effect-id]'))
  running = false
  // A pass can remain pending even when all handlers have finished.
  while (lines.length < 2) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assertEquals(
    lines.at(-1),
    'winding down — waiting on effects pool pass (no handlers running)',
  )
  stopped.resolve()
  await pending
  let count = lines.length
  await new Promise((resolve) => setTimeout(resolve, 5))
  assertEquals(lines.length, count, 'the reporting timer ends with the drain')
})

Deno.test('a finished pool closes without another asynchronous diagnostic dependency', async () => {
  let stopped = false
  let lines: string[] = []
  await drain({
    stop: () => {
      stopped = true
      return Promise.resolve()
    },
    running: () => {
      assert(stopped)
      return []
    },
  }, (line) => lines.push(line))
  assertEquals(lines.length, 0)
})
