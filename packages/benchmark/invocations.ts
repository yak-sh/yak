/** Deno workload declarations, measured with one CPU clock for the whole
 * batch. Explicit start/end boundaries exclude fixture setup and teardown. */
import { stopwatch } from './bench.ts'
import { median } from './result.ts'

export type Invocation = Pick<
  Deno.BenchDefinition,
  'name' | 'fn' | 'n' | 'warmup'
>
type Reading = { value: number; cpu: number }
type Timer = () => () => Reading

export let invocation = async (
  entry: Invocation,
  timer: Timer = stopwatch,
  minimum = 20,
): Promise<{ avg: number; cpu: number; n: number; cpuSamples: number[] }> => {
  let batch = async (n: number): Promise<Reading> => {
    let explicit = false, running = false
    let sum = { value: 0, cpu: 0 }
    let stop: () => Reading
    let context = {
      name: entry.name,
      origin: '',
      start: () => {
        if (running) throw new Error('Benchmark timer already started')
        explicit = running = true
        stop = timer()
      },
      end: () => {
        if (!running) throw new Error('Benchmark timer was not started')
        let reading = stop()
        sum.value += reading.value
        sum.cpu += reading.cpu
        running = false
      },
    }
    let elapsed = timer()
    for (let i = 0; i < n; i++) {
      let result = entry.fn(context)
      if (result && typeof result.then == 'function') await result
      if (running) context.end()
    }
    return explicit ? sum : elapsed()
  }
  await batch(entry.warmup ?? 5)
  let n = Math.max(1, entry.n ?? 1)
  while (true) {
    let reading = await batch(n)
    if (reading.cpu >= minimum || n >= 10_000_000) break
    n *= Math.max(2, Math.min(10, Math.ceil(minimum / (reading.cpu || .001))))
  }
  // Fixture construction can compile the same product paths as the work.
  // Warm for a bounded CPU interval over the whole invocation, including its
  // setup and teardown, instead of publishing the first calibration batch.
  let warmed = 0
  for (let turn = 0; warmed < minimum * 5 && turn < 20; turn++) {
    let elapsed = timer()
    let warm = await batch(n)
    warmed += elapsed().cpu
    if (warm.cpu < minimum) {
      n = Math.min(10_000_000, Math.ceil(n * minimum / (warm.cpu || .001)))
    }
  }
  let readings: Reading[] = []
  for (let i = 0; i < 5; i++) readings.push(await batch(n))
  let middle = [...readings].sort((a, b) => a.cpu - b.cpu)[2]
  let cpuSamples = readings.map((r) => r.cpu * 1e6 / n)
  return { avg: middle.value * 1e6 / n, cpu: median(cpuSamples), n, cpuSamples }
}

/** Install only at the isolated collector's process boundary. Workload files
 * retain Deno.bench's declarations and context without using its wall timer. */
export let declarations = (): Invocation[] => {
  let entries: Invocation[] = []
  Deno.bench = ((
    first: string | Deno.BenchDefinition | Deno.BenchDefinition['fn'],
    second?: Partial<Deno.BenchDefinition> | Deno.BenchDefinition['fn'],
    third?: Deno.BenchDefinition['fn'],
  ) => {
    let definition = typeof first == 'object'
      ? first
      : typeof first == 'function'
      ? { name: first.name, fn: first }
      : {
        ...typeof second == 'object' ? second : {},
        name: first,
        fn: typeof second == 'function' ? second : third,
      }
    if (!definition.fn) throw new Error('Missing benchmark function')
    if (definition.ignore) return
    entries.push(definition as Invocation)
  }) as typeof Deno.bench
  return entries
}
