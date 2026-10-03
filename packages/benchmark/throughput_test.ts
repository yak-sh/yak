/** Ratchet equivalence on the throughput suite, without executing its benches.
 * Measured-box equivalence is checked separately against the JSON artifact. */
import { equal, test, throws } from '@yaks/testing'
import { baseline, compare, type Run } from './mod.ts'
import { type Measurement, regressions } from '../../bin/bench.ts'
import old from '../../bench/baseline.json' with { type: 'json' }

// The dismantled fleet server has no workload files. Compare the available
// workloads, including any additional benches registered by the legacy suite.
let reference: Measurement = {
  ...old,
  ns: Object.fromEntries(
    Object.entries(old.ns).filter(([name]) => !name.startsWith('fleet/')),
  ),
}

let measurement = (): Run => ({
  version: 1,
  suite: 'throughput',
  metric: old.metric,
  workload: old.workload,
  runtime: old.runtime,
  cpu: old.cpu,
  at: '',
  commit: null,
  load: [0, 0, 0],
  rounds: 3,
  tolerance: null,
  verdict: 'measured',
  regressions: [],
  benches: Object.entries(reference.ns).map(([name, median]) => ({
    name,
    unit: name.startsWith('apply/')
      ? 'ns/bundle'
      : name.startsWith('relay/')
      ? 'ns/value'
      : 'ns/op',
    better: 'lower',
    median,
    samples: [],
    rounds: [],
    spans: null,
  })),
})
let legacy = (current: Run): Measurement => ({
  ...old,
  ns: Object.fromEntries(current.benches.map((b) => [b.name, b.median])),
})

test('throughput baseline and verdicts equal the existing runner, including 30% slowdown', async () => {
  let current = measurement()
  let base = baseline(current, .2)
  for (let factor of [1, 1.2, 1.3]) {
    current = measurement()
    current.benches[0].median *= factor
    equal(
      compare(base, current).map((r) => r.name),
      regressions(reference, legacy(current)),
    )
  }
  equal(compare(base, current).length, 1)
  for (let key of ['metric', 'workload', 'runtime', 'cpu'] as const) {
    await throws(() => compare(base, { ...current, [key]: 'changed' }))
    await throws(() =>
      regressions(
        reference,
        { ...legacy(current), [key]: 'changed' } as Measurement,
      )
    )
  }
})
