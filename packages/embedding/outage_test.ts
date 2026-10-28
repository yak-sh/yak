// What a run of drains reports while a model is out, through the outage a
// host keeps between them.

import { equal, test } from '@yaks/testing'
import { Unanswered } from './embedder.ts'
import {
  drained,
  failed,
  type Outage,
  OVERDUE,
  Overdue,
  type Ride,
} from './outage.ts'

let MIN = 60_000
let down = failed(
  new Unanswered('workers-ai', { model: 'm', texts: '2', tries: '4' }, 'x'),
)

// The reports and log lines of drains ending at the given minutes.
let run = (...drains: [number, Ride][]) => {
  let outage: Outage | null = null, reports: unknown[] = [], logs = 0
  for (let [at, ride] of drains) {
    let rode = ride(outage, at * MIN)
    outage = rode.outage
    if (rode.report) reports.push(rode.report)
    if (rode.log) logs++
  }
  return { reports, logs }
}

// A drain each minute through `0..last`, every one unanswered.
let out = (last: number): [number, Ride][] =>
  Array.from({ length: last + 1 }, (_, m) => [m, down])

test('an outage the drains ride out reports nothing, and logs its ends', () => {
  equal(run(...out(OVERDUE / MIN - 1), [OVERDUE / MIN, drained]), {
    reports: [],
    logs: 2,
  })
})

test('owed texts waiting past OVERDUE report once, the outage their cause', () => {
  let { reports } = run(...out(3 * OVERDUE / MIN))
  equal(reports.length, 1)
  let [overdue] = reports as Overdue[]
  equal(overdue instanceof Overdue, true)
  equal(overdue.context.waited, `${OVERDUE} ms`)
  equal(overdue.cause instanceof Unanswered, true)
})

test('an unexpected failure reports at once, in an outage or not', () => {
  let broken = failed(Error('no such table: embedding_owed'))
  equal(run([0, broken]).reports.length, 1)
  equal(run([0, down], [1, broken], [2, broken]).reports.length, 2)
})

test('a drain that answers ends the wait; the next outage waits anew', () => {
  let half = OVERDUE / MIN / 2 + 1
  let again = out(half).map(([m, r]): [number, Ride] => [m + half + 1, r])
  equal(run(...out(half), [half + 1, drained], ...again).reports, [])
})

test('an outage kept across drains reports once, wherever it resumes', () => {
  let rode = down({ since: 0, told: true }, 10 * OVERDUE)
  equal(rode, { outage: { since: 0, told: true } })
})
