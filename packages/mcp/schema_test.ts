/// <reference lib="deno.ns" />
// The two schemas a client receives. The write door's input is the vocabulary:
// every component, every writable property and every type, before an agent
// guesses at one (T-34153). Every tool whose answer is entities answers the
// one bundle shape (server.ts `answerSchema`), listed on all of them, and a
// host holds us to it — it compiles the schema off `tools/list` and refuses a
// reply that does not match — so the answers are checked here against the
// schema as published. `graph_schema` answers a vocabulary document, and
// publishes the meta-schema instead.

import { assertEquals } from '@std/assert'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { z } from 'zod'
import { argsOf } from '@yaks/graph'
import { CallError } from '@yaks/tools'
import { connect, shopGraph } from './testing.ts'

// graph_apply's published input schema — the write door as a client reads it.
let writing = async () => {
  let client = await connect()
  let { tools } = await client.listTools()
  let tool = tools.find((t: { name: string }) => t.name == 'graph_apply')
  await client.close()
  return tool!.inputSchema as {
    properties: { change: { items: Record<string, unknown> } }
  }
}

let at = (o: unknown, ...keys: string[]): unknown =>
  keys.reduce(
    (v, k) =>
      v && typeof v == 'object' && k in v
        ? (v as Record<string, unknown>)[k]
        : undefined,
    o,
  )

Deno.test('every tool publishes its answer, and its answers fit it', async () => {
  let client = await connect({
    graph: shopGraph(),
    search: () => [{ entity: { eid: 'b1' }, doc: { title: 'Spring' } }],
    // A tool that refuses, for the other half of the contract.
    tools: [{
      name: 'shelve',
      description: 'Shelve a book',
      input: { where: z.string() },
      run: () => {
        throw new CallError('shelf', 'no such shelf')
      },
    }],
  })
  let { tools } = await client.listTools()
  let schemas = Object.fromEntries(
    tools.map((t: { name: string; outputSchema?: unknown }) => [
      t.name,
      t.outputSchema,
    ]),
  )
  // One shape on every tool whose answer is entities, whichever tier it came
  // from, and the meta-schema on the one whose answer is a vocabulary.
  let { graph_schema: meta, ...bundled } = schemas
  assertEquals(
    new Set(Object.values(bundled).map((s) => JSON.stringify(s))).size,
    1,
  )
  assertEquals(at(meta, '$id'), 'https://yak.sh/vocab/meta')
  // Compiled the way a host compiles it, off the listing and nothing else.
  let validator = new AjvJsonSchemaValidator()
  let held = (out: { structuredContent?: unknown }, name: string) =>
    assertEquals(
      validator.getValidator(
        schemas[name] as Parameters<AjvJsonSchemaValidator['getValidator']>[0],
      )(out.structuredContent).errorMessage,
      undefined,
      name,
    )

  // The success path: a write, echoed back as the transaction it applied —
  // its components, and the `$alias` the minted entity was asked for by.
  let made = await client.callTool({
    name: 'graph_apply',
    arguments: {
      change: [{
        entity: { eid: '$b' },
        doc: { title: 'Dune' },
        book: { price: 9 },
      }],
    },
  })
  held(made, 'graph_apply')
  let eid = String(
    at(made.structuredContent, 'result', '0', 'entity', 'eid') ?? '',
  )
  for (
    let [name, args] of [
      ['graph_query', { q: 'book' }],
      ['graph_show', { ids: [eid] }],
      ['graph_schema', {}],
      ['search', { words: 'spring' }],
    ] as [string, Record<string, unknown>][]
  ) held(await client.callTool({ name, arguments: args }), name)

  // The refusal path, which a client does not check for us: a refusal is
  // bundles too — the fault the runner recorded — and it is held to the same
  // schema.
  let no = await client.callTool({
    name: 'shelve',
    arguments: { where: 'nowhere' },
  })
  assertEquals(no.isError, true)
  held(no, 'shelve')
  await client.close()
})

Deno.test('graph_apply takes the vocabulary, typed and described', async () => {
  let schema = await writing()
  let book = at(schema, 'properties', 'change', 'items', 'properties', 'book')
  let props = at(book, 'anyOf', '0', 'properties')
  assertEquals(Object.keys(props as object), ['price', 'status', 'author'])
  assertEquals(at(props, 'price', 'type'), ['number', 'null'])
  assertEquals(at(props, 'price', 'description'), 'what it costs, in pounds')
  assertEquals(at(props, 'status', 'anyOf', '0', 'enum'), [
    'draft',
    'shelved',
    'sold',
  ])
  // The two sugars a batch may say beside its components.
  let items = at(schema, 'properties', 'change', 'items', 'properties')
  assertEquals(at(items, '$delete', 'type'), 'boolean')
  assertEquals(at(items, '$was', 'type'), 'object')
  assertEquals(at(items, 'entity', 'required'), ['eid'])
})

// A host whose door takes a property differently than the vocabulary declares
// says so once, and the write schema is derived through it — yaks.app takes an
// id for a reference (agent.ts `reading`).
Deno.test('a host states its own reading of a property on the write door', async () => {
  let client = await connect({
    prop: (prop, o) =>
      prop.category == 'ref' && !o.write
        ? z.object({ eid: z.string() }).passthrough()
        : undefined,
  })
  let { tools } = await client.listTools()
  let schema = tools.find((t: { name: string }) => t.name == 'graph_apply')
    ?.inputSchema
  await client.close()
  let author = at(
    schema,
    'properties',
    'change',
    'items',
    'properties',
    'book',
    'anyOf',
    '0',
    'properties',
    'author',
  )
  assertEquals(at(author, 'type'), ['string', 'null'])
})

Deno.test('the write door names its own words, and stays open to newer ones', async () => {
  let schema = await writing()
  let comp = (name: string) =>
    at(
      schema,
      'properties',
      'change',
      'items',
      'properties',
      name,
      'anyOf',
      '0',
    )
  // `created.at` and `created.by` are the server's own, so they are named and
  // never typed: a client that read a bundle and sent it back is not punished
  // for the stamps riding along, and nothing invites it to write one.
  assertEquals(at(comp('created'), 'properties'), { at: {}, by: {} })
  // And each component is open (T-34277): a client caches this schema with the
  // tool list it came in and the vocabulary grows under it, so a closed one
  // would have that stale copy refuse a property that now exists. The schema
  // describes; the server decides, and says which properties are declared.
  assertEquals(at(comp('book'), 'additionalProperties'), true)
})

Deno.test('a JSON Schema input declaration reaches the listing unchanged', async () => {
  let inputSchema = {
    type: 'object',
    required: ['shelf'],
    additionalProperties: false,
    properties: { shelf: { type: 'string' } },
  }
  let client = await connect({
    tools: [{
      name: 'count_books',
      description: 'Count a shelf',
      inputSchema,
      run: (call) => [{
        entity: { eid: '$said' },
        content: { body: `two on ${argsOf(call).shelf}` },
        output: { source: call.entity.eid },
      }],
    }],
  })
  try {
    let { tools } = await client.listTools()
    assertEquals(
      tools.find((t: { name: string }) => t.name == 'count_books')?.inputSchema,
      inputSchema,
    )
    // And the runner checks the call against it before the tool ever runs.
    let good = await client.callTool({
      name: 'count_books',
      arguments: { shelf: 'poetry' },
    })
    assertEquals((good.content as { text: string }[])[0].text, 'two on poetry')
    let bad = await client.callTool({ name: 'count_books', arguments: {} })
    assertEquals(bad.isError, true)
  } finally {
    await client.close()
  }
})
