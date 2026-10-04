/** The committed throughput suite rejects slower operations and extra SQL. */
import { equal, ok, test, throws } from '@yaks/testing'
import { type Host, Regressed, run } from './mod.ts'
import bank from '../../bench/throughput.baseline.json' with { type: 'json' }
import { countNames, throughput } from '../../bench/throughput.ts'
import {
  applyBenchmarkNames,
  bundlesPerOp,
  relayBenchmarkNames,
} from '../../bench/names.ts'

let context: Host = {
  config: {},
  configURL: null,
  commit: null,
  runtime: bank.runtime,
  cpu: bank.cpu,
  load: [0, 0, 0],
}
test('throughput refuses synthetic 30% timing and statement regressions without banking them', async () => {
  let suite = throughput()
  let directory = await Deno.makeTempDir()
  try {
    let values = Object.fromEntries(bank.benches.map((b) => [b.name, b.median]))
    let options = {
      rounds: 7,
      mode: 'check' as const,
      output: directory + '/results.json',
      baseline: 'bench/throughput.baseline.json',
      host: () => context,
    }
    let collected = { ...suite, collect: () => values }
    equal((await run(collected, options)).verdict, 'passed')
    for (let b of bank.benches) {
      let original = values[b.name]
      values[b.name] = original ? original * 1.3 : 1
      let error = await throws(() => run(collected, options))
      ok(error instanceof Regressed)
      equal((error as Regressed).result.regressions.map((r) => r.name), [
        b.name,
      ])
      values[b.name] = original
    }
    equal(bundlesPerOp('apply/file/edit-alone-1000'), 1000)
    equal(bundlesPerOp('relay/store/entities-100'), 1000)
  } finally {
    await Deno.remove(directory, { recursive: true })
  }
})

test('throughput collects each storage report separately from normalized apply and relay reports', async () => {
  let { benchmarkNames: storageNames } = await import(
    '../sqlite/fixtures/fleet.ts'
  )
  let counts = 0
  let suite = throughput({
    host: () => Promise.resolve(context),
    measure: (mode) =>
      Promise.resolve({
        version: 1,
        runtime: context.runtime,
        cpu: context.cpu,
        benches: (mode == 'pipeline'
          ? [...applyBenchmarkNames(), ...relayBenchmarkNames()]
          : storageNames().filter((n) => n.split('/')[1] == mode)).map(
            (name) => ({ name, results: [{ ok: { avg: 100 } }] }),
          ),
      }),
    counts: () => {
      counts++
      return Promise.resolve(
        Object.fromEntries(countNames().map((n) => [n, { value: 1 }])),
      )
    },
  })
  for (let round = 0; round < 2; round++) {
    let collected = await suite.collect(round)
    equal(
      Object.keys(collected).sort(),
      suite.benches.map((b) => b.name).sort(),
    )
    equal(
      (collected['apply/file/edit-alone-1000'] as { value: number }).value,
      .1,
    )
    equal(
      (collected['relay/store/entities-100'] as { value: number }).value,
      .1,
    )
    equal((collected['sqlite/file/point'] as { value: number }).value, 100)
  }
  equal(counts, 1)
})
