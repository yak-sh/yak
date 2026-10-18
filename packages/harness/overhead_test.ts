// Fixed reference and phase arithmetic do not learn limits from live load.
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import {
  type Mark,
  overheadExcess,
  overheadLimit,
  overheadSamples,
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
test('fixed no-slack reference never changes to match session variance', () => {
  equal(
    overheadExcess([{ step: 'x', metric: 'dispatch', ms: overheadLimit }]),
    [],
  )
  equal(
    overheadExcess([{ step: 'x', metric: 'dispatch', ms: overheadLimit + 1 }])
      .length,
    1,
  )
  equal(
    overheadExcess([{ step: 'x', metric: 'preflight', ms: 10 }], 5).length,
    1,
  )
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
