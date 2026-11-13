#!/usr/bin/env -S deno run -A
// One-time (T-165786): each keyed write's receipt a graph kept as an
// `apply_receipt` entity moves into its write log, under the name @yaks/api's
// door now reads it by (receipts.ts `receiptOf`, the entity's own eid), bound
// to the same digest, with the same answer; then the entity is deleted.
//
//   deno run -A bin/move-receipts.ts <config> <db> [--dry]
//
// Opens <db> composed as <config> says (~/.yak/yak.json, ~/.yak/tracker.json).
// A receipt reaches the log
// before its entity goes, so a run cut off part way loses none, and a second
// run moves nothing. `--dry` counts and checks, and writes nothing.

import { compose, facet } from '@yaks/cli/host'
import { read as config } from '@yaks/cli'
import type { Bundle } from '@yaks/graph'
import type { Driver } from '@yaks/sql'
import { decode, stringify } from '@yaks/vocab/wire'
import { composed } from '@yaks/graph/bundle'
import { first, named, raise, received } from '@yaks/api/log'
import { col, select, table } from '@yaks/sql'

let [path, db] = Deno.args.filter((a) => !a.startsWith('--'))
if (!db) throw new Error('usage: move-receipts.ts <config> <db> [--dry]')
let dry = Deno.args.includes('--dry')
let say = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)
let count = (log: Driver) =>
  log.query(select({ cols: [col('seq')], from: table('yak_writes') })).length

let cfg = config(path)
let host = await compose(
  { ...cfg, db, tracker: undefined, duties: false },
  ['graph'],
  facet,
  { process: false },
)
try {
  let log = host.storage.statements as Driver
  if (!dry) raise(log)
  // Read past the graph's scope, which hides every receipt from its reads.
  let kept = await host.storage.read('.apply_receipt')
  let before = dry ? 0 : count(log)
  let moved = 0, there = 0, same = 0
  for (let at = 0; at < kept.length; at += 100) {
    let batch = kept.slice(at, at + 100)
    for (let b of batch) {
      let { digest, answer } = b.apply_receipt as {
        digest: string
        answer: string
      }
      let rows = decode(host.vocab, JSON.parse(answer)) as Bundle[]
      // The answer as the log keeps it is the one the entity held.
      if (stringify(composed(rows)) == answer) same++
      let request = named(b.entity.eid, digest)
      let name = request.headers.get('idempotency-key')!
      if (dry) continue
      if (first(log, name, request)) there++
      else {
        received(log, { request }, () => rows)
        moved++
      }
    }
    if (!dry) {
      await host.graph.apply(
        batch.map((b) => ({ entity: { eid: b.entity.eid }, $delete: true })),
        { trusted: true },
      )
    }
  }
  let left = (await host.storage.read('.apply_receipt')).length
  let after = dry ? 0 : count(log)
  say({ receipts: kept.length, answers_kept_alike: same, moved, there, left })
  if (!dry) say({ log_before: before, log_after: after })
} finally {
  await host.close()
}
