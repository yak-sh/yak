/// <reference lib="deno.ns" />
// The HTTP door: one JSON-RPC request in, one reply out, the actor taken from
// the door and nowhere else, and every other shape of request refused in its
// own words.

import { test, until } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { type Bundle, graph } from '@yaks/graph'
import { graphDoc } from '@yaks/graph/vocab'
import { subscriptions, Unauthorized } from '@yaks/api'
import { ram } from '@yaks/ram'
import { sessionDoc } from '@yaks/session'
import { authenticate as sessionAuth } from '@yaks/session/rules'
import { loadVocab } from '@yaks/vocab'
import { mcp } from './mount.ts'
import { routes } from './routes.ts'
import { comp, shop, shopGraph } from './testing.ts'

let ada = { by: 'm1' }

let sessionGraph = () => {
  let vocab = loadVocab([...shop.docs, sessionDoc, {
    $defs: {
      created: {
        component: true,
        extends: true,
        type: 'object',
        properties: {
          via: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
        },
      },
    },
  }])
  return graph({ storage: ram(vocab, { number: true }), vocab })
}

let post = (body: unknown) =>
  new Request('http://shop.test/mcp', {
    method: 'POST',
    body: JSON.stringify(body),
  })

let rpc = (method: string, params: Record<string, unknown> = {}) =>
  post({ jsonrpc: '2.0', id: 1, method, params })

let call = (name: string, args: Record<string, unknown> = {}) =>
  rpc('tools/call', { name, arguments: args })

test('the door answers the protocol, and signs what a tool writes', async () => {
  let graph = shopGraph()
  let door = mcp({ graph, authenticate: () => ada })

  let hello = await (await door(rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'shop', version: '0' },
  }))).json()
  assertEquals(hello.result.serverInfo.name, 'yaks')

  let listed = await (await door(rpc('tools/list'))).json()
  assert(listed.result.tools.length >= 4)

  let wrote = await door(call('graph_apply', {
    change: [{
      entity: { eid: 'b1' },
      book: { price: 12 },
      $actor: { by: 'villain' },
    }],
  }))
  assertEquals(wrote.status, 200)
  assertEquals(wrote.headers.get('content-type'), 'application/json')
  let said = await wrote.json()
  assertEquals(said.result.isError, undefined)

  let found: Bundle[] = await graph.read('.price=12&*')
  assertEquals(comp(found[0], 'created').by, 'm1')
})

test('a slow tool answers with its committed outcome', async () => {
  using time = new FakeTime()
  let graph = shopGraph()
  let started = Promise.withResolvers<void>()
  let finish = Promise.withResolvers<void>()
  graph.use({
    name: 'shelf',
    tools: [{
      name: 'shelve',
      description: 'put a book on the shelf',
      input: {},
      run: async () => {
        started.resolve()
        await finish.promise
        return [{ entity: { eid: 'b1' }, book: { status: 'shelved' } }]
      },
    }],
  })
  let door = mcp({ graph })
  let waiting = door(call('shelve'))
  await started.promise
  time.tick(60_001)
  finish.resolve()
  let reply = await waiting
  assertEquals(reply.status, 200)
  let said = await reply.json()
  assertEquals(said.result.isError, undefined)
  assertEquals(comp((await graph.get(['b1']))[0], 'book').status, 'shelved')
})

// A host with a face gives it to `initialize`, whole: MCP's `Implementation`
// carries a title, a line and the square picture beside the name, so a client
// that reads `serverInfo` shows this server without anybody typing it into a
// form. What is not passed is not sent — an absent field says nothing, an
// empty one says nothing is its name.
test('the door hands over the face it was given', async () => {
  let face = {
    name: 'shop.test',
    title: 'The Shop',
    description: 'Books, and what they cost.',
    websiteUrl: 'https://shop.test',
    icons: [{
      src: 'https://shop.test/icon.svg',
      mimeType: 'image/svg+xml',
      sizes: ['any'],
    }],
  }
  let door = mcp({ graph: shopGraph(), authenticate: () => ada, ...face })
  let hello = await (await door(rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'shop', version: '0' },
  }))).json()
  let info = hello.result.serverInfo
  for (let [key, want] of Object.entries(face)) {
    assertEquals(info[key], want, key)
  }

  let bare = mcp({ graph: shopGraph(), authenticate: () => ada })
  let plain = await (await bare(rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'shop', version: '0' },
  }))).json()
  assertEquals(plain.result.serverInfo.title, undefined)
  assertEquals(plain.result.serverInfo.icons, undefined)
})

test('a door that refuses to name a caller answers 401', async () => {
  let door = mcp({
    graph: shopGraph(),
    authenticate: () => {
      throw new Unauthorized('sign in first')
    },
  })
  let r = await door(rpc('tools/list'))
  assertEquals(r.status, 401)
  assertEquals((await r.json()).error, 'Unauthorized')
})

test('the door refuses what it does not serve', async () => {
  let door = mcp({ graph: shopGraph() })
  assertEquals((await door(new Request('http://shop.test/mcp'))).status, 405)
  assertEquals(
    (await door(post([{ jsonrpc: '2.0', id: 1, method: 'ping' }]))).status,
    400,
  )
  assertEquals((await door(post('not a request'))).status, 400)
  let broken = new Request('http://shop.test/mcp', {
    method: 'POST',
    body: '{',
  })
  assertEquals((await door(broken)).status, 400)
})

test('a notification is answered with nothing at all', async () => {
  let door = mcp({ graph: shopGraph() })
  let r = await door(
    post({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  )
  assertEquals(r.status, 202)
})

test('a caller-owned MCP session does not write into the tool graph', async () => {
  let g = sessionGraph()
  let door = mcp({ graph: g })
  let listed = await door(rpc('tools/list'))
  assertEquals(listed.status, 200)
  assertEquals(listed.headers.get('mcp-session-id'), null)
  assertEquals(await g.read('.session'), [])
})

test('an MCP connection writes through its own graph session', async () => {
  let g = sessionGraph()
  let door = mcp({ graph: g, sessions: g })
  let first = await door(rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'shop', version: '0' },
  }))
  let id = first.headers.get('mcp-session-id')
  assert(id)
  let [session] = await g.read(`.session.id=${JSON.stringify(id)}&*`)
  assertEquals(comp(session, 'session').id, id)

  let apply = () =>
    call('graph_apply', {
      change: [{ entity: { eid: 'b1' }, book: { price: 12 } }],
    })
  let resumed = mcp({ graph: g, sessions: g })
  let wrote = await resumed(
    new Request(apply(), {
      headers: { 'mcp-session-id': id },
    }),
  )
  assertEquals(wrote.status, 200)
  assertEquals(wrote.headers.get('mcp-session-id'), id)
  let made = comp((await g.get(['b1']))[0], 'created')
  assertEquals(made.by, session.entity.eid)
  assertEquals(made.via, session.entity.eid)
  assertEquals(
    (await g.read('.session&*')).map((b) => b.entity.eid),
    [session.entity.eid],
  )
  let unknown = await door(
    new Request(apply(), {
      headers: { 'mcp-session-id': crypto.randomUUID() },
    }),
  )
  assertEquals(unknown.status, 404)
})

test('authentication keeps its actor while the MCP session names the run', async () => {
  let g = sessionGraph()
  await g.apply([{ entity: { eid: 'm1' }, doc: { title: 'A member' } }])
  let door = mcp({ graph: g, sessions: g, authenticate: () => ({ by: 'm1' }) })
  let first = await door(rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'shop', version: '0' },
  }))
  let id = first.headers.get('mcp-session-id')
  assert(id)
  let [session] = await g.read(`.session.id=${JSON.stringify(id)}&*`)
  assertEquals(comp(session, 'session').actor, 'm1')
  await door(
    new Request(
      call('graph_apply', {
        change: [{ entity: { eid: 'b1' }, book: { price: 12 } }],
      }),
      { headers: { 'mcp-session-id': id } },
    ),
  )
  let made = comp((await g.get(['b1']))[0], 'created')
  assertEquals(made.by, 'm1')
  assertEquals(made.via, session.entity.eid)
})

test('x-via keeps its session, and a one-shot CLI call gets one', async () => {
  let g = sessionGraph()
  await g.apply([
    { entity: { eid: 'm1' }, doc: { title: 'A member' } },
    { entity: { eid: 's1' }, session: { id: 'harness-run', actor: 'm1' } },
  ])
  let door = mcp({
    graph: g,
    sessions: g,
    authenticate: sessionAuth({ graph: g }),
  })
  let change = (eid: string) =>
    call('graph_apply', {
      change: [{ entity: { eid }, book: { price: 12 } }],
    })

  let harness = await door(
    new Request(change('b1'), {
      headers: { 'x-via': 'harness-run' },
    }),
  )
  assertEquals(harness.headers.get('mcp-session-id'), null)
  assertEquals(comp((await g.get(['b1']))[0], 'created').by, 'm1')
  assertEquals(comp((await g.get(['b1']))[0], 'created').via, 's1')
  assertEquals((await g.read('.session')).length, 1)

  let cli = await door(change('b2'))
  let id = cli.headers.get('mcp-session-id')
  assert(id)
  let [session] = await g.read(`.session.id=${JSON.stringify(id)}&*`)
  let made = comp((await g.get(['b2']))[0], 'created')
  assertEquals(made.by, session.entity.eid)
  assertEquals(made.via, session.entity.eid)
})

test('what the host owes a direct call rides after the answer, which is unchanged', async () => {
  let door = routes({
    config: {},
    graph: shopGraph(),
    who: () => ada,
    tools: [],
    reply: (_call, _answer, wrote) =>
      Promise.resolve(wrote.map((b) => ({
        entity: { eid: 'b0' },
        hit: { kind: 'book', snippet: '', source: 'text', near: b.entity.eid },
      }))),
  })[0].handle
  let said = await (await door(call('graph_apply', {
    change: [{ entity: { eid: 'b1' }, book: { price: 12 } }],
  }))).json()
  let [made, near] = said.result.structuredContent.result as Bundle[]
  assertEquals([made.entity.eid, made.book], ['b1', { price: 12 }])
  assertEquals(near.entity.eid, 'b0')
  assert(said.result.content[0].text.includes('near b1: b0 · book'))
})

test('a call is answered while a subscriber is still reading what it wrote', async () => {
  let g = shopGraph()
  // A host's subscribers read through its read thread (@yaks/api `handler`);
  // this one is held there, the way a busy thread holds it.
  let gate: Promise<void> | undefined
  let held = <T>(v: T | Promise<T>) => gate ? gate.then(() => v) : v
  let subs = subscriptions({
    ...g,
    read: (q, o) => held(g.read(q, o)),
    get: (eids, comps) => held(g.get(eids, comps)),
  })
  let heard: string[] = []
  await subs.open(
    (f) => heard.push(...(f.bundles ?? []).map((b) => b.entity.eid)),
    'books',
    '.book',
  )
  let hold = Promise.withResolvers<void>()
  gate = hold.promise
  let door = routes({ config: {}, graph: g, who: () => ada, tools: [] })[0]
    .handle
  let said: { result: { structuredContent: { result: Bundle[] } } } | undefined
  let asked = door(call('graph_apply', {
    change: [{ entity: { eid: 'b1' }, book: { price: 12 } }],
  }))
  Promise.resolve(asked).then(async (r) => said = await r.json())
  try {
    await until(() => said, { label: 'the answer' })
    assertEquals(said!.result.structuredContent.result[0].entity.eid, 'b1')
    assertEquals(heard, [])
  } finally {
    hold.resolve()
  }
  await subs.snapshot('.book')
  assertEquals(heard, ['b1'])
})

test('initialize carries instructions from the loaded vocabularies', async () => {
  let vocab = loadVocab([
    { ...shop.docs[0], instructions: 'Read the shelf.' },
    { ...shop.docs[1], instructions: 'Keep each sale.' },
  ])
  let g = graph({ storage: ram(vocab), vocab })
  let door = routes({ config: {}, graph: g, who: () => null, tools: [] })[0]
    .handle
  let hello = await (await door(rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'shop', version: '0' },
  }))).json()
  assertEquals(
    hello.result.instructions,
    `${graphDoc.instructions}\n\nRead the shelf.\n\nKeep each sale.`,
  )
})
