// The graph plugins that decide what a write means in a harness graph,
// exported as `@yaks/harness/rules` (and imported by @yaks/cli's `compose`).
// It is the same list `store.ts` builds the harness's own SQLite file with: one
// list, used by the standalone harness and by a server alike.
//
// This is the part that needs a database — it creates the blob tables through
// the caller's connection — which is why it is not in `./vocab`: a browser
// loading the harness's vocabulary never reaches this file.

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
 * in, and the programs a session runs. The blob tables are created first — a
 * plugin may create what it needs through the caller's connection. */
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
