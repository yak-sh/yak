import { assertEquals, assertThrows } from '@std/assert'
import {
  extract,
  type Measurement,
  median,
  METRIC,
  regressions,
  validateNames,
} from './bench.ts'
import {
  benchmarkNames,
  WORKLOAD_VERSION,
} from '../packages/sqlite/fixtures/fleet.ts'

let measurement = (): Measurement => ({
  version: 1,
  metric: METRIC,
  workload: WORKLOAD_VERSION,
  runtime: 'test',
  cpu: 'test',
  ns: Object.fromEntries(benchmarkNames().map((n) => [n, 100])),
})
Deno.test('bench median is the middle run, not the fastest or mean', () => {
  assertEquals(median([500, 100, 110]), 110)
  for (let values of [[], [1], [1, 2, NaN], [1, 2, 0], [1, 2, Infinity]]) {
    assertThrows(() => median(values))
  }
})
Deno.test('bench threshold boundary, regression failure, and no implicit ratchet', () => {
  let base = measurement()
  let current = measurement()
  let name = benchmarkNames()[0]
  current.ns[name] = 120
  assertEquals(regressions(base, current), [])
  current.ns[name] = 120.01
  assertEquals(regressions(base, current), [name])
  assertEquals(base.ns[name], 100)
})
Deno.test('bench fails closed on incomparable, missing, renamed, and invalid numbers', () => {
  for (
    let key of ['version', 'metric', 'workload', 'runtime', 'cpu'] as const
  ) {
    let other = { ...measurement(), [key]: 'changed' } as Measurement
    assertThrows(() => regressions(measurement(), other))
  }
  let ns = measurement().ns
  delete ns[benchmarkNames()[0]]
  assertThrows(() => validateNames(ns))
  ns = { ...measurement().ns, renamed: 100 }
  assertThrows(() => validateNames(ns))
  for (let value of [0, -1, NaN, Infinity]) {
    ns = { ...measurement().ns, [benchmarkNames()[0]]: value }
    assertThrows(() => validateNames(ns))
  }
})
Deno.test('Deno JSON extraction rejects failed, absent, and duplicate results', () => {
  let ok = { name: 'one', results: [{ ok: { avg: 100 } }] }
  let report = { version: 1, runtime: 'test', cpu: 'test', benches: [ok] }
  assertEquals(extract(report, ['one']), { one: 100 })
  assertThrows(() => extract({ ...report, benches: [] }, ['one']))
  assertThrows(() => extract({ ...report, benches: [ok, ok] }, ['one']))
  assertThrows(() =>
    extract({ ...report, benches: [{ name: 'one', results: [] }] }, ['one'])
  )
  assertThrows(() =>
    extract({
      ...report,
      benches: [{ name: 'one', results: [{ failed: 'boom' }] }],
    }, ['one'])
  )
})
