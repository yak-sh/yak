import { equal, test } from '@yaks/testing'
import { drain, enqueue, type Queue } from './queue.ts'
import type { Outcome } from './monitor.ts'

let io = (verdict: Outcome['verdict'], seen: string[] = []) => ({
  now: () => 0,
  deadline: 1,
  save: () => Promise.resolve(),
  check: (j: { suite: string }) => {
    seen.push(j.suite)
    return Promise.resolve(verdict)
  },
})

test('unfinished checks carry across ticks rather than restarting the first suite', async () => {
  let q: Queue = { jobs: [], screened: {} }, now = 0, seen: string[] = []
  enqueue(q, ['a', 'b', 'c'], now)
  let tick = {
    ...io('failed'),
    now: () => now,
    deadline: 2,
    check: (j: { suite: string }) => {
      seen.push(j.suite)
      now++
      return Promise.resolve('failed' as const)
    },
  }
  await drain(q, tick)
  equal([seen, q.jobs.map((j) => j.suite)], [['a', 'b'], ['c']])
  q = JSON.parse(JSON.stringify(q))
  enqueue(q, ['a', 'b', 'c'], now)
  await drain(q, { ...tick, deadline: 4 })
  equal([seen, q.jobs], [['a', 'b', 'c'], []])
})

test('a busy lock or a loaded box keeps the owed job; a check that told nothing still finishes', async () => {
  let q: Queue = { jobs: [], screened: {} }
  enqueue(q, ['a', 'b'], 0)
  await drain(q, io('deferred'))
  await drain(q, io('loaded'))
  equal(q.jobs.map((j) => j.suite), ['a', 'b'])
  await drain(q, io('inconclusive'))
  equal(q.jobs, [])
})

test('a suite is owed once, and not again within the hour it was checked', () => {
  let q: Queue = { jobs: [], screened: { c: 0 } }
  enqueue(q, ['a', 'b', 'c'], 1)
  enqueue(q, ['a', 'b', 'c'], 1)
  equal(q.jobs.map((j) => j.suite), ['a', 'b'])
  q.jobs = []
  enqueue(q, ['c'], 3_600_000)
  equal(q.jobs.map((j) => j.suite), ['c'])
})

test('a suite removed from the list leaves the queue', () => {
  let q: Queue = { jobs: [], screened: {} }
  enqueue(q, ['gone', 'a'], 0)
  enqueue(q, ['a'], 0)
  equal(q.jobs.map((j) => j.suite), ['a'])
})

test('a crash before the result is saved leaves the job owed', async () => {
  let q: Queue = { jobs: [], screened: {} }
  enqueue(q, ['a'], 0)
  let failed = false
  try {
    await drain(q, {
      ...io('passed'),
      check: () => Promise.reject(Error('tracker unavailable')),
    })
  } catch {
    failed = true
  }
  equal([failed, q.jobs.map((j) => j.suite), q.screened], [true, ['a'], {}])
})

test('an admitted job keeps its active allowance while the next carries over', async () => {
  let q: Queue = { jobs: [], screened: {} }, now = 0, seen: string[] = []
  enqueue(q, ['a', 'b'], 0)
  await drain(q, {
    ...io('passed', seen),
    now: () => now,
    check: (j) => {
      seen.push(j.suite)
      now = 600_000
      return Promise.resolve('passed')
    },
  })
  equal([seen, q.jobs.map((j) => j.suite)], [['a'], ['b']])
})
