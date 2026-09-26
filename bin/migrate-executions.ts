// One-time (T-40623): a call the runner finished before 65063e02 says
// `execution{state: 'completed'}`, a word the vocabulary no longer lists, so
// the execution table cannot take the check its vocabulary gives it (T-40571).
// `completed` meant the handler returned, whatever it answered; a failure also
// wrote a fault (`error` or `exception`) sourced from the call. So each becomes
// `failed` where a fault names it, and `done` otherwise, through the graph.
// Proven on a VACUUM INTO copy, run on the live file after a backup, and
// deleted once run.
//
//   deno run -A bin/migrate-executions.ts ~/.yak/yak.json [--db <copy>]

import type { Bundle, Comp } from '@yaks/graph'
import { read } from '../packages/cli/config.ts'
import { compose } from '../packages/cli/host.ts'

let [path, flag, db] = Deno.args
let host = await compose({
  ...read(path),
  ...(flag == '--db' ? { db } : {}),
  duties: false,
}, ['graph'])
let g = host.graph

let source = (b: Bundle) => String((b.output as Comp).source)
let faulted = new Set(
  [
    ...await g.read('.output.source&.error'),
    ...await g.read(
      '.output.source&.exception',
    ),
  ].map(source),
)
let done: Bundle[] = await g.read('.execution.state=completed')
let moved = done.map((b): Bundle => ({
  entity: { eid: b.entity.eid },
  execution: { state: faulted.has(b.entity.eid) ? 'failed' : 'done' },
}))
let failed = moved.filter((b) => (b.execution as Comp).state == 'failed')
console.log(`completed: ${moved.length}, failed among them: ${failed.length}`)
for (let i = 0; i < moved.length; i += 500) {
  await g.apply(moved.slice(i, i + 500), { trusted: true })
}
let left = await g.read('.execution.state=completed')
console.log(`left completed: ${left.length}`)
await host.close(0)
