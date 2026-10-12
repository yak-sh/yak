// Prepare the box exception move from a graph-query snapshot. Admission and
// source patches are applied with yak graph apply, destination before source.
import { type Bundle } from '@yaks/graph'
import { legacyException } from '@yaks/tracker'

let [input, directory] = Deno.args
let { result: rows } = JSON.parse(await Deno.readTextFile(input)) as {
  result: Bundle[]
}
let retired = ['at', 'message', 'stack', 'request', 'request_id', 'version']
let plans = rows.filter((row) => {
  let x = row.exception as Record<string, unknown>
  return !row.entry && !row.output && !row.result ||
    x.type == null || x.value == null ||
    retired.some((prop) => x[prop] != null)
}).map(legacyException)
let records = plans.flatMap((plan) => plan.records)
for (let record of records) {
  let error = record.error as { tags: Record<string, unknown> }
  error.tags.source = 'box'
}
await Deno.writeTextFile(
  `${directory}/tracker-bundles.json`,
  JSON.stringify(records),
)
await Deno.writeTextFile(
  `${directory}/source-bundles.json`,
  JSON.stringify(plans.map((p) => p.patch)),
)
console.log(JSON.stringify({
  history: plans.filter((plan) => plan.history).length,
  defects: records.length,
}))
