import { assert, assertEquals, assertRejects } from '@std/assert'
import { local } from './local.ts'
import { graphMCP } from './mcp_registry.ts'
import { signins } from './signin.ts'
import { fixture } from '../mcp-client/testing.ts'
import { graphToolName } from '@yaks/mcp-client/graph'
import { harness, repo } from './testing.ts'

Deno.test('graph MCP definitions persist; rename keeps identity, edits and removal affect next discovery', async () => {
  const f = fixture()
  const server = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    (r) => f.fetcher(r),
  )
  const dir = await Deno.makeTempDir()
  let h = await harness(dir + '/graph.db')
  let registry = graphMCP(h, signins(h))
  try {
    assertEquals(await registry.tools(), [])
    await h.g.apply([{
      entity: { eid: '0c300000-0000-4000-8000-000000000001' },
      mcp_server: {
        name: 'Website',
        url: `http://127.0.0.1:${server.addr.port}/mcp`,
      },
    }])
    const [original] = await registry.tools()
    assertEquals(
      original.name,
      await graphToolName('0c300000-0000-4000-8000-000000000001', {
        name: 'Website',
        url: `http://127.0.0.1:${server.addr.port}/mcp`,
      }, 'publish_mockup'),
    )
    assert(original.description.includes('Website'))
    await h.g.apply([{
      entity: { eid: '0c300000-0000-4000-8000-000000000001' },
      mcp_server: { name: 'Renamed' },
    }])
    assertEquals((await registry.tools())[0].name, 'Renamed__publish_mockup')
    assertEquals((await registry.control('list')).servers, [
      'Renamed [0c300000-0000-4000-8000-000000000001]',
    ])
    await h.g.apply([{
      entity: { eid: '0c300000-0000-4000-8000-000000000001' },
      mcp_server: { allow: '[]' },
    }])
    assertEquals(await registry.tools(), [])
    // A captured handler belongs to its earlier request, even after configuration changed.
    const value = await original.reply({ html: '<h1>kept</h1>' })
    assert(JSON.stringify(value).includes('mockup/1'))
    await h.g.apply([{
      entity: { eid: '0c300000-0000-4000-8000-000000000001' },
      mcp_server: { allow: null, enabled: false },
    }])
    assertEquals((await registry.control('list')).servers, [])
    await h.g.apply([{
      entity: { eid: '0c300000-0000-4000-8000-000000000001' },
      mcp_server: { enabled: true },
    }])
    await registry.close()
    h.close()
    h = await harness(dir + '/graph.db')
    registry = graphMCP(h, signins(h))
    assertEquals((await registry.tools())[0].name, 'Renamed__publish_mockup')
    await h.g.apply([{
      entity: { eid: '0c300000-0000-4000-8000-000000000001' },
      mcp_server: null,
    }])
    assertEquals(await registry.tools(), [])
  } finally {
    await registry.close()
    h.close()
    await server.shutdown()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('bad MCP definitions and transport failures do not block other servers and are visible in authorization panel', async () => {
  const f = fixture()
  const server = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    (r) => f.fetcher(r),
  )
  const h = await harness(), registry = graphMCP(h, signins(h))
  try {
    await h.g.apply([
      {
        entity: { eid: '0c300000-0000-4000-8000-000000000003' },
        mcp_server: { name: 'Bad', url: 'file:///secret' },
      },
      {
        entity: { eid: '0c300000-0000-4000-8000-000000000004' },
        mcp_server: {
          name: 'Good',
          url: `http://127.0.0.1:${server.addr.port}/mcp`,
        },
      },
      {
        entity: { eid: '0c300000-0000-4000-8000-000000000005' },
        mcp_server: {
          name: 'Broken',
          url: `http://127.0.0.1:${server.addr.port}/mcp`,
          allow: 'not json',
        },
      },
    ])
    assertEquals((await registry.tools()).length, 1)
    const reply = await registry.control('list')
    assert(reply.message?.includes('0c300000-0000-4000-8000-000000000003:'))
    assert(reply.message?.includes('0c300000-0000-4000-8000-000000000005:'))
    await assertRejects(() =>
      registry.control('begin', '0c300000-0000-4000-8000-000000000003')
    )
    await h.g.apply([{
      entity: { eid: '0c300000-0000-4000-8000-000000000004' },
      mcp_server: { url: 'https://user:password@example.test' },
    }])
    assertEquals(await registry.tools(), [])
    assert(!(await registry.control('list')).message?.includes('password'))
  } finally {
    await registry.close()
    h.close()
    await server.shutdown()
  }
})

Deno.test('an already-running agent discovers graph additions on its next ask and hides disabled tools', async () => {
  const { local } = await import('./local.ts')
  const f = fixture()
  const server = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    (r) => f.fetcher(r),
  )
  const h = await harness()
  const offered: string[][] = []
  const a = local({
    cwd: repo(),
    h,
    tools: [],
    model: (req) => {
      offered.push(req.tools.map((t) => t.name))
      return Promise.resolve({
        id: 'reply' + offered.length,
        model: 'fake',
        items: [{ kind: 'assistant', text: 'ok' }],
      })
    },
  })
  try {
    const session = await a.start('one')
    await a.idle(session)
    assertEquals(offered[0], [])
    await h.g.apply([{
      entity: { eid: '0c300000-0000-4000-8000-000000000002' },
      mcp_server: {
        name: 'site',
        url: `http://127.0.0.1:${server.addr.port}/mcp`,
      },
    }])
    await a.send(session, 'two')
    await a.idle(session)
    assertEquals(offered[1], [
      await graphToolName('0c300000-0000-4000-8000-000000000002', {
        name: 'site',
        url: `http://127.0.0.1:${server.addr.port}/mcp`,
      }, 'publish_mockup'),
    ])
    await h.g.apply([{
      entity: { eid: '0c300000-0000-4000-8000-000000000002' },
      mcp_server: { enabled: false },
    }])
    await a.send(session, 'three')
    await a.idle(session)
    assertEquals(offered[2], [])
  } finally {
    await a.close()
    await server.shutdown()
  }
})

Deno.test('reconfiguration changes tool identity without retargeting previously issued calls', async () => {
  const a = fixture(), b = fixture()
  const one = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    (r) => a.fetcher(r),
  )
  const two = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    (r) => b.fetcher(r),
  )
  const h = await harness(), registry = graphMCP(h, signins(h))
  try {
    await h.g.apply([{
      entity: { eid: '0c300000-0000-4000-8000-000000000001' },
      mcp_server: {
        name: 'site',
        url: `http://127.0.0.1:${one.addr.port}/mcp`,
      },
    }])
    const [old] = await registry.tools()
    await h.g.apply([{
      entity: { eid: '0c300000-0000-4000-8000-000000000001' },
      mcp_server: { url: `http://127.0.0.1:${two.addr.port}/mcp` },
    }])
    const [next] = await registry.tools()
    assertEquals(old.name, next.name)
    await old.reply({ html: 'old' })
    await next.reply({ html: 'new' })
    assertEquals(a.calls.filter((c) => c.method === 'tools/call').length, 1)
    assertEquals(b.calls.filter((c) => c.method === 'tools/call').length, 1)
  } finally {
    await registry.close()
    h.close()
    await one.shutdown()
    await two.shutdown()
  }
})

Deno.test('graph MCP namespace collisions fail explicitly without opening duplicate connections', async () => {
  const h = await harness(), registry = graphMCP(h, signins(h))
  try {
    await h.g.apply(['yaks.app', 'yaks_app'].map((name) => ({
      entity: { eid: crypto.randomUUID() },
      mcp_server: { name, url: 'https://example.test/mcp' },
    })))
    await assertRejects(
      () => registry.tools(),
      Error,
      'Duplicate MCP namespace: yaks_app',
    )
  } finally {
    await registry.close()
    h.close()
  }
})

Deno.test('issued calls keep their handler when another ask refreshes the same public name', async () => {
  const first = fixture(), second = fixture()
  const one = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    (r) => first.fetcher(r),
  )
  const two = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    (r) => second.fetcher(r),
  )
  const h = await harness()
  const serverId = crypto.randomUUID()
  await h.g.apply([{
    entity: { eid: serverId },
    mcp_server: { name: 'site', url: `http://127.0.0.1:${one.addr.port}/mcp` },
  }])
  const started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>()
  let asks = 0
  const a = local({
    cwd: repo(),
    h,
    tools: [],
    name: 'fake',
    model: async (req) => {
      if (++asks === 1) {
        started.resolve()
        await release.promise
        return {
          id: 'old',
          model: 'fake',
          items: [{
            kind: 'call',
            id: 'old-call',
            name: req.tools[0].name,
            args: '{"html":"old"}',
          }],
        }
      }
      return {
        id: 'done-' + asks,
        model: 'fake',
        items: [{ kind: 'assistant', text: 'done' }],
      }
    },
  })
  try {
    const original = await a.start('old request')
    await started.promise
    await h.g.apply([{
      entity: { eid: serverId },
      mcp_server: { url: `http://127.0.0.1:${two.addr.port}/mcp` },
    }])
    const other = await a.start('refresh tools')
    await a.idle(other)
    release.resolve()
    await a.idle(original)
    assertEquals(first.calls.filter((c) => c.method === 'tools/call').length, 1)
    assertEquals(
      second.calls.filter((c) => c.method === 'tools/call').length,
      0,
    )
  } finally {
    release.resolve()
    await a.close()
    await one.shutdown()
    await two.shutdown()
  }
})
