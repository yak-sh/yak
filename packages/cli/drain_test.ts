// A shutdown reports its in-memory blockers without waiting on graph reads.
import { assert, assertEquals } from '@std/assert'
import { clock } from '@yaks/testing'
import { bound, drain } from './drain.ts'

Deno.test('a worker hands claims back and exits within its shutdown budget', async () => {
  let time = clock(), stop = new AbortController()
  let due: number[] = [], exits: number[] = []
  let close = bound(
    {
      running: () => [],
      handoff: (at) => {
        due.push(at)
        return Promise.resolve()
      },
    },
    stop.signal,
    () => exits.push(time.now()),
    () => {},
    time,
  )
  stop.abort()
  await time.advance(54_999)
  assertEquals([due, exits], [[], []])
  await time.advance(1)
  await time.advance(5_000)
  assertEquals([due, exits], [[60_000], [55_000]])
  close()
})

Deno.test('a blocked handoff write cannot hold the worker open', async () => {
  let time = clock(), stop = new AbortController()
  let pending = Promise.withResolvers<void>()
  let exits: number[] = []
  let close = bound(
    {
      running: () => [],
      handoff: () => pending.promise,
    },
    stop.signal,
    () => exits.push(time.now()),
    () => {},
    time,
  )
  try {
    stop.abort()
    await time.advance(59_999)
    assertEquals(exits, [])
    await time.advance(1)
    assertEquals(exits, [60_000])
  } finally {
    close()
    pending.resolve()
  }
})

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
