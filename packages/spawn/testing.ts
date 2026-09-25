// Shared test fixtures (not part of the published package — see deno.json).
//
// The store is @yaks/ram: a Map holding the bundles, with the same `apply()`
// and the same query grammar as a database, so a test needs no file and no
// schema. The vocabulary is every component a managed session touches — the
// session's, the process's, and the provider and model entities a request
// names.

import { type Graph, graph, identityEid } from '@yaks/graph'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { loadVocab, type Vocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import { modelDoc } from '@yaks/model'
import { sessionDoc, sessions } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { processDoc, processes } from '@yaks/process'
import { claude } from './adapters.ts'
import { spawnDoc } from './vocab.ts'
import type { Adapter } from './adapters.ts'

/** Every component a managed session uses, and what this package declares. */
export let host: Vocab = loadVocab(
  [sessionDoc, toolsDoc, modelDoc, processDoc, edgeDoc, spawnDoc],
  [edgeKeywords],
)

/** The provider and the model a request names. */
export let FAKE = {
  provider: identityEid('provider', ['fake']),
  model: identityEid('model', ['fake-1']),
}

/** A graph over an empty store, with the session and process plugins loaded.
 * `fx` is the effects registry, for a test that needs to add handlers. */
export let tracked = (): { g: Graph; fx: ReturnType<typeof effects> } => {
  let fx = effects(host, { write: (b) => g.apply(b, { trusted: true }) })
  let g = graph({
    storage: ram(host, { number: true }),
    vocab: host,
    plugins: [sessions(), processes(), fx],
  })
  return { g, fx }
}

/** The fake provider, printing claude's output format: the shipped reader
 * under test, driven by a shell script that needs no model (./fake.sh). */
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

/** The rows that make up a request: a session, and the entry that asks. */
export let asking = (
  session: string,
  entry: string,
  instruction: string,
  using: Record<string, unknown> = {},
) => [
  { entity: { eid: FAKE.provider }, provider: { name: 'fake' } },
  { entity: { eid: FAKE.model }, model: { name: 'fake-1' } },
  { ...link(FAKE.provider, 'serves', FAKE.model), serves: { name: 'fake-1' } },
  { entity: { eid: session }, session: {} },
  {
    entity: { eid: entry },
    entry: { session },
    content: { body: instruction },
    using: { ...FAKE, ...using },
  },
]

/** Wait for something to become true by polling, never by sleeping a guessed
 * duration. The timeout is only there to fail instead of hang. */
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
