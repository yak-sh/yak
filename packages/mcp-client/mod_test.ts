/// <reference lib="deno.ns" />
import { assert, assertEquals, assertRejects } from '@std/assert'
import { clients, connect, nameOf } from './mod.ts'

import { fixture } from './testing.ts'

Deno.test('portable client initializes, exposes unchanged schema and invokes exact remote name', async () => {
  const f = fixture()
  const c = connect({ name: 'site', url: 'https://example.test/mcp' }, {
    fetch: f.fetcher,
    token: () => 'private-token',
  })
  try {
    const [t] = await c.tools()
    assertEquals(t.inputSchema, {
      type: 'object',
      properties: { html: { type: 'string' } },
      required: ['html'],
    })
    const out = await t.run({ html: '<h1>mockup</h1>' }, {} as never)
    assertEquals((out as { structuredContent: unknown }).structuredContent, {
      saved: '<h1>mockup</h1>',
    })
    assert(f.calls.some((x) => x.method === 'notifications/initialized'))
    assertEquals(
      f.calls.find((x) => x.method === 'tools/call')?.params.name,
      'publish_mockup',
    )
    assert(
      f.requests.every((r) =>
        r.headers.get('authorization') === 'Bearer private-token'
      ),
    )
    assert(
      f.requests.filter((r) => r.method === 'POST').slice(1).every((r) =>
        r.headers.get('mcp-session-id') === 'test-session'
      ),
    )
    assertEquals((await c.tools())[0].name, t.name)
    assertEquals(f.calls.filter((x) => x.method === 'tools/list').length, 1)
    f.change()
    c.refresh()
    assertEquals(await c.tools(), [])
  } finally {
    await c.close()
  }
})
Deno.test('names are stable, bounded, distinct across servers and opaque underscores', async () => {
  const a = await nameOf('a', 'x_y'.repeat(200))
  assertEquals(a.length, 64)
  assert(a !== await nameOf('b', 'x_y'.repeat(200)))
  assert(a !== await nameOf('a_x', 'y'.repeat(200)))
  assertEquals(a, await nameOf('a', 'x_y'.repeat(200)))
})
Deno.test('allowlists restrict list and invocation; errors are not mutation retries', async () => {
  const f = fixture()
  const c = connect({
    name: 'site',
    url: 'https://example.test/mcp',
    allow: [],
  }, { fetch: f.fetcher })
  try {
    assertEquals(await c.tools(), [])
    await assertRejects(
      () => c.call('publish_mockup', {}),
      Error,
      'not allowed',
    )
  } finally {
    await c.close()
  }
  const other = connect({ name: 'site', url: 'https://example.test/mcp' }, {
    fetch: f.fetcher,
  })
  try {
    f.toolError()
    assertEquals((await other.call('publish_mockup', {})).isError, true)
    f.fail()
    await assertRejects(
      () => other.call('publish_mockup', {}),
      Error,
      'No retry',
    )
    assertEquals(f.calls.filter((x) => x.method === 'tools/call').length, 2)
  } finally {
    await other.close()
  }
  await assertRejects(() => other.call('publish_mockup', {}), Error, 'closed')
})
Deno.test('multiple servers are composed without remote-name collisions', async () => {
  const f = fixture()
  const pool = clients([{ name: 'one', url: 'https://example.test/mcp' }, {
    name: 'two',
    url: 'https://example.test/mcp',
  }], { fetch: f.fetcher })
  try {
    const tools = await pool.tools()
    assertEquals(tools.length, 2)
    assert(tools[0].name !== tools[1].name)
  } finally {
    await pool.close()
  }
})

Deno.test('SDK list_changed notification invalidates discovery for next snapshot', async () => {
  const f = fixture()
  let notify: ((value: Uint8Array) => void) | undefined
  const c = connect({ name: 'site', url: 'https://example.test/mcp' }, {
    fetch: (input, init) => {
      const request = new Request(input, init)
      if (request.method === 'GET') {
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                notify = (value) => controller.enqueue(value)
                request.signal.addEventListener('abort', () => {
                  try {
                    controller.close()
                  } catch { /* already closed */ }
                })
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
        )
      }
      return f.fetcher(request)
    },
  })
  try {
    assertEquals((await c.tools()).length, 1)
    f.change()
    assert(notify)
    notify(
      new TextEncoder().encode(
        'data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n',
      ),
    )
    // Let the SDK's stream reader deliver the notification.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    assertEquals(await c.tools(), [])
  } finally {
    await c.close()
  }
})

Deno.test('401 does not retry a call, and error text excludes credential and body', async () => {
  const f = fixture()
  let rejected = 0
  const c = connect({ name: 'site', url: 'https://example.test/mcp' }, {
    token: () => 'secret',
    fetch: async (input, init) => {
      const req = new Request(input, init)
      if (
        req.method === 'POST' &&
        (await req.clone().json()).method === 'tools/call'
      ) {
        rejected++
        return new Response('private remote error secret', { status: 401 })
      }
      return f.fetcher(req)
    },
  })
  try {
    await c.tools()
    const err = await assertRejects(() => c.call('publish_mockup', {}))
    assert(!String(err).includes('secret'))
    assertEquals(rejected, 1)
  } finally {
    await c.close()
  }
})

Deno.test('graph Tool is usable through the CLI adapter without any session runtime', async () => {
  const { commandPlugin } = await import('@yaks/cli/structured')
  const f = fixture()
  const c = connect({ name: 'site', url: 'https://example.test/mcp' }, {
    fetch: f.fetcher,
  })
  try {
    const [tool] = await c.tools()
    const lines: string[] = []
    // A CLI host may explicitly assign a local spelling; the remote name stays opaque.
    const plugin = commandPlugin(
      [{ ...tool, noun: 'mockup', verb: 'publish' }],
      async (tool, args, ctx) => {
        ctx.out(JSON.stringify(await tool.run(args, {} as never)))
        return 0
      },
    )
    const ctx = {
      args: ['publish', '--html', '<b>demo</b>'],
      out: (s: string) => lines.push(s),
      note: (s: string) => lines.push(s),
    } as never
    const verbs = await plugin.verbs(ctx)
    assertEquals(await verbs[0].run(ctx), 0)
    assert(lines.join('').includes('mockup/1'))
    assertEquals(
      f.calls.find((x) => x.method === 'tools/call')?.params.arguments,
      { html: '<b>demo</b>' },
    )
  } finally {
    await c.close()
  }
})
