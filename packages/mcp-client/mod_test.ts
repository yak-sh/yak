/// <reference lib="deno.ns" />
import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import type { Bundle, ToolCtx } from '@yaks/graph'
import { clients, connect, nameOf } from './mod.ts'

import { fixture } from './testing.ts'

// What the runner hands a tool: the call's arguments, and the call itself.
// A remote proxy reads nothing else.
let asking = (args: Record<string, unknown> = {}): ToolCtx =>
  ({ args, call: 'c1' }) as unknown as ToolCtx

// The words a proxied tool answered — the prose of the one bundle it made.
let words = (out: Bundle[]): string =>
  String((out[0]?.content as { body?: unknown })?.body ?? '')

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
    // A remote answer is prose to this graph: the words the server wrote,
    // in a bundle that says which call produced them.
    const out = await t.run([], asking({ html: '<h1>mockup</h1>' }))
    // Every text block the server wrote, which is what it wrote for a reader.
    assert(words(out).includes('https://example.test/mockup/1'))
    assertEquals(
      (out[0].output as { source?: unknown }).source,
      'c1',
    )
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
Deno.test('names expose readable server namespace and exact opaque remote name', async () => {
  assertEquals(await nameOf('yaks.app', 'app_list'), 'yaks_app__app_list')
  assertEquals(await nameOf('Other', 'app_list'), 'Other__app_list')
  assertThrows(() => nameOf('a', 'x'.repeat(64)))
  assertThrows(() => nameOf('a', 'remote.name'))
})
Deno.test('normalized namespace collisions are rejected before connecting', () => {
  assertThrows(
    () =>
      clients([
        { name: 'yaks.app', url: 'https://example.test/mcp' },
        { name: 'yaks_app', url: 'https://example.test/other' },
      ]),
    Error,
    'Duplicate MCP namespace',
  )
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
  const { cli } = await import('@yaks/cli')
  const f = fixture()
  const c = connect({ name: 'site', url: 'https://example.test/mcp' }, {
    fetch: f.fetcher,
  })
  try {
    const [tool] = await c.tools()
    const lines: string[] = []
    // A CLI host may explicitly assign a local name; the remote name stays
    // opaque. The tool goes to `cli` as it is — the words, the schema and the
    // run are all the tool's own.
    const said = {
      ...tool,
      noun: 'mockup',
      verb: 'publish',
      run: async (args: Record<string, unknown>) => {
        lines.push(JSON.stringify(await tool.run([], asking(args))))
        return 0
      },
    }
    assertEquals(
      await cli([said], {
        argv: ['publish', 'mockup', '--html', '<b>demo</b>'],
        out: (s: string) => lines.push(s),
        note: (s: string) => lines.push(s),
        reads: { file: () => '', stdin: () => '' },
      }),
      0,
    )
    assert(lines.join('').includes('mockup/1'))
    assertEquals(
      f.calls.find((x) => x.method === 'tools/call')?.params.arguments,
      { html: '<b>demo</b>' },
    )
  } finally {
    await c.close()
  }
})

Deno.test('about tool accepts declared draft-07 input and output through SDK validation', async () => {
  // Matches the public yaks.app about schema shape observed on 2026-09-16.
  const schema = {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: true,
    $schema: 'http://json-schema.org/draft-07/schema#',
  }
  let called = 0
  let invalid = false
  const c = connect({ name: 'public', url: 'https://example.test/mcp' }, {
    fetch: async (input, init) => {
      const req = new Request(input, init)
      if (req.method === 'GET') return new Response(null, { status: 405 })
      if (req.method === 'DELETE') return new Response(null, { status: 200 })
      const body = await req.json()
      if (!('id' in body)) return new Response(null, { status: 202 })
      const result = body.method === 'initialize'
        ? {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock', version: '1' },
        }
        : body.method === 'tools/list'
        ? {
          tools: [{
            name: 'about',
            inputSchema: {
              $schema: schema.$schema,
              type: 'object',
              properties: {},
            },
            outputSchema: schema,
          }],
        }
        : (++called, {
          content: [{ type: 'text', text: 'about' }],
          structuredContent: { text: invalid ? 12 : 'about' },
        })
      return Response.json({ jsonrpc: '2.0', id: body.id, result })
    },
  })
  try {
    const [tool] = await c.tools()
    const { validateToolInput } = await import('@yaks/vocab/tools')
    const result = await tool.run([], asking(validateToolInput(tool, {})))
    assert(words(result).includes('about'))
    assertEquals(called, 1)
    invalid = true
    // The remote's own outputSchema still governs the remote's reply: a
    // server that breaks its published contract is refused at this hop.
    await assertRejects(async () => await tool.run([], asking()))
  } finally {
    await c.close()
  }
})

Deno.test('opaque separators cannot silently collide across distinct server namespaces', async () => {
  const { checkToolNames } = await import('./mod.ts')
  const a = await nameOf('a', 'b__c'), b = await nameOf('a__b', 'c')
  assertEquals(a, b)
  const tool = { description: '' }
  assertThrows(
    () => checkToolNames([{ ...tool, name: a }, { ...tool, name: b }]),
    Error,
    'Duplicate MCP tool name',
  )
})
