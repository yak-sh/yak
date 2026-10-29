/** Product imports stay warm; every collection imports fresh workload modules
 * and awaits their disposal before answering with CPU per operation. */
import { host } from '@yaks/benchmark'
import { declarations, invocation } from '../packages/benchmark/invocations.ts'
import { serve } from './collector.ts'
import { selected } from './selected.ts'

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

/** Await every workload's unload listener, and name the ones that failed. */
let dispose = async () => {
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

await serve(async () => {
  entries.length = 0
  let benches = []
  try {
    for (let path of files) {
      let url = new URL('../' + path, import.meta.url)
      url.searchParams.set('collection', String(sequence))
      await import(url.href)
    }
    sequence++
    let workloads = entries.filter((entry) => selected(entry.name))
    for (let entry of workloads) {
      benches.push({
        name: entry.name,
        results: [{ ok: await invocation(entry) }],
      })
    }
  } catch (error) {
    entries.length = 0
    await dispose().catch(() => {})
    throw error
  }
  entries.length = 0
  await dispose()
  return { version: 1, runtime: machine.runtime, cpu: machine.cpu, benches }
})
