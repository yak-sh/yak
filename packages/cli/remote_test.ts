import { equal, test } from '@yaks/testing'
import { integrationEid } from '@yaks/connections'
import { secretEid } from '@yaks/secrets'
import { compose } from './host.ts'
import { cli } from './run.ts'
import { feedbackCommand } from './feedback.ts'
import { pinned } from './release.ts'
import { rpc } from './rpc.ts'

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

test('local CLI and MCP send feedback to the public support door', async () => {
  let host = await compose(
    {
      db: ':memory:',
      plugins: ['@yaks/kernel', '@yaks/tools', '@yaks/api', '@yaks/mcp'],
    },
    ['graph', 'web'],
    undefined,
    { process: false },
  )
  let explicit = Deno.env.get('YAKS_TOKEN')
  let fetcher = globalThis.fetch
  let requests: Request[] = []
  Deno.env.delete('YAKS_TOKEN')
  globalThis.fetch = (url, options) => {
    requests.push(new Request(url, options))
    return Promise.resolve(Response.json({
      jsonrpc: '2.0',
      id: 1,
      result: {
        structuredContent: {
          result: [{
            entity: { eid: '$said' },
            content: { body: 'Your report was kept.' },
            output: { value: { thread: 'support-thread' } },
          }],
        },
      },
    }))
  }
  try {
    let words = 'Please add a task export.'
    let out: string[] = []
    equal(
      await cli([feedbackCommand], {
        argv: [
          '--config',
          '/nonexistent-yak-feedback-test.json',
          'feedback',
          words,
        ],
        out: (text) => out.push(text),
      }),
      0,
    )
    equal(out, ['Your report was kept.'])
    let ask = rpc({ url: 'http://local/mcp', fetch: host.handler })
    let reply = await ask('tools/call', {
      name: 'feedback',
      arguments: { text: words },
    })
    let result =
      (reply.structuredContent as { result: Record<string, unknown>[] }).result
    equal(result[0].content, { body: 'Your report was kept.' })
    equal((result[0].output as { value: unknown }).value, {
      thread: 'support-thread',
    })
    equal(requests.length, 2)
    for (let req of requests) {
      equal(req.url, 'https://yaks.app/mcp?auth=mixed')
      equal(req.headers.has('authorization'), false)
      equal(req.headers.has('x-via'), false)
      equal((await req.json()).params, {
        name: 'feedback',
        arguments: { text: words, yak_version: pinned['@yaks/cli'] },
      })
    }
  } finally {
    globalThis.fetch = fetcher
    if (explicit) Deno.env.set('YAKS_TOKEN', explicit)
    await host.close()
  }
})
