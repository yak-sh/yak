// Shared test fixtures (not part of the published package — see deno.json).
//
// The store is @yaks/ram: a Map holding the bundles, with the same `apply()`
// and the same query grammar as a database, so a test needs no file and no
// schema. The vocabulary is this package's loaded beside @yaks/session's,
// because the lines a process prints are stored as that package's `content`
// component.

import { loadVocab, type Vocab } from '@yaks/vocab'
import { type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { modelDoc } from '@yaks/model'
import { sessionDoc } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { processDoc } from './comp.ts'
import { processes } from './plugin.ts'

/** This package's components, plus the transcript components its output
 * uses. */
export let host: Vocab = loadVocab([processDoc, sessionDoc, toolsDoc, modelDoc])

/** A graph over an empty store, with the process plugin on it. */
export let tracked = (): Graph =>
  graph({ storage: ram(host), vocab: host, plugins: [processes()] })

/** Wait for a condition by polling it, never by guessing a duration. The
 * timeout is only there so a failure fails instead of hanging. */
export let until = async <T>(
  fact: () => T | Promise<T>,
  label = 'it',
  timeout = 5000,
): Promise<T> => {
  let deadline = Date.now() + timeout
  while (true) {
    let v = await fact()
    if (v) return v
    if (Date.now() >= deadline) throw new Error(`until: timed out on ${label}`)
    await new Promise((go) => setTimeout(go, 5))
  }
}

/** A pid that certainly is not running: a child started, waited on, and
 * exited. The number is free again, so this is the closest a test gets to a
 * dead process. */
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
