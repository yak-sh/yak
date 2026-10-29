import { equal, test } from '@yaks/testing'
import { integrationEid } from '@yaks/connections'
import { secretEid } from '@yaks/secrets'
import { compose } from './host.ts'

test('host delivery reads its configured owner and vault for HTTP and MCP', async () => {
  let owner = crypto.randomUUID()
  let host = await compose(
    {
      db: ':memory:',
      person: owner,
      plugins: [
        '@yaks/kernel',
        '@yaks/provenance',
        '@yaks/effects',
        '@yaks/secrets',
        '@yaks/connections',
      ],
    },
    ['graph'],
    undefined,
    { process: false },
  )
  let explicit = Deno.env.get('YAKS_TOKEN')
  let fetcher = globalThis.fetch
  let requests: Request[] = []
  Deno.env.delete('YAKS_TOKEN')
  globalThis.fetch = ((url, options) => {
    requests.push(new Request(url, options))
    return Promise.resolve(
      Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: { structuredContent: { result: [] } },
      }),
    )
  }) as typeof fetch
  try {
    for (let integration of ['https://bound.test/mcp', 'yaks.app']) {
      let name = `connection:${integration}`
      await host.graph.apply([
        {
          entity: { eid: integrationEid(integration) },
          integration: {
            name: integration,
            hosts: [integration == 'yaks.app' ? 'yaks.app' : 'bound.test'],
          },
        },
        {
          entity: { eid: secretEid(name) },
          connection: {
            owner,
            integration,
            status: 'connected',
            account: 'selected@example.test',
          },
          secret: { name, value: 'fixture-handle' },
        },
      ], { trusted: true })
      await host.vault.seal(secretEid(name), {
        handle: 'fixture-handle',
        value: 'bound-fixture',
      })
    }
    await host.readJson!('https://bound.test/visualize/anatomy')
    await host.remote!('builder_build', { builder: 'remote', app: 'app' }, {
      as: 'selected',
    })
    equal(requests.map((r) => r.headers.get('authorization')), [
      'Bearer bound-fixture',
      'Bearer bound-fixture',
    ])
    equal(requests.map((r) => new URL(r.url).pathname), [
      '/visualize/anatomy',
      '/mcp',
    ])
  } finally {
    globalThis.fetch = fetcher
    if (explicit) Deno.env.set('YAKS_TOKEN', explicit)
    await host.close()
  }
})
