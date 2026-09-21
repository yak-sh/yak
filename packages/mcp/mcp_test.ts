/// <reference lib="deno.ns" />
// The tool surface, end to end, through the SDK's own client: what is listed,
// what a call answers, and whose name is on what it wrote. The client validates
// every structured reply against the tool's published outputSchema, so a
// schema that stopped describing its answer fails here.

import { assert, assertEquals } from '@std/assert'
import { z } from 'zod'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/harness.ts'
import { comp, connect, result, shopGraph, text } from './harness.ts'
import { roster } from './server.ts'
import { rosterLine, rosterVersion } from './roster.ts'

let ada = { by: 'm1' }
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

Deno.test('a read-only door lists no write, and its reads take its scope', async () => {
  // The write is not a tool that refuses — it is not there at all, which is
  // what a door anybody may call has to be able to say.
  let client = await connect({
    readOnly: true,
    search: () => [spring],
    scope: { shelf: z.string().describe('which shelf to read') },
  })
  let tools = (await client.listTools()).tools as {
    name: string
    inputSchema: { properties: Record<string, unknown>; required?: string[] }
  }[]
  assertEquals(tools.map((t) => t.name).sort(), [
    'graph_query',
    'graph_schema',
    'graph_show',
    'search',
  ])
  // Every read says what to name it by, beside its own arguments — and the
  // tool never looks at it: the door read it off the call and built the graph
  // it names before this server saw the request.
  for (let t of tools) {
    assert(t.inputSchema.properties.shelf, `${t.name} says no shelf`)
    assertEquals(t.inputSchema.required?.includes('shelf'), true, t.name)
  }
  assert(tools.find((t) => t.name == 'graph_query')!.inputSchema.properties.q)
  let out = await called(client, 'search', { shelf: 'poetry', words: 'spring' })
  assertEquals(bundles(result(out))[0].entity.eid, 'b1')
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
  let client = await connect({ actor: ada })
  let wrote = bundles(result(
    await called(client, 'graph_apply', {
      change: [spring],
    }),
  ))
  // One bundle for the one entity — its components, its number and its stamp
  // together — and no `$actor`, which is the pipeline's and stops in apply()
  // (T-34294).
  assertEquals(wrote.length, 1)
  assertEquals(wrote[0].entity.eid, 'b1')
  assertEquals(typeof wrote[0].entity.num, 'number')
  assertEquals(comp(wrote[0], 'book').price, 12)
  assertEquals(comp(wrote[0], 'created').by, 'm1')
  assertEquals(wrote[0].$actor, undefined)

  // A mint answers the word the caller named it by, and a delete answers the
  // tombstone alone.
  let [minted] = bundles(result(
    await called(client, 'graph_apply', {
      change: [{ entity: { eid: '$new' }, doc: { title: 'Emma' } }],
    }),
  ))
  assertEquals(minted.$alias, '$new')
  assert(minted.entity.eid != '$new')
  let [died] = bundles(result(
    await called(client, 'graph_apply', {
      change: [{ entity: { eid: minted.entity.eid }, $delete: true }],
    }),
  ))
  assertEquals(died, {
    entity: { eid: minted.entity.eid },
    tombstone: {},
  })

  let found = bundles(result(
    await called(client, 'graph_query', {
      q: '.price<20',
    }),
  ))
  assertEquals(found.map((b) => b.entity.eid), ['b1'])
  assertEquals(found[0].doc, { title: 'The Left Hand of Spring' })
})

Deno.test('a checked batch says what would land and keeps none of it', async () => {
  let g = shopGraph()
  let client = await connect({ graph: g, actor: ada })
  let out = await called(client, 'graph_apply', {
    change: [{ entity: { eid: '$new' }, doc: { title: 'Emma' } }],
    check: true,
  })
  assertEquals(out.isError, undefined)
  // A rehearsal cannot answer bundles — the runner lands what a tool answers
  // — so it answers what WOULD have landed, in words.
  let said = JSON.parse(
    String(comp(bundles(result(out))[0], 'content').body),
  ) as Bundle[]
  assertEquals(said[0].$alias, '$new')
  assert(said[0].entity.eid != '$new')
  assertEquals(await g.read('.doc.title="Emma"'), [])
  // And a batch it would refuse is refused, rehearsal or not.
  let no = await called(client, 'graph_apply', {
    change: [{ entity: { eid: 'b1' }, book: { colour: 'red' } }],
    check: true,
  })
  assertEquals(no.isError, true)
  assert(text(no).includes('colour'))
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
  let graph = shopGraph()
  let client = await connect({ graph, actor: ada })
  await called(client, 'graph_apply', {
    change: [{ ...spring, $actor: { by: 'villain' } }],
  })
  // What LANDED is what this is about: the call was written as the door's
  // actor, and the runner signed the tool's bundles with the same name.
  assertEquals(comp((await graph.read('.price=12'))[0], 'created').by, 'm1')
})

Deno.test('a tool runs as whoever called it', async () => {
  let graph = shopGraph()
  let seen: string | null = null
  graph.use({
    name: 'shelf',
    tools: [{
      name: 'shelve',
      description: 'put a book on the shelf',
      input: {},
      run: (_, ctx) => {
        seen = ctx.actor?.by ?? null
        return [{ entity: { eid: 'b1' }, book: { status: 'shelved' } }]
      },
    }],
  })
  let client = await connect({ graph, actor: ada })
  await called(client, 'shelve')
  // The tool was handed the caller, not the process running it…
  assertEquals(seen, 'm1')
  // …and what it answered is written in that name.
  let [shelved] = await graph.read('.status=shelved')
  assertEquals(comp(shelved, 'created').by, 'm1')
  await client.close()
})

Deno.test('an unattributed server leaves the actor off', async () => {
  let graph = shopGraph()
  let client = await connect({ graph })
  await called(client, 'graph_apply', {
    change: [{ ...spring, $actor: { by: 'villain' } }],
  })
  assertEquals(
    comp((await graph.read('.price=12'))[0], 'created').by,
    undefined,
  )
})

Deno.test('graph_show answers only bundles, including what points at the entity', async () => {
  let graph = shopGraph()
  await graph.apply([spring, {
    entity: { eid: 'r1' },
    review: { stars: 5, book: 'b1' },
  }])
  let client = await connect({ graph })
  let out = bundles(result(await called(client, 'graph_show', { ids: ['b1'] })))
  assertEquals(out.map((b) => b.entity.eid), ['b1', 'r1'])
  assertEquals(comp(out[1], 'review'), { stars: 5, book: 'b1' })

  let alone = bundles(result(
    await called(client, 'graph_show', {
      ids: ['b1'],
      backrefs: false,
    }),
  ))
  assertEquals(alone.map((b) => b.entity.eid), ['b1'])
  await client.close()
})

// The backlinks are asked as `.refs=`, which is ONE term per reference column,
// and workerd's SQLite takes five terms in a compound (@yaks/sql `ARMS`). So
// the shape that broke — backrefs on, over a compiled store whose vocabulary
// references more than five ways — is held here, through the tool.
let wideDoc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' } },
    },
    ...Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`n${i}`, {
        component: true,
        type: 'object',
        properties: {
          of: { type: 'string', ref: 'entity', death: 'detach' },
        },
      }]),
    ),
  } as VocabDoc['$defs'],
}

Deno.test('graph_show gathers backrefs over a vocabulary wider than a compound', async () => {
  let wide = loadVocab([wideDoc, toolsDoc])
  let store = storage(mem(), wide)
  store.install()
  let g = graph({ storage: store, vocab: wide })
  await g.apply([
    { entity: { eid: 'a1' }, doc: { title: 'the target' } },
    { entity: { eid: 'b1' }, n3: { of: 'a1' } },
    { entity: { eid: 'b2' }, n8: { of: 'a1' } },
  ])
  let client = await connect({ graph: g })
  let out = bundles(result(
    await called(client, 'graph_show', { ids: ['a1'], backrefs: true }),
  ))
  assertEquals(out.map((b) => b.entity.eid).sort(), ['a1', 'b1', 'b2'])
  await client.close()
})

// The three sizes are words_test.ts's; this is only that the tool is listed
// and answers the vocabulary it was built over.
Deno.test('graph_schema hands over the words of this graph', async () => {
  let client = await connect()
  // A vocabulary is not rows in the store it describes, so the schema comes
  // back as the one thing it can be: prose, in a content bundle.
  let out = JSON.parse(text(await called(client, 'graph_schema'))) as {
    comps: { name: string }[]
    kinds: string[]
  }
  assertEquals(out.comps.map((c) => c.name), [
    'book',
    'call',
    'content',
    'created',
    'doc',
    'entity',
    'error',
    'exception',
    'execution',
    'output',
    'result',
    'review',
    'tool',
    'updated',
  ])
  assertEquals(out.kinds, ['book', 'doc', 'review', 'tool'])
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
      run: () => [{ entity: { eid: 'b1' }, book: { status: 'shelved' } }],
    }],
  })
  let client = await connect({ graph, actor: ada })
  let names = await listed(client)
  assert(names.includes('shelve'))
  let out = bundles(result(await called(client, 'shelve')))
  assertEquals(out.map((b) => b.entity.eid), ['b1'])
  let found = bundles(result(
    await called(client, 'graph_query', {
      q: '.status=shelved',
    }),
  ))
  assertEquals(found.map((b) => b.entity.eid), ['b1'])
  assertEquals(
    comp((await graph.read('.status=shelved'))[0], 'created').by,
    'm1',
  )
})

Deno.test('a tool whose answer is words says them as content, and its bundles beside', async () => {
  let graph = shopGraph()
  graph.use({
    name: 'shelf',
    tools: [{
      name: 'stocktake',
      description: 'count the shelf',
      meta: { ui: { resourceUri: 'ui://shop/shelf' } },
      // An answer that is not entities is the one entity it can be: prose
      // that says which call produced it.
      run: (_, ctx) => [{
        entity: { eid: '$said' },
        content: { body: 'two books here' },
        output: { source: ctx.call },
      }],
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

  let out = await called(client, 'stocktake')
  // The words are the reply's text; the bundle that carried them is its
  // structure, and it says which call it came from.
  assertEquals(text(out), 'two books here')
  let [said] = bundles(result(out))
  assertEquals(comp(said, 'content').body, 'two books here')
  let [call] = await graph.read('.call')
  assertEquals(comp(said, 'output').source, call.entity.eid)
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

Deno.test('every tool says how a client signs in for it', async () => {
  // Nothing said, nothing declared: a server whose tools need no sign-in
  // leaves the field off rather than guessing at one. The words the tier
  // declared still ride there — `_meta` is where a spelling lives too.
  let plain = await connect()
  let quiet = (await plain.listTools()).tools as {
    _meta?: { securitySchemes?: unknown }
  }[]
  assertEquals(
    quiet.map((t) => t._meta?.securitySchemes),
    quiet.map(() => undefined),
  )
  await plain.close()

  // A door that needs signing in says so on EVERY tool it lists — the generic
  // tier included, which no host writes out — and a tool that declares its own
  // schemes keeps them, which is how one mixed-auth surface offers an open
  // tool beside closed ones.
  let graph = shopGraph()
  graph.use({
    name: 'shelf',
    tools: [{
      name: 'about',
      description: 'what this shop is',
      input: {},
      meta: { securitySchemes: [{ type: 'noauth' }] },
      run: (_, ctx) => [{
        entity: { eid: '$said' },
        content: { body: 'a bookshop' },
        output: { source: ctx.call },
      }],
    }, {
      name: 'shelve',
      description: 'put a book on the shelf',
      input: {},
      meta: { ui: { resourceUri: 'ui://shelf' } },
      run: (_, ctx) => [{
        entity: { eid: '$said' },
        content: { body: 'shelved' },
        output: { source: ctx.call },
      }],
    }],
  })
  let client = await connect({
    graph,
    security: [{ type: 'oauth2', scopes: ['shop'] }],
  })
  let said = new Map(
    ((await client.listTools()).tools as {
      name: string
      _meta?: { securitySchemes?: unknown; ui?: unknown }
    }[]).map((t) => [t.name, t._meta]),
  )
  assertEquals(said.get('graph_query')?.securitySchemes, [{
    type: 'oauth2',
    scopes: ['shop'],
  }])
  assertEquals(said.get('about')?.securitySchemes, [{ type: 'noauth' }])
  // The schemes JOIN what the tool already said; they never replace it.
  assertEquals(said.get('shelve')?.ui, { resourceUri: 'ui://shelf' })
  assertEquals(said.get('shelve')?.securitySchemes, [{
    type: 'oauth2',
    scopes: ['shop'],
  }])
  await client.close()
})
