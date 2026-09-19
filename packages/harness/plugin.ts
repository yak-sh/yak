// The harness as a PLUGIN MODULE: the one place that says what a harness
// graph is made of. A host imports it and takes the facets it runs (@yaks/cli
// `compose` — vocab, derived columns, rules, tool runs), and `store.ts` takes
// the same ones for the harness's own file, so `yak serve --config harness.json`
// and `harness ls` speak about one graph in one way.
//
// There is no manifest and no registration: a plugin is a module that exports
// named parts, and a part it does not have is a part it does not export.

import { blobRead, blobs, blobSchema, sqliteBlobs } from '@yaks/blob'
import { edges } from '@yaks/edge'
import type { Plugin } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { parse } from '@yaks/query'
import { sessionDerived, sessions, taskMarks } from '@yaks/session'
import { processes } from '@yaks/process'
import type { Derived } from '@yaks/sql'
import { derived as taskDerived, tasks } from '@yaks/task'
import type { Vocab } from '@yaks/vocab'
import type { Host } from '@yaks/cli/serve'

export { docs as vocab, keywords } from './vocab.ts'

/** The columns a harness graph computes rather than keeps: a transcript's
 * status and a task's — the SQL halves of `statusOf` — and a body whose text
 * lives in the blob table. */
export let derived = (vocab: Vocab): Derived => ({
  ...sessionDerived,
  ...taskDerived(taskMarks),
  ...blobRead(vocab),
})

/** What a batch means here: addressed bodies, transcripts, edges, tasks, and
 * the programs a session runs. The blob tables are raised first — a rule may
 * install what it needs through `host.sql`. */
export let rules = (host: Host): Plugin[] => {
  for (let statement of blobSchema()) host.sql.exec(statement)
  return [
    blobs(host.vocab, sqliteBlobs(host.sql)),
    sessions(),
    edges(host.vocab),
    tasks(host.vocab, taskMarks),
    processes(),
  ]
}

/** The runs behind the tools vocab.json declares. The answer is the entities
 * themselves — a tool that finds transcripts answers transcripts. */
export let runs: Runs = {
  session_list: (_bundles, ctx) => ctx.read(parse('.session')),
}
