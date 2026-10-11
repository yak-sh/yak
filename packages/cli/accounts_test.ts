// Account selection is computed; token refresh and private session reads share one graph.
import { equal, test } from '@yaks/testing'
import { type AccountOptions, accounts, personalPath } from './accounts.ts'
import {
  accountCredential,
  connectionsDoc,
  integrationEid,
} from '@yaks/connections'
import type { Bundle, Comp } from '@yaks/graph'
import { reader } from '@yaks/graph/read'
import { ram } from '@yaks/ram'
import { ramVault, secretEid, secretsDoc } from '@yaks/secrets'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { idDoc, idKeywords } from '@yaks/id'
import { ids } from '@yaks/id/graph'
import { personaDoc } from '@yaks/persona/vocab'
import { loadVocab } from '@yaks/vocab'
import type { Config } from './config.ts'
import { rpc } from './rpc.ts'
import { cli, globals } from './run.ts'

test('personal account graph keeps multiple credentials and computes default without a token file', async () => {
  let a = memoryAccounts()
  a.connected('newer', 'new@example.test', '2026-01-02T00:00:00Z')
  a.connected('oldest', 'first@example.test', '2026-01-01T00:00:00Z')
  equal(await a.token(), 'oldest')
  equal(await a.token('yaks.app', { as: 'new' }), 'newer')
  equal(
    await a.token('yaks.app', {
      env: (n) => n == 'YAKS_TOKEN' ? 'sandbox' : undefined,
    }),
    'sandbox',
  )
  let account = await accountCredential(
    { graph: a.g, vault: a.vault },
    owner,
    'yaks.app',
    'new',
  )
  equal((account!.connection.connection as Comp).account, 'new@example.test')
  equal(account!.session, undefined)
  equal([...a.files.keys()], [personalPath('/memory')])
  await a.close()
})
test('remote transport reads the credential at each call, not when the door is made', async () => {
  let next = 'one', seen: string[] = []
  let ask = rpc({
    url: 'https://example.test/mcp',
    token: () => Promise.resolve(next),
    fetch: (r) => {
      seen.push(r.headers.get('authorization')!)
      return Response.json({ jsonrpc: '2.0', id: 1, result: { ok: true } })
    },
  })
  await ask('first')
  next = 'two'
  await ask('second')
  equal(seen, ['Bearer one', 'Bearer two'])
})
test('global --as is optional and reaches a tool through an explicit binding', async () => {
  equal(globals(['app_list', '--as', 'bot']).rest, ['app_list'])
  equal(globals(['app_list', '--as=bot']).as, 'bot')
  let seen: unknown
  let code = await cli([{
    name: 'act',
    description: 'select account',
    globals: ['as'],
    inputSchema: { type: 'object', properties: { as: { type: 'string' } } },
    run: (args) => {
      seen = args
      return 0
    },
  }], {
    argv: ['act', '--as', 'bot'],
    env: () => undefined,
    out: () => {},
    note: () => {},
  })
  equal(code, 0)
  equal(seen, { as: 'bot' })
})

test('a pasted yaks.app grant works beside an OAuth integration without a registered client', async () => {
  let a = memoryAccounts()
  a.connected('agent-grant')
  a.patch([{
    entity: { eid: integrationEid('yaks.app') },
    integration: {
      token: 'https://yaks.app/oauth/token',
      authorize: 'https://yaks.app/oauth/authorize',
    },
  }])
  equal(await a.token(), 'agent-grant')
  await a.close()
})

// Same rows and credential door as a configured account graph, with storage
// and a vault in memory. The read-only preflight sees only the vocabulary the
// caller selected; composing a host is the executable-plugin boundary.
let baseVocab = loadVocab(
  [kernelDoc, idDoc, connectionsDoc, secretsDoc],
  [kernelKeywords, idKeywords],
)
let ownerVocab = loadVocab(
  [kernelDoc, idDoc, connectionsDoc, secretsDoc, personaDoc],
  [kernelKeywords, idKeywords],
)
let owner = '12345678-1234-1234-1234-123456789abc'
let memoryAccounts = () => {
  let storage = ram(ownerVocab, { number: true })
  let g = {
    ...reader({ storage, vocab: ownerVocab, plugins: [ids(ownerVocab)] }),
    apply: () => {
      throw new Error('a pasted grant never writes while reading')
    },
  }
  let patch = (bundles: Bundle[]) => storage.tx((tx) => tx.patch(bundles))
  let vault = ramVault()
  let config: Config = {
    db: ':memory:',
    person: owner,
    plugins: ['@yaks/kernel', '@yaks/id', '@yaks/connections', '@yaks/persona'],
  }
  let files = new Map([[personalPath('/memory'), config]])
  let opened = 0
  let lookup = accounts({
    config: (path) => files.get(path),
    reader: (_, plugins) => {
      let vocab = plugins.includes('@yaks/persona') ? ownerVocab : baseVocab
      let read = reader({ storage, vocab, plugins: [ids(vocab)] })
      return Promise.resolve({ graph: read, close: () => {} })
    },
    host: () => {
      opened++
      if (config.plugins?.includes('unrelated')) {
        throw new Error('unrelated graph facet executed')
      }
      return Promise.resolve({ config, graph: g, vault, close: () => {} })
    },
    credential: accountCredential,
  })
  let token = (host = 'yaks.app', opts: AccountOptions = {}) =>
    lookup.token(host, '/memory', { env: () => undefined, ...opts })
  let nameOf = (account: string) => `connection:${account}`
  let rotate = (value: string, account = 'probe@example.test') =>
    vault.seal(secretEid(nameOf(account)), { handle: 'handle', value })
  let connected = (
    value: string,
    account = 'probe@example.test',
    at = '2026-01-01T00:00:00Z',
  ) => {
    patch([
      {
        entity: { eid: integrationEid('yaks.app') },
        integration: { name: 'yaks.app', hosts: ['yaks.app'] },
      },
      {
        entity: { eid: secretEid(nameOf(account)) },
        created: { at },
        connection: {
          owner,
          integration: 'yaks.app',
          status: 'connected',
          account,
        },
        secret: { name: nameOf(account), value: 'handle' },
      },
    ])
    rotate(value, account)
  }
  return {
    config,
    g,
    patch,
    vault,
    token,
    connected,
    rotate,
    files,
    opened: () => opened,
    close: lookup.close,
  }
}

test('an unmatched door reads accounts without executing configured graph plugins', async () => {
  let a = memoryAccounts()
  a.connected('grant')
  a.config.plugins!.push('unrelated')
  equal(await a.token('https://public.example.test'), null)
  equal(a.opened(), 0)
  await a.close()
})

// Readers share a handle for the command, never a cached absence or bearer.
test('an account connected after a miss is visible before accounts close', async () => {
  let a = memoryAccounts()
  equal(await a.token(), null)
  a.connected('first')
  equal(await a.token(), 'first')
  a.rotate('second')
  equal(await a.token(), 'second')
  equal(a.opened(), 1)
  await a.close()
})

test('a prefixed owner resolves with its configured kind vocabulary', async () => {
  let a = memoryAccounts()
  a.patch([{ entity: { eid: owner }, person: {} }])
  let num = (await a.g.get([owner]))[0].entity.num
  // persona declares the U prefix; a connections-only reader cannot infer it.
  a.config.person = `U-${num}`
  equal(await a.token('https://public.example.test'), null)
  equal(a.opened(), 0)
  await a.close()
})
