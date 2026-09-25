import { assert, assertEquals, assertRejects } from '@std/assert'
import { local } from './local.ts'
import { open } from './store.ts'
import { remote } from './remote.ts'
import { mcpTools } from './mcp.ts'
import { signins } from './signin.ts'
import { fixture } from '../mcp-client/testing.ts'
import { graphToolName } from '@yaks/mcp-client/graph'
import { repo } from './testing.ts'

Deno.test('configured remote MCP tool publishes mockup through existing call/result transcript', async () => {
  const f = fixture()
  const server = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    (req) => f.fetcher(req),
  )
  const h = open(':memory:')
  const calls: string[] = []
  let requests = 0
  await h.g.apply([{
    entity: { eid: 'site' },
    mcp_server: {
      name: 'site',
      url: `http://127.0.0.1:${server.addr.port}/mcp`,
    },
  }])
  const a = local({
    cwd: repo(),
    h,
    model: (req) => {
      requests++
      if (requests === 1) {
        const t = req.tools.find((t) => t.description.includes('[site]'))!
        assert(t)
        calls.push(t.name)
        return Promise.resolve({
          id: 'r1',
          model: 'fake',
          items: [{
            kind: 'call',
            id: 'remote-call',
            name: t.name,
            args: JSON.stringify({ html: '<h1>Hello</h1>' }),
          }],
        })
      }
      assert(
        req.items.some((i) =>
          i.kind === 'result' && i.output.includes('mockup/1')
        ),
      )
      return Promise.resolve({
        id: 'r2',
        model: 'fake',
        items: [{ kind: 'assistant', text: 'Published' }],
      })
    },
  })
  try {
    const id = await a.start('publish mockup')
    await a.idle(id)
    const entries = await a.transcript(id)
    assertEquals(entries.filter((b) => b.call).length, 1)
    assertEquals(entries.filter((b) => b.result).length, 1)
    assertEquals(
      calls[0],
      await graphToolName('site', {
        name: 'site',
        url: `http://127.0.0.1:${server.addr.port}/mcp`,
      }, 'publish_mockup'),
    )
    assertEquals(f.calls.filter((c) => c.method === 'tools/list').length, 1)
    assertEquals(f.calls.filter((c) => c.method === 'tools/call').length, 1)
  } finally {
    await a.close()
    await server.shutdown()
  }
})

Deno.test('worker owns MCP connection and preserves exact configured tool schemas', async () => {
  const f = fixture()
  const server = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    (req) => f.fetcher(req),
  )
  const dir = await Deno.makeTempDir()
  const db = dir + '/graph.db'
  const seed = open(db)
  await seed.g.apply([{
    entity: { eid: 'site' },
    mcp_server: {
      name: 'site',
      url: `http://127.0.0.1:${server.addr.port}/mcp`,
    },
  }])
  seed.close()
  const a = await remote({ db, fake: true })
  try {
    const id = await a.agent.start('hello')
    await a.idle(id)
    assertEquals(f.calls.filter((c) => c.method === 'tools/list').length, 1)
    await a.agent.sessions()
    assertEquals(f.calls.filter((c) => c.method === 'tools/list').length, 1)
  } finally {
    await a.close()
    await server.shutdown()
  }
})

Deno.test('tool isError uses expected tool failure rather than a defect', async () => {
  const f = fixture()
  f.toolError()
  const server = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    (req) => f.fetcher(req),
  )
  const h = open(':memory:')
  await h.g.apply([{
    entity: { eid: 'site' },
    mcp_server: {
      name: 'site',
      url: `http://127.0.0.1:${server.addr.port}/mcp`,
    },
  }])
  const tools = mcpTools(h, signins(h))
  try {
    const [tool] = await tools.snapshot()
    await assertRejects(async () => await tool.run({}), Error, 'mockup/1')
  } finally {
    await tools.close()
    h.close()
    await server.shutdown()
  }
})

Deno.test('remote images use external artifacts while large text retains bounded context policy', async () => {
  const f = fixture()
  const image = btoa('image-bytes')
  const server = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    async (req) => {
      const body = req.method === 'POST' ? await req.clone().json() : undefined
      if (body?.method === 'tools/call') {
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{ type: 'image', mimeType: 'image/png', data: image }, {
              type: 'text',
              text: 'a'.repeat(100000),
            }],
          },
        })
      }
      return f.fetcher(req)
    },
  )
  const h = open(':memory:')
  await h.g.apply([{
    entity: { eid: 'site' },
    mcp_server: {
      name: 'site',
      url: `http://127.0.0.1:${server.addr.port}/mcp`,
    },
  }])
  const tools = mcpTools(h, signins(h))
  try {
    await h.g.apply([{ entity: { eid: 's' }, session: {} }, {
      entity: { eid: 'call' },
      entry: { session: 's' },
      call: { to: 'tool' },
    }])
    const [tool] = await tools.snapshot()
    const text = await tool.run({}, {
      session: 's',
      call: { entity: { eid: 'call' } },
      entries: [],
    })
    assert(!text.includes(image))
    assert(text.includes('Artifact:'))
    const artifacts = await h.g.read('.artifact&*')
    assertEquals(artifacts.length, 1)
    const address = (artifacts[0].artifact as { address: string }).address
    assertEquals(
      new TextDecoder().decode(await h.artifacts.get(address)),
      'image-bytes',
    )
    assertEquals((await h.g.read('.attachment&*')).length, 1)
    // The full text remains available for the ordinary context output policy.
    assert(text.endsWith('a'.repeat(100000)))
  } finally {
    await tools.close()
    h.close()
    await server.shutdown()
  }
})
