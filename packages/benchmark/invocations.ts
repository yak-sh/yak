/** Deno workload declarations, measured with one CPU clock for the whole
 * batch. Explicit start/end boundaries exclude fixture setup and teardown. */
import { stopwatch } from './bench.ts'
import type { Sampling } from './result.ts'

export type Invocation = Pick<
  Deno.BenchDefinition,
  'name' | 'fn' | 'n' | 'warmup'
>
type Reading = { value: number; cpu: number }
type Timer = () => () => Reading

export let invocation = async (
  entry: Invocation,
  timer: Timer = stopwatch,
  minimum = 200,
): Promise<{
  avg: number
  cpu: number
  n: number
  cpuSamples: number[]
  sampling?: Sampling
}> => {
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
  await batch(entry.warmup ?? 5)
  let n = Math.max(1, entry.n ?? 1)
  let reading: Reading & { outer: number }
  let sampling: Sampling | undefined
  if (entry.n === undefined) {
    let outer = 0, calibrated = false
    let budget = minimum * 5
    while (true) {
      reading = await batch(n)
      outer += reading.outer
      sampling = {
        status: 'insufficient',
        minimum,
        measured: reading.cpu,
        outer,
      }
      if (reading.cpu >= minimum) {
        // Discard calibration, then verify the retained batch itself. A GC
        // outlier during calibration cannot leave a tiny final batch valid.
        if (calibrated) {
          sampling = undefined
          break
        }
        calibrated = true
        continue
      }
      // Setup CPU limits growth but cannot stand in for measured work.
      let scale = Math.max(
        2,
        Math.min(10, Math.ceil(minimum * 1.25 / (reading.cpu || .001))),
      )
      let allowed = Math.floor(
        Math.max(0, budget - outer) * n / (reading.outer || .001),
      )
      let next = Math.min(10_000_000, n * scale, allowed)
      if (next <= n) break
      n = next
    }
  } else reading = await batch(n)
  // A declared n is the total measured invocation count. Paired rounds own
  // repeated observations; this collector never multiplies that contract.
  let cpu = reading!.cpu * 1e6 / n
  return {
    avg: reading!.value * 1e6 / n,
    cpu,
    n,
    cpuSamples: [cpu],
    ...sampling ? { sampling } : {},
  }
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
