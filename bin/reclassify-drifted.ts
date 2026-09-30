// One-time (T-59268): the archetype pointers left out of step with the rows
// their owners hold by writes past the graph before @yaks/sqlite's units kept
// them: raw SQL in one-time scripts (the cutover's `updated`, the transcript
// restores' tombstones, the writer migrations' `notice` and `prompt`) and
// storage-level patches (boot's lease reap). Every owner the audit finds
// drifted is classified again from the tables it holds rows in. Run after
// @yaks/embedding's tables are keyed by `owner`, so vectors are not counted.
// Proven on a VACUUM INTO copy, run on the live file after a backup, and
// deleted once run.
//
//   deno run -A bin/reclassify-drifted.ts ~/.yak/yak.json

import { drift, reclassify } from '@yaks/sqlite'
import { read } from '../packages/cli/config.ts'
import { compose } from '../packages/cli/host.ts'

let host = await compose({ ...read(Deno.args[0]), duties: false }, ['graph'])
let found = drift(host.sql, Infinity)
console.log(`drifted: ${found.drifted} of ${found.checked}`)

let moved = 0
for (let i = 0; i < found.sample.length; i += 5000) {
  let out = reclassify(host.sql, found.sample.slice(i, i + 5000))
  moved += out.filter((b) => b.archetype == null).length
}
let after = drift(host.sql, 12)
console.log(`reclassified: ${moved}; drifted now: ${after.drifted}`)
await host.close(0)
