/// <reference lib="deno.ns" />
// The output schemas, as a client receives them: what `names` keeps, what
// `full` adds, and what each costs. A tool list is context an agent pays for
// before it has asked anything, so the price is worth a test.

import { assert, assertEquals } from '@std/assert'
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

Deno.test('both depths name every component and column', async () => {
  for (let depth of ['names', 'full'] as const) {
    let { schema } = await queried(depth)
    assertEquals(columnsOf(schema, 'book'), ['price', 'status', 'author'])
    assertEquals(columnsOf(schema, 'doc'), ['title', 'body'])
  }
})

Deno.test('names costs less than full, which is why it is the default', async () => {
  let cheap = await queried('names')
  let rich = await queried('full')
  assert(
    cheap.size < rich.size,
    `names (${cheap.size}) should be smaller than full (${rich.size})`,
  )
  // …and the default is the cheap one.
  let client = await connect()
  let { tools } = await client.listTools()
  assertEquals(JSON.stringify(tools).length, cheap.size)
  await client.close()
})

Deno.test('full spells out an enum, names leaves the value open', async () => {
  let rich = JSON.stringify((await queried('full')).schema)
  let cheap = JSON.stringify((await queried('names')).schema)
  assert(rich.includes('shelved'), 'full lists the enum members')
  assert(!cheap.includes('shelved'), 'names does not')
})
