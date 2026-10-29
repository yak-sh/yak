import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import type { CliCommand } from '@yaks/cli/host'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { personaDoc } from '@yaks/persona/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { provisionalDoc } from '@yaks/effects'
import { connectionsDoc } from '@yaks/connections'
import type { Host } from '@yaks/host'
import { integrationEid } from '@yaks/connections/identity'
import { ramVault, sealed, secrets, secretsDoc } from '@yaks/secrets'
import { CallError } from '@yaks/tools'
import { client } from './client.ts'

let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  personaDoc,
  toolsDoc,
  provisionalDoc,
  connectionsDoc,
  secretsDoc,
])
let vault = ramVault()
let g = graph({
  storage: ram(vocab),
  vocab,
  plugins: [secrets(vault, (b) => g.apply(b, { trusted: true }), vocab)],
})
let host = { graph: g, vault, config: { person: 'owner' } } as Host
await host.graph.apply([
  { entity: { eid: 'owner' }, person: {} },
  {
    entity: { eid: integrationEid('yaks.app') },
    integration: { name: 'yaks.app', hosts: ['yaks.app'] },
  },
  {
    ...sealed('connection:admin', 'admin-bearer'),
    connection: {
      owner: 'owner',
      integration: 'yaks.app',
      account: 'admin@bot.yak.sh',
      status: 'connected',
    },
  },
])

let context = (out: (line: string) => void) =>
  ({ out, as: 'admin' }) as Parameters<CliCommand['run']>[2]

test('the terminal copies OAuth client values without printing them or recording a call', async () => {
  let refs: string[] = [], output: string[] = [], sent: unknown
  let run = client((ref) => {
    refs.push(ref)
    return Promise.resolve(ref.endsWith('/id') ? 'client-id' : 'client-key')
  })
  let fetch = globalThis.fetch
  globalThis.fetch = ((_url, init) => {
    equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer admin-bearer',
    )
    sent = JSON.parse(String(init?.body)).params.arguments.bundles
    return Promise.resolve(
      Response.json({ result: { structuredContent: { result: [] } } }),
    )
  }) as typeof fetch
  try {
    equal(
      await run(
        {
          name: 'google',
          id: 'op://v/client/id',
          secret: 'op://v/client/secret',
        },
        host,
        context((line) => output.push(line)),
      ),
      0,
    )
    equal(refs, ['op://v/client/id', 'op://v/client/secret'])
    let bundles = sent as { secret: { value: string } }[]
    equal(JSON.parse(bundles[0].secret.value), {
      id: 'client-id',
      secret: 'client-key',
    })
    equal(output.length, 1)
    equal(output[0].includes('client-key'), false)
    equal(await host.graph.read('.call'), [])
  } finally {
    globalThis.fetch = fetch
  }
})

test('a client value typed as an argument is refused before accounts or 1Password are read', async () => {
  let reads = 0
  let run = client(() => (reads++, Promise.resolve('key')))
  await assertRejects(
    () =>
      Promise.resolve(
        run({ name: 'google', id: 'plaintext' }, {} as Host, context(() => {})),
      ),
    CallError,
    'op://',
  )
  equal(reads, 0)
})
