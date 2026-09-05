/// <reference lib="deno.ns" />
// The tool surface, end to end, through the SDK's own client: what is listed,
// what a call answers, and whose name is on what it wrote. The client validates
// every structured reply against the tool's published outputSchema, so a
// schema that stopped describing its answer fails here.

import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { comp, connect, result, shopGraph } from './harness.ts'

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
  assertEquals(names, ['graph_apply', 'graph_query', 'graph_show', 'vocab'])
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

Deno.test('vocab hands over the loaded documents', async () => {
  let client = await connect()
  let out = result(await called(client, 'vocab'))
  assert(out && typeof out == 'object' && 'comps' in out && 'docs' in out)
  assertEquals(out.comps, ['book', 'created', 'doc', 'review', 'updated'])
  assert(Array.isArray(out.docs) && out.docs.length == 1)
})

Deno.test('a refusal is the tool error the agent reads, not a broken call', async () => {
  let client = await connect()
  let out = await called(client, 'graph_apply', { change: [{ book: {} }] })
  assertEquals(out.isError, true)
  assert(Array.isArray(out.content))
  assert(String(out.content[0].text).includes('needs an entity'))

  let refused = await called(client, 'graph_apply', {
    change: [{ entity: { eid: 'b1' }, book: { colour: 'red' } }],
  })
  assertEquals(refused.isError, true)
  assert(String(refused.content[0].text).includes('book.colour'))
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
