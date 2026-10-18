import { equal, test } from '@yaks/testing'
import { drain, enqueue, type Queue } from './queue.ts'
import type { Outcome } from './monitor.ts'
let failed: Outcome = { verdict: 'failed', error: 'fixture failure' }
test('unfinished screens carry across ticks rather than restarting the first suite', async () => {
  let q: Queue = { jobs: [], screened: {} }, now = 0, seen: string[] = []
  enqueue(q, ['a', 'b', 'c'], now)
  let io = {
    now: () => now,
    deadline: 2,
    save: () => Promise.resolve(),
    check: (j: { suite: string }) => {
      seen.push(j.suite)
      now++
      return Promise.resolve(failed)
    },
    settle: () => Promise.resolve(),
  }
  await drain(q, io)
  equal(seen, ['a', 'b'])
  equal(q.jobs.map((j) => j.suite), ['c'])
  q = JSON.parse(JSON.stringify(q))
  enqueue(q, ['a', 'b', 'c'], now)
  await drain(q, { ...io, deadline: 4 })
  equal(seen, ['a', 'b', 'c'])
  equal(q.jobs, [])
})
test('busy box retains the exact owed job and unknown measurements finish without a false failure', async () => {
  let q: Queue = { jobs: [], screened: {} }, settled: string[] = []
  enqueue(q, ['a', 'b'], 0)
  let io = {
    now: () => 0,
    deadline: 1,
    save: () => Promise.resolve(),
    check: () => Promise.resolve({ verdict: 'deferred' } as Outcome),
    settle: (_j: unknown, o: Outcome) => {
      settled.push(o.verdict)
      return Promise.resolve()
    },
  }
  await drain(q, io)
  equal(q.jobs.map((j) => j.suite), ['a', 'b'])
  equal(settled, [])
  await drain(q, {
    ...io,
    check: () => Promise.resolve({ verdict: 'inconclusive' } as Outcome),
  })
  equal(settled, ['inconclusive', 'inconclusive'])
  equal(q.jobs, [])
})
test('all screens precede slow confirmations and duplicate enqueues cannot grow backlog', () => {
  let q: Queue = {
    jobs: [{ suite: 'a', phase: 'confirm', due: 0 }],
    screened: { a: 0 },
  }
  enqueue(q, ['a', 'b', 'c'], 1)
  enqueue(q, ['a', 'b', 'c'], 1)
  equal(q.jobs.map((j) => [j.suite, j.phase]), [['b', 'screen'], [
    'c',
    'screen',
  ], ['a', 'confirm']])
})

test('a fresh cron tick cannot starve an older confirmation', () => {
  let q: Queue = {
    jobs: [{ suite: 'a', phase: 'confirm', due: 0 }],
    screened: { a: 1 },
  }
  enqueue(q, ['a', 'b'], 3_600_001)
  equal(q.jobs.map((j) => j.suite), ['a', 'b'])
})

test('new screens lead young confirmations but an hour-old confirmation cannot starve', () => {
 let q:Queue={jobs:[{suite:'a',phase:'confirm',due:0}],screened:{a:0}}
 enqueue(q,['a','b'],1)
 equal(q.jobs.map(j=>j.suite),['b','a'])
 enqueue(q,['a','b','c'],3_600_000)
 equal(q.jobs.map(j=>j.suite),['a','b','c'])
 equal(q.jobs[0].due,0)
})
