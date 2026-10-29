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
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { z } from 'zod'
import { argsOf } from '@yaks/graph'
import { CallError } from '@yaks/tools'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { type Options, server } from './server.ts'
import { answerWith, core, inputSchemaOf } from './tools.ts'
import { connect, pinned, shop, shopGraph } from './testing.ts'
import { inputSchema } from './schema.ts'
import { fileSchema } from './files.ts'
import { toolsSaid } from '@yaks/vocab/tools'

let schemaMeta = new Ajv2020({ strict: false, allErrors: true })
schemaMeta.validateSchema({})

// Exercise the declarations through the same generator and decoration as the
// live doors, including packages absent from the small graph fixtures below.
let declarations: { name: string; schema: Record<string, unknown> }[] = []
for await (let entry of Deno.readDir(new URL('../', import.meta.url))) {
  if (!entry.isDirectory) continue
  let source = new URL(`../${entry.name}/vocab.json`, import.meta.url)
  let doc
  try {
    doc = JSON.parse(await Deno.readTextFile(source))
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) continue
    throw err
  }
  for (let tool of toolsSaid(doc)) {
    let schema = fileSchema(inputSchemaOf({ ...tool, run: () => [] }), () => '')
    declarations.push({ name: `${entry.name}/${tool.name}`, schema })
  }
}
let malformed = declarations.flatMap(({ name, schema }) => {
  inputSchema(name, schema)
  return schemaMeta.validateSchema(schema)
    ? []
    : [{ name, errors: structuredClone(schemaMeta.errors) }]
})
test('every package tool builds an Anthropic-compatible MCP input schema', () => {
  assertEquals(malformed, [])
})

let at = (o: unknown, ...keys: string[]): unknown =>
  keys.reduce(
    (v, k) =>
      v && typeof v == 'object' && k in v
        ? (v as Record<string, unknown>)[k]
        : undefined,
    o,
  )

for (
  let [why, schema] of [
    ['root type', { type: 'array' }],
    ...['allOf', 'anyOf', 'oneOf'].map((key) => [
      key,
      { type: 'object', [key]: [{ required: ['body'] }] },
    ]),
    ...['$files', '', 'é', 'a b', 'x'.repeat(65)].map((key) => [
      'property',
      { type: 'object', properties: { [key]: {} } },
    ]),
  ] as [string, Record<string, unknown>][]
) {
  test(`MCP schema building refuses unsupported ${JSON.stringify(schema)}`, () => {
    assertThrows(() => inputSchema('write', schema), Error, why)
  })
}

test('MCP schema building preserves supported nested JSON Schema', () => {
  let schema = {
    type: 'object',
    properties: {
      ['x'.repeat(64)]: {
        anyOf: [
          { type: 'string', minLength: 1 },
          { type: 'object', properties: { $value: {} } },
        ],
      },
      'a.Z_9-': { allOf: [{ oneOf: [{ const: 1 }, { const: 2 }] }] },
    },
  }
  assertEquals(inputSchema('write', schema), schema)
})

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
  for (let tool of tools) {
    inputSchema(tool.name, tool.inputSchema)
    assertEquals(
      schemaMeta.validateSchema(tool.inputSchema),
      true,
      JSON.stringify(schemaMeta.errors),
    )
  }
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

// A row saying a word of its own beside its components, as yaks.app's rows
// say `kind`. Undeclared, a client refuses the whole answer after the server
// has sent it, so the server reports it as it leaves; declared through
// `answer`, the same rows fit. The client checks what it has listed, as a
// client does once connected.
let shelf = async (reported: string[], answer?: Options['answer']) => {
  let client = await connect({
    ...(answer ? { answer } : {}),
    report: (_err, _call, tool) => void reported.push(String(tool)),
    tools: [{
      name: 'shelf',
      description: 'The books on a shelf',
      input: {},
      readOnly: true,
      run: () => [{ entity: { eid: 'b1' }, kind: 'book', book: { price: 9 } }],
    }],
  })
  await client.listTools()
  return client
}

test('an answer outside its listed schema is reported, and fits once its row words are declared', async () => {
  let reported: string[] = []
  let bare = await shelf(reported)
  await assertRejects(() => bare.callTool({ name: 'shelf', arguments: {} }))
  assertEquals(reported, ['shelf'])
  await bare.close()

  let quiet: string[] = []
  let kinded = await shelf(quiet, answerWith({ kind: { type: 'string' } }))
  let out = await kinded.callTool({ name: 'shelf', arguments: {} })
  assertEquals(at(out.structuredContent, 'result', '0', 'kind'), 'book')
  assertEquals(quiet, [])
  await kinded.close()
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
