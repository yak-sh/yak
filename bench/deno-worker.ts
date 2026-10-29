/** Product imports stay warm; every collection imports fresh workload modules
 * and awaits their disposal before answering with CPU per operation. */
import { host } from '@yaks/benchmark'
import { declarations, invocation } from '../packages/benchmark/invocations.ts'
import { serve } from './collector.ts'

let files = Deno.args.filter((arg) => arg != '--serve')
let entries = declarations(), sequence = 0
let cleanups: EventListenerOrEventListenerObject[] = []
let subscribe = globalThis.addEventListener.bind(globalThis)
globalThis.addEventListener = ((
  name: string,
  callback: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
) => {
  if (name == 'unload' && callback) cleanups.push(callback)
  else if (callback) subscribe(name, callback, options)
}) as typeof globalThis.addEventListener
let machine = await host()
await serve(async () => {
  entries.length = 0
  try {
    for (let path of files) {
      let url = new URL('../' + path, import.meta.url)
      url.searchParams.set('collection', String(sequence))
      await import(url.href)
    }
    sequence++
    let filter = Deno.env.get('BENCH_FILTER')
    let names = Deno.env.get('BENCH_NAMES')
    let wanted = names ? new Set<string>(JSON.parse(names)) : undefined
    let selected = entries.filter((entry) =>
      (!wanted || wanted.has(entry.name)) &&
      (!filter || new RegExp(filter).test(entry.name))
    )
    let benches = []
    for (let entry of selected) {
      benches.push({
        name: entry.name,
        results: [{ ok: await invocation(entry) }],
      })
    }
    return { version: 1, runtime: machine.runtime, cpu: machine.cpu, benches }
  } finally {
    entries.length = 0
    let disposed = await Promise.allSettled(
      cleanups.splice(0).map(async (cleanup) => {
        let event = new Event('unload')
        await (typeof cleanup == 'function'
          ? cleanup(event)
          : cleanup.handleEvent(event))
      }),
    )
    let errors = disposed.filter((result) => result.status == 'rejected')
      .map((result) => (result as PromiseRejectedResult).reason)
    if (errors.length) {
      throw new AggregateError(
        errors,
        `Benchmark fixture cleanup failed: ${errors.join('; ')}`,
      )
    }
  }
})
