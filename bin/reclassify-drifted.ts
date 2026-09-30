// One-time (T-59268): the archetype pointers left out of step with the rows
// their owners hold by writes past the graph before @yaks/sqlite's units kept
// them: raw SQL in one-time scripts (the cutover's `updated`, the transcript
// restores' tombstones, the writer migrations' `notice` and `prompt`) and
// storage-level patches (boot's lease reap). Every owner the audit finds
// drifted is classified again from the tables it holds rows in. Run once the
// server has opened the file with @yaks/embedding's tables keyed by `owner`,
// so vectors are not counted. Proven on a VACUUM INTO copy, run on the live
// file after a backup, and deleted once run.
//
//   deno run -A bin/reclassify-drifted.ts ~/.yak/yak.json

import { drift, mend } from '@yaks/sqlite'
import { read } from '../packages/cli/config.ts'
import { compose } from '../packages/cli/host.ts'

let host = await compose({ ...read(Deno.args[0]), duties: false }, ['graph'])
console.log(`drifted: ${drift(host.sql, 0).drifted}`)
console.log(`reclassified: ${mend(host.sql)}`)
console.log(`drifted now: ${drift(host.sql, 0).drifted}`)
await host.close(0)
