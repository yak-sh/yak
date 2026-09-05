/// <reference lib="deno.ns" />
// The tool surface, end to end, through the SDK's own client: what is listed,
// what a call answers, and whose name is on what it wrote. The client validates
// every structured reply against the tool's published outputSchema, so a
// schema that stopped describing its answer fails here.

import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { comp, connect, result, shopGraph } from './harness.ts'
import { roster, Say } from './server.ts'
import { rosterLine, rosterVersion } from './roster.ts'

let ada = { eid: 'm1' }
let spring: Bundle = {
  entity: { eid: 'b1' },
  doc: { title: 'The Left Hand of Spring' },
  book: { price: 12, status: 'shelved' },
}

let bundles = (out: unknown): Bundle[] => {
  assert(Array.isArray(out), 'expected bundles')
  return out
}

// The tool names a client is offered. `listTools()` answers a loosely typed
// result, so the row shape is named here rather than inferred.
let listed = async (
  client: Awaited<ReturnType<typeof connect>>,
): Promise<string[]> =>
  (await client.listTools()).tools.map((t: { name: string }) => t.name)

let called = async (
  client: Awaited<ReturnType<typeof connect>>,
  name: string,
  args: Record<string, unknown> = {},
) => await client.callTool({ name, arguments: args })

Deno.test('the generic tier is what it lists', async () => {
  let client = await connect()
  let names = (await listed(client)).sort()
  assertEquals(names, [
    'graph_apply',
    'graph_query',
    'graph_schema',
    'graph_show',
  ])
  await client.close()
})

Deno.test('a search seam adds its tool, and answers through it', async () => {
  let client = await connect({ search: () => [spring] })
  let names = await listed(client)
  assert(names.includes('search'))
  let out = await called(client, 'search', { words: 'spring' })
  assertEquals(bundles(result(out))[0].entity.eid, 'b1')
  await client.close()
})

Deno.test('a batch applied comes back as it landed, and reads back', async () => {
  let client = await connect()
  let wrote = bundles(result(
    await called(client, 'graph_apply', {
      change: [spring],
    }),
  ))
  assertEquals(wrote[0].entity.eid, 'b1')

  let found = bundles(result(
    await called(client, 'graph_query', {
      q: '.price<20',
    }),
  ))
  assertEquals(found.map((b) => b.entity.eid), ['b1'])
  assertEquals(found[0].doc, { title: 'The Left Hand of Spring' })
})

Deno.test('an applied batch may drop a component, and says so', async () => {
  let client = await connect()
  await called(client, 'graph_apply', { change: [spring] })
  let out = await called(client, 'graph_apply', {
    change: [{ entity: { eid: 'b1' }, doc: null }],
  })
  assertEquals(out.isError, undefined)
  assertEquals(bundles(result(out))[0].doc, null)
})

Deno.test('filters and limit join the query line', async () => {
  let client = await connect()
  await called(client, 'graph_apply', {
    change: [spring, { entity: { eid: 'b2' }, book: { price: 40 } }],
  })
  let found = bundles(result(
    await called(client, 'graph_query', {
      q: '.price!',
      filters: ['.price<20'],
      limit: 5,
    }),
  ))
  assertEquals(found.map((b) => b.entity.eid), ['b1'])
})

Deno.test('the server signs the batch, never the client', async () => {
  let client = await connect({ actor: ada })
  await called(client, 'graph_apply', {
    change: [{ ...spring, $actor: { by: 'villain' } }],
  })
  let found = bundles(result(
    await called(client, 'graph_query', {
      q: '.price=12',
    }),
  ))
  assertEquals(comp(found[0], 'created').by, 'm1')
})

Deno.test('an unattributed server leaves the actor off', async () => {
  let client = await connect()
  await called(client, 'graph_apply', {
    change: [{ ...spring, $actor: { by: 'villain' } }],
  })
  let found = bundles(result(
    await called(client, 'graph_query', {
      q: '.price=12',
    }),
  ))
  assertEquals(comp(found[0], 'created').by, undefined)
})

Deno.test('graph_show answers the entity, what points at it, and the edges', async () => {
  let graph = shopGraph()
  await graph.apply([spring, {
    entity: { eid: 'r1' },
    review: { stars: 5, book: 'b1' },
  }])
  let client = await connect({ graph })
  let out = result(await called(client, 'graph_show', { ids: ['b1'] }))
  assert(out && typeof out == 'object' && 'bundles' in out && 'edges' in out)
  assertEquals(bundles(out.bundles).map((b) => b.entity.eid), ['b1', 'r1'])
  assertEquals(out.edges, [{
    from: 'r1',
    to: 'b1',
    comp: 'review',
    prop: 'book',
  }])

  let alone = result(
    await called(client, 'graph_show', {
      ids: ['b1'],
      backrefs: false,
    }),
  )
  assert(alone && typeof alone == 'object' && 'bundles' in alone)
  assertEquals(bundles(alone.bundles).map((b) => b.entity.eid), ['b1'])
})

// The three sizes are words_test.ts's; this is only that the tool is listed
// and answers the vocabulary it was built over.
Deno.test('graph_schema hands over the words of this graph', async () => {
  let client = await connect()
  let out = result(await called(client, 'graph_schema')) as {
    comps: { name: string }[]
    kinds: string[]
  }
  assertEquals(out.comps.map((c) => c.name), [
    'book',
    'created',
    'doc',
    'entity',
    'review',
    'updated',
  ])
  assertEquals(out.kinds, ['book', 'doc', 'review'])
})

Deno.test('a refusal is the tool error the agent reads, not a broken call', async () => {
  let client = await connect()
  // The write door's schema IS the vocabulary (T-34153), so a bundle with no
  // identity and a value of the wrong type are each refused where they were
  // typed — with the path that names them.
  let said = async (change: unknown) => {
    let out = await called(client, 'graph_apply', { change })
    assertEquals(out.isError, true)
    assert(Array.isArray(out.content))
    return String(out.content[0].text)
  }
  assert((await said([{ book: {} }])).includes('"entity"'))
  // A column nobody declared is the SERVER's refusal, not the schema's: the
  // schema is open so a client's cached copy cannot refuse a word this graph
  // has since learned. It names the columns that do exist, and where to read
  // them (T-34277).
  let colour = await said([{ entity: { eid: 'b1' }, book: { colour: 'red' } }])
  assert(colour.includes('unknown column: book.colour'), colour)
  assert(colour.includes('book declares price, status, author'), colour)
  assert(colour.includes('graph_schema'), colour)
  let price = await said([{ entity: { eid: 'b1' }, book: { price: 'lots' } }])
  assert(price.includes('Expected number'), price)

  // And what the schema cannot see — a batch that is not an array of bundles
  // at all — the tool still says for itself.
  let bare = await called(client, 'graph_apply', { change: 'a book' })
  assertEquals(bare.isError, true)
})

Deno.test('a plugin contributes tools the way it contributes components', async () => {
  let graph = shopGraph()
  graph.use({
    name: 'shelf',
    tools: [{
      name: 'shelve',
      description: 'put a book on the shelf',
      input: {},
      run: (_args, ctx) =>
        ctx.apply([{ entity: { eid: 'b1' }, book: { status: 'shelved' } }]),
    }],
  })
  let client = await connect({ graph, actor: ada })
  let names = await listed(client)
  assert(names.includes('shelve'))
  await called(client, 'shelve')
  let found = bundles(result(
    await called(client, 'graph_query', {
      q: '.status=shelved',
    }),
  ))
  assertEquals(found.map((b) => b.entity.eid), ['b1'])
  assertEquals(comp(found[0], 'created').by, 'm1')
})

Deno.test('a tool that says its own words says them, and its data beside', async () => {
  let graph = shopGraph()
  graph.use({
    name: 'shelf',
    tools: [{
      name: 'stocktake',
      description: 'count the shelf',
      meta: { ui: { resourceUri: 'ui://shop/shelf' } },
      run: () => new Say('two books here', { books: 2 }),
    }],
  })
  let client = await connect({ graph })
  let [tool] = (await client.listTools()).tools
    .filter((t: { name: string }) => t.name == 'stocktake')
  // The metadata rides to the client verbatim: it is the transport's to carry
  // and nobody else's to read.
  assertEquals(
    (tool as { _meta?: unknown })._meta,
    { ui: { resourceUri: 'ui://shop/shelf' } },
  )

  let out = await called(client, 'stocktake') as {
    content: { text: string }[]
    structuredContent?: unknown
  }
  assertEquals(out.content[0].text, 'two books here')
  // Unwrapped — a host that renders this was told which page to render it in.
  assertEquals(out.structuredContent, { books: 2 })
  await client.close()
})

// The ROSTER (T-34277): a client lists the tools once and holds that list, so
// a tool a release added is one it will never call and one that went is one it
// calls into a refusal. The version names the list, the host remembers which
// one a session connected under, and every result carries the diff.
Deno.test('the roster version moves with the names and with the release', () => {
  let a = ['graph_query', 'about']
  assertEquals(rosterVersion(a, 'v1'), rosterVersion([...a].reverse(), 'v1'))
  assert(rosterVersion(a, 'v1') != rosterVersion([...a, 'mail_send'], 'v1'))
  assert(rosterVersion(a, 'v1') != rosterVersion(a, 'v2'))
})

Deno.test('the line names what moved, and says nothing when nothing did', () => {
  assertEquals(rosterLine(['about'], ['about']), undefined)
  assertEquals(
    rosterLine(['about', 'vocab'], ['about', 'mail_list', 'mail_send']),
    'The tool list changed since you connected (new: mail_list, mail_send; ' +
      'gone: vocab). Reconnect to see them, or ask `about`.',
  )
})

Deno.test('a session that connected against another roster is told, once', async () => {
  let graph = shopGraph()
  // What this client cached at connect — a roster from before the release
  // that added `search` and took `vocab` away. It is the host that remembers
  // this; here it is a variable.
  let now = roster({ graph, search: () => [] })
  let was: string[] = [...now.filter((n) => n != 'search'), 'vocab']
  let told = 0
  let client = await connect({
    graph,
    search: () => [],
    roster: (names) => {
      let line = rosterLine(was, names)
      if (line) {
        told++
        was = names // once per changed set, not once per call
      }
      return line
    },
  })
  let out = await called(client, 'graph_query', { q: '.price!' })
  let blocks = out.content as { text: string }[]
  assertEquals(blocks.length, 2)
  assertEquals(
    blocks[1].text,
    'The tool list changed since you connected (new: search; gone: vocab). ' +
      'Reconnect to see them, or ask `about`.',
  )
  // The answer itself is untouched — a described value stays parsable.
  assertEquals(JSON.parse(blocks[0].text), [])
  // Once per changed set: the next reply is quiet again.
  let quiet = await called(client, 'graph_query', { q: '.price!' })
  assertEquals((quiet.content as { text: string }[]).length, 1)
  assertEquals(told, 1)
  await client.close()
})

Deno.test('a host with more than tools registers them on the same server', async () => {
  let client = await connect({
    extend: (server) =>
      void server.registerResource('shelf', 'shop://shelf', {
        title: 'The shelf',
        mimeType: 'text/plain',
      }, () => ({
        contents: [{ uri: 'shop://shelf', text: 'one book' }],
      })),
  })
  let { resources } = await client.listResources()
  assertEquals(resources.map((r: { uri: string }) => r.uri), ['shop://shelf'])
  let read = await client.readResource({ uri: 'shop://shelf' })
  assertEquals((read.contents[0] as { text: string }).text, 'one book')
  // And the tools are still there beside them.
  assert((await listed(client)).includes('graph_query'))
  await client.close()
})
