// Another site's request cannot begin a browser sign-in or create a connection.
import { integrationEid } from '@yaks/connections'
import { docs as connections } from '@yaks/connections/vocab'
import { docs as kernel } from '@yaks/kernel/vocab'
import { docs as doc } from '@yaks/doc/vocab'
import { docs as edge } from '@yaks/edge/vocab'
import { docs as effects } from '@yaks/effects/vocab'
import { docs as secretsDocs } from '@yaks/secrets/vocab'
import { ramVault, secrets } from '@yaks/secrets'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { authorization } from './authorize.ts'

let owner = mint()
let vocab = loadVocab([
  ...kernel,
  ...doc,
  ...edge,
  ...effects,
  ...secretsDocs,
  ...connections,
])
let vault = ramVault()
let g = graph({
  storage: ram(vocab),
  vocab,
  plugins: [
    secrets(vault, (batch) => g.apply(batch, { trusted: true })),
  ],
})
let host = { graph: g, vocab, vault, config: { person: owner } }
await host.graph.apply([{
  entity: { eid: integrationEid('probe') },
  integration: {
    name: 'probe',
    hosts: ['example.org'],
    authorize: 'https://example.org/authorize',
    token: 'https://example.org/token',
    client_id: 'probe-client',
  },
}])
let stopping = new AbortController()
let route = authorization({ ...host, stopping: stopping.signal })
let call = (body: unknown, origin = 'https://tasks.test') =>
  route.handle(
    new Request('https://tasks.test/web/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(body),
    }),
  )

test('browser sign-in rejects another origin before starting authorization', async () => {
  await assertRejects(
    async () =>
      await call({ action: 'begin', name: 'probe' }, 'https://other.test'),
    Error,
    'Sign in from this site',
  )
  assertEquals(await host.graph.read('.connection'), [])
})
