/** Deno workload declarations, measured with one CPU clock for the whole
 * batch. Explicit start/end boundaries exclude fixture setup and teardown. */
import { stopwatch } from './bench.ts'

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
  let batch = async (n: number): Promise<Reading & { outer: number }> => {
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
    let total = elapsed()
    return { ...(explicit ? sum : total), outer: total.cpu }
  }
  let warm = await batch(entry.warmup ?? 5)
  let n = Math.max(1, entry.n ?? 1)
  if (entry.n === undefined) {
    let warmed = warm.outer
    for (let turn = 0; turn < 20; turn++) {
      let reading = await batch(n)
      warmed += reading.outer
      // An explicit timed act can be tiny beside its fixture. Growing by
      // timed CPU alone would repeat that fixture thousands of times.
      if (reading.cpu >= minimum || reading.outer >= minimum) {
        if (warmed >= minimum * 5) break
      } else {
        let scale = Math.ceil(minimum / (reading.outer || .001))
        n = Math.min(10_000_000, n * Math.max(2, Math.min(10, scale)))
      }
    }
  }
  // A declared n is the total measured invocation count. Paired rounds own
  // repeated observations; this collector never multiplies that contract.
  let reading = await batch(n)
  let cpu = reading.cpu * 1e6 / n
  return { avg: reading.value * 1e6 / n, cpu, n, cpuSamples: [cpu] }
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
