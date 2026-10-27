import { equal, test } from '@yaks/testing'
import type { Run } from '@yaks/benchmark'
import { type History, judge } from './observations.ts'
let at = 0
let run = (n: number, verdict: Run['verdict'] = 'passed', busy = 0): Run => ({
  version: 1,
  suite: 's',
  metric: 'm',
  workload: 1,
  cpu: 'c',
  runtime: 'r',
  at: new Date(++at * 1_800_000).toISOString(),
  commit: 'sha',
  load: [9.7],
  busy,
  rounds: 3,
  tolerance: .3,
  verdict,
  regressions: [],
  benches: [{
    name: 'work',
    unit: 'ms',
    better: 'lower',
    median: n,
    spread: 0,
    rounds: [],
    samples: [],
    spans: null,
  }],
})
let pending: History = {}
for (let n of [100, 101, 102, 103, 104, 130]) judge(pending, 'old', run(n))
let frozen = JSON.stringify(pending.reference)
for (let n of [106, 107, 108, 109, 110]) judge(pending, 'new', run(n))
test('same-code sitting spread accumulates without learning a changed-code slowdown', () => {
  equal(judge(pending, 'new', run(136)).slower, ['work'])
  equal(JSON.stringify(pending.reference), frozen)
})
let restored = JSON.parse(JSON.stringify(pending)) as History
test('candidate evidence survives a monitor restart', () => {
  equal(judge(restored, 'new', run(108)).verdict, 'slower')
})
test('unchanged code and a busy box cannot report or contaminate the reference', () => {
  let history: History = {}
  for (let n of [100, 130, 110, 120]) judge(history, 'old', run(n))
  equal(judge(history, 'old', run(125, 'regressed')).verdict, 'unconfirmed')
  let saved = JSON.stringify(history)
  equal(judge(history, 'new', run(200, 'regressed', .8)).verdict, 'loaded')
  equal(JSON.stringify(history), saved)
})
test('a legacy cache starts from a pass, never a scalar baseline or suspicious result', () => {
  let history: History = {}
  equal(judge(history, 'old', run(200, 'regressed')).verdict, 'inconclusive')
  equal(history.reference, undefined)
  judge(history, 'old', run(100))
  let same = run(101)
  same.at = history.reference!.observations[0].at
  judge(history, 'old', same)
  equal(history.reference!.observations.length, 1)
  equal(judge(history, 'new', run(110)).verdict, 'inconclusive')
})

let promoted: History = {}
for (let n of [100, 101, 102]) judge(promoted, 'old', run(n))
for (let n of [80, 81, 82]) judge(promoted, 'fast', run(n))
for (let n of [94, 95]) judge(promoted, 'slower', run(n))
test('a proven speedup becomes the reference for the next slowdown', () => {
  equal(promoted.references?.work.key, 'fast')
  equal(judge(promoted, 'slower', run(96)).slower, ['work'])
})
test('a best-of-three confirmation cannot change the one-run evidence', () => {
  let history: History = {}
  judge(history, 'old', run(100))
  let before = JSON.stringify(history)
  judge(history, 'old', run(50), false)
  equal(JSON.stringify(history), before)
})
test('unknown load is not a quiet reference and protocol changes discard incompatible evidence', () => {
  let history: History = {}
  let unknown = run(100)
  unknown.busy = null
  equal(judge(history, 'old', unknown).verdict, 'inconclusive')
  equal(history, {})
  judge(history, 'old', run(100))
  let changed = run(200)
  changed.workload = 2
  judge(history, 'new', changed)
  equal(history.reference?.key, 'new')
  equal(history.reference?.observations.length, 1)
})
