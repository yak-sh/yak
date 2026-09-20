// Shared test fixtures (not part of the published package — see deno.json).
//
// The store is @yaks/ram: a Map holding the bundles, the same `apply()` and
// the same query grammar as a database, so a test needs no file and no schema.
// The vocabulary is every word a managed session touches — the transcript's,
// the process's, and the provider and model entities a request names.

import { type Graph, graph } from '@yaks/graph'
import { loadVocab, type Vocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import { modelDoc } from '@yaks/model'
import { sessionDoc, sessions } from '@yaks/session'
import { processDoc, processes } from '@yaks/process'
import { claude } from './adapters.ts'
import type { Adapter } from './adapters.ts'

/** Every word a managed session wears. */
export let host: Vocab = loadVocab([sessionDoc, modelDoc, processDoc])

/** A graph over an empty store, with the transcript and process rules on it.
 * `fx` is the effects registry, for a test that composes the facet. */
export let tracked = (): { g: Graph; fx: ReturnType<typeof effects> } => {
  let fx = effects(host, { write: (b) => g.apply(b, { trusted: true }) })
  let g = graph({
    storage: ram(host),
    vocab: host,
    plugins: [sessions(), processes(), fx],
  })
  return { g, fx }
}

/** The fake provider, wearing claude's dialect: the shipped reader under test,
 * driven by a shell script that needs no model (./fake.sh). */
export let fake: Adapter = {
  ...claude,
  argv: (j) => [
    'sh',
    new URL('./fake.sh', import.meta.url).pathname,
    j.session,
    j.model ?? '',
    j.instruction,
  ],
}

/** The bundles a request is: a session, and the entry that asks. */
export let asking = (
  session: string,
  entry: string,
  instruction: string,
  using: Record<string, unknown> = {},
) => [
  { entity: { eid: 'provider-fake' }, provider: { name: 'fake' } },
  {
    entity: { eid: 'model-fake' },
    model: { name: 'fake-1', provider: 'provider-fake' },
  },
  { entity: { eid: session }, session: {} },
  {
    entity: { eid: entry },
    entry: { session },
    content: { body: instruction },
    using: { provider: 'provider-fake', model: 'model-fake', ...using },
  },
]

/** Wait for a fact by polling it, never by guessing a duration. The budget is
 * only there to fail instead of hang. */
export let until = async <T>(
  fact: () => T | Promise<T>,
  label = 'it',
  timeout = 20_000,
): Promise<T> => {
  let deadline = Date.now() + timeout
  while (true) {
    let v = await fact()
    if (v) return v
    if (Date.now() >= deadline) throw new Error(`until: timed out on ${label}`)
    await new Promise((go) => setTimeout(go, 10))
  }
}

/** A test that costs a process: heavy, so it runs under TASKS_SLOW. */
export let slow = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, fn, ignore: !Deno.env.get('TASKS_SLOW') })
