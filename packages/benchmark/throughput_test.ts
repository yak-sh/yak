/** The committed throughput suite rejects slower operation CPU and retains SQL diagnostics. */
import { equal, ok, test, throws } from '@yaks/testing'
import { type Baseline, type Host, limit, Regressed, run } from './mod.ts'
import bank from '../../bench/throughput.baseline.json' with { type: 'json' }
import { countNames, throughput } from '../../bench/throughput.ts'
import {
  applyBenchmarkNames,
  bundlesPerOp,
  RECORDING_BATCHES,
} from '../../bench/names.ts'

let context: Host = {
  config: {},
  configURL: null,
  commit: null,
  runtime: bank.runtime,
  cpu: bank.cpu,
  load: [0, 0, 0],
}
test('throughput refuses CPU regressions past each banked limit without banking them', async () => {
  let suite = throughput()
  let directory = await Deno.makeTempDir()
  try {
    let base = bank as Baseline
    let baseline = directory + '/baseline.json'
    await Deno.writeTextFile(baseline, JSON.stringify(base))
    let values = Object.fromEntries(bank.benches.map((b) => [b.name, b.median]))
    let limits = Object.fromEntries(base.benches.map((b) => [
      b.name,
      limit(base, b),
    ]))
    let options = {
      rounds: 7,
      mode: 'check' as const,
      figure: 'cpu' as const,
      output: directory + '/results.json',
      baseline,
      host: () => context,
    }
    // CPU crosses the named case's allowance; wall time is diagnostic.
    let check = (slower: string[] = []) =>
      run({
        ...suite,
        collect: () =>
          Object.fromEntries(
            Object.entries(values).map((
              [n, v],
            ) => [n, {
              value: v * 10,
              cpu: slower.includes(n) ? limits[n] * 1.3 + 1 : v,
            }]),
          ),
      }, options)
    let regressed = async (slower: string[]) => {
      let error = await throws(() => check(slower))
      ok(error instanceof Regressed)
      return (error as Regressed).result.regressions.map((r) => r.name).sort()
    }
    equal((await check()).verdict, 'passed')
    // Each bench is compared alone: one slower bench is the only one named,
    // and every case refuses CPU beyond its measured noise allowance.
    let names = Object.keys(values).sort()
    equal(await regressed([names[0]]), [names[0]])
    equal(await regressed(names), names)
    equal(JSON.parse(await Deno.readTextFile(baseline)), bank)
    equal(bundlesPerOp('apply/file/edit-alone-1000'), 1000)
  } finally {
    await Deno.remove(directory, { recursive: true })
  }
})

test('throughput collects each storage report separately from normalized apply reports', async () => {
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
          ? applyBenchmarkNames()
          : storageNames().filter((n) => n.split('/')[1] == mode)).map(
            (name) => ({ name, results: [{ ok: { avg: 100, cpu: 50 } }] }),
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
    equal((collected['sqlite/file/point'] as { value: number }).value, 100)
    equal((collected['apply/file/edit-alone-1000'] as { cpu: number }).cpu, .05)
    equal(
      (collected['apply/file/edit-alone-1000'] as { counts: unknown }).counts,
      { sqlPerApply: 1, sqlPerBundle: 1 },
    )
    ok(!Object.keys(collected).some((name) => name.endsWith('/sqlPerApply')))
  }
  equal(counts, 1)
})

test('recording comparison normalizes both modes per bundle without a statement observer', async () => {
  let suite = throughput({
    recording: true,
    filter: '-200|batch-1000',
    host: () => Promise.resolve(context),
    measure: (mode) =>
      Promise.resolve({
        version: 1,
        runtime: context.runtime,
        cpu: context.cpu,
        benches: applyBenchmarkNames(true).filter((name) =>
          /-200|batch-1000/.test(name)
        ).filter((name) =>
          name.endsWith('/subscribed') == (mode == 'recording-subscribed')
        ).map((name) => ({
          name,
          results: [{
            ok: {
              avg: name.endsWith('/subscribed') ? 120 : 100,
              cpu: name.endsWith('/subscribed') ? 60 : 50,
            },
          }],
        })),
      }),
    counts: () => {
      throw new Error('Statement counting must stay outside timing')
    },
  })
  let collected = await suite.collect(0)
  equal(
    Object.keys(collected).sort(),
    suite.benches.map((b) => b.name).sort(),
  )
  ok(!Object.hasOwn(collected, 'apply/file/edit-alone-1000'))
  for (let n of [200, 1000]) {
    let name = `apply/file/edit-batch-${n}`
    equal(
      (collected[name] as { value: number }).value,
      100 / (n * RECORDING_BATCHES),
    )
    equal(
      (collected[`${name}/subscribed`] as { value: number }).value,
      120 / (n * RECORDING_BATCHES),
    )
  }
})
