/// <reference lib="deno.ns" />
// The two schemas a client receives. The write door's input is the generic
// bundle, whatever the vocabulary, and a client that checks a call against it
// must pass every bundle the server takes. Every tool whose answer is entities
// answers the
// one bundle shape (server.ts `answerSchema`), listed on all of them, and a
// host holds us to it — it compiles the schema off `tools/list` and refuses a
// reply that does not match — so the answers are checked here against the
// schema as published. `graph_schema` answers a vocabulary document, and
// publishes the meta-schema instead.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { z } from 'zod'
import { argsOf } from '@yaks/graph'
import { CallError } from '@yaks/tools'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { server } from './server.ts'
import { core, inputSchemaOf } from './tools.ts'
import { connect, pinned, shop, shopGraph } from './testing.ts'

let at = (o: unknown, ...keys: string[]): unknown =>
  keys.reduce(
    (v, k) =>
      v && typeof v == 'object' && k in v
        ? (v as Record<string, unknown>)[k]
        : undefined,
    o,
  )

test('every tool publishes its answer, and its answers fit it', async () => {
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
      bundles: [{
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

// The write door as a client's validator holds it: whether one bundle passes.
let door = (schema: unknown) => {
  let check = new AjvJsonSchemaValidator().getValidator(
    schema as Parameters<AjvJsonSchemaValidator['getValidator']>[0],
  )
  return (bundle: Record<string, unknown>) =>
    check({ bundles: [{ entity: { eid: '$b' }, ...bundle }] }).valid
}

// graph_apply's published input schema, compiled as the file loads.
let ok = door(
  inputSchemaOf(core({ vocab: shop }).find((t) => t.name == 'graph_apply')!),
)

test('a client checking a write against graph_apply passes what the server takes', () => {
  assertEquals(ok({ book: { price: 9, status: 'sold' } }), true)
  assertEquals(ok({ book: { price: null }, doc: null }), true)
  assertEquals(ok({ $delete: true, $was: { book: { price: null } } }), true)
  // The server's stamps riding back on a bundle a client read, and a word
  // declared after the client listed the tools.
  assertEquals(ok({ created: { at: '2026-10-12' }, later: { x: 1 } }), true)
})

test('a JSON Schema input declaration reaches the listing unchanged', async () => {
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

test('a non-object declared schema is not replaced in the neutral tool listing', async () => {
  let schema = { type: 'array', items: { type: 'string' } }
  let handler = createMcpHandler(() =>
    server({
      graph: shopGraph(),
      tools: [{
        name: 'declared_array',
        description: 'An externally declared root',
        input: {},
        outputSchema: schema,
        run: () => [],
      }],
    }), { legacy: 'reject' })
  let client = new Client({ name: 'schema-test', version: '0' }, pinned)
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://shop.test/mcp'), {
        fetch: (input, init) =>
          handler.fetch(
            input instanceof Request ? input : new Request(input, init),
          ),
      }),
    )
    let found = (await client.listTools()).tools.find((t) =>
      t.name == 'declared_array'
    )
    assertEquals(found?.outputSchema, schema)
  } finally {
    await client.close()
    await handler.close()
  }
})

test('modern custom parameter headers use the exact registered input schema before dispatch', async () => {
  let ran = 0
  let g = shopGraph()
  let handler = createMcpHandler(() =>
    server({
      graph: g,
      tools: [{
        name: 'header_shelf',
        description: 'Select a shelf',
        inputSchema: {
          type: 'object',
          required: ['shelf'],
          properties: {
            shelf: { type: 'string', 'x-mcp-header': 'Shelf' },
          },
        },
        run: () => {
          ran++
          return []
        },
      }],
    }), { legacy: 'reject' })
  let client = new Client({ name: 'header-test', version: '0' }, pinned)
  let mismatch = false
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://shop.test/mcp'), {
        fetch: (input, init) => {
          let request = input instanceof Request
            ? input
            : new Request(input, init)
          if (mismatch) request.headers.set('Mcp-Param-Shelf', 'different')
          return handler.fetch(request)
        },
      }),
    )
    await client.callTool({
      name: 'header_shelf',
      arguments: { shelf: 'poetry' },
    })
    assertEquals(ran, 1)
    mismatch = true
    let code: unknown
    try {
      await client.callTool({
        name: 'header_shelf',
        arguments: { shelf: 'poetry' },
      })
    } catch (error) {
      code = (error as { code?: unknown }).code
    }
    assertEquals(code, -32020)
    assertEquals(ran, 1)
    assertEquals((await g.read('.call')).length, 1)
  } finally {
    await client.close()
    await handler.close()
  }
})
