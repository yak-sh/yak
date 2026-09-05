/// <reference lib="deno.ns" />
// The output schemas, as a client receives them: what `names` keeps, what
// `full` adds, and what each costs. A tool list is context an agent pays for
// before it has asked anything, so the price is worth a test.

import { assert, assertEquals } from '@std/assert'
import { z } from 'zod'
import { connect } from './harness.ts'

// The component's own columns, wherever the nullable wrapper put them: a
// component reads as `{object} | null`, so the object is either the schema or
// the first branch of its `anyOf`.
let columnsOf = (schema: unknown, comp: string): string[] => {
  let at = (o: unknown, key: string): unknown =>
    o && typeof o == 'object' && key in o
      ? (o as Record<string, unknown>)[key]
      : undefined
  let object = (o: unknown): unknown => {
    let any = at(o, 'anyOf')
    return Array.isArray(any) ? any[0] : o
  }
  let items = at(at(at(schema, 'properties'), 'result'), 'items')
  let props = at(object(at(at(items, 'properties'), comp)), 'properties')
  return props && typeof props == 'object' ? Object.keys(props) : []
}

let queried = async (depth: 'names' | 'full') => {
  let client = await connect({ schema: depth })
  let { tools } = await client.listTools()
  let tool = tools.find((t: { name: string }) => t.name == 'graph_query')
  await client.close()
  return { schema: tool?.outputSchema, size: JSON.stringify(tools).length }
}

// graph_apply's published INPUT schema — the write door as a client reads it.
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

Deno.test('both depths name every component and column', async () => {
  for (let depth of ['names', 'full'] as const) {
    let { schema } = await queried(depth)
    assertEquals(columnsOf(schema, 'book'), ['price', 'status', 'author'])
    assertEquals(columnsOf(schema, 'doc'), ['title', 'body'])
  }
})

Deno.test('names costs less than full, which is the default anyway', async () => {
  let cheap = await queried('names')
  let rich = await queried('full')
  assert(
    cheap.size < rich.size,
    `names (${cheap.size}) should be smaller than full (${rich.size})`,
  )
  // …and what a host gets without asking is the typed one: an agent guessing
  // at a column costs more than the schema does (T-34153).
  let client = await connect()
  let { tools } = await client.listTools()
  assertEquals(JSON.stringify(tools).length, rich.size)
  await client.close()
})

Deno.test('full spells out an enum, names leaves the value open', async () => {
  let rich = JSON.stringify((await queried('full')).schema)
  let cheap = JSON.stringify((await queried('names')).schema)
  assert(rich.includes('shelved'), 'full lists the enum members')
  assert(!cheap.includes('shelved'), 'names does not')
})

// The WRITE door (T-34153): graph_apply's input schema is the vocabulary, so
// an agent reads the columns and their types before it writes any, rather
// than guessing at them and learning from a refusal.
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

// A host whose door answers a column differently than the vocabulary declares
// says so once, and every schema is derived through it — yaks.app reads a
// reference back as `{eid, name}` and takes an id (agent.ts `reading`).
Deno.test('a host spells its own reading of a column, read and write', async () => {
  let client = await connect({
    schema: 'full',
    column: (col, o) =>
      col.category == 'ref' && !o.write
        ? z.object({ eid: z.string() }).passthrough()
        : undefined,
  })
  let { tools } = await client.listTools()
  let of = (name: string, where: 'inputSchema' | 'outputSchema') =>
    JSON.stringify(
      tools.find((t: { name: string }) => t.name == name)?.[where],
    )
  await client.close()
  // The read says the object it answers, where the vocabulary says a string…
  let read = at(
    JSON.parse(of('graph_query', 'outputSchema')),
    'properties',
    'result',
    'items',
    'properties',
    'book',
    'properties',
    'author',
    'anyOf',
    '0',
  )
  assertEquals(at(read, 'type'), 'object')
  assertEquals(Object.keys(at(read, 'properties') as object), ['eid'])
  // …and the write still takes the id.
  let author = at(
    JSON.parse(of('graph_apply', 'inputSchema')),
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

Deno.test('the write door is closed: a stamped or misspelled column is not in it', async () => {
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
  // And a column nobody declared is refused by the schema itself, which is
  // what `apply()` does with it anyway.
  assertEquals(at(comp('book'), 'additionalProperties'), false)
})
