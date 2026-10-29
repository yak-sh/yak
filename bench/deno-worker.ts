/** One process owns the registered Deno workloads and reports CPU per operation. */
import { host } from '@yaks/benchmark'
import { declarations, invocation } from '../packages/benchmark/invocations.ts'

let entries = declarations()
for (let path of Deno.args) {
  await import(new URL('../' + path, import.meta.url).href)
}
let filter = Deno.env.get('BENCH_FILTER')
if (filter) {
  entries = entries.filter((entry) => new RegExp(filter).test(entry.name))
}
let machine = await host()
let benches = []
for (let entry of entries) {
  benches.push({ name: entry.name, results: [{ ok: await invocation(entry) }] })
}
console.log(JSON.stringify({
  version: 1,
  runtime: machine.runtime,
  cpu: machine.cpu,
  benches,
}))
