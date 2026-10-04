/** Timed sync or async workloads. Setup and teardown are outside each sample;
 * operations normalizes a batch, while iterations keeps individual samples. */
import type { Bench, Sample, Workload } from './result.ts'
import { during, peek, record } from '@yaks/trace'

type DurationUnit = 'ns' | 'us' | 'ms' | 's'
export type TimeUnit = DurationUnit | `${DurationUnit}/${string}`
export type Iteration = { round: number; iteration: number }
export type TimedBench = Pick<Workload, 'name' | 'resolution'> & {
  unit: TimeUnit
  run: (iteration: Iteration) => unknown
  /** How many independent timed invocations to keep in each round. */
  iterations?: number
  /** How many operations one invocation performs. */
  operations?: number
  setup?: (iteration: Iteration) => unknown
  teardown?: (iteration: Iteration) => unknown
  /** Record this target's work (for example, a graph). Without a target, the
   * tree contains the bench invocation's own span. */
  target?: object
}

export let bench = (options: TimedBench): Bench => {
  let iterations = options.iterations ?? 1
  let operations = options.operations ?? 1
  for (let n of [iterations, operations]) {
    if (!Number.isSafeInteger(n) || n < 1) {
      throw new Error('Expected a positive integer count')
    }
  }
  let [unit, per, extra] = options.unit.split('/')
  if (extra != null || per === '' || (operations != 1 && !per)) {
    throw new Error('Operation normalization needs a unit with a denominator')
  }
  let scales: Record<string, number> = { ns: 1e6, us: 1e3, ms: 1, s: 1e-3 }
  let scale = scales[unit]
  if (scale == null) throw new Error(`Unknown time unit: ${options.unit}`)
  let target = options.target ?? {}
  return {
    name: options.name,
    unit: options.unit,
    ...(options.resolution !== undefined
      ? { resolution: options.resolution }
      : {}),
    better: 'lower',
    sample: async (round) => {
      let out: Sample[] = []
      for (let iteration = 0; iteration < iterations; iteration++) {
        let context = { round, iteration }
        try {
          await options.setup?.(context)
          let timed = () => {
            let start = performance.now()
            let result = options.run(context)
            let done = (): Sample => ({
              value: (performance.now() - start) * scale / operations,
              counts: { operations },
              source: 'invocation',
            })
            // A sync workload must not pay for a Promise turn inside its timing.
            return result &&
                typeof (result as PromiseLike<unknown>).then == 'function'
              ? Promise.resolve(result).then(done)
              : done()
          }
          let captured = await record(
            target,
            () =>
              options.target ? timed() : during(
                peek(target)?.begin({
                  kind: 'bench',
                  name: options.name,
                  package: '@yaks/benchmark',
                }),
                timed,
              ),
          )
          out.push({ ...captured.result, spans: captured.spans })
        } finally {
          await options.teardown?.(context)
        }
      }
      return out
    },
  }
}
