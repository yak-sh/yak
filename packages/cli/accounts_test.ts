// Account selection is computed; token refresh and private session reads share one graph.
import { equal, ok, test } from '@yaks/testing'
import {
  accountHost,
  accountToken,
  closeAccounts,
  personal,
} from './accounts.ts'
import {
  accountCredential,
  connect,
  integrationEid,
  need,
} from '@yaks/connections'
import type { Comp } from '@yaks/graph'
import { rpc } from './rpc.ts'
import { cli, globals } from './run.ts'

let named = async (state: string, address: string, key: string) => {
  let path = await personal(state), h = await accountHost(path)
  await h.graph.apply([{
    entity: { eid: integrationEid('yaks.app') },
    integration: { name: 'yaks.app', hosts: ['yaks.app'] },
  }])
  let [b] = await h.graph.apply(
    await need(h.graph.read, {
      owner: h.config.person!,
      integration: 'yaks.app',
    }),
  )
  await connect(
    { graph: h.graph, vault: h.vault },
    b.entity.eid,
    { key },
    address,
  )
  return { path, h, b }
}
test('personal account graph keeps multiple credentials and computes default without a token file', async () => {
  let state = await Deno.makeTempDir()
  try {
    let { path, h } = await named(state, 'first@example.test', 'oldest')
    await named(state, 'new@example.test', 'newer')
    equal(
      await accountToken('yaks.app', state, {
        config: path,
        env: () => undefined,
      }),
      'oldest',
    )
    equal(
      await accountToken('yaks.app', state, {
        config: path,
        as: 'new',
        env: () => undefined,
      }),
      'newer',
    )
    equal(
      await accountToken('yaks.app', state, {
        env: (n) => n == 'YAKS_TOKEN' ? 'sandbox' : undefined,
      }),
      'sandbox',
    )
    let account = await accountCredential(
      { graph: h.graph, vault: h.vault },
      h.config.person!,
      'yaks.app',
      'new',
    )
    equal((account!.connection.connection as Comp).account, 'new@example.test')
    equal(account!.session, undefined)
    ok(
      !(await Array.fromAsync(Deno.readDir(state))).some((f) =>
        f.name == 'token.json'
      ),
    )
  } finally {
    await closeAccounts()
    await Deno.remove(state, { recursive: true })
  }
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
test('global --as is optional and reaches a tool only if its schema names account selection', async () => {
  equal(globals(['app_list', '--as', 'bot']).rest, ['app_list'])
  equal(globals(['app_list', '--as=bot']).as, 'bot')
  let seen: unknown
  let code = await cli([{
    name: 'act',
    description: 'select account',
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
  let state = await Deno.makeTempDir()
  try {
    let { h, path } = await named(state, 'probe@example.test', 'agent-grant')
    await h.graph.apply([{
      entity: { eid: integrationEid('yaks.app') },
      integration: {
        token: 'https://yaks.app/oauth/token',
        authorize: 'https://yaks.app/oauth/authorize',
      },
    }])
    equal(
      await accountToken('yaks.app', state, {
        config: path,
        env: () => undefined,
      }),
      'agent-grant',
    )
  } finally {
    await closeAccounts()
    await Deno.remove(state, { recursive: true })
  }
})
