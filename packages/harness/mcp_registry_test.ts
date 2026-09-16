import { assert, assertEquals, assertRejects } from '@std/assert'
import { open } from './store.ts'
import { graphMCP } from './mcp_registry.ts'
import { fixture } from '../mcp-client/testing.ts'
import { graphToolName } from '@yaks/mcp-client/graph'

Deno.test('graph MCP definitions persist; rename keeps identity, edits and removal affect next discovery', async () => {
  const f = fixture()
  const server = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    (r) => f.fetcher(r),
  )
  const dir = await Deno.makeTempDir()
  let h = open(dir + '/graph.db')
  let registry = graphMCP(h.g)
  try {
    assertEquals(await registry.tools(), [])
    await h.g.apply([{
      entity: { eid: 'remote' },
      mcp_server: {
        name: 'Website',
        url: `http://127.0.0.1:${server.addr.port}/mcp`,
      },
    }])
    const [original] = await registry.tools()
    assertEquals(
      original.name,
      await graphToolName('remote', {
        name: 'remote',
        url: `http://127.0.0.1:${server.addr.port}/mcp`,
      }, 'publish_mockup'),
    )
    assert(original.description.includes('Website'))
    await h.g.apply([{
      entity: { eid: 'remote' },
      mcp_server: { name: 'Renamed' },
    }])
    assertEquals((await registry.tools())[0].name, original.name)
    assertEquals((await registry.control('list')).servers, ['Renamed [remote]'])
    await h.g.apply([{
      entity: { eid: 'remote' },
      mcp_server: { allow: '[]' },
    }])
    assertEquals(await registry.tools(), [])
    // A captured handler belongs to its earlier request, even after configuration changed.
    const value = await original.run({ html: '<h1>kept</h1>' }, {
      graph: h.g,
      actor: null,
      apply: h.g.apply.bind(h.g),
      read: h.g.read.bind(h.g),
    })
    assert(JSON.stringify(value).includes('mockup/1'))
    await h.g.apply([{
      entity: { eid: 'remote' },
      mcp_server: { allow: null, enabled: false },
    }])
    assertEquals((await registry.control('list')).servers, [])
    await h.g.apply([{
      entity: { eid: 'remote' },
      mcp_server: { enabled: true },
    }])
    await registry.close()
    h.close()
    h = open(dir + '/graph.db')
    registry = graphMCP(h.g)
    assertEquals((await registry.tools())[0].name, original.name)
    await h.g.apply([{ entity: { eid: 'remote' }, mcp_server: null }])
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
  const h = open(':memory:'), registry = graphMCP(h.g)
  try {
    await h.g.apply([
      {
        entity: { eid: 'bad' },
        mcp_server: { name: 'Bad', url: 'file:///secret' },
      },
      {
        entity: { eid: 'good' },
        mcp_server: {
          name: 'Good',
          url: `http://127.0.0.1:${server.addr.port}/mcp`,
        },
      },
      {
        entity: { eid: 'broken' },
        mcp_server: {
          name: 'Broken',
          url: `http://127.0.0.1:${server.addr.port}/mcp`,
          allow: 'not json',
        },
      },
    ])
    assertEquals((await registry.tools()).length, 1)
    const reply = await registry.control('list')
    assert(reply.message?.includes('bad:'))
    assert(reply.message?.includes('broken:'))
    await assertRejects(() => registry.control('begin', 'bad'))
    await h.g.apply([{
      entity: { eid: 'good' },
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
  const { agent } = await import('./run.ts')
  const f = fixture()
  const server = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    (r) => f.fetcher(r),
  )
  const h = open(':memory:')
  const offered: string[][] = []
  const a = agent({
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
      entity: { eid: 'stable' },
      mcp_server: {
        name: 'site',
        url: `http://127.0.0.1:${server.addr.port}/mcp`,
      },
    }])
    await a.send(session, 'two')
    await a.idle(session)
    assertEquals(offered[1], [
      await graphToolName('stable', {
        name: 'stable',
        url: `http://127.0.0.1:${server.addr.port}/mcp`,
      }, 'publish_mockup'),
    ])
    await h.g.apply([{
      entity: { eid: 'stable' },
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
  const h = open(':memory:'), registry = graphMCP(h.g)
  try {
    await h.g.apply([{
      entity: { eid: 'remote' },
      mcp_server: {
        name: 'site',
        url: `http://127.0.0.1:${one.addr.port}/mcp`,
      },
    }])
    const [old] = await registry.tools()
    await h.g.apply([{
      entity: { eid: 'remote' },
      mcp_server: { url: `http://127.0.0.1:${two.addr.port}/mcp` },
    }])
    const [next] = await registry.tools()
    assert(old.name !== next.name)
    const ctx = {
      graph: h.g,
      actor: null,
      apply: h.g.apply.bind(h.g),
      read: h.g.read.bind(h.g),
    }
    await old.run({ html: 'old' }, ctx)
    await next.run({ html: 'new' }, ctx)
    assertEquals(a.calls.filter((c) => c.method === 'tools/call').length, 1)
    assertEquals(b.calls.filter((c) => c.method === 'tools/call').length, 1)
  } finally {
    await registry.close()
    h.close()
    await one.shutdown()
    await two.shutdown()
  }
})
