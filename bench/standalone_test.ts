/** Each package workload suite checks regressions through the benchmark runner. */
import { Regressed, run, type Samples } from '@yaks/benchmark'
import { equal, ok, test, throws } from '@yaks/testing'
import { standalone } from './standalone.ts'

for (let registration of standalone) {
  let suite = registration.suite()
  test(`${suite.name} refuses a synthetic regression`, async () => {
    let stored = new Map<string, string>()
    let cost = 100
    let measured = {
      ...suite,
      collect: () =>
        Object.fromEntries(suite.benches.map(({ name }) => [
          name,
          [{ value: cost - 1 }, { value: cost }, { value: cost + 1 }],
        ])) as Record<string, Samples>,
    }
    let options = {
      output: 'result.json',
      baseline: registration.baseline,
      rounds: 3,
      host: () => ({
        config: {},
        configURL: null,
        commit: 'fixture',
        runtime: 'fixture-runtime',
        cpu: 'fixture-cpu',
        load: [0, 0, 0],
      }),
      reporters: () => [],
      files: {
        read: (path: string) => Promise.resolve(stored.get(path)!),
        write: (path: string, value: unknown) => {
          stored.set(path, JSON.stringify(value))
          return Promise.resolve()
        },
      },
    }
    await run(measured, { ...options, mode: 'accept', tolerance: 0.2 })
    let banked = stored.get(options.baseline)
    equal(
      (await run(measured, { ...options, mode: 'check' })).verdict,
      'passed',
    )
    cost = 130
    let error = await throws(() => run(measured, { ...options, mode: 'check' }))
    ok(error instanceof Regressed)
    if (!(error instanceof Regressed)) throw error
    equal(error.result.regressions.length, suite.benches.length)
    equal(JSON.parse(stored.get(options.output)!).verdict, 'regressed')
    equal(stored.get(options.baseline), banked)
  })
}
