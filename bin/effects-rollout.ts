// One-time, for the effect pool's rollout (T-39570): the rows the pool keeps
// under a name no vocabulary declares any more are removed, and the runs the
// rollout failed for want of a handler are owed again. Proven on a VACUUM INTO
// copy, run on the live file after a backup, and deleted once run.
//
//   deno run -A bin/effects-rollout.ts ~/.yak/yak.json [--db <copy>]
//
// A pool row is bookkeeping the pool writes beneath the journal (tx.patch), so
// it is removed and re-owed the same way.

import { effectsIn } from '@yaks/vocab'
import type { Bundle } from '@yaks/graph'
import { read } from '../packages/cli/config.ts'
import { compose } from '../packages/cli/host.ts'

let [path, flag, db] = Deno.args
let host = await compose({
  ...read(path),
  ...(flag == '--db' ? { db } : {}),
  duties: false,
}, ['graph'])
let g = host.graph
let declared = new Set(effectsIn(host.vocab.docs).map((e) => e.name))
let quoted = (s: string) => JSON.stringify(s)

let handlers = (await g.rows('.effect&.distinct=effect.handler'))
  .map((r) => String(r.value ?? ''))
let stale = handlers.filter((h) => h && !declared.has(h))
console.log(`declared: ${declared.size}, stale names: ${stale.length}`)

let removed = 0
for (let h of stale) {
  while (true) {
    let rows: Bundle[] = await g.read(
      `.effect.handler=${quoted(h)}&.limit=5000`,
    )
    if (!rows.length) break
    await host.storage.tx((tx) => tx.remove(rows.map((b) => b.entity)))
    removed += rows.length
  }
}
console.log(`removed ${removed} rows under stale names`)

// Failed only because the process that claimed them had no handler yet.
let failed: Bundle[] = await g.read(
  `.effect.state=failed&.effect.error~=${quoted('no effect registered as')}`,
)
await host.storage.tx((tx) =>
  tx.patch(failed.map((b) => ({
    entity: b.entity,
    effect: {
      state: 'pending',
      attempts: 0,
      error: null,
      next: null,
      lease_owner: null,
      lease_token: null,
      lease_expiry: null,
    },
  })))
)
console.log(`owed again: ${failed.length} failed runs`)
await host.close(0)
