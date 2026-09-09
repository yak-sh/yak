// Shared test fixtures (not part of the published package — see deno.json).
//
// The store is @yaks/ram: a Map holding the bundles, the same `apply()` and the
// same query grammar as a database, so a test needs no file and no schema. The
// vocabulary is this package's beside @yaks/session's, because the lines a
// process writes are that package's `content`.

import { loadVocab, type Vocab } from '@yaks/vocab'
import { type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { modelDoc } from '@yaks/model'
import { sessionDoc } from '@yaks/session'
import { processDoc } from './comp.ts'
import { processes } from './plugin.ts'

/** This package's words, and the transcript words its output rides. */
export let host: Vocab = loadVocab([processDoc, sessionDoc, modelDoc])

/** A graph over an empty store, with the process plugin on it. */
export let tracked = (): Graph =>
  graph({ storage: ram(host), vocab: host, plugins: [processes()] })

/** A pid that certainly is not running: a child spawned, waited on, and gone.
 * The number is free, so this is the closest a test gets to a dead process. */
export let gone = async (): Promise<number> => {
  let child = new Deno.Command('sh', {
    args: ['-c', 'exit 0'],
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  let pid = child.pid
  await child.status
  return pid
}
