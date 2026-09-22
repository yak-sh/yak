/// <reference lib="deno.ns" />
// The write door's schema, as a client receives it. A tool's answer has no
// schema any more — it is bundles, and what a bundle is the vocabulary
// already says — so what is published is the one schema a client writes
// against, and it is the vocabulary: every component, every writable column
// and every type, before an agent guesses at one (T-34153).

import { assertEquals } from '@std/assert'
import { z } from 'zod'
import { connect } from './harness.ts'

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

Deno.test('no tool publishes an output schema: an answer is bundles', async () => {
  let client = await connect({ search: () => [] })
  let { tools } = await client.listTools()
  assertEquals(
    tools.map((t: { outputSchema?: unknown }) => t.outputSchema),
    tools.map(() => undefined),
  )
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

// A host whose door takes a column differently than the vocabulary declares
// says so once, and the write schema is derived through it — yaks.app takes an
// id for a reference (agent.ts `reading`).
Deno.test('a host spells its own reading of a column on the write door', async () => {
  let client = await connect({
    column: (col, o) =>
      col.category == 'ref' && !o.write
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
  // would have that stale copy refuse a column that now exists. The schema
  // describes; the server decides, and says which columns are declared.
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
      run: (_, ctx) => [{
        entity: { eid: '$said' },
        content: { body: `two on ${ctx.args.shelf}` },
        output: { source: ctx.call },
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
