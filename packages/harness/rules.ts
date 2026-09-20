// What a batch MEANS in a harness graph: the `rules` facet a host takes
// (@yaks/cli `compose`, `@yaks/harness/rules`), and the very list `store.ts`
// builds the harness's own file with. One list, two hosts.
//
// This is the facet that needs a DATABASE — it installs the blob tables
// through the host's connection — which is why it is not in `./vocab`: a
// browser loading the harness's words never reaches this file.

import { blobs, blobSchema, sqliteBlobs } from '@yaks/blob'
import { edges } from '@yaks/edge'
import type { Plugin } from '@yaks/graph'
import { sessions, taskMarks } from '@yaks/session'
import { processes } from '@yaks/process'
import { projects } from '@yaks/project'
import { tasks } from '@yaks/task'
import type { Driver } from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'

/** Addressed bodies, transcripts, edges, tasks, the portfolio they are filed
 * in, and the programs a session runs. The blob tables are raised first — a
 * rule may install what it needs through the host's connection. */
export let rules = (host: { vocab: Vocab; sql: Driver }): Plugin[] => {
  for (let statement of blobSchema()) host.sql.exec(statement)
  return [
    blobs(host.vocab, sqliteBlobs(host.sql)),
    sessions(),
    edges(host.vocab),
    tasks(),
    projects(host.vocab, taskMarks),
    processes(),
  ]
}
