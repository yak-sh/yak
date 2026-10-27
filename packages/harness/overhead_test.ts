// Fixed reference and phase arithmetic do not learn limits from live load.
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import {
  type Mark,
  overheadDue,
  overheadLimit,
  overheadSamples,
  RECENT,
  waits,
} from './overhead.ts'
const row = (
  eid: string,
  seq: number,
  at: number,
  parts: Record<string, unknown>,
): Bundle => ({
  entity: { eid },
  entry: { session: 's', seq },
  created: { at: new Date(at).toISOString() },
  ...parts,
})
const mark = (
  eid: string,
  at: number,
  name: string,
  by: string | null,
): Mark => ({ at, patch: { entity: { eid }, [name]: { by } } })
const entries = [
  row('a', 1, 0, { ask: {} }),
  row('c', 2, 10, { call: { source: 'a' } }),
  row('r', 3, 1020, { result: { call: 'c', ms: 1000 } }),
  row('b', 4, 1030, { ask: {} }),
]
const marks = [
  mark('a', 0, 'attempt', 'p'),
  mark('a', 15, 'attempt', null),
  mark('c', 15, 'execution', 'p'),
  mark('b', 1030, 'attempt', 'p'),
]
const samples = overheadSamples(entries, marks)
const during = [
  mark('a', 0, 'attempt', 'p'),
  mark('a', 1025, 'attempt', null),
  mark('c', 15, 'execution', 'p'),
  mark('b', 1030, 'attempt', 'p'),
]
test('tool overhead subtracts a long command and keeps dispatch separate', () =>
  equal(samples, [{ step: 'c', metric: 'dispatch', ms: 5 }, {
    step: 'r',
    metric: 'tool-overhead',
    ms: 5,
  }, { step: 'b', metric: 'preflight', ms: 10 }]))
test('a result during model wait excludes the remaining provider time', () =>
  equal(overheadSamples(entries, during).at(-1), {
    step: 'b',
    metric: 'preflight',
    ms: 5,
  }))
// Whether a session's phase is over its reference after these samples.
const over = (ms: number[], limit = overheadLimit) => {
  const recent = new Map<string, number[]>()
  return ms.map((m) => overheadDue(recent, 's dispatch', m, limit)).at(-1)
}
test('the fixed reference never changes to match session variance', () => {
  equal(over(Array(RECENT).fill(overheadLimit)), false)
  equal(over(Array(RECENT).fill(overheadLimit + 1)), true)
  equal(over(Array(RECENT).fill(10), 5), true)
})
test('a phase is judged by the median of its newest steps, so one slow step is noise', () => {
  const typical = Array(RECENT).fill(overheadLimit / 2)
  equal(over([...typical, 999]), false)
  equal(over([...typical, 999, 999, 999]), true)
  equal(over(Array(RECENT - 1).fill(999)), false)
})
test('input and missing execution marks are not guessed as harness overhead', () => {
  equal(
    overheadSamples(
      [...entries.slice(0, 3), row('input', 3.5, 1022, {}), entries[3]],
      marks,
      new Set(['input']),
    ).some((s) => s.metric == 'preflight'),
    false,
  )
  equal(overheadSamples(entries, []), [])
})
test('time a phase waited for a CPU is not overhead; any other wait is', () => {
  const slow = [row('a', 1, 0, { ask: {} }), row('c', 2, 10, { call: {} })]
  const claimed = [mark('c', 210, 'execution', 'p')]
  const dispatch = (wait: number) =>
    overheadSamples(slow, claimed, new Set(), () => wait)[0].ms
  equal([dispatch(190), dispatch(0)], [10, 200])
})
test('what load took between two instants is read at the commits after each', () => {
  const clock = [100, 200, 300]
  const read = [5, 8, undefined, 20]
  const load = waits(() => read.shift(), () => clock.shift()!)
  for (let i = 0; i < 4; i++) load.note()
  equal(
    [load.between(150, 300), load.between(0, 150), load.between(150, 500)],
    [12, 3, 0],
  )
})
