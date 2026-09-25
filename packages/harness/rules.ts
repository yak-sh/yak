// The graph plugins that decide what a write means in a harness graph that
// `store.ts` opens on its own. Each is its own package's `./rules` facet too,
// which is how a `yak` config composing those packages gets them.
//
// This is the part that needs a database — it creates the blob tables through
// the caller's connection — which is why it is not in `./vocab`: a browser
// loading the harness's vocabulary never reaches this file.

import { blobs, blobSchema, sqliteBlobs } from '@yaks/blob'
import { edges } from '@yaks/edge'
import type { Bundle, Plugin } from '@yaks/graph'
import { sessions, taskMarks } from '@yaks/session'
import { processes } from '@yaks/process'
import { projects } from '@yaks/project'
import { tasks } from '@yaks/task'
import type { Driver } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { secrets, type Vault } from '@yaks/secrets'

/** Addressed bodies, transcripts, edges, tasks, the portfolio they are filed
 * in, the programs a session runs, and the secrets it signs in with, kept in
 * the host's vault. The blob tables are created first — a plugin may create
 * what it needs through the caller's connection. */
export let rules = (
  host: {
    vocab: Vocab
    sql: Driver
    vault: Vault
    /** the graph's own `apply()`, trusted: what a sealed secret's mark coming
     * off is written through */
    write: (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>
  },
): Plugin[] => {
  for (let statement of blobSchema()) host.sql.query(statement)
  return [
    blobs(host.vocab, sqliteBlobs(host.sql)),
    sessions(),
    edges(host.vocab),
    tasks(),
    projects(host.vocab, taskMarks),
    processes(),
    secrets(host.vault, host.write),
  ]
}
